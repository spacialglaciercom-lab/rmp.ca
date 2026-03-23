/**
 * Post-Route AI Parser — Logistics Report Generator
 *
 * Translates raw PostGIS spatial data into a summarized "Logistics Report"
 * that LLMs can easily understand and analyze. This bridges the gap between
 * complex spatial math and actionable insights.
 *
 * Flow:
 * 1. PostGIS calculates distances, clusters, coverage gaps
 * 2. This service formats results into human-readable summaries
 * 3. AI Gateway receives the report and provides recommendations
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { collectionPoints } from "../drizzle/schema";

export interface LogisticsReport {
  summary: {
    totalPoints: number;
    collectedCount: number;
    remainingCount: number;
    completionPercentage: number;
    totalDistanceMeters: number;
    estimatedTimeMinutes: number;
  };
  spatialAnalysis: {
    coverageRadius: number;
    clusterCount: number;
    largestClusterSize: number;
    isolatedPoints: number;
    avgInterPointDistance: number;
    maxInterPointDistance: number;
  };
  efficiency: {
    routeEfficiencyScore: number;
    backtrackingRisk: "low" | "medium" | "high";
    deadheadPercentage: number;
    suggestedOptimizations: string[];
  };
  hotspots: Array<{
    lat: number;
    lng: number;
    pointCount: number;
    avgDistance: number;
  }>;
  recommendations: string[];
}

export interface RouteAnalysisInput {
  driverLng: number;
  driverLat: number;
  routeId?: string;
  includeCollected?: boolean;
}

/**
 * Generate a comprehensive logistics report from PostGIS spatial data.
 * This is the "operational goldmine" that gets fed to the AI.
 */
