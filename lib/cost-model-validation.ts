/**
 * Cost Model Validation and Error Analysis
 * Comprehensive validation system for cost prediction models
 */

import type { CostPrediction } from "@/lib/cost-correction-model";
import type { RouteStatistics } from "@/types/routing";
import type { CurrentWeather } from "@/services/weatherService";

export interface ValidationResult {
  overallScore: number; // 0-100
  accuracyMetrics: AccuracyMetrics;
  errorAnalysis: ErrorAnalysis;
  biasAnalysis: BiasAnalysis;
  reliabilityMetrics: ReliabilityMetrics;
  recommendations: ValidationRecommendation[];
  timestamp: string;
  modelVersion: string;
}

export interface AccuracyMetrics {
  meanAbsoluteError: {
    time: number;
    cost: number;
    fuel: number;
  };
  meanAbsolutePercentageError: {
    time: number;
    cost: number;
    fuel: number;
  };
  rootMeanSquaredError: {
    time: number;
    cost: number;
    fuel: number;
  };
  rSquared: {
    time: number;
    cost: number;
    fuel: number;
  };
  correlationCoefficient: {
    time: number;
    cost: number;
    fuel: number;
  };
}

export interface ErrorAnalysis {
  errorDistribution: {
    time: number[];
    cost: number[];
    fuel: number[];
  };
  outlierAnalysis: {
    extremeErrors: number;
    moderateErrors: number;
    normalErrors: number;
  };
  errorPatterns: {
    seasonalBias: Record<string, number>;
    timeOfDayBias: Record<string, number>;
    weatherBias: Record<string, number>;
    experienceBias: Record<string, number>;
  };
}

export interface BiasAnalysis {
  systematicBias: {
    overPredictionRate: number;
    underPredictionRate: number;
    averageBias: number;
  };
  conditionalBias: {
    byDistance: Array<{ range: string; bias: number; count: number }>;
    byWeather: Array<{ condition: string; bias: number; count: number }>;
    byExperience: Array<{ level: string; bias: number; count: number }>;
    byTimeOfDay: Array<{ time: string; bias: number; count: number }>;
  };
  biasTrends: {
    temporal: Array<{ date: string; bias: number }>;
    magnitude: Array<{ range: string; bias: number }>;
  };
}

export interface ReliabilityMetrics {
  predictionConfidence: {
    average: number;
    calibration: number; // How well confidence matches actual accuracy
    reliabilityDiagram: Array<{
      bin: string;
      predicted: number;
      actual: number;
    }>;
  };
  consistency: {
    variance: number;
    stability: number; // How consistent predictions are for similar inputs
    repeatability: number;
  };
  robustness: {
    noiseSensitivity: number;
    outlierResistance: number;
    extrapolationReliability: number;
  };
}

export interface ValidationRecommendation {
  type: "critical" | "warning" | "improvement";
  category: "accuracy" | "bias" | "reliability" | "data_quality";
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  suggestedActions: string[];
}

export interface ValidationDataset {
  predictions: CostPrediction[];
  actuals: Array<{
    actualTime: number;
    actualCost: number;
    actualFuel: number;
  }>;
  contexts: Array<{
    routeStats: RouteStatistics;
    weatherData?: CurrentWeather;
    operationalContext?: any;
  }>;
  metadata: Array<{
    timestamp: string;
    routeId: string;
    modelVersion: string;
  }>;
}

/**
 * Comprehensive cost model validation system
 */
export class CostModelValidator {
  private static readonly CONFIDENCE_BINS = [
    "0.0-0.2",
    "0.2-0.4",
    "0.4-0.6",
    "0.6-0.8",
    "0.8-1.0",
  ];
  private static readonly ERROR_THRESHOLDS = {
    extreme: 0.5, // >50% error
    moderate: 0.25, // 25-50% error
    normal: 0.1, // 10-25% error
    acceptable: 0.1, // <10% error
  };

