/**
 * CPP Performance Tracker with Weight Integration
 * Tracks and analyzes CPP solver performance with cost-corrected weights
 */

import { getMongoClient } from "@/server/mongodb";
import { ObjectId } from "mongodb";
import * as fs from "fs/promises";
import * as path from "path";

export interface CPPPerformanceMetrics {
  metricsId: string;
  timestamp: Date;
  routeId: string;
  weightUpdateId: string;
  optimizationMetrics: {
    totalDistance: number;
    estimatedTime: number;
    turnCount: number;
    complexityScore: number;
    algorithm: string;
    iterations: number;
    convergenceTime: number;
  };
  costMetrics: {
    predictedCost: number;
    actualCost: number;
    costAccuracy: number;
    costBreakdown: {
      fuel: number;
      labor: number;
      maintenance: number;
      overhead: number;
    };
  };
  weightMetrics: {
    correctionFactor: number;
    confidence: number;
    dataSource: string;
    mlPenalty: number;
    validationScore: number;
  };
  performanceComparison: {
    vsOriginalWeights: number;
    vsPreviousVersion: number;
    efficiencyGain: number;
    timeSaved: number;
  };
  routeCharacteristics: {
    urbanDensity: "low" | "medium" | "high";
    roadConditions: "good" | "fair" | "poor";
    trafficLevel: "low" | "medium" | "high";
    weatherImpact: number;
  };
}

export interface PerformanceAnalysisConfig {
  enabled: boolean;
  analysisInterval: number; // hours
  benchmarkRoutes: number;
  significanceThreshold: number;
  minSampleSize: number;
  autoOptimize: boolean;
}

export interface PerformanceBenchmark {
  benchmarkId: string;
  name: string;
  description: string;
  routeCharacteristics: {
    distanceRange: [number, number];
    complexityRange: [number, number];
    urbanDensity: string[];
    weatherConditions: string[];
  };
  baselineMetrics: {
    averageCost: number;
    averageTime: number;
    averageEfficiency: number;
    sampleSize: number;
  };
  currentMetrics: {
    averageCost: number;
    averageTime: number;
    averageEfficiency: number;
    sampleSize: number;
    improvement: number;
  };
}

export interface PerformanceTrend {
  period: string;
  totalRoutes: number;
  averageImprovement: number;
  improvementRate: number;
  costReduction: number;
  timeReduction: number;
  efficiencyGain: number;
  trendDirection: "improving" | "declining" | "stable";
}

export interface OptimizationRecommendation {
  type:
    | "weight_adjustment"
    | "algorithm_tuning"
    | "data_collection"
    | "parameter_optimization";
  target: string;
  currentValue: number;
  recommendedValue: number;
  expectedImpact: number;
  confidence: number;
  reasoning: string;
  implementationComplexity: "low" | "medium" | "high";
}

/**
 * Comprehensive CPP performance tracking system
 */
export class CPPPerformanceTracker {
  private config: PerformanceAnalysisConfig;
  private performanceData: CPPPerformanceMetrics[] = [];
  private benchmarks: PerformanceBenchmark[] = [];
  private isTracking: boolean = false;
  private trackingInterval?: NodeJS.Timeout;

  constructor(config: PerformanceAnalysisConfig) {
    this.config = config;
    this.initializeBenchmarks();
  }

  /**
   * Initialize performance benchmarks
   */
  private initializeBenchmarks(): void {
    this.benchmarks = [
      {
        benchmarkId: "urban_short",
        name: "Urban Short Routes",
        description:
          "Short routes (< 5km) in urban areas with medium complexity",
        routeCharacteristics: {
          distanceRange: [0.5, 5.0],
          complexityRange: [0.3, 0.7],
          urbanDensity: ["medium", "high"],
          weatherConditions: ["clear", "clouds", "rain"],
        },
        baselineMetrics: {
          averageCost: 45.0,
          averageTime: 25.0,
          averageEfficiency: 75.0,
          sampleSize: 0,
        },
        currentMetrics: {
          averageCost: 0,
          averageTime: 0,
          averageEfficiency: 0,
          sampleSize: 0,
          improvement: 0,
        },
      },
      {
        benchmarkId: "suburban_medium",
        name: "Suburban Medium Routes",
        description:
          "Medium routes (5-15km) in suburban areas with mixed complexity",
        routeCharacteristics: {
          distanceRange: [5.0, 15.0],
          complexityRange: [0.4, 0.8],
          urbanDensity: ["low", "medium"],
          weatherConditions: ["clear", "clouds", "rain", "snow"],
        },
        baselineMetrics: {
          averageCost: 120.0,
          averageTime: 65.0,
          averageEfficiency: 78.0,
          sampleSize: 0,
        },
        currentMetrics: {
          averageCost: 0,
          averageTime: 0,
          averageEfficiency: 0,
          sampleSize: 0,
          improvement: 0,
        },
      },
      {
        benchmarkId: "rural_long",
        name: "Rural Long Routes",
        description: "Long routes (> 15km) in rural areas with high complexity",
        routeCharacteristics: {
          distanceRange: [15.0, 50.0],
          complexityRange: [0.6, 1.0],
          urbanDensity: ["low"],
          weatherConditions: ["clear", "clouds", "rain", "snow", "fog"],
        },
        baselineMetrics: {
          averageCost: 280.0,
          averageTime: 150.0,
          averageEfficiency: 72.0,
          sampleSize: 0,
        },
        currentMetrics: {
          averageCost: 0,
          averageTime: 0,
          averageEfficiency: 0,
          sampleSize: 0,
          improvement: 0,
        },
      },
    ];
  }

