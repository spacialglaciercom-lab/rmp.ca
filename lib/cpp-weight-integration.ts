/**
 * CPP Weight Integration System
 * Feeds corrected cost weights back into the Chinese Postman Problem solver
 */

import { getMongoClient } from "@/server/mongodb";
import { costCorrectionModel } from "@/lib/cost-correction-model";
import { costPredictionService } from "@/services/costPredictionService";
import { incrementalModelTrainer } from "@/lib/incremental-model-trainer";
import { ObjectId } from "mongodb";
import * as fs from "fs/promises";
import * as path from "path";

export interface CPPWeightData {
  wayId: string;
  originalWeight: number;
  correctedWeight: number;
  correctionFactor: number;
  confidence: number;
  features: {
    distance: number;
    turnComplexity: number;
    weatherSeverity: number;
    driverExperience: number;
    timeOfDay: number;
    urbanDensity: number;
  };
  metadata: {
    modelVersion: string;
    calculationDate: Date;
    dataSource: 'prediction' | 'historical' | 'ml_enhanced';
    validationScore: number;
  };
}

export interface WeightIntegrationConfig {
  minConfidence: number;
  maxCorrectionFactor: number;
  weightUpdateInterval: number; // hours
  validationThreshold: number;
  fallbackToOriginal: boolean;
  mlEnhancementEnabled: boolean;
}

export interface CPPWeightUpdate {
  updateId: string;
  timestamp: Date;
  weights: CPPWeightData[];
  summary: {
    totalWays: number;
    updatedWays: number;
    averageCorrection: number;
    confidenceScore: number;
    modelVersion: string;
  };
  validation: {
    passed: boolean;
    tests: Array<{
      name: string;
      passed: boolean;
      message: string;
    }>;
  };
}

export interface WeightFeedbackResult {
  success: boolean;
  updateId?: string;
  weightsApplied: number;
  performanceImprovement?: number;
  errors?: string[];
  recommendations?: string[];
}

/**
 * CPP Weight Integration System
 * Manages the integration of cost-corrected weights into the CPP solver
 */
export class CPPWeightIntegrationSystem {
  private config: WeightIntegrationConfig;
  private currentWeights: Map<string, CPPWeightData> = new Map();
  private weightHistory: CPPWeightUpdate[] = [];

  constructor(config: WeightIntegrationConfig) {
    this.config = config;
  }

  /**
   * Calculate corrected weights for CPP edges based on cost model predictions
   */
  async calculateCorrectedWeights(
    ways: Array<{
      id: string;
      length: number;
      nodes: string[];
      tags?: Record<string, string>;
    }>,
    weatherData?: any,
    operationalContext?: any
  ): Promise<CPPWeightData[]> {
    console.log(`🧮 Calculating corrected weights for ${ways.length} ways...`);
    
    const correctedWeights: CPPWeightData[] = [];
    let processedCount = 0;

    try {
      // Batch process ways for efficiency
      const batchSize = 50;
      
      for (let i = 0; i < ways.length; i += batchSize) {
        const batch = ways.slice(i, i + batchSize);
        const batchWeights = await this.processWeightBatch(batch, weatherData, operationalContext);
        correctedWeights.push(...batchWeights);
        
        processedCount += batch.length;
        console.log(`   Processed ${processedCount}/${ways.length} ways`);
      }

      console.log(`✅ Calculated ${correctedWeights.length} corrected weights`);
      return correctedWeights;

    } catch (error) {
      console.error("❌ Error calculating corrected weights:", error);
      
      // Fallback to original weights if enabled
      if (this.config.fallbackToOriginal) {
        console.log("⚠️  Falling back to original weights");
        return this.createFallbackWeights(ways);
      }
      
      throw error;
    }
  }

