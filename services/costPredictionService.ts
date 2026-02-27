/**
 * Cost Prediction Service
 * Integrates cost correction model with route optimization and provides cost-aware recommendations
 */

import { costCorrectionModel, type CostFactors, type CostPrediction, type ActualCostData } from "@/lib/cost-correction-model";
import type { RouteStatistics } from "@/types/routing";
import type { CurrentWeather } from "@/services/weatherService";
import { getLeapWeatherRecommendations, type LeapWeatherInput } from "@/services/leapAIService";

export interface CostAwareRouteRecommendation {
  routeId: string;
  predictedCosts: CostPrediction;
  costEfficiencyScore: number; // 0-100, higher is better
  alternativeRoutes: Array<{
    routeVariant: string;
    costDifference: number; // vs original
    timeDifference: number; // vs original
    tradeOffs: string[];
  }>;
  optimizationOpportunities: string[];
  riskAssessment: {
    costOverrunRisk: "low" | "medium" | "high";
    likelyCostRange: [number, number]; // [min, max]
    primaryRiskFactors: string[];
  };
}

export interface CostOptimizationRequest {
  routeStats: RouteStatistics;
  weatherData?: CurrentWeather;
  operationalContext?: Partial<CostFactors>;
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
}

export interface CostLearningUpdate {
  routeId: string;
  predictedCosts: CostPrediction;
  actualCosts: ActualCostData;
  routeStats: RouteStatistics;
  weatherData?: CurrentWeather;
  operationalContext?: Partial<CostFactors>;
  feedback?: {
    costAccuracy: number; // 1-10 rating
    predictionUsefulness: number; // 1-10 rating
    comments?: string;
  };
}

/**
 * Main cost prediction service
 */
export class CostPredictionService {
  private static instance: CostPredictionService;
  private costLearningQueue: CostLearningUpdate[] = [];
  private learningBatchSize = 10;
  
  private constructor() {}
  
  static getInstance(): CostPredictionService {
    if (!CostPredictionService.instance) {
      CostPredictionService.instance = new CostPredictionService();
    }
    return CostPredictionService.instance;
  }

  /**
   * Get cost-aware route recommendations
   */
  async getCostAwareRecommendations(
    request: CostOptimizationRequest
  ): Promise<CostAwareRouteRecommendation | null> {
    try {
      // Get base cost prediction
      const prediction = await costCorrectionModel.predictCosts(
        request.routeStats,
        request.weatherData,
        request.operationalContext
      );
      
      if (!prediction) {
        console.warn("Cost prediction failed, using fallback");
        return this.getFallbackRecommendation(request);
      }

      // Generate alternative cost scenarios
      const alternatives = await this.generateAlternativeScenarios(request, prediction);
      
      // Calculate cost efficiency score
      const efficiencyScore = this.calculateCostEfficiencyScore(prediction, request);
      
      // Assess cost risks
      const riskAssessment = this.assessCostRisks(prediction, request);
      
      // Identify optimization opportunities
      const optimizationOpportunities = this.identifyOptimizationOpportunities(prediction, request);
      
      return {
        routeId: `route_${Date.now()}`,
        predictedCosts: prediction,
        costEfficiencyScore: efficiencyScore,
        alternativeRoutes: alternatives,
        optimizationOpportunities,
        riskAssessment,
      };
    } catch (error) {
      console.error("Cost-aware recommendation failed:", error);
      return this.getFallbackRecommendation(request);
    }
  }

  /**
   * Update model with actual cost data (learning)
   */
  async updateWithActualCosts(update: CostLearningUpdate): Promise<void> {
    // Add to learning queue
    this.costLearningQueue.push(update);
    
    // Process batch when we have enough samples
    if (this.costLearningQueue.length >= this.learningBatchSize) {
      await this.processLearningBatch();
    }
  }