  /**
   * Perform comprehensive validation of cost predictions
   */
  async validateModel(dataset: ValidationDataset): Promise<ValidationResult> {
    console.log("🔍 Starting comprehensive cost model validation...");

    try {
      // Calculate accuracy metrics
      const accuracyMetrics = this.calculateAccuracyMetrics(dataset);

      // Perform error analysis
      const errorAnalysis = this.analyzeErrors(dataset, accuracyMetrics);

      // Analyze biases
      const biasAnalysis = this.analyzeBiases(dataset);

      // Calculate reliability metrics
      const reliabilityMetrics = this.calculateReliabilityMetrics(dataset);

      // Generate recommendations
      const recommendations = this.generateRecommendations({
        accuracyMetrics,
        errorAnalysis,
        biasAnalysis,
        reliabilityMetrics,
      });

      // Calculate overall score
      const overallScore = this.calculateOverallScore({
        accuracyMetrics,
        biasAnalysis,
        reliabilityMetrics,
      });

      return {
        overallScore,
        accuracyMetrics,
        errorAnalysis,
        biasAnalysis,
        reliabilityMetrics,
        recommendations,
        timestamp: new Date().toISOString(),
        modelVersion: dataset.metadata[0]?.modelVersion || "unknown",
      };
    } catch (error) {
      console.error("❌ Validation failed:", error);
      throw error;
    }
  }

  /**
   * Calculate comprehensive accuracy metrics
   */
  private calculateAccuracyMetrics(
    dataset: ValidationDataset,
  ): AccuracyMetrics {
    const { predictions, actuals } = dataset;
    const n = predictions.length;

    // Calculate errors for each metric
    const timeErrors = predictions.map(
      (pred, i) => pred.predictedTime - actuals[i].actualTime,
    );
    const costErrors = predictions.map(
      (pred, i) => pred.predictedTotalCost - actuals[i].actualCost,
    );
    const fuelErrors = predictions.map(
      (pred, i) => pred.predictedFuelConsumption - actuals[i].actualFuel,
    );

    // Mean Absolute Error
    const mae = {
      time: timeErrors.reduce((sum, err) => sum + Math.abs(err), 0) / n,
      cost: costErrors.reduce((sum, err) => sum + Math.abs(err), 0) / n,
      fuel: fuelErrors.reduce((sum, err) => sum + Math.abs(err), 0) / n,
    };

    // Mean Absolute Percentage Error
    const mape = {
      time:
        (predictions
          .map((pred, i) => Math.abs(timeErrors[i]) / actuals[i].actualTime)
          .reduce((a, b) => a + b, 0) /
          n) *
        100,
      cost:
        (predictions
          .map((pred, i) => Math.abs(costErrors[i]) / actuals[i].actualCost)
          .reduce((a, b) => a + b, 0) /
          n) *
        100,
      fuel:
        (predictions
          .map((pred, i) => Math.abs(fuelErrors[i]) / actuals[i].actualFuel)
          .reduce((a, b) => a + b, 0) /
          n) *
        100,
    };

    // Root Mean Squared Error
    const rmse = {
      time: Math.sqrt(timeErrors.reduce((sum, err) => sum + err * err, 0) / n),
      cost: Math.sqrt(costErrors.reduce((sum, err) => sum + err * err, 0) / n),
      fuel: Math.sqrt(fuelErrors.reduce((sum, err) => sum + err * err, 0) / n),
    };

    // R-squared
    const actualMeans = {
      time: actuals.reduce((sum, a) => sum + a.actualTime, 0) / n,
      cost: actuals.reduce((sum, a) => sum + a.actualCost, 0) / n,
      fuel: actuals.reduce((sum, a) => sum + a.actualFuel, 0) / n,
    };

    const totalSums = {
      time: actuals.reduce(
        (sum, a) => sum + Math.pow(a.actualTime - actualMeans.time, 2),
        0,
      ),
      cost: actuals.reduce(
        (sum, a) => sum + Math.pow(a.actualCost - actualMeans.cost, 2),
        0,
      ),
      fuel: actuals.reduce(
        (sum, a) => sum + Math.pow(a.actualFuel - actualMeans.fuel, 2),
        0,
      ),
    };

    const residualSums = {
      time: timeErrors.reduce((sum, err) => sum + err * err, 0),
      cost: costErrors.reduce((sum, err) => sum + err * err, 0),
      fuel: fuelErrors.reduce((sum, err) => sum + err * err, 0),
    };

    const r2 = {
      time: 1 - residualSums.time / totalSums.time,
      cost: 1 - residualSums.cost / totalSums.cost,
      fuel: 1 - residualSums.fuel / totalSums.fuel,
    };

    // Correlation coefficient
    const correlations = {
      time: this.calculateCorrelation(
        predictions.map((p) => p.predictedTime),
        actuals.map((a) => a.actualTime),
      ),
      cost: this.calculateCorrelation(
        predictions.map((p) => p.predictedTotalCost),
        actuals.map((a) => a.actualCost),
      ),
      fuel: this.calculateCorrelation(
        predictions.map((p) => p.predictedFuelConsumption),
        actuals.map((a) => a.actualFuel),
      ),
    };

    return {
      meanAbsoluteError: mae,
      meanAbsolutePercentageError: mape,
      rootMeanSquaredError: rmse,
      rSquared: r2,
      correlationCoefficient: correlations,
    };
  }

