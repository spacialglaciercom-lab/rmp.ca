/**
 * Cost-Aware Route Optimizer
 * Integrates cost correction model with route optimization to provide cost-optimal routes
 */

import {
  costPredictionService,
  type CostOptimizationRequest,
  type CostAwareRouteRecommendation,
} from "@/services/costPredictionService";
import {
  costCorrectionModel,
  type CostFactors,
} from "@/lib/cost-correction-model";
import { RouteOptimizer } from "@/lib/route-optimizer-v2/routeOptimizer";
import { getEdgePenaltiesFromLeap } from "@/lib/route-ml-enhancement";
import type { RouteStatistics } from "@/types/routing";
import type { CurrentWeather } from "@/services/weatherService";
import type { Way } from "@/lib/route-optimizer-v2/types";

export interface CostOptimizedRoute {
  route: Array<{ latitude: number; longitude: number; nodeId?: string }>;
  totalDistance: number;
  estimatedTime: number;
  predictedCosts: {
    totalCost: number;
    fuelCost: number;
    laborCost: number;
    maintenanceCost: number;
    overheadCost: number;
  };
  costEfficiencyScore: number;
  optimizationMetrics: {
    costPerKilometer: number;
    timePerKilometer: number;
    fuelEfficiency: number;
    costEffectiveness: number;
  };
  costComparison: {
    vsStandardRoute: number;
    vsPreviousRoutes: number;
    potentialSavings: number;
  };
  riskAssessment: {
    costOverrunRisk: "low" | "medium" | "high";
    confidence: number;
    primaryRiskFactors: string[];
  };
  recommendations: string[];
}

export interface CostOptimizationConfig {
  budgetConstraints?: {
    maxTotalCost?: number;
    maxFuelCost?: number;
    maxTimeCost?: number;
  };
  optimizationPreferences?: {
    prioritizeCost: boolean;
    prioritizeTime: boolean;
    prioritizeFuel: boolean;
    riskTolerance: "conservative" | "moderate" | "aggressive";
  };
  costWeights?: {
    fuel: number;
    labor: number;
    maintenance: number;
    overhead: number;
  };
  learningEnabled?: boolean;
}

export interface RouteVariant {
  name: string;
  description: string;
  routeStats: RouteStatistics;
  costPrediction: any;
  efficiencyScore: number;
  tradeOffs: string[];
}

/**
 * Cost-aware route optimizer that integrates ML-based cost predictions with route optimization
 */
export class CostAwareRouteOptimizer {
  private optimizer: RouteOptimizer;
  private costWeights: CostOptimizationConfig["costWeights"];
  private learningEnabled: boolean;

  constructor(
    nodes: Map<string, any>,
    ways: Way[],
    onewayMode: string = "A",
    turnRestrictions: any[] = [],
    config: CostOptimizationConfig = {},
  ) {
    this.costWeights = config.costWeights || {
      fuel: 0.3,
      labor: 0.4,
      maintenance: 0.2,
      overhead: 0.1,
    };
    this.learningEnabled = config.learningEnabled ?? true;

    // Initialize base route optimizer
    this.optimizer = new RouteOptimizer(
      nodes,
      ways,
      onewayMode,
      turnRestrictions,
    );
  }

