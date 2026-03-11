/**
 * Cost Correction Model for Trash Route Optimization
 * Learns from historical route data to improve cost estimates and identify cost-optimal routes
 */

import { Platform } from "react-native";
import type { RouteStatistics, TurnStatistics } from "@/types/routing";
import type { CurrentWeather } from "@/services/weatherService";

export interface CostFactors {
  // Route characteristics
  distance: number; // kilometers
  estimatedTime: number; // minutes
  turnComplexity: number; // calculated from turn distribution
  segmentComplexity: number; // segments per km

  // Weather impact
  weatherSeverity: number; // 0-1 scale
  temperature: number; // Celsius
  precipitation: number; // mm/h
  windSpeed: number; // m/s
  visibility: number; // meters

  // Operational factors
  vehicleType: string;
  driverExperience: DriverExperienceLevel;
  timeOfDay: TimeOfDay;
  dayOfWeek: number; // 0-6
  season: Season;

  // Historical performance
  historicalAccuracy: number; // 0-1, how accurate past predictions were
  routeSuccessRate: number; // 0-1, completion success rate
}

export interface ActualCostData {
  actualTime: number; // minutes
  actualFuelConsumption: number; // liters
  actualStopsCompleted: number;
  maintenanceCosts: number; // dollars
  laborCosts: number; // dollars
  totalCost: number; // dollars
  customerComplaints: number;
  safetyIncidents: number;
}

export interface CostPrediction {
  predictedTime: number; // minutes
  predictedFuelConsumption: number; // liters
  predictedTotalCost: number; // dollars
  confidenceScore: number; // 0-1
  costBreakdown: {
    fuel: number;
    labor: number;
    maintenance: number;
    overhead: number;
  };
  riskFactors: string[];
  optimizationSuggestions: string[];
}

export interface CostCorrectionResult {
  originalEstimate: number;
  correctedEstimate: number;
  correctionFactor: number; // corrected / original
  confidence: number;
  reasoning: string;
  primaryCostDrivers: string[];
  potentialSavings: number;
}

export type DriverExperienceLevel = "novice" | "intermediate" | "experienced";
export type TimeOfDay = "early_morning" | "morning" | "afternoon" | "evening";
export type Season = "spring" | "summer" | "fall" | "winter";

/**
 * Cost Correction Model using Liquid Leap AI for sophisticated cost prediction
 */
export class CostCorrectionModel {
  private static readonly MODEL_VERSION = "1.0";
  private static readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
  private static readonly MIN_TRAINING_SAMPLES = 50;

  private costCache = new Map<
    string,
    { prediction: CostPrediction; timestamp: number }
  >();
  private historicalData: Array<{
    factors: CostFactors;
    actual: ActualCostData;
  }> = [];

  constructor() {
    this.loadHistoricalData();
  }

  /**
   * Predict route costs using AI model with historical data learning
   */
  async predictCosts(
    routeStats: RouteStatistics,
    weatherData?: CurrentWeather,
    operationalContext?: Partial<CostFactors>,
  ): Promise<CostPrediction | null> {
    // Only available on iOS with Leap SDK
    if (Platform.OS !== "ios") {
      return this.getFallbackPrediction(
        routeStats,
        weatherData,
        operationalContext,
      );
    }

    const costFactors = this.buildCostFactors(
      routeStats,
      weatherData,
      operationalContext,
    );
    const cacheKey = this.generateCacheKey(costFactors);

    // Check cache
    const cached = this.costCache.get(cacheKey);
    if (cached && this.isCacheValid(cached.timestamp)) {
      return cached.prediction;
    }

    try {
      const prediction = await this.callAICostModel(costFactors);
      if (prediction) {
        this.costCache.set(cacheKey, { prediction, timestamp: Date.now() });
      }
      return prediction;
    } catch (error) {
      console.error("AI cost prediction failed:", error);
      return this.getFallbackPrediction(
        routeStats,
        weatherData,
        operationalContext,
      );
    }
  }