export async function generateLogisticsReport(
  input: RouteAnalysisInput
): Promise<LogisticsReport> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database connection not available");
  }

  const { driverLng, driverLat, includeCollected = false } = input;

  // 1. Get summary statistics
  const summaryResult = await db.execute(sql`
    SELECT 
      COUNT(*)::int as total_points,
      COUNT(*) FILTER (WHERE is_collected = true)::int as collected_count,
      COUNT(*) FILTER (WHERE is_collected = false)::int as remaining_count,
      COALESCE(SUM(ST_Distance(location, ST_MakePoint(${driverLng}, ${driverLat})::geography)), 0)::float as total_distance_meters
    FROM ${collectionPoints}
    ${includeCollected ? sql`` : sql`WHERE is_collected = false`}
  `);

  const summary = summaryResult[0] as {
    total_points: number;
    collected_count: number;
    remaining_count: number;
    total_distance_meters: number;
  };

  const totalPoints = summary.total_points ?? 0;
  const collectedCount = summary.collected_count ?? 0;
  const remainingCount = summary.remaining_count ?? 0;
  const totalDistanceMeters = summary.total_distance_meters ?? 0;

  // 2. Calculate inter-point distances for efficiency analysis
  const interPointStats = await db.execute(sql`
    WITH points AS (
      SELECT id, location
      FROM ${collectionPoints}
      ${includeCollected ? sql`` : sql`WHERE is_collected = false`}
    ),
    distances AS (
      SELECT 
        p1.id as from_id,
        p2.id as to_id,
        ST_Distance(p1.location, p2.location) as distance
      FROM points p1
      CROSS JOIN points p2
      WHERE p1.id < p2.id
    )
    SELECT 
      AVG(distance)::float as avg_distance,
      MAX(distance)::float as max_distance,
      MIN(distance)::float as min_distance
    FROM distances
  `);

  const interPoint = interPointStats[0] as {
    avg_distance: number | null;
    max_distance: number | null;
    min_distance: number | null;
  };

  // 3. Identify clusters using PostGIS ST_ClusterKMeans (if available) or simple grouping
  const clusterResult = await db.execute(sql`
    WITH points AS (
      SELECT 
        id,
        location,
        ST_X(location::geometry) as lng,
        ST_Y(location::geometry) as lat
      FROM ${collectionPoints}
      ${includeCollected ? sql`` : sql`WHERE is_collected = false`}
    ),
    point_distances AS (
      SELECT 
        p1.id,
        p1.lng,
        p1.lat,
        AVG(ST_Distance(p1.location, p2.location)) as avg_dist_to_others
      FROM points p1
      CROSS JOIN points p2
      WHERE p1.id != p2.id
      GROUP BY p1.id, p1.lng, p1.lat
    )
    SELECT 
      id,
      lng,
      lat,
      avg_dist_to_others,
      CASE 
        WHEN avg_dist_to_others > 500 THEN 'isolated'
        ELSE 'clustered'
      END as point_type
    FROM point_distances
    ORDER BY avg_dist_to_others DESC
    LIMIT 20
  `);

  // 4. Calculate hotspots (areas with high point density)
  const hotspots = await db.execute(sql`
    WITH points AS (
      SELECT 
        id,
        location,
        ST_X(location::geometry) as lng,
        ST_Y(location::geometry) as lat
      FROM ${collectionPoints}
      ${includeCollected ? sql`` : sql`WHERE is_collected = false`}
    ),
    grid AS (
      SELECT 
        FLOOR(lng * 100) / 100 as grid_x,
        FLOOR(lat * 100) / 100 as grid_y,
        COUNT(*) as point_count,
        AVG(lng) as avg_lng,
        AVG(lat) as avg_lat,
        AVG(ST_Distance(location, ST_MakePoint(${driverLng}, ${driverLat})::geography)) as avg_dist
      FROM points
      GROUP BY FLOOR(lng * 100), FLOOR(lat * 100)
      HAVING COUNT(*) >= 2
    )
    SELECT 
      avg_lat as lat,
      avg_lng as lng,
      point_count,
      avg_dist as avg_distance
    FROM grid
    ORDER BY point_count DESC
    LIMIT 5
  `);

  // 5. Calculate efficiency metrics
  const isolatedPoints = (clusterResult as unknown as Array<{ point_type: string }>).filter(
    (p) => p.point_type === "isolated"
  ).length;

  const avgInterPointDistance = interPoint.avg_distance ?? 0;
  const maxInterPointDistance = interPoint.max_distance ?? 0;

  // Calculate route efficiency score (0-100)
  // Lower avg distance = higher efficiency
  const efficiencyBase = Math.max(0, 100 - (avgInterPointDistance / 50));
  const clusterBonus = Math.min(20, (totalPoints - isolatedPoints) * 2);
  const routeEfficiencyScore = Math.min(100, Math.max(0, efficiencyBase + clusterBonus));

  // Determine backtracking risk
  let backtrackingRisk: "low" | "medium" | "high";
  if (avgInterPointDistance < 200 && isolatedPoints < 3) {
    backtrackingRisk = "low";
  } else if (avgInterPointDistance < 500 && isolatedPoints < 10) {
    backtrackingRisk = "medium";
  } else {
    backtrackingRisk = "high";
  }

  // Calculate deadhead percentage (estimated travel without collection)
  const deadheadPercentage = totalPoints > 0 
    ? Math.min(100, (isolatedPoints / totalPoints) * 100 + (avgInterPointDistance / 1000) * 10)
    : 0;

  // Generate optimization suggestions
  const suggestedOptimizations: string[] = [];
  if (isolatedPoints > 5) {
    suggestedOptimizations.push(
      `${isolatedPoints} isolated points detected — consider reassigning to nearest cluster route`
    );
  }
  if (avgInterPointDistance > 500) {
    suggestedOptimizations.push(
      "High average inter-point distance — route may benefit from zone-based optimization"
    );
  }
  if (hotspots.length > 2) {
    suggestedOptimizations.push(
      `${hotspots.length} hotspot zones identified — prioritize these for efficiency`
    );
  }
  if (remainingCount > 20 && routeEfficiencyScore < 60) {
    suggestedOptimizations.push(
      "Consider splitting route into multiple sub-routes for better coverage"
    );
  }

  // Estimate time (assuming 2 min per stop + 1 min per 100m travel)
  const estimatedTimeMinutes = remainingCount * 2 + (totalDistanceMeters / 100) * 1;

  const completionPercentage = totalPoints > 0 
    ? Math.round((collectedCount / totalPoints) * 100)
    : 0;

  // Generate initial recommendations
  const recommendations: string[] = [];
  if (completionPercentage > 80) {
    recommendations.push("Route nearing completion — prepare for end-of-day reporting");
  }
  if (remainingCount > 50) {
    recommendations.push("High remaining count — consider requesting additional resources");
  }
  if (backtrackingRisk === "high") {
    recommendations.push("High backtracking risk detected — review route sequence");
  }

  return {
    summary: {
      totalPoints,
      collectedCount,
      remainingCount,
      completionPercentage,
      totalDistanceMeters: Math.round(totalDistanceMeters),
      estimatedTimeMinutes: Math.round(estimatedTimeMinutes),
    },
    spatialAnalysis: {
      coverageRadius: Math.round(maxInterPointDistance / 2),
      clusterCount: hotspots.length,
      largestClusterSize: Math.max(
        ...((hotspots as unknown as Array<{ point_count: number }>).map((h) => h.point_count) as number[]),
        0
      ),
      isolatedPoints,
      avgInterPointDistance: Math.round(avgInterPointDistance),
      maxInterPointDistance: Math.round(maxInterPointDistance),
    },
    efficiency: {
      routeEfficiencyScore: Math.round(routeEfficiencyScore),
      backtrackingRisk,
      deadheadPercentage: Math.round(deadheadPercentage * 10) / 10,
      suggestedOptimizations,
    },
    hotspots: (hotspots as unknown as Array<{ lat: number; lng: number; point_count: number; avg_distance: number }>).map(
      (h) => ({
        lat: h.lat,
        lng: h.lng,
        pointCount: h.point_count,
        avgDistance: Math.round(h.avg_distance),
      })
    ),
    recommendations,
  };
}