  /**
   * Process a batch of ways for weight calculation
   */
  private async processWeightBatch(
    ways: Array<any>,
    weatherData?: any,
    operationalContext?: any
  ): Promise<CPPWeightData[]> {
    const batchWeights: CPPWeightData[] = [];

    // Get predictions for the batch
    const routeStatsBatch = ways.map(way => this.convertWayToRouteStats(way));
    
    const predictions = await Promise.all(
      routeStatsBatch.map(stats => 
        costPredictionService.getCostAwareRecommendations({
          routeStats: stats,
          weatherData,
          operationalContext
        })
      )
    );

    // Calculate ML-enhanced penalties if enabled
    let mlPenalties: Map<string, number> = new Map();
    if (this.config.mlEnhancementEnabled) {
      mlPenalties = await this.getMLEnhancedPenalties(ways, weatherData);
    }

    // Process each way
    for (let i = 0; i < ways.length; i++) {
      const way = ways[i];
      const prediction = predictions[i];
      const mlPenalty = mlPenalties.get(way.id) || 0;
      
      const weightData = await this.calculateSingleWeight(
        way,
        prediction,
        mlPenalty,
        weatherData,
        operationalContext
      );
      
      if (weightData) {
        batchWeights.push(weightData);
      }
    }

    return batchWeights;
  }

  /**
   * Calculate corrected weight for a single way
   */
  private async calculateSingleWeight(
    way: any,
    costRecommendation: any,
    mlPenalty: number,
    weatherData?: any,
    operationalContext?: any
  ): Promise<CPPWeightData | null> {
    try {
      const originalWeight = way.length; // Base weight is physical length
      
      // Extract features
      const features = this.extractWayFeatures(way, weatherData, operationalContext);
      
      // Calculate cost-based correction
      let costCorrectionFactor = 1.0;
      let confidence = 0.5;
      
      if (costRecommendation && costRecommendation.predictedCosts) {
        const predictedCost = costRecommendation.predictedCosts.predictedTotalCost;
        const baselineCost = this.calculateBaselineCost(way.length, way.tags);
        
        costCorrectionFactor = predictedCost / baselineCost;
        confidence = costRecommendation.predictedCosts.confidenceScore;
      }
      
      // Apply ML penalty
      const mlCorrectionFactor = 1.0 + mlPenalty;
      
      // Combine corrections
      let correctedWeight = originalWeight * costCorrectionFactor * mlCorrectionFactor;
      
      // Apply confidence-based weighting
      if (confidence < this.config.minConfidence) {
        // Blend with original weight based on confidence
        const confidenceFactor = confidence / this.config.minConfidence;
        correctedWeight = originalWeight * (1 - confidenceFactor) + correctedWeight * confidenceFactor;
      }
      
      // Apply maximum correction limit
      const maxCorrection = this.config.maxCorrectionFactor;
      if (correctedWeight / originalWeight > maxCorrection) {
        correctedWeight = originalWeight * maxCorrection;
      }
      
      // Get model version for tracking
      const modelVersion = await this.getCurrentModelVersion();
      
      return {
        wayId: way.id,
        originalWeight,
        correctedWeight,
        correctionFactor: correctedWeight / originalWeight,
        confidence,
        features,
        metadata: {
          modelVersion,
          calculationDate: new Date(),
          dataSource: mlPenalty > 0 ? 'ml_enhanced' : 'prediction',
          validationScore: this.calculateValidationScore(correctedWeight, originalWeight, confidence)
        }
      };

    } catch (error) {
      console.error(`Error calculating weight for way ${way.id}:`, error);
      
      // Return fallback weight if validation fails
      if (this.config.fallbackToOriginal) {
        return this.createFallbackWeight(way);
      }
      
      return null;
    }
  }

  /**
   * Get ML-enhanced penalties from route optimization
   */
  private async getMLEnhancedPenalties(ways: any[], weatherData?: any): Promise<Map<string, number>> {
    try {
      // This would integrate with the existing ML enhancement system
      // For now, return simulated penalties
      const penalties = new Map<string, number>();
      
      for (const way of ways) {
        // Simulate ML penalty based on way characteristics
        const penalty = this.simulateMLPenalty(way, weatherData);
        penalties.set(way.id, penalty);
      }
      
      return penalties;
    } catch (error) {
      console.warn("⚠️  ML enhancement failed, using prediction-based weights only:", error);
      return new Map<string, number>();
    }
  }

