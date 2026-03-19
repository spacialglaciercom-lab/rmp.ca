import { CollectionPoint } from "@/types";
import { RouteStatistics, RouteReport, TurnPenalties } from "@/types/routing";

/** Format a date in Canada time (America/Toronto - Eastern). Returns ISO-like string with timezone. */
export function formatDateCanadaTime(
  date: Date,
  timeZone: string = "America/Toronto",
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const tz = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")} ${tz ?? timeZone}`.trim();
}

/** Format a date in the device's local timezone (actual time on the device). */
export function formatDateDeviceLocal(date: Date): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const tz = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")} ${tz ?? timeZone}`.trim();
}

export interface ExportMetadata {
  appName: string;
  appVersion: string;
  exportedAt: string;
  routeName: string;
  totalPoints: number;
}

export interface RouteExportData {
  metadata: ExportMetadata;
  configuration: {
    turnPenalties: TurnPenalties;
    startPoint?: {
      latitude: number;
      longitude: number;
      name?: string;
    };
  };
  statistics: RouteStatistics | null;
  report: RouteReport | null;
  collectionPoints: CollectionPoint[];
}

// Generate export metadata
export function generateExportMetadata(
  routeName: string,
  pointCount: number,
): ExportMetadata {
  return {
    appName: "RouteMasterPro",
    appVersion: "1.0.0",
    exportedAt: formatDateCanadaTime(new Date()),
    routeName,
    totalPoints: pointCount,
  };
}

// Export to JSON format (sanitizes estimated time, converts timestamps to Canada time)
export function exportToJSON(data: RouteExportData): string {
  const sanitized = { ...data };
  if (data.metadata) {
    sanitized.metadata = {
      ...data.metadata,
      exportedAt: formatDateCanadaTime(new Date()),
    };
  }
  if (data.statistics) {
    sanitized.statistics = sanitizeRouteStatistics(data.statistics);
  }
  if (data.report) {
    sanitized.report = {
      ...data.report,
      ...(data.report.routeStats && {
        routeStats: sanitizeRouteStatistics(data.report.routeStats),
      }),
      generatedAt:
        data.report.generatedAt instanceof Date
          ? data.report.generatedAt
          : new Date(data.report.generatedAt),
    };
  }
  return JSON.stringify(sanitized, null, 2);
}