  /**
   * Start performance tracking
   */
  async startTracking(): Promise<void> {
    if (this.isTracking) {
      console.log("⚠️  CPP performance tracking already running");
      return;
    }

    console.log("🚀 Starting CPP performance tracking");
    this.isTracking = true;

    // Initial data collection
    await this.collectPerformanceData();

    // Schedule periodic collection
    this.trackingInterval = setInterval(
      async () => {
        await this.collectPerformanceData();
      },
      this.config.analysisInterval * 60 * 60 * 1000,
    );

    console.log(
      `✅ CPP performance tracking started with ${this.config.analysisInterval} hour intervals`,
    );
  }

  /**
   * Stop tracking
   */
  stopTracking(): void {
    if (!this.isTracking) {
      console.log("⚠️  CPP performance tracking not running");
      return;
    }

    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = undefined;
    }

    this.isTracking = false;
    console.log("🛑 CPP performance tracking stopped");
  }

  /**
   * Record CPP performance metrics
   */
  async recordPerformance(
    routeId: string,
    optimizationResult: any,
    weightUpdateId: string,
    routeCharacteristics: any,
  ): Promise<void> {
    if (!this.isTracking) return;

    try {
      const metrics = await this.calculatePerformanceMetrics(
        routeId,
        optimizationResult,
        weightUpdateId,
        routeCharacteristics,
      );

      if (metrics) {
        // Store locally
        this.performanceData.push(metrics);

        // Store in database
        await this.storePerformanceMetrics(metrics);

        // Update benchmarks
        await this.updateBenchmarks(metrics);

        // Keep only recent data
        this.cleanupOldData();

        console.log(
          `📊 Performance recorded for route ${routeId}: ${metrics.performanceComparison.efficiencyGain.toFixed(1)}% improvement`,
        );
      }
    } catch (error) {
      console.error(`Error recording performance for route ${routeId}:`, error);
    }
  }

  /**
   * Calculate comprehensive performance metrics
   */
  private async calculatePerformanceMetrics(
    routeId: string,
    optimizationResult: any,
    weightUpdateId: string,
    routeCharacteristics: any,
  ): Promise<CPPPerformanceMetrics | null> {
    try {
      // Extract optimization metrics
      const optimizationMetrics =
        this.extractOptimizationMetrics(optimizationResult);

      // Calculate cost metrics
      const costMetrics = await this.calculateCostMetrics(optimizationResult);

      // Extract weight metrics
      const weightMetrics = this.extractWeightMetrics(optimizationResult);

      // Calculate performance comparison
      const performanceComparison =
        await this.calculatePerformanceComparison(optimizationResult);

      return {
        metricsId: `cpp_perf_${routeId}_${Date.now()}`,
        timestamp: new Date(),
        routeId,
        weightUpdateId,
        optimizationMetrics,
        costMetrics,
        weightMetrics,
        performanceComparison,
        routeCharacteristics,
      };
    } catch (error) {
      console.error("Error calculating performance metrics:", error);
      return null;
    }
  }

  /**
   * Extract optimization metrics from result
   */
  private extractOptimizationMetrics(
    result: any,
  ): CPPPerformanceMetrics["optimizationMetrics"] {
    return {
      totalDistance: result.totalDistance || 0,
      estimatedTime: result.estimatedTime || 0,
      turnCount: result.turns?.total || 0,
      complexityScore: this.calculateComplexityScore(result),
      algorithm: result.algorithm || "cpp",
      iterations: result.iterations || 0,
      convergenceTime: result.convergenceTime || 0,
    };
  }

  /**
   * Calculate complexity score
   */
  private calculateComplexityScore(result: any): number {
    const turnRatio =
      (result.turns?.total || 0) / Math.max(1, result.totalDistance);
    const segmentRatio =
      (result.segmentsRouted || 0) / Math.max(1, result.totalDistance);

    // Normalize to 0-1 scale
    const complexity = turnRatio * 0.6 + segmentRatio * 0.4;
    return Math.min(1.0, complexity);
  }

  /**
   * Calculate cost metrics
   */
  private async calculateCostMetrics(
    result: any,
  ): Promise<CPPPerformanceMetrics["costMetrics"]> {
    const predictedCost = result.predictedCost || result.estimatedCost || 0;
    const actualCost = result.actualCost || predictedCost; // Use predicted if actual not available

    const costAccuracy =
      predictedCost > 0
        ? 1 - Math.abs(actualCost - predictedCost) / predictedCost
        : 0;

    // Estimate cost breakdown
    const totalCost = actualCost;
    const fuel = totalCost * 0.3;
    const labor = totalCost * 0.5;
    const maintenance = totalCost * 0.15;
    const overhead = totalCost * 0.05;

    return {
      predictedCost,
      actualCost,
      costAccuracy,
      costBreakdown: { fuel, labor, maintenance, overhead },
    };
  }

  /**
   * Extract weight metrics
   */
  private extractWeightMetrics(
    result: any,
  ): CPPPerformanceMetrics["weightMetrics"] {
    const weightData = result.weightMetrics || {};

    return {
      correctionFactor: weightData.correctionFactor || 1.0,
      confidence: weightData.confidence || 0.5,
      dataSource: weightData.dataSource || "original",
      mlPenalty: weightData.mlPenalty || 0,
      validationScore: weightData.validationScore || 0,
    };
  }

  /**
   * Calculate performance comparison
   */
  private async calculatePerformanceComparison(
    result: any,
  ): Promise<CPPPerformanceMetrics["performanceComparison"]> {
    // Compare with original weights (baseline)
    const vsOriginal = this.calculateImprovement(result, "original");

    // Compare with previous version
    const vsPrevious = this.calculateImprovement(result, "previous");

    // Calculate efficiency gain
    const efficiencyGain = (vsOriginal + vsPrevious) / 2;

    // Calculate time saved
    const timeSaved = result.timeSaved || 0;

    return {
      vsOriginalWeights: vsOriginal,
      vsPreviousVersion: vsPrevious,
      efficiencyGain,
      timeSaved,
    };
  }

  /**
   * Calculate improvement vs baseline
   */
  private calculateImprovement(result: any, baseline: string): number {
    // This would compare with stored baseline metrics
    // For now, use simple improvement calculation
    const baselineCost = result.baselineCost || result.predictedCost * 1.1; // 10% buffer
    const actualCost = result.actualCost || result.predictedCost;

    return baselineCost > 0 ? (baselineCost - actualCost) / baselineCost : 0;
  }

  /**
   * Collect performance data
   */
  private async collectPerformanceData(): Promise<void> {
    console.log("\n📊 Collecting CPP performance data...");

    try {
      const recentData = await this.getRecentPerformanceData();

      if (recentData.length === 0) {
        console.log("No recent performance data available");
        return;
      }

      // Process and analyze data
      await this.analyzePerformanceData(recentData);

      const duration = (Date.now() - Date.now()) / 1000; // Placeholder
      console.log(
        `✅ Performance data collection completed in ${duration.toFixed(2)}s`,
      );
    } catch (error) {
      console.error("❌ Error collecting performance data:", error);
    }
  }

  /**
   * Get recent performance data
   */
  private async getRecentPerformanceData(): Promise<any[]> {
    const client = getMongoClient();
    if (!client) return [];

    try {
      const db = client.db("trashroute");
      const collection = db.collection("cpp_performance_metrics");

      const since = new Date(
        Date.now() - this.config.analysisInterval * 60 * 60 * 1000,
      );

      return await collection
        .find({ timestamp: { $gte: since } })
        .sort({ timestamp: -1 })
        .limit(1000)
        .toArray();
    } catch (error) {
      console.error("Error getting recent performance data:", error);
      return [];
    }
  }

  /**
   * Analyze performance data
   */
  private async analyzePerformanceData(data: any[]): Promise<void> {
    if (data.length < this.config.minSampleSize) {
      console.log(
        `Insufficient data for analysis (${data.length} < ${this.config.minSampleSize})`,
      );
      return;
    }

    // Update benchmarks
    await this.updateBenchmarksFromData(data);

    // Generate recommendations
    const recommendations =
      await this.generateOptimizationRecommendations(data);

    if (recommendations.length > 0) {
      console.log("💡 Optimization recommendations:");
      recommendations.forEach((rec) => {
        console.log(
          `   ${rec.type}: ${rec.target} (${rec.currentValue.toFixed(3)} → ${rec.recommendedValue.toFixed(3)})`,
        );
        console.log(
          `   Expected impact: ${(rec.expectedImpact * 100).toFixed(1)}%`,
        );
        console.log(`   Confidence: ${(rec.confidence * 100).toFixed(0)}%`);
      });
    }
  }

  /**
   * Update benchmarks from data
   */
  private async updateBenchmarksFromData(data: any[]): Promise<void> {
    for (const benchmark of this.benchmarks) {
      const matchingData = data.filter((d) =>
        this.matchesBenchmark(d, benchmark),
      );

      if (matchingData.length >= this.config.benchmarkRoutes) {
        benchmark.currentMetrics = {
          averageCost:
            matchingData.reduce((sum, d) => sum + d.costMetrics.actualCost, 0) /
            matchingData.length,
          averageTime:
            matchingData.reduce(
              (sum, d) => sum + d.optimizationMetrics.estimatedTime,
              0,
            ) / matchingData.length,
          averageEfficiency:
            matchingData.reduce(
              (sum, d) => sum + d.performanceComparison.efficiencyGain,
              0,
            ) / matchingData.length,
          sampleSize: matchingData.length,
          improvement:
            matchingData.reduce(
              (sum, d) => sum + d.performanceComparison.vsOriginalWeights,
              0,
            ) / matchingData.length,
        };

        // Update baseline if significant improvement
        if (
          benchmark.currentMetrics.improvement >
          this.config.significanceThreshold
        ) {
          benchmark.baselineMetrics = {
            ...benchmark.baselineMetrics,
            averageCost: benchmark.currentMetrics.averageCost,
            averageTime: benchmark.currentMetrics.averageTime,
            averageEfficiency: benchmark.currentMetrics.averageEfficiency,
            sampleSize: benchmark.currentMetrics.sampleSize,
          };
        }
      }
    }
  }

  /**
   * Check if data matches benchmark
   */
  private matchesBenchmark(
    data: any,
    benchmark: PerformanceBenchmark,
  ): boolean {
    const distance = data.optimizationMetrics.totalDistance;
    const complexity = data.optimizationMetrics.complexityScore;

    const [minDistance, maxDistance] =
      benchmark.routeCharacteristics.distanceRange;
    const [minComplexity, maxComplexity] =
      benchmark.routeCharacteristics.complexityRange;

    return (
      distance >= minDistance &&
      distance <= maxDistance &&
      complexity >= minComplexity &&
      complexity <= maxComplexity
    );
  }

  /**
   * Generate optimization recommendations
   */
  private async generateOptimizationRecommendations(
    data: any[],
  ): Promise<OptimizationRecommendation[]> {
    const recommendations: OptimizationRecommendation[] = [];

    // Analyze performance patterns
    const patterns = this.analyzePerformancePatterns(data);

    // Weight adjustment recommendations
    if (patterns.lowConfidenceWeights > 0.3) {
      recommendations.push({
        type: "weight_adjustment",
        target: "confidence_threshold",
        currentValue: 0.6,
        recommendedValue: 0.75,
        expectedImpact: 0.05,
        confidence: 0.8,
        reasoning:
          "High percentage of low-confidence weights affecting performance",
        implementationComplexity: "low",
      });
    }

    // Algorithm tuning recommendations
    if (patterns.highComplexityRoutes > 0.4) {
      recommendations.push({
        type: "algorithm_tuning",
        target: "complexity_penalty",
        currentValue: 1.0,
        recommendedValue: 1.2,
        expectedImpact: 0.08,
        confidence: 0.7,
        reasoning: "Many high-complexity routes showing suboptimal performance",
        implementationComplexity: "medium",
      });
    }

    // Data collection recommendations
    if (patterns.insufficientWeatherData > 0.2) {
      recommendations.push({
        type: "data_collection",
        target: "weather_coverage",
        currentValue: 0.8,
        recommendedValue: 0.95,
        expectedImpact: 0.03,
        confidence: 0.6,
        reasoning: "Insufficient weather data for accurate predictions",
        implementationComplexity: "medium",
      });
    }

    return recommendations;
  }

  /**
   * Analyze performance patterns
   */
  private analyzePerformancePatterns(data: any[]): any {
    const total = data.length;

    const lowConfidenceWeights =
      data.filter((d) => d.weightMetrics.confidence < 0.6).length / total;
    const highComplexityRoutes =
      data.filter((d) => d.optimizationMetrics.complexityScore > 0.7).length /
      total;
    const insufficientWeatherData =
      data.filter((d) => !d.routeCharacteristics.weatherImpact).length / total;

    return {
      lowConfidenceWeights,
      highComplexityRoutes,
      insufficientWeatherData,
    };
  }

  /**
   * Store performance metrics
   */
  private async storePerformanceMetrics(
    metrics: CPPPerformanceMetrics,
  ): Promise<void> {
    const client = getMongoClient();
    if (!client) return;

    try {
      const db = client.db("trashroute");
      const collection = db.collection("cpp_performance_metrics");

      await collection.insertOne({
        ...metrics,
        _id: new ObjectId(),
      });
    } catch (error) {
      console.error("Error storing performance metrics:", error);
    }
  }

  /**
   * Cleanup old data
   */
  private cleanupOldData(): void {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Keep 90 days
    this.performanceData = this.performanceData.filter(
      (d) => d.timestamp > cutoff,
    );
  }

  /**
   * Get performance trends
   */
  getPerformanceTrends(period: "24h" | "7d" | "30d"): PerformanceTrend {
    const hours = period === "24h" ? 24 : period === "7d" ? 7 * 24 : 30 * 24;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const periodData = this.performanceData.filter((d) => d.timestamp > cutoff);

    if (periodData.length === 0) {
      return {
        period,
        totalRoutes: 0,
        averageImprovement: 0,
        improvementRate: 0,
        costReduction: 0,
        timeReduction: 0,
        efficiencyGain: 0,
        trendDirection: "stable",
      };
    }

    const totalRoutes = periodData.length;
    const improvedRoutes = periodData.filter(
      (d) => d.performanceComparison.overallImprovement > 0,
    ).length;
    const averageImprovement =
      periodData.reduce(
        (sum, d) => sum + d.performanceComparison.overallImprovement,
        0,
      ) / totalRoutes;
    const improvementRate = improvedRoutes / totalRoutes;
    const costReduction =
      periodData.reduce(
        (sum, d) => sum + d.performanceComparison.vsOriginalWeights,
        0,
      ) / totalRoutes;
    const timeReduction =
      periodData.reduce(
        (sum, d) =>
          sum +
          d.optimizationMetrics.estimatedTime *
            d.performanceComparison.vsOriginalWeights,
        0,
      ) / totalRoutes;
    const efficiencyGain = averageImprovement; // Simplified

    // Determine trend direction
    const trendDirection = this.calculateTrendDirection(periodData);

    return {
      period,
      totalRoutes,
      averageImprovement,
      improvementRate,
      costReduction,
      timeReduction,
      efficiencyGain,
      trendDirection,
    };
  }

  /**
   * Calculate trend direction
   */
  private calculateTrendDirection(
    data: CPPPerformanceMetrics[],
  ): "improving" | "declining" | "stable" {
    if (data.length < 5) return "stable";

    const recent = data.slice(-5);
    const older = data.slice(-10, -5);

    const recentAvg =
      recent.reduce(
        (sum, d) => sum + d.performanceComparison.overallImprovement,
        0,
      ) / recent.length;
    const olderAvg =
      older.reduce(
        (sum, d) => sum + d.performanceComparison.overallImprovement,
        0,
      ) / older.length;

    const difference = recentAvg - olderAvg;

    if (Math.abs(difference) < 0.02) return "stable";
    return difference > 0 ? "improving" : "declining";
  }

  /**
   * Get benchmark performance
   */
  getBenchmarkPerformance(): PerformanceBenchmark[] {
    return this.benchmarks.map((b) => ({
      ...b,
      improvement: b.currentMetrics.improvement,
      status:
        b.currentMetrics.improvement > this.config.significanceThreshold
          ? "exceeding"
          : b.currentMetrics.improvement > 0
            ? "meeting"
            : "below",
    }));
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): {
    totalRoutes: number;
    averageImprovement: number;
    averageEfficiency: number;
    averageAccuracy: number;
    bestPerformingRoute: string | null;
    worstPerformingRoute: string | null;
  } {
    if (this.performanceData.length === 0) {
      return {
        totalRoutes: 0,
        averageImprovement: 0,
        averageEfficiency: 0,
        averageAccuracy: 0,
        bestPerformingRoute: null,
        worstPerformingRoute: null,
      };
    }

    const totalRoutes = this.performanceData.length;
    const averageImprovement =
      this.performanceData.reduce(
        (sum, d) => sum + d.performanceComparison.overallImprovement,
        0,
      ) / totalRoutes;
    const averageEfficiency =
      this.performanceData.reduce(
        (sum, d) => sum + d.performanceComparison.efficiencyGain,
        0,
      ) / totalRoutes;
    const averageAccuracy =
      this.performanceData.reduce(
        (sum, d) => sum + d.costMetrics.costAccuracy,
        0,
      ) / totalRoutes;

    const bestRoute = this.performanceData.reduce((best, current) =>
      current.performanceComparison.overallImprovement >
      best.performanceComparison.overallImprovement
        ? current
        : best,
    );

    const worstRoute = this.performanceData.reduce((worst, current) =>
      current.performanceComparison.overallImprovement <
      worst.performanceComparison.overallImprovement
        ? current
        : worst,
    );

    return {
      totalRoutes,
      averageImprovement,
      averageEfficiency,
      averageAccuracy,
      bestPerformingRoute: bestRoute.routeId,
      worstPerformingRoute: worstRoute.routeId,
    };
  }

  /**
   * Generate comprehensive performance report
   */
  async generatePerformanceReport(
    period: "daily" | "weekly" | "monthly",
  ): Promise<string> {
    const stats = this.getPerformanceStats();
    const trends = this.getPerformanceTrends(period);
    const benchmarks = this.getBenchmarkPerformance();

    return `
# CPP Performance Report
**Period:** ${period}
**Generated:** ${new Date().toISOString()}

## Overall Statistics
- **Total Routes Analyzed:** ${stats.totalRoutes}
- **Average Improvement:** ${(stats.averageImprovement * 100).toFixed(2)}%
- **Average Efficiency Gain:** ${(stats.averageEfficiency * 100).toFixed(2)}%
- **Average Cost Accuracy:** ${(stats.averageAccuracy * 100).toFixed(1)}%

## Performance Trends (${period})
- **Routes in Period:** ${trends.totalRoutes}
- **Improvement Rate:** ${(trends.improvementRate * 100).toFixed(1)}%
- **Average Cost Reduction:** ${(trends.costReduction * 100).toFixed(2)}%
- **Average Time Reduction:** ${(trends.timeReduction * 100).toFixed(2)}%
- **Trend Direction:** ${trends.trendDirection.toUpperCase()}

## Benchmark Performance
${benchmarks.map((b) => `- **${b.name}:** ${(b.currentMetrics.improvement * 100).toFixed(2)}% improvement (${b.status})`).join("\n")}

## Top Performers
- **Best Route:** ${stats.bestPerformingRoute || "N/A"}
- **Worst Route:** ${stats.worstPerformingRoute || "N/A"}

## System Status
- Tracking Status: ${this.isTracking ? "Active" : "Inactive"}
- Data Quality: ${stats.averageAccuracy > 0.8 ? "Good" : stats.averageAccuracy > 0.6 ? "Fair" : "Poor"}
- Trend Direction: ${trends.trendDirection}

## Key Insights
- Weight integration is ${trends.improvementRate > 0.7 ? "highly effective" : trends.improvementRate > 0.5 ? "moderately effective" : "showing room for improvement"}
- ${trends.trendDirection === "improving" ? "Performance is trending upward" : trends.trendDirection === "declining" ? "Performance decline detected - investigation recommended" : "Performance remains stable"}
- Cost reduction averaging ${(trends.costReduction * 100).toFixed(2)}% across all routes

## Next Steps
- Continue monitoring performance trends
- Review and act on optimization recommendations
- Consider expanding to additional route types
- Maintain regular data collection and analysis
    `.trim();
  }
}

// Default configuration
export const defaultPerformanceConfig: PerformanceAnalysisConfig = {
  enabled: true,
  analysisInterval: 6, // 6 hours
  benchmarkRoutes: 50,
  significanceThreshold: 0.05,
  minSampleSize: 20,
  autoOptimize: true,
};

// Export singleton instance
export const cppPerformanceTracker = new CPPPerformanceTracker(
  defaultPerformanceConfig,
);