  /**
   * Correct existing cost estimates based on learned patterns
   */
  async correctCosts(
    originalEstimate: number,
    routeStats: RouteStatistics,
    weatherData?: CurrentWeather,
    operationalContext?: Partial<CostFactors>,
  ): Promise<CostCorrectionResult | null> {
    const prediction = await this.predictCosts(
      routeStats,
      weatherData,
      operationalContext,
    );
    if (!prediction) return null;

    const correctedEstimate = prediction.predictedTotalCost;
    const correctionFactor = correctedEstimate / originalEstimate;

    return {
      originalEstimate,
      correctedEstimate,
      correctionFactor,
      confidence: prediction.confidenceScore,
      reasoning: this.generateCorrectionReasoning(correctionFactor, prediction),
      primaryCostDrivers: this.identifyPrimaryCostDrivers(prediction),
      potentialSavings: Math.max(0, originalEstimate - correctedEstimate),
    };
  }

  /**
   * Learn from actual cost data to improve future predictions
   */
  async learnFromActualData(
    predictedCosts: CostPrediction,
    actualCosts: ActualCostData,
    routeStats: RouteStatistics,
    weatherData?: CurrentWeather,
    operationalContext?: Partial<CostFactors>,
  ): Promise<void> {
    const costFactors = this.buildCostFactors(
      routeStats,
      weatherData,
      operationalContext,
    );

    this.historicalData.push({
      factors: costFactors,
      actual: actualCosts,
    });

    // Keep only recent data to prevent memory issues
    if (this.historicalData.length > 1000) {
      this.historicalData = this.historicalData.slice(-500);
    }

    // Update historical accuracy metrics
    this.updateHistoricalAccuracy(predictedCosts, actualCosts);
  }

  /**
   * Build cost factors from route statistics and context
   */
  private buildCostFactors(
    routeStats: RouteStatistics,
    weatherData?: CurrentWeather,
    operationalContext?: Partial<CostFactors>,
  ): CostFactors {
    const turns = routeStats.turns;
    const totalTurns = Math.max(
      1,
      turns.leftTurns + turns.rightTurns + turns.uTurns + turns.straightAhead,
    );

    return {
      // Route characteristics
      distance: routeStats.totalDistance,
      estimatedTime: routeStats.estimatedTime,
      turnComplexity: (turns.leftTurns * 2 + turns.uTurns * 3) / totalTurns, // Higher complexity for left/U turns
      segmentComplexity: routeStats.segmentsRouted / routeStats.totalDistance,

      // Weather impact
      weatherSeverity: this.calculateWeatherSeverity(weatherData),
      temperature: weatherData?.temp ?? 15,
      precipitation: weatherData?.rain1h ?? 0,
      windSpeed: weatherData?.windSpeed ?? 0,
      visibility: weatherData?.visibility ?? 10000,

      // Operational factors
      vehicleType:
        operationalContext?.vehicleType ?? "municipal waste collection truck",
      driverExperience: operationalContext?.driverExperience ?? "intermediate",
      timeOfDay: operationalContext?.timeOfDay ?? "morning",
      dayOfWeek: operationalContext?.dayOfWeek ?? new Date().getDay(),
      season: operationalContext?.season ?? this.getCurrentSeason(),

      // Historical performance (will be updated based on actual data)
      historicalAccuracy: operationalContext?.historicalAccuracy ?? 0.8,
      routeSuccessRate: operationalContext?.routeSuccessRate ?? 0.95,
    };
  }

  /**
   * Call AI for sophisticated cost prediction
   * NOTE: Leap SDK removed - returns null to use fallback heuristics
   */
  private async callAICostModel(
    costFactors: CostFactors,
  ): Promise<CostPrediction | null> {
    // Leap SDK removed - return null to use fallback heuristics
    return null;
  }