  /**
   * Simulate ML penalty (placeholder for actual ML integration)
   */
  private simulateMLPenalty(way: any, weatherData?: any): number {
    // Simulate penalty based on way characteristics
    let penalty = 0;
    
    // Road type penalty
    if (way.tags?.highway === 'residential') penalty += 0.1;
    if (way.tags?.highway === 'service') penalty += 0.15;
    if (way.tags?.highway === 'primary') penalty -= 0.05;
    
    // Width penalty
    if (way.tags?.width && parseFloat(way.tags.width) < 3) penalty += 0.1;
    
    // Surface penalty
    if (way.tags?.surface === 'gravel') penalty += 0.2;
    if (way.tags?.surface === 'unpaved') penalty += 0.25;
    
    // Weather penalty
    if (weatherData?.rain1h > 5) penalty += 0.1;
    if (weatherData?.windSpeed > 10) penalty += 0.05;
    
    return Math.min(0.5, penalty); // Max 50% penalty
  }

  /**
   * Extract features from way data
   */
  private extractWayFeatures(way: any, weatherData?: any, operationalContext?: any): CPPWeightData['features'] {
    return {
      distance: way.length,
      turnComplexity: this.calculateTurnComplexity(way),
      weatherSeverity: this.calculateWeatherSeverity(weatherData),
      driverExperience: operationalContext?.driverExperience || 'intermediate',
      timeOfDay: operationalContext?.timeOfDay || 'morning',
      urbanDensity: this.calculateUrbanDensity(way)
    };
  }

  /**
   * Calculate turn complexity for a way
   */
  private calculateTurnComplexity(way: any): number {
    // Estimate based on way geometry and tags
    let complexity = 0.5; // Base complexity
    
    // Road type influence
    if (way.tags?.highway === 'residential') complexity += 0.2;
    if (way.tags?.junction === 'roundabout') complexity += 0.3;
    
    // One-way influence
    if (way.tags?.oneway === 'yes') complexity += 0.1;
    
    return Math.min(1.0, complexity);
  }

  /**
   * Calculate weather severity
   */
  private calculateWeatherSeverity(weatherData?: any): number {
    if (!weatherData) return 0;
    
    let severity = 0;
    
    if (weatherData.rain1h > 5) severity += 0.3;
    if (weatherData.windSpeed > 10) severity += 0.2;
    if (weatherData.visibility < 1000) severity += 0.3;
    
    return Math.min(1.0, severity);
  }

  /**
   * Calculate urban density
   */
  private calculateUrbanDensity(way: any): 'low' | 'medium' | 'high' {
    // Simple heuristic based on road type and width
    if (way.tags?.highway === 'motorway' || way.tags?.highway === 'trunk') return 'low';
    if (way.tags?.highway === 'residential' && way.tags?.width && parseFloat(way.tags.width) < 4) return 'high';
    return 'medium';
  }

  /**
   * Calculate baseline cost for comparison
   */
  private calculateBaselineCost(distance: number, tags?: Record<string, string>): number {
    // Simple baseline: distance-based cost with road type modifier
    let baseCost = distance * 2.0; // $2 per km baseline
    
    // Road type modifiers
    if (tags?.highway === 'motorway') baseCost *= 0.8;
    if (tags?.highway === 'residential') baseCost *= 1.2;
    if (tags?.highway === 'service') baseCost *= 1.5;
    
    return baseCost;
  }

  /**
   * Convert way data to route statistics for cost prediction
   */
  private convertWayToRouteStats(way: any): any {
    // Estimate route statistics from way data
    const estimatedStops = Math.max(1, Math.floor(way.length * 0.5)); // 0.5 stops per km
    const estimatedTime = way.length * 6; // 6 minutes per km baseline
    
    return {
      totalDistance: way.length,
      estimatedTime,
      totalTraversals: way.nodes.length - 1,
      turns: {
        rightTurns: Math.floor(estimatedStops * 0.6),
        leftTurns: Math.floor(estimatedStops * 0.3),
        uTurns: Math.floor(estimatedStops * 0.1),
        straightAhead: estimatedStops
      },
      segmentsRouted: way.nodes.length - 1,
      segmentsExcluded: 0
    };
  }