  /**
   * Optimize route with cost awareness
   */
  async optimizeWithCostAwareness(
    routeStats: RouteStatistics,
    weatherData?: CurrentWeather,
    operationalContext?: Partial<CostFactors>,
    config: CostOptimizationConfig = {},
    customStartPoint?: { lat: number; lon: number },
  ): Promise<CostOptimizedRoute | null> {
    try {
      console.log("🚀 Starting cost-aware route optimization...");

      // Step 1: Get ML-enhanced edge penalties for problematic ways
      console.log("🤖 Getting ML edge penalties...");
      const edgePenalties = await this.getMLEdgePenalties(ways, weatherData);

      // Step 2: Get cost-aware route recommendations
      console.log("💰 Analyzing cost factors...");
      const costRequest: CostOptimizationRequest = {
        routeStats,
        weatherData,
        operationalContext,
        budgetConstraints: config.budgetConstraints,
        optimizationPreferences: config.optimizationPreferences,
      };

      const costRecommendation =
        await costPredictionService.getCostAwareRecommendations(costRequest);
      if (!costRecommendation) {
        console.warn(
          "⚠️ Cost-aware recommendation failed, using standard optimization",
        );
        return this.getStandardCostOptimizedRoute(
          routeStats,
          weatherData,
          operationalContext,
        );
      }

      // Step 3: Generate route variants with different optimization strategies
      console.log("🔄 Generating route variants...");
      const routeVariants = await this.generateRouteVariants(
        routeStats,
        weatherData,
        operationalContext,
        config,
      );

      // Step 4: Select best variant based on cost efficiency
      console.log("🎯 Selecting optimal route...");
      const bestVariant = this.selectBestVariant(
        routeVariants,
        costRecommendation,
      );

      // Step 5: Create final cost-optimized route
      console.log("✨ Creating cost-optimized route...");
      const optimizedRoute = await this.createOptimizedRoute(
        bestVariant,
        costRecommendation,
        customStartPoint,
      );

      return optimizedRoute;
    } catch (error) {
      console.error("❌ Cost-aware optimization failed:", error);
      return this.getFallbackOptimizedRoute(
        routeStats,
        weatherData,
        operationalContext,
      );
    }
  }

  /**
   * Get ML edge penalties for cost optimization
   */
  private async getMLEdgePenalties(
    ways: Way[],
    weatherData?: CurrentWeather,
  ): Promise<Map<string, number>> {
    try {
      const weatherContext = weatherData
        ? `Weather context: ${weatherData.condition.main}, visibility ${weatherData.visibility}m, wind ${weatherData.windSpeed}m/s`
        : null;

      return await getEdgePenaltiesFromLeap(ways, weatherContext);
    } catch (error) {
      console.warn(
        "⚠️ ML edge penalties failed, using default penalties:",
        error,
      );
      return new Map<string, number>();
    }
  }