  /**
   * Fallback cost prediction when AI is unavailable
   */
  private getFallbackPrediction(
    routeStats: RouteStatistics,
    weatherData?: CurrentWeather,
    operationalContext?: Partial<CostFactors>,
  ): CostPrediction {
    const baseTime = routeStats.estimatedTime;
    const baseFuel = routeStats.totalDistance * 0.3; // 0.3L per km baseline

    // Weather adjustments
    const weatherMultiplier = this.calculateWeatherImpact(weatherData);

    // Time adjustments
    const timeMultiplier = this.getTimeOfDayMultiplier(
      operationalContext?.timeOfDay,
    );

    // Driver experience adjustments
    const experienceMultiplier = this.getExperienceMultiplier(
      operationalContext?.driverExperience,
    );

    const adjustedTime =
      baseTime * weatherMultiplier * timeMultiplier * experienceMultiplier;
    const adjustedFuel = baseFuel * weatherMultiplier * 0.9; // Weather affects fuel efficiency

    // Cost calculation (simplified)
    const laborCost = (adjustedTime / 60) * 45; // $45/hour
    const fuelCost = adjustedFuel * 1.5; // $1.5/L
    const maintenanceCost = routeStats.totalDistance * 0.15; // $0.15/km
    const overheadCost = (laborCost + fuelCost + maintenanceCost) * 0.2; // 20% overhead

    const totalCost = laborCost + fuelCost + maintenanceCost + overheadCost;

    return {
      predictedTime: adjustedTime,
      predictedFuelConsumption: adjustedFuel,
      predictedTotalCost: totalCost,
      confidenceScore: 0.6, // Lower confidence for fallback
      costBreakdown: {
        fuel: fuelCost,
        labor: laborCost,
        maintenance: maintenanceCost,
        overhead: overheadCost,
      },
      riskFactors: this.getFallbackRiskFactors(weatherData),
      optimizationSuggestions: this.getFallbackSuggestions(weatherData),
    };
  }

  /**
   * Calculate weather severity score (0-1)
   */
  private calculateWeatherSeverity(weatherData?: CurrentWeather): number {
    if (!weatherData) return 0;

    let severity = 0;

    // Precipitation impact
    if (weatherData.rain1h > 5) severity += 0.3;
    if (weatherData.rain1h > 10) severity += 0.2;
    if (weatherData.snow1h > 0) severity += 0.4;

    // Wind impact
    if (weatherData.windSpeed > 10) severity += 0.2;
    if (weatherData.windSpeed > 15) severity += 0.2;

    // Visibility impact
    if (weatherData.visibility < 1000) severity += 0.3;
    if (weatherData.visibility < 500) severity += 0.2;

    // Temperature impact (extreme temperatures)
    if (weatherData.temp < -10 || weatherData.temp > 35) severity += 0.2;

    return Math.min(1, severity);
  }

  /**
   * Calculate weather impact multiplier
   */
  private calculateWeatherImpact(weatherData?: CurrentWeather): number {
    const severity = this.calculateWeatherSeverity(weatherData);
    return 1 + severity * 0.5; // Up to 50% increase in time/cost
  }

  /**
   * Get time of day multiplier
   */
  private getTimeOfDayMultiplier(timeOfDay?: TimeOfDay): number {
    const multipliers = {
      early_morning: 1.1, // Slower, less visibility
      morning: 1.0, // Baseline
      afternoon: 1.05, // More traffic
      evening: 1.15, // Rush hour, reduced visibility
    };
    return timeOfDay ? multipliers[timeOfDay] : 1.0;
  }

  /**
   * Get driver experience multiplier
   */
  private getExperienceMultiplier(experience?: DriverExperienceLevel): number {
    const multipliers = {
      novice: 1.3, // 30% slower
      intermediate: 1.0, // Baseline
      experienced: 0.85, // 15% faster
    };
    return experience ? multipliers[experience] : 1.0;
  }

  /**
   * Get current season
   */
  private getCurrentSeason(): Season {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return "spring";
    if (month >= 5 && month <= 7) return "summer";
    if (month >= 8 && month <= 10) return "fall";
    return "winter";
  }

