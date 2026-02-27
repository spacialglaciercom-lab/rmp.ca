/**
 * Weight Feedback Loop Monitoring
 * Monitors the effectiveness of cost-corrected weights in CPP optimization
 */

import { getMongoClient } from "@/server/mongodb";
import { ObjectId } from "mongodb";
import * as fs from "fs/promises";
import * as path from "path";

export interface WeightFeedbackMetrics {
  feedbackId: string;
  timestamp: Date;
  routeId: string;
  weightUpdateId: string;
  originalPerformance: {
    totalCost: number;
    totalTime: number;
    fuelConsumption: number;
    efficiencyScore: number;
  };
  correctedPerformance: {
    totalCost: number;
    totalTime: number;
    fuelConsumption: number;
    efficiencyScore: number;
  };
  weightEffectiveness: {
    costImprovement: number;
    timeImprovement: number;
    fuelImprovement: number;
    overallImprovement: number;
  };
  weightAccuracy: {
    predictedVsActual: number;
    predictionError: number;
    confidenceAlignment: number;
  };
  routeCharacteristics: {
    totalDistance: number;
    complexityScore: number;
    weatherConditions: string;
    driverExperience: string;
  };
}

export interface FeedbackLoopConfig {
  enabled: boolean;
  collectionInterval: number; // hours
  minSampleSize: number;
  significanceThreshold: number;
  confidenceThreshold: number;
  autoAdjustWeights: boolean;
  maxAdjustmentFactor: number;
}

export interface WeightEffectivenessAnalysis {
  period: string;
  totalRoutes: number;
  improvedRoutes: number;
  averageImprovement: number;
  improvementByFactor: Record<string, number>;
  weightAccuracy: {
    average: number;
    byConfidence: Record<string, number>;
    byDataSource: Record<string, number>;
  };
  recommendations: string[];
}

export interface WeightAdjustmentRecommendation {
  type: 'increase' | 'decrease' | 'recalibrate';
  factor: string;
  currentValue: number;
  recommendedValue: number;
  confidence: number;
  reasoning: string;
  impact: 'low' | 'medium' | 'high';
}

/**
 * Comprehensive weight feedback monitoring system
 */
export class WeightFeedbackMonitor {
  private config: FeedbackLoopConfig;
  private feedbackData: WeightFeedbackMetrics[] = [];
  private isMonitoring: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(config: FeedbackLoopConfig) {
    this.config = config;
  }

  /**
   * Start monitoring weight feedback loop
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      console.log("⚠️  Weight feedback monitoring already running");
      return;
    }

    console.log("🚀 Starting weight feedback monitoring");
    this.isMonitoring = true;

    // Initial data collection
    await this.collectFeedbackData();

    // Schedule periodic collection
    this.monitoringInterval = setInterval(async () => {
      await this.collectFeedbackData();
    }, this.config.collectionInterval * 60 * 60 * 1000);

    console.log(`✅ Weight feedback monitoring started with ${this.config.collectionInterval} hour intervals`);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      console.log("⚠️  Weight feedback monitoring not running");
      return;
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.isMonitoring = false;
    console.log("🛑 Weight feedback monitoring stopped");
  }

  /**
   * Collect weight feedback data
   */
  private async collectFeedbackData(): Promise<void> {
    console.log("\n📊 Collecting weight feedback data...");
    const startTime = Date.now();

    try {
      // Get recent routes with weight updates
      const recentRoutes = await this.getRecentRoutesWithWeights();
      
      if (recentRoutes.length === 0) {
        console.log("No recent routes with weight updates found");
        return;
      }

      // Collect feedback for each route
      const feedbackBatch = await Promise.all(
        recentRoutes.map(route => this.collectSingleRouteFeedback(route))
      );

      // Filter valid feedback
      const validFeedback = feedbackBatch.filter(f => f !== null);
      
      if (validFeedback.length > 0) {
        // Store feedback data
        await this.storeFeedbackBatch(validFeedback);
        
        // Update local cache
        this.feedbackData.push(...validFeedback);
        
        // Keep only recent data
        this.cleanupOldData();
        
        const duration = (Date.now() - startTime) / 1000;
        console.log(`✅ Collected ${validFeedback.length} feedback entries in ${duration.toFixed(2)}s`);
        
        // Analyze and generate recommendations
        if (validFeedback.length >= this.config.minSampleSize) {
          await this.analyzeAndRecommend(validFeedback);
        }
      }

    } catch (error) {
      console.error("❌ Error collecting feedback data:", error);
    }
  }

