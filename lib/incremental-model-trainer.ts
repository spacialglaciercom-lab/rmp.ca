/**
 * Incremental Model Training
 * Efficiently updates cost correction model with new data without full retraining
 */

import { getMongoClient } from "@/server/mongodb";
import { costModelValidator } from "@/lib/cost-model-validation";
import { ObjectId } from "mongodb";
import * as fs from "fs/promises";
import * as path from "path";

export interface IncrementalTrainingConfig {
  learningRate: number;
  batchSize: number;
  maxEpochs: number;
  convergenceThreshold: number;
  validationSplit: number;
  minNewSamples: number;
  featureDecay: number; // How quickly old features decay
  targetMemory: number; // How many historical samples to keep
}

export interface IncrementalUpdate {
  features: Record<string, number>;
  targets: {
    timeCorrection: number;
    costCorrection: number;
    fuelCorrection: number;
  };
  weight: number; // Sample weight based on recency and quality
  timestamp: Date;
}

export interface ModelCoefficients {
  version: string;
  coefficients: Record<string, number>;
  intercepts: {
    time: number;
    cost: number;
    fuel: number;
  };
  featureImportance: Record<string, number>;
  trainingStats: {
    totalSamples: number;
    lastUpdate: string;
    averageLoss: number;
    convergenceEpoch: number;
  };
}

export interface TrainingResult {
  success: boolean;
  coefficients: ModelCoefficients;
  performance: {
    trainingAccuracy: number;
    validationAccuracy: number;
    improvement: number;
    convergenceReached: boolean;
  };
  samplesUsed: number;
  trainingTime: number;
  errors?: string[];
}

/**
 * Incremental gradient descent trainer for cost model
 */
export class IncrementalModelTrainer {
  private config: IncrementalTrainingConfig;
  private currentCoefficients: ModelCoefficients | null = null;
  private trainingHistory: IncrementalUpdate[] = [];
  private isTraining: boolean = false;

  constructor(config: IncrementalTrainingConfig) {
    this.config = config;
  }

  /**
   * Load current model coefficients
   */
  async loadCurrentModel(): Promise<ModelCoefficients | null> {
    try {
      const modelPath = path.join(process.cwd(), 'models', 'cost-model-coefficients.json');
      const modelData = await fs.readFile(modelPath, 'utf-8');
      this.currentCoefficients = JSON.parse(modelData);
      return this.currentCoefficients;
    } catch (error) {
      console.log("No existing model found, will create new one");
      return null;
    }
  }