  /**
   * Calculate validation score for weight
   */
  private calculateValidationScore(correctedWeight: number, originalWeight: number, confidence: number): number {
    const correctionRatio = correctedWeight / originalWeight;
    const ratioScore = correctionRatio > 0.5 && correctionRatio < 3.0 ? 1.0 : 0.5;
    
    return (ratioScore + confidence) / 2;
  }

  /**
   * Create fallback weight when prediction fails
   */
  private createFallbackWeight(way: any): CPPWeightData {
    return {
      wayId: way.id,
      originalWeight: way.length,
      correctedWeight: way.length,
      correctionFactor: 1.0,
      confidence: 0.0,
      features: this.extractWayFeatures(way),
      metadata: {
        modelVersion: 'fallback',
        calculationDate: new Date(),
        dataSource: 'original',
        validationScore: 0.0
      }
    };
  }

  /**
   * Get current model version
   */
  private async getCurrentModelVersion(): Promise<string> {
    try {
      const model = await incrementalModelTrainer.loadCurrentModel();
      return model?.version || 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Apply corrected weights to CPP solver
   */
  async applyWeightsToCPP(cppOptimizer: any, correctedWeights: CPPWeightData[]): Promise<boolean> {
    console.log(`🎯 Applying ${correctedWeights.length} corrected weights to CPP solver...`);
    
    try {
      const weightMap = new Map(correctedWeights.map(w => [w.wayId, w.correctedWeight]));
      const confidenceMap = new Map(correctedWeights.map(w => [w.wayId, w.confidence]));
      
      // Apply weights to CPP optimizer
      await cppOptimizer.updateEdgeWeights(weightMap, confidenceMap);
      
      console.log("✅ Weights successfully applied to CPP solver");
      return true;
      
    } catch (error) {
      console.error("❌ Failed to apply weights to CPP solver:", error);
      return false;
    }
  }

  /**
   * Validate weight integration
   */
  async validateWeightIntegration(weights: CPPWeightData[]): Promise<{
    passed: boolean;
    tests: Array<{ name: string; passed: boolean; message: string }>;
  }> {
    const tests = [
      {
        name: 'Weight Range Validation',
        test: () => this.validateWeightRanges(weights)
      },
      {
        name: 'Confidence Threshold Validation',
        test: () => this.validateConfidenceThresholds(weights)
      },
      {
        name: 'Data Completeness Validation',
        test: () => this.validateDataCompleteness(weights)
      },
      {
        name: 'Model Version Consistency',
        test: () => this.validateModelVersionConsistency(weights)
      }
    ];

    const results = tests.map(({ name, test }) => {
      try {
        const passed = test();
        return {
          name,
          passed,
          message: passed ? `${name} passed` : `${name} failed`
        };
      } catch (error) {
        return {
          name,
          passed: false,
          message: `${name} error: ${String(error)}`
        };
      }
    });

    const passed = results.every(r => r.passed);
    
    return {
      passed,
      tests: results
    };
  }

  /**
   * Validate weight ranges
   */
  private validateWeightRanges(weights: CPPWeightData[]): boolean {
    return weights.every(w => {
      const ratio = w.correctedWeight / w.originalWeight;
      return ratio >= 0.1 && ratio <= 5.0; // Reasonable range
    });
  }

  /**
   * Validate confidence thresholds
   */
  private validateConfidenceThresholds(weights: CPPWeightData[]): boolean {
    return weights.every(w => w.confidence >= 0 && w.confidence <= 1);
  }

  /**
   * Validate data completeness
   */
  private validateDataCompleteness(weights: CPPWeightData[]): boolean {
    return weights.every(w => 
      w.wayId && 
      w.originalWeight > 0 && 
      w.correctedWeight > 0 && 
      w.features && 
      w.metadata
    );
  }

  /**
   * Validate model version consistency
   */
  private validateModelVersionConsistency(weights: CPPWeightData[]): boolean {
    const versions = new Set(weights.map(w => w.metadata.modelVersion));
    return versions.size <= 2; // Allow current and fallback versions
  }

  /**
   * Store weight update in history
   */
  async storeWeightUpdate(update: CPPWeightUpdate): Promise<void> {
    this.weightHistory.push(update);
    
    // Keep only recent history (last 100 updates)
    if (this.weightHistory.length > 100) {
      this.weightHistory = this.weightHistory.slice(-100);
    }

    // Store in database
    const client = getMongoClient();
    if (!client) return;

    try {
      const db = client.db("trashroute");
      const collection = db.collection("cpp_weight_updates");
      
      await collection.insertOne({
        ...update,
        _id: new ObjectId()
      });
      
      console.log(`Weight update stored: ${update.updateId}`);
    } catch (error) {
      console.error("Error storing weight update:", error);
    }
  }

  /**
   * Get weight update history
   */
  async getWeightHistory(limit: number = 50): Promise<CPPWeightUpdate[]> {
    const client = getMongoClient();
    if (!client) return this.weightHistory.slice(-limit);

    try {
      const db = client.db("trashroute");
      const collection = db.collection("cpp_weight_updates");
      
      const history = await collection
        .find({})
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
      
      return history.map(h => ({
        updateId: h.updateId,
        timestamp: h.timestamp,
        weights: h.weights,
        summary: h.summary,
        validation: h.validation
      }));
    } catch (error) {
      console.error("Error getting weight history:", error);
      return this.weightHistory.slice(-limit);
    }
  }

  /**
   * Get current weight statistics
   */
  getWeightStats(): {
    totalWeights: number;
    averageCorrection: number;
    averageConfidence: number;
    byDataSource: Record<string, number>;
  } {
    if (this.currentWeights.size === 0) {
      return {
        totalWeights: 0,
        averageCorrection: 0,
        averageConfidence: 0,
        byDataSource: {}
      };
    }

    const weights = Array.from(this.currentWeights.values());
    
    const totalWeights = weights.length;
    const averageCorrection = weights.reduce((sum, w) => sum + w.correctionFactor, 0) / totalWeights;
    const averageConfidence = weights.reduce((sum, w) => sum + w.confidence, 0) / totalWeights;
    
    const byDataSource: Record<string, number> = {};
    weights.forEach(w => {
      byDataSource[w.metadata.dataSource] = (byDataSource[w.metadata.dataSource] || 0) + 1;
    });

    return {
      totalWeights,
      averageCorrection,
      averageConfidence,
      byDataSource
    };
  }
}

/**
 * Nightly weight synchronization system
 */
export class NightlyWeightSync {
  private weightIntegration: CPPWeightIntegrationSystem;
  private lastSyncDate: Date | null = null;
  private syncInterval: number;

  constructor(
    weightIntegration: CPPWeightIntegrationSystem,
    syncInterval: number = 24 // hours
  ) {
    this.weightIntegration = weightIntegration;
    this.syncInterval = syncInterval;
  }

  /**
   * Perform nightly weight synchronization
   */
  async performNightlySync(cppOptimizer: any): Promise<WeightFeedbackResult> {
    console.log("🌙 Starting nightly weight synchronization...");
    const startTime = Date.now();
    
    try {
      // Step 1: Check if sync is needed
      const shouldSync = await this.shouldSync();
      if (!shouldSync.needed) {
        return {
          success: true,
          weightsApplied: 0,
          recommendations: [shouldSync.reason]
        };
      }

      // Step 2: Get recent cost model updates
      console.log("📊 Getting recent cost model updates...");
      const recentUpdates = await this.getRecentUpdates();
      
      if (recentUpdates.length === 0) {
        return {
          success: true,
          weightsApplied: 0,
          recommendations: ["No new cost model updates available"]
        };
      }

      // Step 3: Calculate corrected weights
      console.log("🧮 Calculating corrected weights...");
      const ways = await this.getWaysForOptimization();
      const correctedWeights = await this.weightIntegration.calculateCorrectedWeights(ways);

      // Step 4: Validate weights
      console.log("🔍 Validating corrected weights...");
      const validation = await this.weightIntegration.validateWeightIntegration(correctedWeights);
      
      if (!validation.passed) {
        console.warn("⚠️  Weight validation failed:", validation.tests.filter(t => !t.passed));
        
        if (validation.tests.some(t => t.name.includes('critical') && !t.passed)) {
          return {
            success: false,
            weightsApplied: 0,
            errors: ["Critical validation failures detected"],
            recommendations: ["Review weight calculation process", "Check data quality"]
          };
        }
      }

      // Step 5: Apply weights to CPP
      console.log("🎯 Applying weights to CPP solver...");
      const applySuccess = await this.weightIntegration.applyWeightsToCPP(cppOptimizer, correctedWeights);
      
      if (!applySuccess) {
        return {
          success: false,
          weightsApplied: 0,
          errors: ["Failed to apply weights to CPP solver"],
          recommendations: ["Check CPP solver integration", "Verify weight format"]
        };
      }

      // Step 6: Store weight update
      const updateResult: CPPWeightUpdate = {
        updateId: `weight_sync_${Date.now()}`,
        timestamp: new Date(),
        weights: correctedWeights,
        summary: {
          totalWays: ways.length,
          updatedWays: correctedWeights.length,
          averageCorrection: this.calculateAverageCorrection(correctedWeights),
          confidenceScore: this.calculateAverageConfidence(correctedWeights),
          modelVersion: await this.weightIntegration.getCurrentModelVersion()
        },
        validation: validation
      };

      await this.weightIntegration.storeWeightUpdate(updateResult);

      // Step 7: Calculate performance improvement
      const improvement = await this.calculatePerformanceImprovement(correctedWeights);

      const duration = (Date.now() - startTime) / 1000;
      this.lastSyncDate = new Date();

      console.log(`✅ Nightly weight sync completed in ${duration.toFixed(2)}s`);
      console.log(`   Applied ${correctedWeights.length} corrected weights`);
      console.log(`   Average correction: ${(updateResult.summary.averageCorrection * 100).toFixed(1)}%`);

      return {
        success: true,
        updateId: updateResult.updateId,
        weightsApplied: correctedWeights.length,
        performanceImprovement: improvement,
        recommendations: [
          "Monitor CPP performance with new weights",
          "Continue collecting route performance data",
          "Review weight validation results"
        ]
      };

    } catch (error) {
      console.error("❌ Nightly weight sync failed:", error);
      
      return {
        success: false,
        weightsApplied: 0,
        errors: [String(error)],
        recommendations: [
          "Check system logs for detailed error information",
          "Verify cost model and CPP integration",
          "Consider manual intervention if needed"
        ]
      };
    }
  }

  /**
   * Check if weight synchronization is needed
   */
  private async shouldSync(): Promise<{ needed: boolean; reason: string }> {
    // Check if enough time has passed since last sync
    if (this.lastSyncDate) {
      const hoursSinceLastSync = (Date.now() - this.lastSyncDate.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastSync < this.syncInterval) {
        return {
          needed: false,
          reason: `Last sync was ${hoursSinceLastSync.toFixed(1)} hours ago (interval: ${this.syncInterval}h)`
        };
      }
    }

    // Check for new cost model data
    const recentUpdates = await this.getRecentUpdates();
    if (recentUpdates.length === 0) {
      return {
        needed: false,
        reason: "No new cost model updates available"
      };
    }

    // Check model performance improvement
    const recentImprovement = await this.getRecentImprovement();
    if (recentImprovement < 0.01) { // Less than 1% improvement
      return {
        needed: false,
        reason: "Recent model updates show minimal improvement (< 1%)"
      };
    }

    return {
      needed: true,
      reason: `Sufficient new data and model improvements detected (${recentUpdates.length} updates, ${(recentImprovement * 100).toFixed(2)}% improvement)`
    };
  }

  /**
   * Get recent cost model updates
   */
  private async getRecentUpdates(): Promise<any[]> {
    const since = new Date(Date.now() - this.syncInterval * 60 * 60 * 1000);
    
    const client = getMongoClient();
    if (!client) return [];

    try {
      const db = client.db("trashroute");
      const collection = db.collection("cost_history");
      
      return await collection
        .find({
          timestamp: { $gte: since },
          "costCorrections.accuracyScore": { $gte: 0.7 }
        })
        .sort({ timestamp: -1 })
        .limit(100)
        .toArray();
    } catch (error) {
      console.error("Error getting recent updates:", error);
      return [];
    }
  }

  /**
   * Get ways for optimization from CPP system
   */
  private async getWaysForOptimization(): Promise<any[]> {
    // This would integrate with the actual CPP system
    // For now, return simulated ways
    return Array.from({ length: 100 }, (_, i) => ({
      id: `way_${i}`,
      length: 0.5 + Math.random() * 2.0, // 0.5-2.5 km
      nodes: Array.from({ length: 10 }, (_, j) => `node_${i}_${j}`),
      tags: {
        highway: ['residential', 'tertiary', 'secondary'][Math.floor(Math.random() * 3)],
        width: (3 + Math.random() * 4).toString(), // 3-7m width
        surface: Math.random() > 0.8 ? 'gravel' : 'asphalt'
      }
    }));
  }

  /**
   * Calculate average correction factor
   */
  private calculateAverageCorrection(weights: CPPWeightData[]): number {
    if (weights.length === 0) return 0;
    
    const totalCorrection = weights.reduce((sum, w) => sum + w.correctionFactor, 0);
    return totalCorrection / weights.length;
  }

  /**
   * Calculate average confidence
   */
  private calculateAverageConfidence(weights: CPPWeightData[]): number {
    if (weights.length === 0) return 0;
    
    const totalConfidence = weights.reduce((sum, w) => sum + w.confidence, 0);
    return totalConfidence / weights.length;
  }

  /**
   * Calculate recent improvement from model updates
   */
  private async getRecentImprovement(): Promise<number> {
    const recentHistory = await this.weightIntegration.getWeightHistory(10);
    
    if (recentHistory.length < 2) return 0;
    
    const recent = recentHistory[0];
    const previous = recentHistory[1];
    
    if (!recent || !previous) return 0;
    
    return recent.summary.averageCorrection - previous.summary.averageCorrection;
  }

  /**
   * Calculate performance improvement from new weights
   */
  private async calculatePerformanceImprovement(weights: CPPWeightData[]): Promise<number> {
    // This would compare CPP performance before and after weight application
    // For now, return estimated improvement based on correction factors
    const avgCorrection = this.calculateAverageCorrection(weights);
    return Math.max(0, (1.0 - avgCorrection) * 0.5); // Estimated 50% of correction translates to performance improvement
  }

  /**
   * Schedule regular weight synchronization
   */
  scheduleRegularSync(): void {
    setInterval(async () => {
      console.log(`⏰ Scheduled weight sync triggered (interval: ${this.syncInterval}h)`);
      
      // This would need access to the CPP optimizer instance
      // For now, just log the intention
      console.log("Weight sync would be performed here with CPP optimizer");
      
    }, this.syncInterval * 60 * 60 * 1000);
    
    console.log(`⏰ Scheduled weight sync every ${this.syncInterval} hours`);
  }
}

// Default configuration
export const defaultWeightIntegrationConfig: WeightIntegrationConfig = {
  minConfidence: 0.6,
  maxCorrectionFactor: 3.0,
  weightUpdateInterval: 24, // hours
  validationThreshold: 0.7,
  fallbackToOriginal: true,
  mlEnhancementEnabled: true
};

// Export singleton instances
export const cppWeightIntegration = new CPPWeightIntegrationSystem(defaultWeightIntegrationConfig);
export const nightlyWeightSync = new NightlyWeightSync(
  cppWeightIntegration,
  24 // Sync every 24 hours
);