  /**
   * Get cost comparison between multiple routes
   */
  async compareRouteCosts(
    routes: Array<{
      routeStats: RouteStatistics;
      routeId: string;
      routeName?: string;
    }>,
    weatherData?: CurrentWeather,
    operationalContext?: Partial<CostFactors>
  ): Promise<Array<{
    routeId: string;
    routeName?: string;
    predictedCosts: CostPrediction;
    costRank: number;
    costEfficiency: number;
    recommendations: string[];
  }>> {
    const routeCosts = await Promise.all(
      routes.map(async (route) => {
        const prediction = await costCorrectionModel.predictCosts(
          route.routeStats,
          weatherData,
          operationalContext
        );
        
        return {
          routeId: route.routeId,
          routeName: route.routeName,
          predictedCosts: prediction,
          costEfficiency: prediction ? this.calculateBasicCostEfficiency(prediction) : 0,
          recommendations: prediction ? this.getBasicRecommendations(prediction) : [],
        };
      })
    );

    // Sort by cost efficiency and assign ranks
    const validRoutes = routeCosts
      .filter(route => route.predictedCosts !== null)
      .sort((a, b) => b.costEfficiency - a.costEfficiency);

    return validRoutes.map((route, index) => ({
      ...route,
      predictedCosts: route.predictedCosts!,
      costRank: index + 1,
    }));
  }

  /**
   * Generate budget-aware recommendations
   */
  async getBudgetRecommendations(
    request: CostOptimizationRequest
  ): Promise<{
    withinBudget: boolean;
    recommendations: string[];
    costReductionNeeded: number;
    alternativeStrategies: string[];
  }> {
    const recommendation = await this.getCostAwareRecommendations(request);
    if (!recommendation) {
      return {
        withinBudget: true,
        recommendations: ["Unable to generate cost prediction"],
        costReductionNeeded: 0,
        alternativeStrategies: [],
      };
    }

    const { predictedCosts } = recommendation;
    const constraints = request.budgetConstraints || {};
    
    let withinBudget = true;
    let costReductionNeeded = 0;
    const recommendations: string[] = [];
    const alternativeStrategies: string[] = [];

    // Check total cost constraint
    if (constraints.maxTotalCost && predictedCosts.predictedTotalCost > constraints.maxTotalCost) {
      withinBudget = false;
      costReductionNeeded = predictedCosts.predictedTotalCost - constraints.maxTotalCost;
      recommendations.push(`Total cost exceeds budget by $${costReductionNeeded.toFixed(2)}`);
      alternativeStrategies.push("Consider route optimization to reduce distance");
      alternativeStrategies.push("Schedule during off-peak hours to reduce labor costs");
    }

    // Check fuel cost constraint
    if (constraints.maxFuelCost) {
      const predictedFuelCost = predictedCosts.costBreakdown.fuel;
      if (predictedFuelCost > constraints.maxFuelCost) {
        withinBudget = false;
        recommendations.push(`Fuel cost exceeds budget by $${(predictedFuelCost - constraints.maxFuelCost).toFixed(2)}`);
        alternativeStrategies.push("Optimize route to reduce total distance");
        alternativeStrategies.push("Consider more fuel-efficient vehicle");
      }
    }

    // Check time cost constraint
    if (constraints.maxTimeCost) {
      const predictedTimeCost = predictedCosts.costBreakdown.labor;
      if (predictedTimeCost > constraints.maxTimeCost) {
        withinBudget = false;
        recommendations.push(`Time/labor cost exceeds budget by $${(predictedTimeCost - constraints.maxTimeCost).toFixed(2)}`);
        alternativeStrategies.push("Optimize route to reduce completion time");
        alternativeStrategies.push("Consider more experienced driver for efficiency");
      }
    }

    if (withinBudget) {
      recommendations.push("Route stays within budget constraints");
      recommendations.push(`Budget utilization: ${((predictedCosts.predictedTotalCost / (constraints.maxTotalCost || predictedCosts.predictedTotalCost)) * 100).toFixed(1)}%`);
    }

    return {
      withinBudget,
      recommendations,
      costReductionNeeded,
      alternativeStrategies,
    };
  }