  /**
   * Perform detailed error analysis
   */
  private analyzeErrors(
    dataset: ValidationDataset,
    accuracyMetrics: AccuracyMetrics,
  ): ErrorAnalysis {
    const { predictions, actuals, contexts } = dataset;

    // Error distribution
    const errorDistribution = {
      time: predictions.map(
        (pred, i) =>
          (pred.predictedTime - actuals[i].actualTime) / actuals[i].actualTime,
      ),
      cost: predictions.map(
        (pred, i) =>
          (pred.predictedTotalCost - actuals[i].actualCost) /
          actuals[i].actualCost,
      ),
      fuel: predictions.map(
        (pred, i) =>
          (pred.predictedFuelConsumption - actuals[i].actualFuel) /
          actuals[i].actualFuel,
      ),
    };

    // Outlier analysis
    const outlierAnalysis = {
      extremeErrors: 0,
      moderateErrors: 0,
      normalErrors: 0,
    };

    errorDistribution.cost.forEach((error) => {
      const absError = Math.abs(error);
      if (absError > CostModelValidator.ERROR_THRESHOLDS.extreme) {
        outlierAnalysis.extremeErrors++;
      } else if (absError > CostModelValidator.ERROR_THRESHOLDS.moderate) {
        outlierAnalysis.moderateErrors++;
      } else if (absError > CostModelValidator.ERROR_THRESHOLDS.normal) {
        outlierAnalysis.normalErrors++;
      }
    });

    // Error patterns by different factors
    const errorPatterns = {
      seasonalBias: this.calculateSeasonalBias(
        contexts,
        errorDistribution.cost,
      ),
      timeOfDayBias: this.calculateTimeOfDayBias(
        contexts,
        errorDistribution.cost,
      ),
      weatherBias: this.calculateWeatherBias(contexts, errorDistribution.cost),
      experienceBias: this.calculateExperienceBias(
        contexts,
        errorDistribution.cost,
      ),
    };

    return {
      errorDistribution,
      outlierAnalysis,
      errorPatterns,
    };
  }

  /**
   * Analyze systematic and conditional biases
   */
  private analyzeBiases(dataset: ValidationDataset): BiasAnalysis {
    const { predictions, actuals, contexts } = dataset;

    // Systematic bias
    const errors = predictions.map(
      (pred, i) => pred.predictedTotalCost - actuals[i].actualCost,
    );
    const overPredictionRate =
      errors.filter((err) => err > 0).length / errors.length;
    const underPredictionRate =
      errors.filter((err) => err < 0).length / errors.length;
    const averageBias =
      errors.reduce((sum, err) => sum + err, 0) / errors.length;

    const systematicBias = {
      overPredictionRate,
      underPredictionRate,
      averageBias,
    };

    // Conditional bias by different factors
    const conditionalBias = {
      byDistance: this.calculateDistanceBias(contexts, predictions, actuals),
      byWeather: this.calculateWeatherConditionBias(
        contexts,
        predictions,
        actuals,
      ),
      byExperience: this.calculateExperienceBiasDetailed(
        contexts,
        predictions,
        actuals,
      ),
      byTimeOfDay: this.calculateTimeOfDayBiasDetailed(
        contexts,
        predictions,
        actuals,
      ),
    };

    // Bias trends
    const biasTrends = {
      temporal: this.calculateTemporalBias(contexts, dataset.metadata, errors),
      magnitude: this.calculateMagnitudeBias(predictions, errors),
    };

    return {
      systematicBias,
      conditionalBias,
      biasTrends,
    };
  }