  /**
   * Generate multiple route variants with different optimization strategies
   */
  private async generateRouteVariants(
    routeStats: RouteStatistics,
    weatherData?: CurrentWeather,
    operationalContext?: Partial<CostFactors>,
    config: CostOptimizationConfig = {},
  ): Promise<RouteVariant[]> {
    const variants: RouteVariant[] = [];

    // Variant 1: Cost-optimized (experienced driver, off-peak hours)
    const costOptimizedContext: Partial<CostFactors> = {
      ...operationalContext,
      driverExperience: "experienced",
      timeOfDay: "early_morning",
    };

    const costOptimizedPrediction = await costCorrectionModel.predictCosts(
      routeStats,
      weatherData,
      costOptimizedContext,
    );

    if (costOptimizedPrediction) {
      variants.push({
        name: "Cost-Optimized",
        description:
          "Optimized for minimum total cost with experienced driver and off-peak timing",
        routeStats,
        costPrediction: costOptimizedPrediction,
        efficiencyScore: this.calculateVariantEfficiency(
          costOptimizedPrediction,
          routeStats,
        ),
        tradeOffs: [
          "Requires experienced driver",
          "Early morning start may affect scheduling",
          "Limited to off-peak hours",
        ],
      });
    }

    // Variant 2: Time-optimized (prioritize speed)
    const timeOptimizedStats = {
      ...routeStats,
      estimatedTime: routeStats.estimatedTime * 0.9, // Assume 10% time reduction possible
    };

    const timeOptimizedPrediction = await costCorrectionModel.predictCosts(
      timeOptimizedStats,
      weatherData,
      operationalContext,
    );

    if (timeOptimizedPrediction) {
      variants.push({
        name: "Time-Optimized",
        description:
          "Prioritizes completion time while maintaining reasonable costs",
        routeStats: timeOptimizedStats,
        costPrediction: timeOptimizedPrediction,
        efficiencyScore: this.calculateVariantEfficiency(
          timeOptimizedPrediction,
          timeOptimizedStats,
        ),
        tradeOffs: [
          "May increase fuel consumption",
          "Higher operational intensity",
          "Increased safety risks",
        ],
      });
    }

    // Variant 3: Fuel-optimized (eco-driving)
    const fuelOptimizedContext: Partial<CostFactors> = {
      ...operationalContext,
      driverExperience: "experienced",
      timeOfDay: "morning", // Steady traffic flow
    };

    const fuelOptimizedPrediction = await costCorrectionModel.predictCosts(
      routeStats,
      weatherData,
      fuelOptimizedContext,
    );

    if (fuelOptimizedPrediction) {
      variants.push({
        name: "Fuel-Optimized",
        description:
          "Minimizes fuel consumption through eco-driving techniques",
        routeStats,
        costPrediction: fuelOptimizedPrediction,
        efficiencyScore: this.calculateVariantEfficiency(
          fuelOptimizedPrediction,
          routeStats,
        ),
        tradeOffs: [
          "May increase total time",
          "Requires fuel-conscious driving",
          "Slightly higher labor costs",
        ],
      });
    }

    // Variant 4: Weather-adaptive
    if (weatherData && weatherData.rain1h > 5) {
      const weatherAdaptivePrediction = await costCorrectionModel.predictCosts(
        routeStats,
        { ...weatherData, rain1h: weatherData.rain1h * 0.7 }, // Assume weather improvement
        operationalContext,
      );

      if (weatherAdaptivePrediction) {
        variants.push({
          name: "Weather-Adaptive",
          description:
            "Adjusts for weather conditions to maintain safety and efficiency",
          routeStats,
          costPrediction: weatherAdaptivePrediction,
          efficiencyScore: this.calculateVariantEfficiency(
            weatherAdaptivePrediction,
            routeStats,
          ),
          tradeOffs: [
            "May require schedule adjustment",
            "Weather-dependent timing",
            "Potential customer service impact",
          ],
        });
      }
    }

    return variants;
  }