  /**
   * Generate alternative cost scenarios
   */
  private async generateAlternativeScenarios(
    request: CostOptimizationRequest,
    basePrediction: CostPrediction
  ): Promise<Array<{
    routeVariant: string;
    costDifference: number;
    timeDifference: number;
    tradeOffs: string[];
  }>> {
    const alternatives: Array<{
      routeVariant: string;
      costDifference: number;
      timeDifference: number;
      tradeOffs: string[];
    }> = [];

    // Scenario 1: Optimized for cost
    const costOptimizedContext: Partial<CostFactors> = {
      ...request.operationalContext,
      driverExperience: "experienced",
      timeOfDay: "early_morning",
    };

    const costOptimizedPrediction = await costCorrectionModel.predictCosts(
      request.routeStats,
      request.weatherData,
      costOptimizedContext
    );

    if (costOptimizedPrediction) {
      alternatives.push({
        routeVariant: "Cost-Optimized",
        costDifference: costOptimizedPrediction.predictedTotalCost - basePrediction.predictedTotalCost,
        timeDifference: costOptimizedPrediction.predictedTime - basePrediction.predictedTime,
        tradeOffs: [
          "Requires experienced driver",
          "Early morning start may affect scheduling",
          "Potentially lower customer satisfaction with early collection",
        ],
      });
    }

    // Scenario 2: Weather-delayed
    if (request.weatherData && request.weatherData.rain1h > 5) {
      const delayedWeatherData = {
        ...request.weatherData,
        rain1h: request.weatherData.rain1h * 0.5, // Assume delay reduces rain impact
      };

      const delayedPrediction = await costCorrectionModel.predictCosts(
        request.routeStats,
        delayedWeatherData,
        request.operationalContext
      );

      if (delayedPrediction) {
        alternatives.push({
          routeVariant: "Weather-Delayed",
          costDifference: delayedPrediction.predictedTotalCost - basePrediction.predictedTotalCost,
          timeDifference: delayedPrediction.predictedTime - basePrediction.predictedTime,
          tradeOffs: [
            "Delays service delivery",
            "May affect customer satisfaction",
            "Requires schedule flexibility",
          ],
        });
      }
    }

    // Scenario 3: Rush hour avoidance
    const offPeakContext: Partial<CostFactors> = {
      ...request.operationalContext,
      timeOfDay: "early_morning",
    };

    const offPeakPrediction = await costCorrectionModel.predictCosts(
      request.routeStats,
      request.weatherData,
      offPeakContext
    );

    if (offPeakPrediction) {
      alternatives.push({
        routeVariant: "Off-Peak",
        costDifference: offPeakPrediction.predictedTotalCost - basePrediction.predictedTotalCost,
        timeDifference: offPeakPrediction.predictedTime - basePrediction.predictedTime,
        tradeOffs: [
          "Early morning start required",
          "May require overtime pay",
          "Better traffic conditions",
        ],
      });
    }

    return alternatives;
  }