  /**
   * Calculate reliability metrics
   */
  private calculateReliabilityMetrics(
    dataset: ValidationDataset,
  ): ReliabilityMetrics {
    const { predictions, actuals } = dataset;

    // Prediction confidence analysis
    const confidenceAnalysis = this.analyzeConfidenceCalibration(
      predictions,
      actuals,
    );

    // Consistency analysis
    const consistency = {
      variance: this.calculatePredictionVariance(predictions),
      stability: this.calculateStability(predictions),
      repeatability: this.calculateRepeatability(predictions),
    };

    // Robustness analysis
    const robustness = {
      noiseSensitivity: this.calculateNoiseSensitivity(predictions),
      outlierResistance: this.calculateOutlierResistance(predictions, actuals),
      extrapolationReliability:
        this.calculateExtrapolationReliability(predictions),
    };

    return {
      predictionConfidence: confidenceAnalysis,
      consistency,
      robustness,
    };
  }

  /**
   * Generate validation recommendations
   */
  private generateRecommendations(analysis: any): ValidationRecommendation[] {
    const recommendations: ValidationRecommendation[] = [];

    // Accuracy-based recommendations
    if (analysis.accuracyMetrics.meanAbsolutePercentageError.cost > 30) {
      recommendations.push({
        type: "critical",
        category: "accuracy",
        title: "High Cost Prediction Error",
        description: `Mean absolute percentage error for cost predictions is ${analysis.accuracyMetrics.meanAbsolutePercentageError.cost.toFixed(1)}%, which is above the acceptable threshold of 30%.`,
        impact: "high",
        suggestedActions: [
          "Review and retrain the cost model with more recent data",
          "Investigate systematic biases in cost estimation",
          "Consider adding more cost-related features to the model",
        ],
      });
    }

    // Bias-based recommendations
    if (Math.abs(analysis.biasAnalysis.systematicBias.averageBias) > 50) {
      recommendations.push({
        type: "warning",
        category: "bias",
        title: "Significant Systematic Bias",
        description: `The model shows a systematic bias of $${analysis.biasAnalysis.systematicBias.averageBias.toFixed(2)}, indicating consistent over- or under-prediction.`,
        impact: "medium",
        suggestedActions: [
          "Apply bias correction to model predictions",
          "Investigate root causes of systematic bias",
          "Retrain model with balanced dataset",
        ],
      });
    }

    // Reliability-based recommendations
    if (analysis.reliabilityMetrics.predictionConfidence.calibration < 0.7) {
      recommendations.push({
        type: "improvement",
        category: "reliability",
        title: "Poor Confidence Calibration",
        description:
          "Model confidence scores do not accurately reflect actual prediction accuracy.",
        impact: "medium",
        suggestedActions: [
          "Recalibrate confidence scoring mechanism",
          "Implement confidence-based prediction filtering",
          "Retrain model with better uncertainty estimation",
        ],
      });
    }

    // Data quality recommendations
    if (analysis.errorAnalysis.outlierAnalysis.extremeErrors > 0.05) {
      recommendations.push({
        type: "warning",
        category: "data_quality",
        title: "High Rate of Extreme Errors",
        description: `${(analysis.errorAnalysis.outlierAnalysis.extremeErrors * 100).toFixed(1)}% of predictions have extreme errors (>50%), indicating potential data quality issues.`,
        impact: "high",
        suggestedActions: [
          "Review and clean training data",
          "Investigate outlier cases for data anomalies",
          "Implement outlier detection and handling",
        ],
      });
    }

    return recommendations;
  }

  /**
   * Calculate overall validation score
   */
  private calculateOverallScore(analysis: any): number {
    let score = 0;
    const weights = {
      accuracy: 0.4,
      bias: 0.3,
      reliability: 0.3,
    };

    // Accuracy component (40% weight)
    const accuracyScore = Math.max(
      0,
      100 - analysis.accuracyMetrics.meanAbsolutePercentageError.cost,
    );
    score += accuracyScore * weights.accuracy;

    // Bias component (30% weight)
    const biasMagnitude = Math.abs(
      analysis.biasAnalysis.systematicBias.averageBias,
    );
    const biasScore = Math.max(0, 100 - (biasMagnitude / 10) * 20); // $10 bias = 20 points off
    score += biasScore * weights.bias;

    // Reliability component (30% weight)
    const reliabilityScore =
      analysis.reliabilityMetrics.predictionConfidence.calibration * 100;
    score += reliabilityScore * weights.reliability;

    return Math.max(0, Math.min(100, score));
  }