/**
 * Format the logistics report as a human-readable string for AI consumption.
 * This is what gets passed to the LLM for analysis.
 */
export function formatReportForAI(report: LogisticsReport): string {
  const lines: string[] = [
    "## Route Logistics Report",
    "",
    "### Summary",
    `- Total Collection Points: ${report.summary.totalPoints}`,
    `- Collected: ${report.summary.collectedCount} (${report.summary.completionPercentage}%)`,
    `- Remaining: ${report.summary.remainingCount}`,
    `- Total Distance: ${(report.summary.totalDistanceMeters / 1000).toFixed(2)} km`,
    `- Estimated Time Remaining: ${report.summary.estimatedTimeMinutes} minutes`,
    "",
    "### Spatial Analysis",
    `- Coverage Radius: ${report.spatialAnalysis.coverageRadius}m`,
    `- Clusters Detected: ${report.spatialAnalysis.clusterCount}`,
    `- Largest Cluster: ${report.spatialAnalysis.largestClusterSize} points`,
    `- Isolated Points: ${report.spatialAnalysis.isolatedPoints}`,
    `- Avg Inter-Point Distance: ${report.spatialAnalysis.avgInterPointDistance}m`,
    `- Max Inter-Point Distance: ${report.spatialAnalysis.maxInterPointDistance}m`,
    "",
    "### Efficiency Metrics",
    `- Route Efficiency Score: ${report.efficiency.routeEfficiencyScore}/100`,
    `- Backtracking Risk: ${report.efficiency.backtrackingRisk}`,
    `- Deadhead Percentage: ${report.efficiency.deadheadPercentage}%`,
    "",
    "### Hotspot Zones",
  ];

  report.hotspots.forEach((h, i) => {
    lines.push(
      `  ${i + 1}. (${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}) — ${h.pointCount} points, avg distance: ${h.avgDistance}m`
    );
  });

  if (report.efficiency.suggestedOptimizations.length > 0) {
    lines.push("", "### Suggested Optimizations");
    report.efficiency.suggestedOptimizations.forEach((opt) => {
      lines.push(`- ${opt}`);
    });
  }

  if (report.recommendations.length > 0) {
    lines.push("", "### Initial Recommendations");
    report.recommendations.forEach((rec) => {
      lines.push(`- ${rec}`);
    });
  }

  return lines.join("\n");
}