  /**
   * Perform incremental training with new data
   */
  async trainIncremental(newData: IncrementalUpdate[]): Promise<TrainingResult> {
    if (this.isTraining) {
      throw new Error("Training already in progress");
    }

    if (newData.length < this.config.minNewSamples) {
      return {
        success: false,
        coefficients: this.currentCoefficients!,
        performance: {
          trainingAccuracy: 0,
          validationAccuracy: 0,
          improvement: 0,
          convergenceReached: false
        },
        samplesUsed: 0,
        trainingTime: 0,
        errors: [`Insufficient new data: ${newData.length} < ${this.config.minNewSamples}`]
      };
    }

    this.isTraining = true;
    const startTime = Date.now();

    try {
      console.log(`🔄 Starting incremental training with ${newData.length} new samples...`);

      // Load current model if not loaded
      if (!this.currentCoefficients) {
        await this.loadCurrentModel();
        if (!this.currentCoefficients) {
          // Create initial model if none exists
          this.currentCoefficients = this.createInitialModel();
        }
      }

      // Prepare training data
      const trainingData = this.prepareTrainingData(newData);
      
      // Split into training and validation sets
      const splitIndex = Math.floor(trainingData.length * (1 - this.config.validationSplit));
      const trainData = trainingData.slice(0, splitIndex);
      const valData = trainingData.slice(splitIndex);

      console.log(`Training data: ${trainData.length} samples, Validation: ${valData.length} samples`);

      // Perform incremental training
      const trainingResult = await this.performGradientDescent(trainData, valData);
      
      // Update training history
      this.updateTrainingHistory(newData);

      // Save updated model
      await this.saveModel(trainingResult.coefficients);

      const trainingTime = (Date.now() - startTime) / 1000;
      
      console.log(`✅ Incremental training completed in ${trainingTime.toFixed(2)}s`);
      console.log(`Training accuracy: ${(trainingResult.performance.trainingAccuracy * 100).toFixed(1)}%`);
      console.log(`Validation accuracy: ${(trainingResult.performance.validationAccuracy * 100).toFixed(1)}%`);
      console.log(`Improvement: ${(trainingResult.performance.improvement * 100).toFixed(2)}%`);

      return {
        ...trainingResult,
        trainingTime
      };

    } catch (error) {
      console.error("❌ Incremental training failed:", error);
      return {
        success: false,
        coefficients: this.currentCoefficients!,
        performance: {
          trainingAccuracy: 0,
          validationAccuracy: 0,
          improvement: 0,
          convergenceReached: false
        },
        samplesUsed: 0,
        trainingTime: (Date.now() - startTime) / 1000,
        errors: [String(error)]
      };
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Create initial model coefficients
   */
  private createInitialModel(): ModelCoefficients {
    const features = [
      'routeDistance', 'estimatedTime', 'turnComplexity', 'weatherSeverity',
      'temperature', 'precipitation', 'windSpeed', 'visibility',
      'driverExperience', 'timeOfDay', 'dayOfWeek', 'season',
      'urbanDensity', 'roadConditions'
    ];

    const coefficients: Record<string, number> = {};
    const featureImportance: Record<string, number> = {};

    // Initialize with small random values
    features.forEach(feature => {
      coefficients[feature] = (Math.random() - 0.5) * 0.1;
      featureImportance[feature] = 0.1;
    });

    return {
      version: "1.0.0",
      coefficients,
      intercepts: {
        time: 1.0,
        cost: 1.0,
        fuel: 1.0
      },
      featureImportance,
      trainingStats: {
        totalSamples: 0,
        lastUpdate: new Date().toISOString(),
        averageLoss: 1.0,
        convergenceEpoch: 0
      }
    };
  }

  /**
   * Prepare training data with weights and decay
   */
  private prepareTrainingData(newData: IncrementalUpdate[]): IncrementalUpdate[] {
    // Combine new data with recent history
    const recentHistory = this.getRecentTrainingHistory();
    
    // Apply time-based decay to historical data
    const decayedHistory = recentHistory.map(update => ({
      ...update,
      weight: update.weight * this.calculateTimeDecay(update.timestamp)
    }));

    // Add weights to new data
    const weightedNewData = newData.map(update => ({
      ...update,
      weight: this.calculateSampleWeight(update)
    }));

    // Combine and shuffle
    const combinedData = [...decayedHistory, ...weightedNewData];
    return this.shuffleArray(combinedData);
  }

  /**
   * Perform gradient descent training
   */
  private async performGradientDescent(
    trainData: IncrementalUpdate[],
    valData: IncrementalUpdate[]
  ): Promise<TrainingResult> {
    if (!this.currentCoefficients) {
      throw new Error("No current coefficients available");
    }

    const coefficients = { ...this.currentCoefficients };
    let bestCoefficients = { ...coefficients };
    let bestValidationAccuracy = 0;
    let convergenceEpoch = 0;
    let patience = 5; // Early stopping patience
    let noImprovementCount = 0;

    console.log("Starting gradient descent training...");

    for (let epoch = 0; epoch < this.config.maxEpochs; epoch++) {
      let totalLoss = 0;
      let predictions: number[] = [];
      let actuals: number[] = [];

      // Training step
      for (const sample of trainData) {
        // Make prediction
        const prediction = this.predictSample(sample.features, coefficients);
        
        // Calculate loss
        const loss = this.calculateLoss(prediction, sample.targets);
        totalLoss += loss * sample.weight;
        
        // Store for accuracy calculation
        predictions.push(prediction.cost);
        actuals.push(sample.targets.costCorrection);

        // Update coefficients
        this.updateCoefficients(sample, prediction, coefficients);
      }

      // Calculate training accuracy
      const trainingAccuracy = this.calculateAccuracy(predictions, actuals);
      const averageLoss = totalLoss / trainData.length;

      // Validation step
      const validationAccuracy = this.validateModel(valData, coefficients);

      console.log(`Epoch ${epoch + 1}/${this.config.maxEpochs}: ` +
                  `Train Acc: ${(trainingAccuracy * 100).toFixed(1)}%, ` +
                  `Val Acc: ${(validationAccuracy * 100).toFixed(1)}%, ` +
                  `Loss: ${averageLoss.toFixed(4)}`);

      // Check for improvement
      if (validationAccuracy > bestValidationAccuracy) {
        bestValidationAccuracy = validationAccuracy;
        bestCoefficients = { ...coefficients };
        convergenceEpoch = epoch;
        noImprovementCount = 0;
      } else {
        noImprovementCount++;
      }

      // Early stopping
      if (noImprovementCount >= patience) {
        console.log(`Early stopping at epoch ${epoch + 1}`);
        break;
      }

      // Check convergence
      if (averageLoss < this.config.convergenceThreshold) {
        console.log(`Convergence reached at epoch ${epoch + 1}`);
        convergenceEpoch = epoch;
        break;
      }
    }

    // Calculate improvement
    const previousAccuracy = this.validateModel(valData, this.currentCoefficients!);
    const improvement = bestValidationAccuracy - previousAccuracy;

    return {
      success: true,
      coefficients: bestCoefficients,
      performance: {
        trainingAccuracy: 0, // Would calculate from training data
        validationAccuracy: bestValidationAccuracy,
        improvement,
        convergenceReached: convergenceEpoch > 0
      },
      samplesUsed: trainData.length
    };
  }

  /**
   * Make prediction for a single sample
   */
  private predictSample(features: Record<string, number>, coefficients: ModelCoefficients): {
    time: number;
    cost: number;
    fuel: number;
  } {
    let timePrediction = coefficients.intercepts.time;
    let costPrediction = coefficients.intercepts.cost;
    let fuelPrediction = coefficients.intercepts.fuel;

    // Linear combination of features
    Object.entries(features).forEach(([feature, value]) => {
      const coeff = coefficients.coefficients[feature] || 0;
      timePrediction += coeff * value;
      costPrediction += coeff * value * 1.1; // Cost typically has higher variance
      fuelPrediction += coeff * value * 0.9; // Fuel typically has lower variance
    });

    // Ensure reasonable bounds
    return {
      time: Math.max(0.1, Math.min(5, timePrediction)),
      cost: Math.max(0.1, Math.min(5, costPrediction)),
      fuel: Math.max(0.1, Math.min(5, fuelPrediction))
    };
  }

  /**
   * Calculate loss for a prediction
   */
  private calculateLoss(
    prediction: { time: number; cost: number; fuel: number },
    targets: { timeCorrection: number; costCorrection: number; fuelCorrection: number }
  ): number {
    const timeLoss = Math.pow(prediction.time - targets.timeCorrection, 2);
    const costLoss = Math.pow(prediction.cost - targets.costCorrection, 2);
    const fuelLoss = Math.pow(prediction.fuel - targets.fuelCorrection, 2);
    
    return (timeLoss + costLoss + fuelLoss) / 3;
  }

  /**
   * Update coefficients based on prediction error
   */
  private updateCoefficients(
    sample: IncrementalUpdate,
    prediction: { time: number; cost: number; fuel: number },
    coefficients: ModelCoefficients
  ): void {
    const learningRate = this.config.learningRate * sample.weight;

    Object.entries(sample.features).forEach(([feature, value]) => {
      // Calculate gradients for each target
      const timeGradient = 2 * (prediction.time - sample.targets.timeCorrection) * value;
      const costGradient = 2 * (prediction.cost - sample.targets.costCorrection) * value * 1.1;
      const fuelGradient = 2 * (prediction.fuel - sample.targets.fuelCorrection) * value * 0.9;
      
      // Average gradient
      const avgGradient = (timeGradient + costGradient + fuelGradient) / 3;
      
      // Update coefficient
      if (coefficients.coefficients[feature] !== undefined) {
        coefficients.coefficients[feature] -= learningRate * avgGradient;
      }
    });

    // Update intercepts
    const avgError = (
      (prediction.time - sample.targets.timeCorrection) +
      (prediction.cost - sample.targets.costCorrection) +
      (prediction.fuel - sample.targets.fuelCorrection)
    ) / 3;
    
    coefficients.intercepts.time -= learningRate * avgError;
    coefficients.intercepts.cost -= learningRate * avgError * 1.1;
    coefficients.intercepts.fuel -= learningRate * avgError * 0.9;
  }

  /**
   * Validate model on validation set
   */
  private validateModel(data: IncrementalUpdate[], coefficients: ModelCoefficients): number {
    if (data.length === 0) return 0;

    let totalError = 0;
    
    data.forEach(sample => {
      const prediction = this.predictSample(sample.features, coefficients);
      const error = this.calculateLoss(prediction, sample.targets);
      totalError += error * sample.weight;
    });

    const avgError = totalError / data.reduce((sum, sample) => sum + sample.weight, 0);
    return Math.max(0, 1 - Math.sqrt(avgError)); // Convert to accuracy score
  }

  /**
   * Calculate accuracy between predictions and actuals
   */
  private calculateAccuracy(predictions: number[], actuals: number[]): number {
    if (predictions.length !== actuals.length || predictions.length === 0) return 0;

    const errors = predictions.map((pred, i) => Math.abs(pred - actuals[i]));
    const avgError = errors.reduce((sum, err) => sum + err, 0) / errors.length;
    const avgActual = actuals.reduce((sum, val) => sum + val, 0) / actuals.length;
    
    return Math.max(0, 1 - (avgError / avgActual));
  }

  /**
   * Calculate sample weight based on recency and quality
   */
  private calculateSampleWeight(update: IncrementalUpdate): number {
    const ageWeight = this.calculateTimeDecay(update.timestamp);
    const qualityWeight = update.weight || 1.0;
    
    return ageWeight * qualityWeight;
  }

  /**
   * Calculate time decay for historical data
   */
  private calculateTimeDecay(timestamp: Date): number {
    const ageInDays = (Date.now() - timestamp.getTime()) / (24 * 60 * 60 * 1000);
    return Math.exp(-this.config.featureDecay * ageInDays);
  }

  /**
   * Get recent training history
   */
  private getRecentTrainingHistory(): IncrementalUpdate[] {
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
    return this.trainingHistory.filter(update => update.timestamp > cutoffDate);
  }

  /**
   * Update training history
   */
  private updateTrainingHistory(newData: IncrementalUpdate[]): void {
    // Add new data to history
    this.trainingHistory.push(...newData);
    
    // Keep only recent history based on memory limit
    const maxHistory = this.config.targetMemory;
    if (this.trainingHistory.length > maxHistory) {
      // Remove oldest samples
      this.trainingHistory = this.trainingHistory.slice(-maxHistory);
    }
  }

  /**
   * Save updated model
   */
  private async saveModel(coefficients: ModelCoefficients): Promise<void> {
    const modelPath = path.join(process.cwd(), 'models', 'cost-model-coefficients.json');
    await fs.mkdir(path.dirname(modelPath), { recursive: true });
    
    // Update training stats
    coefficients.trainingStats = {
      ...coefficients.trainingStats,
      totalSamples: this.trainingHistory.length,
      lastUpdate: new Date().toISOString(),
      averageLoss: 0 // Would calculate from recent training
    };

    await fs.writeFile(modelPath, JSON.stringify(coefficients, null, 2));
    console.log(`Model coefficients saved to ${modelPath}`);
  }

  /**
   * Shuffle array (Fisher-Yates algorithm)
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Get feature importance scores
   */
  private calculateFeatureImportance(coefficients: ModelCoefficients): Record<string, number> {
    const importance: Record<string, number> = {};
    
    Object.entries(coefficients.coefficients).forEach(([feature, coeff]) => {
      // Use absolute coefficient value as importance
      importance[feature] = Math.abs(coeff);
    });

    // Normalize to sum to 1
    const totalImportance = Object.values(importance).reduce((sum, val) => sum + val, 0);
    if (totalImportance > 0) {
      Object.keys(importance).forEach(feature => {
        importance[feature] /= totalImportance;
      });
    }

    return importance;
  }
}

/**
 * Incremental training manager
 */
export class IncrementalTrainingManager {
  private trainer: IncrementalModelTrainer;
  private config: IncrementalTrainingConfig;
  private lastTrainingDate: Date | null = null;

  constructor(config: IncrementalTrainingConfig) {
    this.config = config;
    this.trainer = new IncrementalModelTrainer(config);
  }

  /**
   * Check if incremental training is needed
   */
  async shouldTrain(): Promise<{
    needed: boolean;
    reason: string;
    newSamples: number;
    estimatedImprovement: number;
  }> {
    const client = getMongoClient();
    if (!client) {
      return { needed: false, reason: "MongoDB not configured", newSamples: 0, estimatedImprovement: 0 };
    }

    const db = client.db("trashroute");
    const processedData = db.collection("processed_cost_data");

    // Check for new data since last training
    const since = this.lastTrainingDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const newSamples = await processedData.countDocuments({
      createdAt: { $gt: since },
      "metadata.validationScore": { $gte: 0.8 }
    });

    if (newSamples < this.config.minNewSamples) {
      return {
        needed: false,
        reason: `Insufficient new data: ${newSamples} < ${this.config.minNewSamples}`,
        newSamples,
        estimatedImprovement: 0
      };
    }

    // Check current model performance
    const recentValidation = await this.getRecentValidation();
    const currentAccuracy = recentValidation?.accuracyMetrics?.meanAbsolutePercentageError?.cost || 100;
    
    // Estimate potential improvement (simplified)
    const estimatedImprovement = Math.min(0.1, newSamples / 1000); // Max 10% improvement

    return {
      needed: true,
      reason: `Sufficient new data available: ${newSamples} samples`,
      newSamples,
      estimatedImprovement
    };
  }

  /**
   * Perform incremental training
   */
  async performIncrementalTraining(): Promise<TrainingResult> {
    console.log("🚀 Starting incremental training process...");

    try {
      // Get new training data
      const newData = await this.getNewTrainingData();
      console.log(`📊 Retrieved ${newData.length} new training samples`);

      if (newData.length === 0) {
        return {
          success: false,
          coefficients: await this.trainer.loadCurrentModel() || this.trainer.createInitialModel(),
          performance: {
            trainingAccuracy: 0,
            validationAccuracy: 0,
            improvement: 0,
            convergenceReached: false
          },
          samplesUsed: 0,
          trainingTime: 0,
          errors: ["No new training data available"]
        };
      }

      // Convert to incremental updates
      const incrementalUpdates = this.convertToIncrementalUpdates(newData);
      
      // Perform training
      const result = await this.trainer.trainIncremental(incrementalUpdates);
      
      if (result.success) {
        this.lastTrainingDate = new Date();
        console.log("✅ Incremental training completed successfully");
      }

      return result;

    } catch (error) {
      console.error("❌ Incremental training failed:", error);
      return {
        success: false,
        coefficients: await this.trainer.loadCurrentModel() || this.trainer.createInitialModel(),
        performance: {
          trainingAccuracy: 0,
          validationAccuracy: 0,
          improvement: 0,
          convergenceReached: false
        },
        samplesUsed: 0,
        trainingTime: 0,
        errors: [String(error)]
      };
    }
  }

  /**
   * Get new training data since last training
   */
  private async getNewTrainingData(): Promise<any[]> {
    const client = getMongoClient();
    if (!client) return [];

    const db = client.db("trashroute");
    const processedData = db.collection("processed_cost_data");

    const since = this.lastTrainingDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    return await processedData
      .find({
        createdAt: { $gt: since },
        "metadata.validationScore": { $gte: 0.8 }
      })
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray();
  }

  /**
   * Convert database records to incremental updates
   */
  private convertToIncrementalUpdates(data: any[]): IncrementalUpdate[] {
    return data.map(record => ({
      features: record.features,
      targets: record.targets,
      weight: record.metadata?.dataQuality || 0.8,
      timestamp: record.createdAt
    }));
  }

  /**
   * Get recent validation results
   */
  private async getRecentValidation(): Promise<any> {
    const client = getMongoClient();
    if (!client) return null;

    const db = client.db("trashroute");
    const validations = db.collection("model_validations");

    const recent = await validations
      .find({})
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    return recent[0] || null;
  }

  /**
   * Schedule regular incremental training
   */
  scheduleRegularTraining(intervalHours: number = 24): void {
    setInterval(async () => {
      const shouldTrain = await this.shouldTrain();
      if (shouldTrain.needed) {
        console.log(`🕐 Scheduled training triggered: ${shouldTrain.reason}`);
        await this.performIncrementalTraining();
      }
    }, intervalHours * 60 * 60 * 1000);

    console.log(`⏰ Scheduled incremental training every ${intervalHours} hours`);
  }
}

// Default configuration
export const defaultIncrementalConfig: IncrementalTrainingConfig = {
  learningRate: 0.01,
  batchSize: 32,
  maxEpochs: 100,
  convergenceThreshold: 0.001,
  validationSplit: 0.2,
  minNewSamples: 50,
  featureDecay: 0.01,
  targetMemory: 1000
};

// Export singleton instances
export const incrementalModelTrainer = new IncrementalModelTrainer(defaultIncrementalConfig);
export const incrementalTrainingManager = new IncrementalTrainingManager(defaultIncrementalConfig);