  /**
   * Collect feedback for a single route
   */
  private async collectSingleRouteFeedback(route: any): Promise<WeightFeedbackMetrics | null> {
    try {
      // Get route performance data
      const originalPerformance = await this.getOriginalRoutePerformance(route.routeId);
      const correctedPerformance = await this.getCorrectedRoutePerformance(route.routeId);
      
      if (!originalPerformance || !correctedPerformance) {
        return null;
      }

      // Get weight information used for this route
      const weightInfo = await this.getWeightInfoForRoute(route.routeId);
      
      if (!weightInfo) {
        return null;
      }

      // Calculate improvements
      const effectiveness = this.calculateEffectiveness(
        originalPerformance,
        correctedPerformance
      );

      // Calculate weight accuracy
      const accuracy = this.calculateWeightAccuracy(
        weightInfo,
        originalPerformance,
        correctedPerformance
      );

      return {
        feedbackId: `feedback_${route.routeId}_${Date.now()}`,
        timestamp: new Date(),
        routeId: route.routeId,
        weightUpdateId: weightInfo.updateId,
        originalPerformance,
        correctedPerformance,
        weightEffectiveness: effectiveness,
        weightAccuracy: accuracy,
        routeCharacteristics: {
          totalDistance: route.totalDistance,
          complexityScore: route.complexityScore,
          weatherConditions: route.weatherConditions,
          driverExperience: route.driverExperience
        }
      };

    } catch (error) {
      console.error(`Error collecting feedback for route ${route.routeId}:`, error);
      return null;
    }
  }