  /**
   * Generate cache key for cost predictions
   */
  private generateCacheKey(costFactors: CostFactors): string {
    const key = `${costFactors.distance.toFixed(1)}_${costFactors.estimatedTime.toFixed(0)}_${costFactors.weatherSeverity.toFixed(1)}_${costFactors.driverExperience}_${costFactors.timeOfDay}_${costFactors.dayOfWeek}_${costFactors.season}`;
    return key;
  }

  /**
   * Check if cache entry is valid
   */
  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < CostCorrectionModel.CACHE_TTL_MS;
  }

  /**
   * Generate correction reasoning
   */
  private generateCorrectionReasoning(
    correctionFactor: number,
    prediction: CostPrediction,
  ): string {
    if (correctionFactor > 1.2) {
      return `Cost estimate increased by ${((correctionFactor - 1) * 100).toFixed(0)}% due to ${prediction.riskFactors.join(", ")}`;
    } else if (correctionFactor < 0.8) {
      return `Cost estimate reduced by ${((1 - correctionFactor) * 100).toFixed(0)}% based on favorable conditions`;
    } else {
      return "Cost estimate remains within normal range";
    }
  }

  /**
   * Identify primary cost drivers
   */
  private identifyPrimaryCostDrivers(prediction: CostPrediction): string[] {
    const drivers = [...prediction.riskFactors];

    if (prediction.costBreakdown.fuel > prediction.costBreakdown.labor * 0.8) {
      drivers.push("High fuel consumption");
    }

    if (prediction.predictedTime > 240) {
      // > 4 hours
      drivers.push("Extended route duration");
    }

    return drivers;
  }

  /**
   * Get fallback risk factors
   */
  private getFallbackRiskFactors(weatherData?: CurrentWeather): string[] {
    const factors: string[] = [];

    if (weatherData) {
      if (weatherData.rain1h > 5) factors.push("Moderate precipitation");
      if (weatherData.rain1h > 10) factors.push("Heavy precipitation");
      if (weatherData.windSpeed > 10) factors.push("Strong winds");
      if (weatherData.visibility < 1000) factors.push("Low visibility");
    }

    return factors;
  }

  /**
   * Get fallback optimization suggestions
   */
  private getFallbackSuggestions(weatherData?: CurrentWeather): string[] {
    const suggestions: string[] = [];

    if (weatherData) {
      if (weatherData.rain1h > 5)
        suggestions.push("Consider delaying start to avoid peak precipitation");
      if (weatherData.windSpeed > 10)
        suggestions.push("Allow extra time for windy conditions");
      if (weatherData.visibility < 1000)
        suggestions.push("Reduce speed in low visibility areas");
    }

    suggestions.push("Monitor fuel consumption during route");
    suggestions.push("Track actual completion time for future optimization");

    return suggestions;
  }

  /**
   * Update historical accuracy based on prediction vs actual
   */
  private updateHistoricalAccuracy(
    predicted: CostPrediction,
    actual: ActualCostData,
  ): void {
    const timeAccuracy =
      1 -
      Math.abs(predicted.predictedTime - actual.actualTime) /
        predicted.predictedTime;
    const costAccuracy =
      1 -
      Math.abs(predicted.predictedTotalCost - actual.totalCost) /
        predicted.predictedTotalCost;

    // Update model's understanding of its accuracy
    const newAccuracy = (timeAccuracy + costAccuracy) / 2;

    // This could be used to adjust future confidence scores
    console.log(`Model accuracy update: ${(newAccuracy * 100).toFixed(1)}%`);
  }

  /**
   * Load historical data (placeholder for persistence)
   */
  private loadHistoricalData(): void {
    // In a real implementation, this would load from storage
    this.historicalData = [];
  }

  /**
   * Clear cost cache
   */
  clearCache(): void {
    this.costCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.costCache.size,
      hitRate: 0, // Could be implemented with proper tracking
    };
  }
}

// Singleton instance
export const costCorrectionModel = new CostCorrectionModel();