  /**
   * Calculate cost efficiency score (0-100)
   */
  private calculateCostEfficiencyScore(
    prediction: CostPrediction,
    request: CostOptimizationRequest
  ): number {
    const preferences = request.optimizationPreferences || {
      prioritizeCost: true,
      prioritizeTime: false,
      prioritizeFuel: false,
      riskTolerance: "moderate",
    };

    let score = 50; // Base score

    // Cost efficiency (lower cost = higher score)
    const costPerKm = prediction.predictedTotalCost / (request.routeStats.totalDistance || 1);
    if (costPerKm < 8) score += 25; // Very efficient
    else if (costPerKm < 12) score += 15; // Efficient
    else if (costPerKm < 16) score += 5; // Average
    else score -= 10; // Inefficient

    // Time efficiency (shorter time = higher score)
    const timePerKm = prediction.predictedTime / (request.routeStats.totalDistance || 1);
    if (preferences.prioritizeTime) {
      if (timePerKm < 3) score += 15; // Very fast
      else if (timePerKm < 5) score += 10; // Fast
      else if (timePerKm > 8) score -= 15; // Slow
    }

    // Fuel efficiency (lower fuel consumption = higher score)
    const fuelPerKm = prediction.predictedFuelConsumption / (request.routeStats.totalDistance || 1);
    if (preferences.prioritizeFuel) {
      if (fuelPerKm < 0.25) score += 15; // Very efficient
      else if (fuelPerKm < 0.35) score += 10; // Efficient
      else if (fuelPerKm > 0.5) score -= 15; // Inefficient
    }

    // Confidence bonus
    score += prediction.confidenceScore * 10;

    // Risk adjustment
    if (preferences.riskTolerance === "conservative" && prediction.riskFactors.length > 2) {
      score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Assess cost risks
   */
  private assessCostRisks(
    prediction: CostPrediction,
    request: CostOptimizationRequest
  ): {
    costOverrunRisk: "low" | "medium" | "high";
    likelyCostRange: [number, number];
    primaryRiskFactors: string[];
  } {
    const riskFactors = [...prediction.riskFactors];
    let riskLevel: "low" | "medium" | "high" = "low";
    
    // Determine risk level
    if (prediction.confidenceScore < 0.7) {
      riskLevel = "high";
      riskFactors.push("Low prediction confidence");
    } else if (prediction.confidenceScore < 0.85) {
      riskLevel = "medium";
      riskFactors.push("Moderate prediction confidence");
    }

    if (request.weatherData) {
      const weatherSeverity = this.calculateWeatherSeverity(request.weatherData);
      if (weatherSeverity > 0.7) {
        riskLevel = "high";
        riskFactors.push("Severe weather conditions");
      } else if (weatherSeverity > 0.4) {
        if (riskLevel === "low") riskLevel = "medium";
        riskFactors.push("Challenging weather conditions");
      }
    }

    // Calculate cost range based on risk
    const baseCost = prediction.predictedTotalCost;
    let costRange: [number, number];
    
    switch (riskLevel) {
      case "low":
        costRange = [baseCost * 0.9, baseCost * 1.1];
        break;
      case "medium":
        costRange = [baseCost * 0.8, baseCost * 1.3];
        break;
      case "high":
        costRange = [baseCost * 0.7, baseCost * 1.6];
        break;
    }

    return {
      costOverrunRisk: riskLevel,
      likelyCostRange: costRange,
      primaryRiskFactors: riskFactors.slice(0, 3), // Top 3 risk factors
    };
  }

  /**
   * Identify optimization opportunities
   */
  private identifyOptimizationOpportunities(
    prediction: CostPrediction,
    request: CostOptimizationRequest
  ): string[] {
    const opportunities: string[] = [];

    // Fuel optimization
    if (prediction.costBreakdown.fuel > prediction.predictedTotalCost * 0.4) {
      opportunities.push("High fuel costs - consider route optimization to reduce distance");
    }

    // Time optimization
    if (prediction.predictedTime > 240) { // > 4 hours
      opportunities.push("Long route duration - consider splitting into multiple shorter routes");
    }

    // Weather optimization
    if (request.weatherData) {
      const weatherSeverity = this.calculateWeatherSeverity(request.weatherData);
      if (weatherSeverity > 0.5) {
        opportunities.push("Weather impact detected - consider timing adjustments");
      }
    }

    // Risk optimization
    if (prediction.riskFactors.length > 2) {
      opportunities.push("Multiple risk factors - implement risk mitigation strategies");
    }

    // Always include learning opportunity
    opportunities.push("Track actual costs to improve future predictions");

    return opportunities;
  }

  /**
   * Process learning batch
   */
  private async processLearningBatch(): Promise<void> {
    if (this.costLearningQueue.length === 0) return;

    const batch = this.costLearningQueue.splice(0, this.learningBatchSize);
    
    try {
      await Promise.all(
        batch.map(update => 
          costCorrectionModel.learnFromActualData(
            update.predictedCosts,
            update.actualCosts,
            update.routeStats,
            update.weatherData,
            update.operationalContext
          )
        )
      );
      
      console.log(`Processed ${batch.length} cost learning updates`);
    } catch (error) {
      console.error("Cost learning batch processing failed:", error);
    }
  }

  /**
   * Fallback recommendation when AI is unavailable
   */
  private getFallbackRecommendation(request: CostOptimizationRequest): CostAwareRouteRecommendation {
    const baseTime = request.routeStats.estimatedTime;
    const baseDistance = request.routeStats.totalDistance;
    
    // Simple cost estimation
    const estimatedFuel = baseDistance * 0.3; // 0.3L per km
    const estimatedTimeCost = (baseTime / 60) * 45; // $45/hour
    const estimatedFuelCost = estimatedFuel * 1.5; // $1.5/L
    const estimatedTotalCost = estimatedTimeCost + estimatedFuelCost + (baseDistance * 0.15) + ((estimatedTimeCost + estimatedFuelCost) * 0.2);

    const fallbackPrediction: CostPrediction = {
      predictedTime: baseTime,
      predictedFuelConsumption: estimatedFuel,
      predictedTotalCost: estimatedTotalCost,
      confidenceScore: 0.5,
      costBreakdown: {
        fuel: estimatedFuelCost,
        labor: estimatedTimeCost,
        maintenance: baseDistance * 0.15,
        overhead: (estimatedTimeCost + estimatedFuelCost) * 0.2,
      },
      riskFactors: this.getFallbackRiskFactors(request.weatherData),
      optimizationSuggestions: this.getFallbackSuggestions(),
    };

    return {
      routeId: `fallback_route_${Date.now()}`,
      predictedCosts: fallbackPrediction,
      costEfficiencyScore: 50, // Neutral score
      alternativeRoutes: [],
      optimizationOpportunities: this.getFallbackSuggestions(),
      riskAssessment: {
        costOverrunRisk: "medium",
        likelyCostRange: [estimatedTotalCost * 0.8, estimatedTotalCost * 1.4],
        primaryRiskFactors: this.getFallbackRiskFactors(request.weatherData),
      },
    };
  }

  /**
   * Calculate basic cost efficiency
   */
  private calculateBasicCostEfficiency(prediction: CostPrediction): number {
    const costPerKm = prediction.predictedTotalCost / 10; // Assume 10km baseline
    return Math.max(0, 100 - (costPerKm - 8) * 5); // Simple scoring
  }

  /**
   * Get basic recommendations
   */
  private getBasicRecommendations(prediction: CostPrediction): string[] {
    return [
      "Monitor actual fuel consumption",
      "Track completion time for accuracy",
      "Consider weather impact on costs",
    ];
  }

  /**
   * Calculate weather severity
   */
  private calculateWeatherSeverity(weatherData?: CurrentWeather): number {
    if (!weatherData) return 0;
    
    let severity = 0;
    if (weatherData.rain1h > 5) severity += 0.3;
    if (weatherData.windSpeed > 10) severity += 0.2;
    if (weatherData.visibility < 1000) severity += 0.3;
    
    return Math.min(1, severity);
  }

  /**
   * Get fallback risk factors
   */
  private getFallbackRiskFactors(weatherData?: CurrentWeather): string[] {
    const factors: string[] = ["Limited prediction accuracy"];
    
    if (weatherData) {
      if (weatherData.rain1h > 5) factors.push("Weather impact not fully assessed");
      if (weatherData.windSpeed > 10) factors.push("Wind conditions may affect costs");
    }
    
    return factors;
  }

  /**
   * Get fallback suggestions
   */
  private getFallbackSuggestions(): string[] {
    return [
      "Collect actual cost data to improve predictions",
      "Consider operational factors for better estimates",
      "Monitor weather impact on route costs",
    ];
  }
}

// Export singleton instance
export const costPredictionService = CostPredictionService.getInstance();