// Export to CSV format
export function exportToCSV(
  points: CollectionPoint[],
  statistics: RouteStatistics | null,
  routeName: string,
): string {
  const lines: string[] = [];

  // Header section
  lines.push("# RouteMasterPro Export");
  lines.push(`# Route Name: ${routeName}`);
  lines.push(`# Exported: ${new Date().toISOString()}`);
  lines.push("");

  // Statistics section
  if (statistics) {
    const estimatedTime = sanitizeEstimatedTime(statistics);
    lines.push("# Route Statistics");
    lines.push(`# Total Distance: ${statistics.totalDistance.toFixed(2)} km`);
    lines.push(`# Estimated Time: ${estimatedTime} minutes`);
    lines.push(`# Right Turns: ${statistics.turns.rightTurns}`);
    lines.push(`# Left Turns: ${statistics.turns.leftTurns}`);
    lines.push(`# U-Turns: ${statistics.turns.uTurns}`);
    lines.push(`# Straight: ${statistics.turns.straightAhead}`);
    lines.push("");
  }

  // Collection points header
  lines.push(
    "id,address,location_name,latitude,longitude,collection_type,status,scheduled_time,notes",
  );

  // Collection points data
  for (const point of points) {
    const row = [
      escapeCSV(point.id),
      escapeCSV(point.address),
      escapeCSV(point.locationName || ""),
      point.latitude.toFixed(6),
      point.longitude.toFixed(6),
      escapeCSV(point.collectionType),
      escapeCSV(point.status),
      escapeCSV(point.scheduledTime || ""),
      escapeCSV(point.notes || ""),
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

/** Sanitize estimated time if it implies an impossibly slow average speed (< 10 km/h) */
export function sanitizeEstimatedTime(stats: RouteStatistics): number {
  if (stats.totalDistance <= 0 || stats.estimatedTime <= 0)
    return stats.estimatedTime;
  const impliedSpeedKmh = (stats.totalDistance / stats.estimatedTime) * 60;
  if (impliedSpeedKmh < 10) {
    return Math.round((stats.totalDistance / 25) * 60); // 25 km/h typical for trash collection
  }
  return stats.estimatedTime;
}

/** Return statistics with sanitized estimated time for export */
export function sanitizeRouteStatistics(
  stats: RouteStatistics,
): RouteStatistics {
  return { ...stats, estimatedTime: sanitizeEstimatedTime(stats) };
}

// Export statistics only to CSV
export function exportStatisticsToCSV(
  statistics: RouteStatistics,
  penalties: TurnPenalties,
  routeName: string,
): string {
  const lines: string[] = [];
  const estimatedTime = sanitizeEstimatedTime(statistics);

  lines.push("metric,value,unit");
  lines.push(`route_name,${escapeCSV(routeName)},`);
  lines.push(`export_time,${formatDateDeviceLocal(new Date())},`);
  lines.push(`total_distance,${statistics.totalDistance.toFixed(2)},km`);
  lines.push(`estimated_time,${estimatedTime},minutes`);
  lines.push(`total_traversals,${statistics.totalTraversals},count`);
  lines.push(`right_turns,${statistics.turns.rightTurns},count`);
  lines.push(`left_turns,${statistics.turns.leftTurns},count`);
  lines.push(`u_turns,${statistics.turns.uTurns},count`);
  lines.push(`straight_ahead,${statistics.turns.straightAhead},count`);
  lines.push(`segments_routed,${statistics.segmentsRouted},count`);
  lines.push(`segments_excluded,${statistics.segmentsExcluded},count`);
  if (statistics.efficiency !== undefined) {
    lines.push(`efficiency,${statistics.efficiency.toFixed(1)},percent`);
  }
  if (statistics.deadEndsIdentified !== undefined) {
    lines.push(`dead_ends_identified,${statistics.deadEndsIdentified},count`);
  }
  if (statistics.onewayViolations !== undefined) {
    lines.push(`oneway_violations,${statistics.onewayViolations},count`);
  }
  if (statistics.uTurnsAvoided !== undefined) {
    lines.push(`u_turns_avoided,${statistics.uTurnsAvoided},count`);
  }
  lines.push(`left_turn_penalty,${penalties.leftTurn},weight`);
  lines.push(`u_turn_penalty,${penalties.uTurn},weight`);
  lines.push(`right_turn_penalty,${penalties.rightTurn},weight`);

  return lines.join("\n");
}

// Generate a unique export id (avoids collision when exporting multiple routes in same session)
function uniqueExportId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// Export for fleet management systems
export function exportForFleetManagement(
  points: CollectionPoint[],
  statistics: RouteStatistics | null,
  routeName: string,
): string {
  const data = {
    version: "1.0",
    format: "fleet_management_v1",
    route: {
      id: `route_${uniqueExportId()}`,
      name: routeName,
      created: formatDateDeviceLocal(new Date()),
      status: "planned",
    },
    summary: statistics
      ? {
          distance_km: statistics.totalDistance,
          duration_minutes: sanitizeEstimatedTime(statistics),
          stop_count: points.length,
          turn_summary: {
            right: statistics.turns.rightTurns,
            left: statistics.turns.leftTurns,
            u_turn: statistics.turns.uTurns,
          },
        }
      : null,
    stops: points.map((point, index) => ({
      sequence: index + 1,
      stop_id: point.id,
      travel_time_from_previous_stop_minutes: 0,
      location: {
        address: point.address,
        name: point.locationName,
        coordinates: {
          lat: point.latitude,
          lng: point.longitude,
        },
      },
      service: {
        type: point.collectionType,
        scheduled_time: point.scheduledTime,
        estimated_duration_minutes: 0,
      },
      notes: point.notes || null,
      status: point.status,
    })),
  };

  return JSON.stringify(data, null, 2);
}

// Helper function to escape CSV values
function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Get file extension for export format
export function getExportExtension(format: ExportFormat): string {
  switch (format) {
    case "json":
      return ".json";
    case "csv":
      return ".csv";
    case "fleet":
      return ".json";
    case "gpx":
      return ".gpx";
    default:
      return ".txt";
  }
}

// Export format types
export type ExportFormat = "json" | "csv" | "fleet" | "gpx";

// Get MIME type for export format
export function getExportMimeType(format: ExportFormat): string {
  switch (format) {
    case "json":
    case "fleet":
      return "application/json";
    case "csv":
      return "text/csv";
    case "gpx":
      return "application/gpx+xml";
    default:
      return "text/plain";
  }
}