  /**
   * Calculate efficiency score for a route variant
   */
  private calculateVariantEfficiency(
    prediction: any,
    routeStats: RouteStatistics,
  ): number {
    const dist = routeStats.totalDistance || 1;
    const costPerKm = prediction.predictedTotalCost / dist;
    const timePerKm = prediction.predictedTime / dist;
    const fuelPerKm = prediction.predictedFuelConsumption / dist;

    // Scoring based on benchmarks
    let score = 50; // Base score

    // Cost efficiency (40% weight)
    if (costPerKm < 10) score += 20;
    else if (costPerKm < 15) score += 10;
    else if (costPerKm > 25) score -= 15;

    // Time efficiency (30% weight)
    if (timePerKm < 4) score += 15;
    else if (timePerKm < 6) score += 8;
    else if (timePerKm > 10) score -= 10;

    // Fuel efficiency (20% weight)
    if (fuelPerKm < 0.3) score += 10;
    else if (fuelPerKm < 0.4) score += 5;
    else if (fuelPerKm > 0.6) score -= 8;

    // Confidence bonus (10% weight)
    score += prediction.confidenceScore * 10;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Select best route variant based on cost efficiency and constraints
   */
  private selectBestVariant(
    variants: RouteVariant[],
    costRecommendation: CostAwareRouteRecommendation,
  ): RouteVariant {
    // Filter by budget constraints if specified
    const validVariants = variants.filter((variant) => {
      const totalCost = variant.costPrediction.predictedTotalCost;
      const maxCost =
        costRecommendation.predictedCosts.predictedTotalCost * 1.2; // 20% tolerance
      return totalCost <= maxCost;
    });

    // Select variant with highest efficiency score
    const bestVariant = validVariants.reduce(
      (best, current) =>
        current.efficiencyScore > best.efficiencyScore ? current : best,
      validVariants[0],
    );

    return bestVariant || variants[0]; // Fallback to first variant
  }

  /**
   * Create final optimized route with cost information
   */
  private async createOptimizedRoute(
    variant: RouteVariant,
    costRecommendation: CostAwareRouteRecommendation,
    customStartPoint?: { lat: number; lon: number },
  ): Promise<CostOptimizedRoute> {
    const { costPrediction } = variant;
    const { routeStats } = variant;

    const dist = routeStats.totalDistance || 1;
    const optimizationMetrics = {
      costPerKilometer: costPrediction.predictedTotalCost / dist,
      timePerKilometer: costPrediction.predictedTime / dist,
      fuelEfficiency: dist / (costPrediction.predictedFuelConsumption || 1),
      costEffectiveness:
        (dist / (costPrediction.predictedTotalCost || 1)) * 1000,
    };

    // Calculate cost comparisons
    const costComparison = {
      vsStandardRoute: this.calculateVsStandardRoute(
        variant,
        costRecommendation,
      ),
      vsPreviousRoutes: 0, // Would be calculated from historical data
      potentialSavings: Math.max(
        0,
        costRecommendation.predictedCosts.predictedTotalCost -
          costPrediction.predictedTotalCost,
      ),
    };

    // Generate recommendations
    const recommendations = [
      ...costPrediction.optimizationSuggestions,
      ...costRecommendation.optimizationOpportunities,
      `Selected ${variant.name} strategy for optimal cost efficiency`,
    ];

    return {
      route: [], // Would be populated from actual route optimization
      totalDistance: routeStats.totalDistance,
      estimatedTime: costPrediction.predictedTime,
      predictedCosts: {
        totalCost: costPrediction.predictedTotalCost,
        fuelCost: costPrediction.costBreakdown.fuel,
        laborCost: costPrediction.costBreakdown.labor,
        maintenanceCost: costPrediction.costBreakdown.maintenance,
        overheadCost: costPrediction.costBreakdown.overhead,
      },
      costEfficiencyScore: variant.efficiencyScore,
      optimizationMetrics,
      costComparison,
      riskAssessment: costRecommendation.riskAssessment,
      recommendations: [...new Set(recommendations)], // Remove duplicates
    };
  }

  /**
   * Calculate cost comparison vs standard route
   */
  private calculateVsStandardRoute(
    variant: RouteVariant,
    costRecommendation: CostAwareRouteRecommendation,
  ): number {
    const standardCost = costRecommendation.predictedCosts.predictedTotalCost;
    const variantCost = variant.costPrediction.predictedTotalCost;
    return ((standardCost - variantCost) / standardCost) * 100;
  }

  /**
   * Get standard cost-optimized route (fallback)
   */
  private async getStandardCostOptimizedRoute(
    routeStats: RouteStatistics,
    weatherData?: CurrentWeather,
    operationalContext?: Partial<CostFactors>,
  ): Promise<CostOptimizedRoute | null> {
    const prediction = await costCorrectionModel.predictCosts(
      routeStats,
      weatherData,
      operationalContext,
    );
    if (!prediction) return null;

    return {
      route: [],
      totalDistance: routeStats.totalDistance,
      estimatedTime: prediction.predictedTime,
      predictedCosts: {
        totalCost: prediction.predictedTotalCost,
        fuelCost: prediction.costBreakdown.fuel,
        laborCost: prediction.costBreakdown.labor,
        maintenanceCost: prediction.costBreakdown.maintenance,
        overheadCost: prediction.costBreakdown.overhead,
      },
      costEfficiencyScore: 50, // Neutral score for fallback
      optimizationMetrics: {
        costPerKilometer:
          prediction.predictedTotalCost / (routeStats.totalDistance || 1),
        timePerKilometer:
          prediction.predictedTime / (routeStats.totalDistance || 1),
        fuelEfficiency:
          (routeStats.totalDistance || 1) /
          (prediction.predictedFuelConsumption || 1),
        costEffectiveness:
          ((routeStats.totalDistance || 1) /
            (prediction.predictedTotalCost || 1)) *
          1000,
      },
      costComparison: {
        vsStandardRoute: 0,
        vsPreviousRoutes: 0,
        potentialSavings: 0,
      },
      riskAssessment: {
        costOverrunRisk: "medium",
        confidence: prediction.confidenceScore,
        primaryRiskFactors: prediction.riskFactors,
      },
      recommendations: prediction.optimizationSuggestions,
    };
  }

  /**
   * Get fallback optimized route when cost-aware optimization fails
   */
  private getFallbackOptimizedRoute(
    routeStats: RouteStatistics,
    weatherData?: CurrentWeather,
    operationalContext?: Partial<CostFactors>,
  ): CostOptimizedRoute {
    // Simple cost estimation fallback
    const baseTime = routeStats.estimatedTime;
    const baseDistance = routeStats.totalDistance;
    const estimatedFuel = baseDistance * 0.3;
    const estimatedTimeCost = (baseTime / 60) * 45;
    const estimatedFuelCost = estimatedFuel * 1.5;
    const estimatedMaintenanceCost = baseDistance * 0.15;
    const estimatedOverheadCost =
      (estimatedTimeCost + estimatedFuelCost + estimatedMaintenanceCost) * 0.2;
    const estimatedTotalCost =
      estimatedTimeCost +
      estimatedFuelCost +
      estimatedMaintenanceCost +
      estimatedOverheadCost;

    return {
      route: [],
      totalDistance: baseDistance,
      estimatedTime: baseTime,
      predictedCosts: {
        totalCost: estimatedTotalCost,
        fuelCost: estimatedFuelCost,
        laborCost: estimatedTimeCost,
        maintenanceCost: estimatedMaintenanceCost,
        overheadCost: estimatedOverheadCost,
      },
      costEfficiencyScore: 40, // Lower score for fallback
      optimizationMetrics: {
        costPerKilometer: estimatedTotalCost / baseDistance,
        timePerKilometer: baseTime / baseDistance,
        fuelEfficiency: baseDistance / estimatedFuel,
        costEffectiveness: (baseDistance / estimatedTotalCost) * 1000,
      },
      costComparison: {
        vsStandardRoute: 0,
        vsPreviousRoutes: 0,
        potentialSavings: 0,
      },
      riskAssessment: {
        costOverrunRisk: "high",
        confidence: 0.5,
        primaryRiskFactors: [
          "Limited prediction accuracy",
          "Fallback estimation used",
        ],
      },
      recommendations: [
        "Cost prediction unavailable - monitor actual costs",
        "Consider cost model retraining",
        "Track performance for future improvements",
      ],
    };
  }

  /**
   * Update model with actual route performance data
   */
  async updateWithActualPerformance(
    routeId: string,
    predictedCosts: any,
    actualPerformance: {
      actualTime: number;
      actualFuelConsumption: number;
      actualTotalCost: number;
      stopsCompleted: number;
      customerComplaints?: number;
      safetyIncidents?: number;
    },
    routeStats: RouteStatistics,
    weatherData?: CurrentWeather,
    operationalContext?: Partial<CostFactors>,
  ): Promise<void> {
    if (!this.learningEnabled) return;

    const actualCosts = {
      actualTime: actualPerformance.actualTime,
      actualFuelConsumption: actualPerformance.actualFuelConsumption,
      totalCost: actualPerformance.actualTotalCost,
      laborCosts: actualPerformance.actualTotalCost * 0.6, // Estimated breakdown
      fuelCosts: actualPerformance.actualFuelConsumption * 1.5,
      maintenanceCosts: actualPerformance.actualTotalCost * 0.15,
      stopsCompleted: actualPerformance.stopsCompleted,
      customerComplaints: actualPerformance.customerComplaints || 0,
      safetyIncidents: actualPerformance.safetyIncidents || 0,
    };

    await costPredictionService.updateWithActualCosts({
      routeId,
      predictedCosts,
      actualCosts,
      routeStats,
      weatherData,
      operationalContext,
    });
  }

  /**
   * Compare multiple route options with cost analysis
   */
  async compareRouteOptions(
    routeOptions: Array<{
      name: string;
      routeStats: RouteStatistics;
      description?: string;
    }>,
    weatherData?: CurrentWeather,
    operationalContext?: Partial<CostFactors>,
    config: CostOptimizationConfig = {},
  ): Promise<
    Array<{
      name: string;
      description?: string;
      costAnalysis: CostOptimizedRoute;
      ranking: {
        costRank: number;
        efficiencyRank: number;
        overallScore: number;
      };
    }>
  > {
    const routeAnalyses = await Promise.all(
      routeOptions.map(async (option) => {
        const costAnalysis = await this.optimizeWithCostAwareness(
          option.routeStats,
          weatherData,
          operationalContext,
          config,
        );

        return {
          name: option.name,
          description: option.description,
          costAnalysis: costAnalysis!,
          ranking: {
            costRank: 0, // Will be calculated
            efficiencyRank: 0, // Will be calculated
            overallScore: costAnalysis?.costEfficiencyScore || 0,
          },
        };
      }),
    );

    // Sort by overall score and assign rankings
    const sortedByCost = [...routeAnalyses].sort(
      (a, b) =>
        a.costAnalysis.predictedCosts.totalCost -
        b.costAnalysis.predictedCosts.totalCost,
    );

    const sortedByEfficiency = [...routeAnalyses].sort(
      (a, b) =>
        b.costAnalysis.costEfficiencyScore - a.costAnalysis.costEfficiencyScore,
    );

    return routeAnalyses.map((analysis) => ({
      ...analysis,
      ranking: {
        costRank: sortedByCost.findIndex((a) => a.name === analysis.name) + 1,
        efficiencyRank:
          sortedByEfficiency.findIndex((a) => a.name === analysis.name) + 1,
        overallScore: analysis.ranking.overallScore,
      },
    }));
  }

  /**
   * Generate cost optimization report
   */
  async generateOptimizationReport(
    optimizedRoute: CostOptimizedRoute,
    alternativeRoutes?: CostOptimizedRoute[],
  ): Promise<{
    summary: string;
    costBreakdown: any;
    efficiencyAnalysis: any;
    recommendations: string[];
    riskAssessment: any;
    performanceMetrics: any;
  }> {
    const summary = `Cost-optimized route generated with predicted total cost of $${optimizedRoute.predictedCosts.totalCost.toFixed(2)} and efficiency score of ${optimizedRoute.costEfficiencyScore}/100.`;

    const costBreakdown = {
      total: optimizedRoute.predictedCosts.totalCost,
      breakdown: optimizedRoute.predictedCosts,
      percentages: {
        fuel:
          (optimizedRoute.predictedCosts.fuelCost /
            optimizedRoute.predictedCosts.totalCost) *
          100,
        labor:
          (optimizedRoute.predictedCosts.laborCost /
            optimizedRoute.predictedCosts.totalCost) *
          100,
        maintenance:
          (optimizedRoute.predictedCosts.maintenanceCost /
            optimizedRoute.predictedCosts.totalCost) *
          100,
        overhead:
          (optimizedRoute.predictedCosts.overheadCost /
            optimizedRoute.predictedCosts.totalCost) *
          100,
      },
    };

    const efficiencyAnalysis = {
      current: optimizedRoute.optimizationMetrics,
      benchmarks: {
        costPerKm: { good: 8, average: 12, poor: 16 },
        timePerKm: { good: 3, average: 5, poor: 8 },
        fuelEfficiency: { good: 4, average: 3, poor: 2 },
      },
    };

    const riskAssessment = {
      level: optimizedRoute.riskAssessment.costOverrunRisk,
      confidence: optimizedRoute.riskAssessment.confidence,
      factors: optimizedRoute.riskAssessment.primaryRiskFactors,
      mitigation: this.generateRiskMitigationStrategies(
        optimizedRoute.riskAssessment,
      ),
    };

    const performanceMetrics = {
      efficiencyScore: optimizedRoute.costEfficiencyScore,
      costSavings: optimizedRoute.costComparison.potentialSavings,
      performanceVsAlternatives: alternativeRoutes
        ? this.compareToAlternatives(optimizedRoute, alternativeRoutes)
        : null,
    };

    return {
      summary,
      costBreakdown,
      efficiencyAnalysis,
      recommendations: optimizedRoute.recommendations,
      riskAssessment,
      performanceMetrics,
    };
  }

  /**
   * Generate risk mitigation strategies
   */
  private generateRiskMitigationStrategies(riskAssessment: any): string[] {
    const strategies: string[] = [];

    if (riskAssessment.level === "high") {
      strategies.push("Implement cost monitoring during route execution");
      strategies.push("Prepare contingency budget of 20-30%");
      strategies.push("Consider route segmentation to reduce risk");
    } else if (riskAssessment.level === "medium") {
      strategies.push("Monitor key cost drivers during execution");
      strategies.push("Prepare contingency budget of 10-15%");
    }

    if (riskAssessment.confidence < 0.7) {
      strategies.push("Collect more data to improve prediction confidence");
      strategies.push("Consider multiple cost scenarios");
    }

    return strategies;
  }

  /**
   * Compare performance to alternative routes
   */
  private compareToAlternatives(
    optimizedRoute: CostOptimizedRoute,
    alternatives: CostOptimizedRoute[],
  ): any {
    const avgAlternativeCost =
      alternatives.reduce(
        (sum, route) => sum + route.predictedCosts.totalCost,
        0,
      ) / alternatives.length;
    const avgAlternativeEfficiency =
      alternatives.reduce((sum, route) => sum + route.costEfficiencyScore, 0) /
      alternatives.length;

    return {
      costAdvantage:
        ((avgAlternativeCost - optimizedRoute.predictedCosts.totalCost) /
          avgAlternativeCost) *
        100,
      efficiencyAdvantage:
        optimizedRoute.costEfficiencyScore - avgAlternativeEfficiency,
      alternativesCount: alternatives.length,
    };
  }
}

/**
 * Factory function for creating cost-aware route optimizer
 */
export function createCostAwareRouteOptimizer(
  nodes: Map<string, any>,
  ways: Way[],
  onewayMode: string = "A",
  turnRestrictions: any[] = [],
  config: CostOptimizationConfig = {},
): CostAwareRouteOptimizer {
  return new CostAwareRouteOptimizer(
    nodes,
    ways,
    onewayMode,
    turnRestrictions,
    config,
  );
}

// Export singleton instance management
export const costAwareRouteOptimizer = {
  create: createCostAwareRouteOptimizer,

  // Utility functions
  calculateCostEfficiency: (
    prediction: any,
    routeStats: RouteStatistics,
  ): number => {
    const dist = routeStats.totalDistance || 1;
    const costPerKm = prediction.predictedTotalCost / dist;
    const timePerKm = prediction.predictedTime / dist;

    let score = 50;
    if (costPerKm < 10) score += 25;
    else if (costPerKm < 15) score += 15;
    if (timePerKm < 4) score += 15;
    else if (timePerKm < 6) score += 8;

    return Math.min(100, score);
  },

  generateCostSummary: (optimizedRoute: CostOptimizedRoute): string => {
    return (
      `Route: ${optimizedRoute.totalDistance.toFixed(1)}km, ` +
      `Cost: $${optimizedRoute.predictedCosts.totalCost.toFixed(2)}, ` +
      `Efficiency: ${optimizedRoute.costEfficiencyScore}/100, ` +
      `Risk: ${optimizedRoute.riskAssessment.costOverrunRisk}`
    );
  },
};