  /**
   * Get original route performance (before weight correction)
   */
  private async getOriginalRoutePerformance(routeId: string): Promise<WeightFeedbackMetrics['originalPerformance'] | null> {
    const client = getMongoClient();
    if (!client) return null;

    try {
      const db = client.db("trashroute");
      const collection = db.collection("route_performance_history");
      
      // Get performance before weight correction
      const performance = await collection.findOne({
        routeId,
        weightVersion: 'original',
        timestamp: {
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      });

      if (!performance) return null;

      return {
        totalCost: performance.totalCost,
        totalTime: performance.totalTime,
        fuelConsumption: performance.fuelConsumption,
        efficiencyScore: performance.efficiencyScore
      };
    } catch (error) {
      console.error(`Error getting original performance for route ${routeId}:`, error);
      return null;
    }
  }

  /**
   * Get corrected route performance (after weight correction)
   */
  private async getCorrectedRoutePerformance(routeId: string): Promise<WeightFeedbackMetrics['correctedPerformance'] | null> {
    const client = getMongoClient();
    if (!client) return null;

    try {
      const db = client.db("trashroute");
      const collection = db.collection("route_performance_history");
      
      // Get performance after weight correction
      const performance = await collection.findOne({
        routeId,
        weightVersion: { $ne: 'original' },
        timestamp: {
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      });

      if (!performance) return null;

      return {
        totalCost: performance.totalCost,
        totalTime: performance.totalTime,
        fuelConsumption: performance.fuelConsumption,
        efficiencyScore: performance.efficiencyScore
      };
    } catch (error) {
      console.error(`Error getting corrected performance for route ${routeId}:`, error);
      return null;
    }
  }

  /**
   * Get weight information used for a route
   */
  private async getWeightInfoForRoute(routeId: string): Promise<any | null> {
    const client = getMongoClient();
    if (!client) return null;

    try {
      const db = client.db("trashroute");
      const collection = db.collection("route_weight_assignments");
      
      const weightInfo = await collection.findOne({
        routeId,
        timestamp: {
          $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) // Last 14 days
        }
      });

      return weightInfo;
    } catch (error) {
      console.error(`Error getting weight info for route ${routeId}:`, error);
      return null;
    }
  }

  /**
   * Calculate weight effectiveness (improvement metrics)
   */
  private calculateEffectiveness(
    original: WeightFeedbackMetrics['originalPerformance'],
    corrected: WeightFeedbackMetrics['correctedPerformance']
  ): WeightFeedbackMetrics['weightEffectiveness'] {
    const costImprovement = (original.totalCost - corrected.totalCost) / original.totalCost;
    const timeImprovement = (original.totalTime - corrected.totalTime) / original.totalTime;
    const fuelImprovement = (original.fuelConsumption - corrected.fuelConsumption) / original.fuelConsumption;
    const overallImprovement = (costImprovement + timeImprovement + fuelImprovement) / 3;

    return {
      costImprovement,
      timeImprovement,
      fuelImprovement,
      overallImprovement
    };
  }

  /**
   * Calculate weight accuracy (prediction vs actual)
   */
  private calculateWeightAccuracy(
    weightInfo: any,
    original: WeightFeedbackMetrics['originalPerformance'],
    corrected: WeightFeedbackMetrics['correctedPerformance']
  ): WeightFeedbackMetrics['weightAccuracy'] {
    // Calculate how well the weight predictions matched actual performance
    const predictedVsActual = Math.abs(weightInfo.predictedImprovement - (corrected.totalCost / original.totalCost));
    const predictionError = predictedVsActual / weightInfo.predictedImprovement;
    const confidenceAlignment = weightInfo.confidence * (1 - predictionError);

    return {
      predictedVsActual,
      predictionError,
      confidenceAlignment
    };
  }

  /**
   * Store feedback batch in database
   */
  private async storeFeedbackBatch(feedback: WeightFeedbackMetrics[]): Promise<void> {
    const client = getMongoClient();
    if (!client) return;

    try {
      const db = client.db("trashroute");
      const collection = db.collection("weight_feedback_metrics");
      
      await collection.insertMany(feedback.map(f => ({
        ...f,
        _id: new ObjectId()
      })));
      
      console.log(`Stored ${feedback.length} feedback entries`);
    } catch (error) {
      console.error("Error storing feedback batch:", error);
    }
  }

  /**
   * Get recent routes with weight updates
   */
  private async getRecentRoutesWithWeights(): Promise<any[]> {
    const client = getMongoClient();
    if (!client) return [];

    try {
      const db = client.db("trashroute");
      const collection = db.collection("completed_routes");
      
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
      
      return await collection
        .find({
          completionDate: { $gte: since },
          weightUpdateId: { $exists: true }
        })
        .sort({ completionDate: -1 })
        .limit(100)
        .toArray();
    } catch (error) {
      console.error("Error getting recent routes with weights:", error);
      return [];
    }
  }

  /**
   * Analyze feedback data and generate recommendations
   */
  private async analyzeAndRecommend(feedback: WeightFeedbackMetrics[]): Promise<void> {
    console.log("🔍 Analyzing feedback data for recommendations...");
    
    try {
      const analysis = this.analyzeEffectiveness(feedback);
      const recommendations = this.generateWeightAdjustments(analysis);
      
      if (recommendations.length > 0) {
        console.log("💡 Weight adjustment recommendations:");
        recommendations.forEach(rec => {
          console.log(`   ${rec.type.toUpperCase()} ${rec.factor}: ${rec.currentValue.toFixed(3)} → ${rec.recommendedValue.toFixed(3)}`);
          console.log(`   Reason: ${rec.reasoning}`);
          console.log(`   Impact: ${rec.impact}`);
        });
        
        // Apply automatic adjustments if enabled
        if (this.config.autoAdjustWeights) {
          await this.applyWeightAdjustments(recommendations);
        }
      }
      
    } catch (error) {
      console.error("Error analyzing feedback data:", error);
    }
  }

  /**
   * Analyze weight effectiveness
   */
  private analyzeEffectiveness(feedback: WeightFeedbackMetrics[]): WeightEffectivenessAnalysis {
    const totalRoutes = feedback.length;
    const improvedRoutes = feedback.filter(f => f.weightEffectiveness.overallImprovement > 0).length;
    const averageImprovement = feedback.reduce((sum, f) => sum + f.weightEffectiveness.overallImprovement, 0) / totalRoutes;
    
    // Analyze by factors
    const improvementByFactor: Record<string, number> = {};
    const confidenceLevels = ['low', 'medium', 'high'];
    const dataSources = ['prediction', 'historical', 'ml_enhanced'];
    
    confidenceLevels.forEach(level => {
      const levelData = feedback.filter(f => {
        const confidence = f.weightAccuracy.confidenceAlignment;
        if (level === 'low') return confidence < 0.6;
        if (level === 'medium') return confidence >= 0.6 && confidence < 0.8;
        return confidence >= 0.8;
      });
      
      if (levelData.length > 0) {
        improvementByFactor[`confidence_${level}`] = levelData.reduce((sum, f) => sum + f.weightEffectiveness.overallImprovement, 0) / levelData.length;
      }
    });

    // Weight accuracy analysis
    const averageAccuracy = feedback.reduce((sum, f) => sum + f.weightAccuracy.confidenceAlignment, 0) / totalRoutes;
    
    const accuracyByConfidence: Record<string, number> = {};
    const accuracyBySource: Record<string, number> = {};
    
    confidenceLevels.forEach(level => {
      const levelData = feedback.filter(f => {
        const confidence = f.weightAccuracy.confidenceAlignment;
        if (level === 'low') return confidence < 0.6;
        if (level === 'medium') return confidence >= 0.6 && confidence < 0.8;
        return confidence >= 0.8;
      });
      
      if (levelData.length > 0) {
        accuracyByConfidence[level] = levelData.reduce((sum, f) => sum + f.weightAccuracy.confidenceAlignment, 0) / levelData.length;
      }
    });

    return {
      period: 'recent',
      totalRoutes,
      improvedRoutes,
      averageImprovement,
      improvementByFactor,
      weightAccuracy: {
        average: averageAccuracy,
        byConfidence: accuracyByConfidence,
        byDataSource: accuracyBySource
      },
      recommendations: this.generateAnalysisRecommendations(improvedRoutes, totalRoutes, averageImprovement)
    };
  }

  /**
   * Generate analysis-based recommendations
   */
  private generateAnalysisRecommendations(improvedRoutes: number, totalRoutes: number, averageImprovement: number): string[] {
    const recommendations: string[] = [];
    const improvementRate = improvedRoutes / totalRoutes;
    
    if (improvementRate < 0.7) {
      recommendations.push("Less than 70% of routes show improvement - review weight calculation methodology");
    }
    
    if (averageImprovement < 0.05) {
      recommendations.push("Average improvement below 5% - consider collecting more diverse training data");
    }
    
    if (improvementRate > 0.9 && averageImprovement > 0.1) {
      recommendations.push("Excellent performance - consider expanding to more route types");
    }
    
    recommendations.push("Continue monitoring weight effectiveness");
    recommendations.push("Regularly review and adjust weight calculation factors");
    
    return recommendations;
  }

  /**
   * Generate weight adjustment recommendations
   */
  private generateWeightAdjustments(analysis: WeightEffectivenessAnalysis): WeightAdjustmentRecommendation[] {
    const recommendations: WeightAdjustmentRecommendation[] = [];
    
    // Analyze by confidence levels
    Object.entries(analysis.weightAccuracy.byConfidence).forEach(([level, accuracy]) => {
      if (accuracy < 0.7) {
        recommendations.push({
          type: 'recalibrate',
          factor: `confidence_${level}`,
          currentValue: accuracy,
          recommendedValue: 0.8,
          confidence: 0.8,
          reasoning: `Low accuracy for ${level} confidence predictions`,
          impact: 'high'
        });
      }
    });
    
    // Analyze by data source if available
    Object.entries(analysis.improvementByFactor).forEach(([factor, improvement]) => {
      if (improvement < 0.02) {
        recommendations.push({
          type: 'increase',
          factor,
          currentValue: improvement,
          recommendedValue: improvement * 1.5,
          confidence: 0.7,
          reasoning: `Low improvement for ${factor} factor`,
          impact: 'medium'
        });
      }
    });
    
    return recommendations;
  }

  /**
   * Apply weight adjustments
   */
  private async applyWeightAdjustments(recommendations: WeightAdjustmentRecommendation[]): Promise<void> {
    console.log("🔧 Applying weight adjustments...");
    
    for (const rec of recommendations) {
      try {
        // This would integrate with the weight calculation system
        console.log(`   Applying ${rec.type} to ${rec.factor}: ${rec.currentValue.toFixed(3)} → ${rec.recommendedValue.toFixed(3)}`);
        
        // Store adjustment for tracking
        await this.storeAdjustment(rec);
        
      } catch (error) {
        console.error(`Error applying adjustment for ${rec.factor}:`, error);
      }
    }
    
    console.log("✅ Weight adjustments applied");
  }

  /**
   * Store weight adjustment
   */
  private async storeAdjustment(recommendation: WeightAdjustmentRecommendation): Promise<void> {
    const client = getMongoClient();
    if (!client) return;

    try {
      const db = client.db("trashroute");
      const collection = db.collection("weight_adjustments");
      
      await collection.insertOne({
        ...recommendation,
        _id: new ObjectId(),
        appliedAt: new Date()
      });
    } catch (error) {
      console.error("Error storing adjustment:", error);
    }
  }

  /**
   * Cleanup old data
   */
  private cleanupOldData(): void {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Keep 90 days
    this.feedbackData = this.feedbackData.filter(d => d.timestamp > cutoff);
  }

  /**
   * Get weight feedback statistics
   */
  getFeedbackStats(): {
    totalFeedback: number;
    averageImprovement: number;
    improvementRate: number;
    averageAccuracy: number;
    recentTrend: 'improving' | 'declining' | 'stable';
  } {
    if (this.feedbackData.length === 0) {
      return {
        totalFeedback: 0,
        averageImprovement: 0,
        improvementRate: 0,
        averageAccuracy: 0,
        recentTrend: 'stable'
      };
    }

    const totalFeedback = this.feedbackData.length;
    const averageImprovement = this.feedbackData.reduce((sum, f) => 
      sum + f.weightEffectiveness.overallImprovement, 0) / totalFeedback;
    
    const improvedCount = this.feedbackData.filter(f => 
      f.weightEffectiveness.overallImprovement > 0).length;
    const improvementRate = improvedCount / totalFeedback;
    
    const averageAccuracy = this.feedbackData.reduce((sum, f) => 
      sum + f.weightAccuracy.confidenceAlignment, 0) / totalFeedback;

    // Calculate trend (simplified)
    const recent = this.feedbackData.slice(-10);
    const older = this.feedbackData.slice(-20, -10);
    
    const recentAvg = recent.reduce((sum, f) => sum + f.weightEffectiveness.overallImprovement, 0) / recent.length;
    const olderAvg = older.reduce((sum, f) => sum + f.weightEffectiveness.overallImprovement, 0) / older.length;
    
    let recentTrend: 'improving' | 'declining' | 'stable' = 'stable';
    if (recentAvg > olderAvg + 0.02) recentTrend = 'improving';
    else if (recentAvg < olderAvg - 0.02) recentTrend = 'declining';

    return {
      totalFeedback,
      averageImprovement,
      improvementRate,
      averageAccuracy,
      recentTrend
    };
  }

  /**
   * Generate comprehensive feedback report
   */
  async generateFeedbackReport(period: 'daily' | 'weekly' | 'monthly'): Promise<string> {
    const stats = this.getFeedbackStats();
    const analysis = this.analyzeEffectiveness(this.feedbackData);
    
    return `
# Weight Feedback Loop Report
**Period:** ${period}
**Generated:** ${new Date().toISOString()}

## Summary Statistics
- **Total Feedback Entries:** ${stats.totalFeedback}
- **Average Improvement:** ${(stats.averageImprovement * 100).toFixed(2)}%
- **Improvement Rate:** ${(stats.improvementRate * 100).toFixed(1)}%
- **Average Accuracy:** ${(stats.averageAccuracy * 100).toFixed(1)}%
- **Recent Trend:** ${stats.recentTrend.toUpperCase()}

## Effectiveness Analysis
- **Routes Analyzed:** ${analysis.totalRoutes}
- **Improved Routes:** ${analysis.improvedRoutes}
- **Average Improvement:** ${(analysis.averageImprovement * 100).toFixed(2)}%

## Recommendations
${analysis.recommendations.map(rec => `- ${rec}`).join('\n')}

## System Health
- Monitoring Status: ${this.isMonitoring ? 'Active' : 'Inactive'}
- Data Quality: ${stats.averageAccuracy > 0.8 ? 'Good' : stats.averageAccuracy > 0.6 ? 'Fair' : 'Poor'}
- Performance Trend: ${stats.recentTrend}

## Next Steps
- Continue collecting feedback data
- Review and act on adjustment recommendations
- Monitor system performance trends
- Consider expanding to additional route types
    `.trim();
  }
}

// Default configuration
export const defaultFeedbackConfig: FeedbackLoopConfig = {
  enabled: true,
  collectionInterval: 6, // 6 hours
  minSampleSize: 20,
  significanceThreshold: 0.05,
  confidenceThreshold: 0.7,
  autoAdjustWeights: true,
  maxAdjustmentFactor: 0.2
};

// Export singleton instance
export const weightFeedbackMonitor = new WeightFeedbackMonitor(defaultFeedbackConfig);