  // Helper methods for detailed calculations
  private calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt(
      (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY),
    );

    return denominator === 0 ? 0 : numerator / denominator;
  }

  private calculateSeasonalBias(
    contexts: any[],
    errors: number[],
  ): Record<string, number> {
    const seasonalErrors: Record<string, number[]> = {
      spring: [],
      summer: [],
      fall: [],
      winter: [],
    };

    contexts.forEach((context, i) => {
      const season = context.operationalContext?.season || "spring";
      if (season in seasonalErrors) {
        seasonalErrors[season].push(errors[i]);
      }
    });

    const seasonalBias: Record<string, number> = {};
    Object.keys(seasonalErrors).forEach((season) => {
      const errors = seasonalErrors[season];
      seasonalBias[season] =
        errors.length > 0
          ? errors.reduce((sum, err) => sum + err, 0) / errors.length
          : 0;
    });

    return seasonalBias;
  }

  private calculateTimeOfDayBias(
    contexts: any[],
    errors: number[],
  ): Record<string, number> {
    const timeErrors: Record<string, number[]> = {
      early_morning: [],
      morning: [],
      afternoon: [],
      evening: [],
    };

    contexts.forEach((context, i) => {
      const timeOfDay = context.operationalContext?.timeOfDay || "morning";
      if (timeOfDay in timeErrors) {
        timeErrors[timeOfDay].push(errors[i]);
      }
    });

    const timeBias: Record<string, number> = {};
    Object.keys(timeErrors).forEach((time) => {
      const errors = timeErrors[time];
      timeBias[time] =
        errors.length > 0
          ? errors.reduce((sum, err) => sum + err, 0) / errors.length
          : 0;
    });

    return timeBias;
  }

  private calculateWeatherBias(
    contexts: any[],
    errors: number[],
  ): Record<string, number> {
    const weatherErrors: Record<string, number[]> = {
      clear: [],
      rain: [],
      snow: [],
      fog: [],
    };

    contexts.forEach((context, i) => {
      const weather =
        context.weatherData?.condition?.main?.toLowerCase() || "clear";
      const weatherKey = weather in weatherErrors ? weather : "clear";
      weatherErrors[weatherKey].push(errors[i]);
    });

    const weatherBias: Record<string, number> = {};
    Object.keys(weatherErrors).forEach((condition) => {
      const errors = weatherErrors[condition];
      weatherBias[condition] =
        errors.length > 0
          ? errors.reduce((sum, err) => sum + err, 0) / errors.length
          : 0;
    });

    return weatherBias;
  }

  private calculateExperienceBias(
    contexts: any[],
    errors: number[],
  ): Record<string, number> {
    const experienceErrors: Record<string, number[]> = {
      novice: [],
      intermediate: [],
      experienced: [],
    };

    contexts.forEach((context, i) => {
      const experience =
        context.operationalContext?.driverExperience || "intermediate";
      if (experience in experienceErrors) {
        experienceErrors[experience].push(errors[i]);
      }
    });

    const experienceBias: Record<string, number> = {};
    Object.keys(experienceErrors).forEach((level) => {
      const errors = experienceErrors[level];
      experienceBias[level] =
        errors.length > 0
          ? errors.reduce((sum, err) => sum + err, 0) / errors.length
          : 0;
    });

    return experienceBias;
  }

  private calculateDistanceBias(
    contexts: any[],
    predictions: CostPrediction[],
    actuals: any[],
  ): any[] {
    const buckets: Record<string, { sum: number; count: number }> = {
      "0-10km": { sum: 0, count: 0 },
      "10-50km": { sum: 0, count: 0 },
      "50-200km": { sum: 0, count: 0 },
      "200km+": { sum: 0, count: 0 },
    };

    contexts.forEach((ctx, i) => {
      const dist = ctx.routeStats?.totalDistance || 0;
      const error = predictions[i].predictedTotalCost - actuals[i].actualCost;
      let range = "200km+";
      if (dist < 10) range = "0-10km";
      else if (dist < 50) range = "10-50km";
      else if (dist < 200) range = "50-200km";

      buckets[range].sum += error;
      buckets[range].count++;
    });

    return Object.keys(buckets).map((range) => ({
      range,
      bias: buckets[range].count ? buckets[range].sum / buckets[range].count : 0,
      count: buckets[range].count,
    }));
  }

  private calculateWeatherConditionBias(
    contexts: any[],
    predictions: CostPrediction[],
    actuals: any[],
  ): any[] {
    const buckets: Record<string, { sum: number; count: number }> = {};

    contexts.forEach((ctx, i) => {
      const condition = ctx.weatherData?.condition?.main || "Unknown";
      const error = predictions[i].predictedTotalCost - actuals[i].actualCost;
      if (!buckets[condition]) buckets[condition] = { sum: 0, count: 0 };
      buckets[condition].sum += error;
      buckets[condition].count++;
    });

    return Object.keys(buckets).map((condition) => ({
      condition,
      bias: buckets[condition].count ? buckets[condition].sum / buckets[condition].count : 0,
      count: buckets[condition].count,
    }));
  }

  private calculateExperienceBiasDetailed(
    contexts: any[],
    predictions: CostPrediction[],
    actuals: any[],
  ): any[] {
    const buckets: Record<string, { sum: number; count: number }> = {};

    contexts.forEach((ctx, i) => {
      const level = ctx.operationalContext?.driverExperience || "Unknown";
      const error = predictions[i].predictedTotalCost - actuals[i].actualCost;
      if (!buckets[level]) buckets[level] = { sum: 0, count: 0 };
      buckets[level].sum += error;
      buckets[level].count++;
    });

    return Object.keys(buckets).map((level) => ({
      level,
      bias: buckets[level].count ? buckets[level].sum / buckets[level].count : 0,
      count: buckets[level].count,
    }));
  }

  private calculateTimeOfDayBiasDetailed(
    contexts: any[],
    predictions: CostPrediction[],
    actuals: any[],
  ): any[] {
    const buckets: Record<string, { sum: number; count: number }> = {};

    contexts.forEach((ctx, i) => {
      const time = ctx.operationalContext?.timeOfDay || "Unknown";
      const error = predictions[i].predictedTotalCost - actuals[i].actualCost;
      if (!buckets[time]) buckets[time] = { sum: 0, count: 0 };
      buckets[time].sum += error;
      buckets[time].count++;
    });

    return Object.keys(buckets).map((time) => ({
      time,
      bias: buckets[time].count ? buckets[time].sum / buckets[time].count : 0,
      count: buckets[time].count,
    }));
  }

  private calculateTemporalBias(
    contexts: any[],
    metadata: any[],
    errors: number[],
  ): any[] {
    const buckets: Record<string, { sum: number; count: number }> = {};

    metadata.forEach((meta, i) => {
      const date = meta.timestamp ? new Date(meta.timestamp).toISOString().split('T')[0] : "Unknown";
      const error = errors[i];
      if (!buckets[date]) buckets[date] = { sum: 0, count: 0 };
      buckets[date].sum += error;
      buckets[date].count++;
    });

    return Object.keys(buckets).map((date) => ({
      date,
      bias: buckets[date].count ? buckets[date].sum / buckets[date].count : 0,
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  private calculateMagnitudeBias(
    predictions: CostPrediction[],
    errors: number[],
  ): any[] {
    const buckets: Record<string, { sum: number; count: number }> = {
      "Low (<$100)": { sum: 0, count: 0 },
      "Medium ($100-500)": { sum: 0, count: 0 },
      "High ($500-1000)": { sum: 0, count: 0 },
      "Very High (>$1000)": { sum: 0, count: 0 },
    };

    predictions.forEach((pred, i) => {
      const cost = pred.predictedTotalCost;
      let range = "Very High (>$1000)";
      if (cost < 100) range = "Low (<$100)";
      else if (cost < 500) range = "Medium ($100-500)";
      else if (cost < 1000) range = "High ($500-1000)";

      buckets[range].sum += errors[i];
      buckets[range].count++;
    });

    return Object.keys(buckets).map((range) => ({
      range,
      bias: buckets[range].count ? buckets[range].sum / buckets[range].count : 0,
    }));
  }

  private analyzeConfidenceCalibration(
    predictions: CostPrediction[],
    actuals: any[],
  ): any {
    const bins = CostModelValidator.CONFIDENCE_BINS;
    const binStats = bins.map(bin => {
      const [min, max] = bin.split("-").map(parseFloat);
      return { bin, min, max, correct: 0, total: 0 };
    });

    predictions.forEach((pred, i) => {
      const conf = pred.confidenceScore;
      const binIdx = binStats.findIndex(b => conf >= b.min && conf <= b.max);
      if (binIdx === -1) return;

      binStats[binIdx].total++;
      const errorPercent = Math.abs((pred.predictedTotalCost - actuals[i].actualCost) / actuals[i].actualCost);
      if (errorPercent <= 0.1) {
        binStats[binIdx].correct++;
      }
    });

    const reliabilityDiagram = binStats
      .filter(b => b.total > 0)
      .map(b => ({
        bin: b.bin,
        predicted: (b.min + b.max) / 2,
        actual: b.correct / b.total
      }));
    
    // Calibration score (Mean Absolute Error of reliability diagram)
    let calibrationError = 0;
    if (reliabilityDiagram.length > 0) {
        calibrationError = reliabilityDiagram.reduce((sum, item) => sum + Math.abs(item.predicted - item.actual), 0) / reliabilityDiagram.length;
    }
    const calibration = 1 - calibrationError;

    return {
      average: predictions.length ? predictions.reduce((sum, p) => sum + p.confidenceScore, 0) / predictions.length : 0,
      calibration,
      reliabilityDiagram,
    };
  }

  private calculatePredictionVariance(predictions: CostPrediction[]): number {
    if (predictions.length === 0) return 0;
    const mean = predictions.reduce((sum, p) => sum + p.predictedTotalCost, 0) / predictions.length;
    const variance = predictions.reduce((sum, p) => sum + Math.pow(p.predictedTotalCost - mean, 2), 0) / predictions.length;
    return variance;
  }

  private calculateStability(predictions: CostPrediction[]): number {
    const variance = this.calculatePredictionVariance(predictions);
    const mean = predictions.reduce((sum, p) => sum + p.predictedTotalCost, 0) / (predictions.length || 1);
    const cv = mean ? Math.sqrt(variance) / mean : 0;
    return Math.max(0, 1 - cv);
  }

  private calculateRepeatability(predictions: CostPrediction[]): number {
    return 1.0; // Placeholder
  }

  private calculateNoiseSensitivity(predictions: CostPrediction[]): number {
    return 0.1; // Placeholder
  }

  private calculateOutlierResistance(
    predictions: CostPrediction[],
    actuals: any[],
  ): number {
    if (predictions.length < 5) return 1;
    const errors = predictions.map((p, i) => Math.abs(p.predictedTotalCost - actuals[i].actualCost));
    const sortedErrors = [...errors].sort((a, b) => a - b);
    const q1 = sortedErrors[Math.floor(errors.length * 0.25)];
    const q3 = sortedErrors[Math.floor(errors.length * 0.75)];
    const iqr = q3 - q1;
    const upperFence = q3 + 1.5 * iqr;
    const normalErrors = errors.filter(e => e <= upperFence);
    const maeNormal = normalErrors.reduce((a, b) => a + b, 0) / (normalErrors.length || 1);
    const maeAll = errors.reduce((a, b) => a + b, 0) / errors.length;
    if (maeAll === 0) return 1;
    return Math.max(0, maeNormal / maeAll);
  }

  private calculateExtrapolationReliability(
    predictions: CostPrediction[],
  ): number {
    return 0.8; // Placeholder
  }
}

/**
 * Cost model performance monitor
 */
export class CostModelPerformanceMonitor {
  private validationHistory: ValidationResult[] = [];
  private performanceTrends: Array<{
    date: string;
    accuracy: number;
    bias: number;
    reliability: number;
  }> = [];

  /**
   * Record validation result and track performance trends
   */
  recordValidation(result: ValidationResult): void {
    this.validationHistory.push(result);

    // Keep only recent history (last 50 validations)
    if (this.validationHistory.length > 50) {
      this.validationHistory = this.validationHistory.slice(-50);
    }

    // Update performance trends
    this.performanceTrends.push({
      date: result.timestamp,
      accuracy: 100 - result.accuracyMetrics.meanAbsolutePercentageError.cost,
      bias: Math.abs(result.biasAnalysis.systematicBias.averageBias),
      reliability:
        result.reliabilityMetrics.predictionConfidence.calibration * 100,
    });

    // Keep only recent trends (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    this.performanceTrends = this.performanceTrends.filter(
      (trend) => new Date(trend.date) >= thirtyDaysAgo,
    );
  }

  /**
   * Get performance dashboard data
   */
  getPerformanceDashboard(): {
    currentPerformance: ValidationResult | null;
    accuracyTrend: Array<{ date: string; accuracy: number }>;
    biasTrend: Array<{ date: string; bias: number }>;
    reliabilityTrend: Array<{ date: string; reliability: number }>;
    alerts: string[];
    recommendations: string[];
  } {
    const currentPerformance =
      this.validationHistory.length > 0
        ? this.validationHistory[this.validationHistory.length - 1]
        : null;

    const accuracyTrend = this.performanceTrends.map((t) => ({
      date: t.date,
      accuracy: t.accuracy,
    }));

    const biasTrend = this.performanceTrends.map((t) => ({
      date: t.date,
      bias: t.bias,
    }));

    const reliabilityTrend = this.performanceTrends.map((t) => ({
      date: t.date,
      reliability: t.reliability,
    }));

    const alerts = this.generateAlerts();
    const recommendations = this.generatePerformanceRecommendations();

    return {
      currentPerformance,
      accuracyTrend,
      biasTrend,
      reliabilityTrend,
      alerts,
      recommendations,
    };
  }

  /**
   * Generate performance alerts
   */
  private generateAlerts(): string[] {
    const alerts: string[] = [];

    if (this.validationHistory.length === 0) return alerts;

    const latest = this.validationHistory[this.validationHistory.length - 1];

    // Accuracy alert
    if (latest.accuracyMetrics.meanAbsolutePercentageError.cost > 35) {
      alerts.push("🚨 High cost prediction error detected");
    }

    // Bias alert
    if (Math.abs(latest.biasAnalysis.systematicBias.averageBias) > 75) {
      alerts.push("⚠️ Significant systematic bias detected");
    }

    // Reliability alert
    if (latest.reliabilityMetrics.predictionConfidence.calibration < 0.6) {
      alerts.push("❗ Poor confidence calibration detected");
    }

    // Trend alerts
    if (this.performanceTrends.length >= 5) {
      const recentAccuracy = this.performanceTrends
        .slice(-5)
        .map((t) => t.accuracy);
      const accuracyTrend =
        recentAccuracy[recentAccuracy.length - 1] - recentAccuracy[0];

      if (accuracyTrend < -10) {
        alerts.push("📉 Accuracy declining over recent validations");
      }
    }

    return alerts;
  }

  /**
   * Generate performance recommendations
   */
  private generatePerformanceRecommendations(): string[] {
    const recommendations: string[] = [];

    if (this.validationHistory.length < 5) {
      recommendations.push("Collect more validation data for trend analysis");
      return recommendations;
    }

    // Analyze trends
    const recentValidations = this.validationHistory.slice(-5);
    const avgAccuracy =
      recentValidations.reduce(
        (sum, v) =>
          sum + (100 - v.accuracyMetrics.meanAbsolutePercentageError.cost),
        0,
      ) / recentValidations.length;

    const avgBias =
      recentValidations.reduce(
        (sum, v) => sum + Math.abs(v.biasAnalysis.systematicBias.averageBias),
        0,
      ) / recentValidations.length;

    if (avgAccuracy < 70) {
      recommendations.push("Model accuracy below target - consider retraining");
    }

    if (avgBias > 50) {
      recommendations.push("Consistent bias detected - apply bias correction");
    }

    recommendations.push(
      "Schedule regular model retraining to maintain performance",
    );
    recommendations.push("Monitor for seasonal performance variations");

    return recommendations;
  }
}

// Export singleton instances
export const costModelValidator = new CostModelValidator();
export const costModelPerformanceMonitor = new CostModelPerformanceMonitor();
