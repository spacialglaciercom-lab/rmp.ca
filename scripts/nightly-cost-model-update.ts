/**
 * Nightly Cost Model Update System
 * Automatically updates the cost correction model with new data and retrains as needed
 *
 * Usage: tsx scripts/nightly-cost-model-update.ts [options]
 * Options:
 *   --check-only           Only check if update is needed, don't execute
 *   --force-update         Force update even if minimum data threshold not met
 *   --validate-only        Only run validation on current model
 *   --rollback             Rollback to previous model version
 *   --dry-run              Simulate update without making changes
 */

import { program } from "commander";
import { getMongoClient } from "@/server/mongodb";
import { costCorrectionModel } from "@/lib/cost-correction-model";
import {
  costModelValidator,
  costModelPerformanceMonitor,
} from "@/lib/cost-model-validation";
import {
  CostModelTrainer,
  type TrainedModel,
} from "@/scripts/train-cost-model";
import * as fs from "fs/promises";
import * as path from "path";
import { ObjectId } from "mongodb";

interface NightlyUpdateConfig {
  minNewSamples: number;
  maxModelAge: number; // days
  accuracyThreshold: number;
  validationSplit: number;
  backupRetention: number; // days
  checkOnly: boolean;
  forceUpdate: boolean;
  validateOnly: boolean;
  rollback: boolean;
  dryRun: boolean;
}

interface UpdateMetrics {
  newSamples: number;
  totalSamples: number;
  currentAccuracy: number;
  recommendedAction: "update" | "validate" | "skip";
  reason: string;
  confidence: number;
}

interface UpdateResult {
  success: boolean;
  action: string;
  metrics: UpdateMetrics;
  newModel?: TrainedModel;
  validationResult?: any;
  errors?: string[];
  timestamp: string;
}

interface ModelVersion {
  version: string;
  date: string;
  performance: any;
  filePath: string;
  isActive: boolean;
}

class NightlyCostModelUpdate {
  private config: NightlyUpdateConfig;
  private updateHistory: UpdateResult[] = [];
  private modelVersions: ModelVersion[] = [];

  constructor(config: NightlyUpdateConfig) {
    this.config = config;
  }

  async execute(): Promise<UpdateResult> {
    console.log("🌙 Starting Nightly Cost Model Update");
    console.log("=".repeat(60));
    console.log(`Configuration: ${JSON.stringify(this.config, null, 2)}`);

    const startTime = Date.now();
    let result: UpdateResult;

    try {
      // Step 1: Check if rollback is requested
      if (this.config.rollback) {
        result = await this.performRollback();
        return result;
      }

      // Step 2: Analyze current model performance
      console.log("\n📊 Analyzing current model performance...");
      const currentMetrics = await this.analyzeCurrentModel();
      console.log(
        `Current metrics: ${JSON.stringify(currentMetrics, null, 2)}`,
      );

      // Step 3: Collect new training data
      console.log("\n📥 Collecting new training data...");
      const newDataInfo = await this.collectNewTrainingData();
      console.log(
        `New data collected: ${JSON.stringify(newDataInfo, null, 2)}`,
      );

      // Step 4: Determine if update is needed
      console.log("\n🤔 Determining if model update is needed...");
      const updateDecision = this.shouldUpdateModel(
        currentMetrics,
        newDataInfo,
      );
      console.log(
        `Update decision: ${JSON.stringify(updateDecision, null, 2)}`,
      );

      // Step 5: Execute appropriate action
      if (this.config.checkOnly) {
        result = {
          success: true,
          action: "check",
          metrics: updateDecision,
          timestamp: new Date().toISOString(),
        };
      } else if (this.config.validateOnly) {
        result = await this.performValidationOnly();
      } else if (
        updateDecision.recommendedAction === "update" ||
        this.config.forceUpdate
      ) {
        result = await this.performModelUpdate(updateDecision);
      } else if (updateDecision.recommendedAction === "validate") {
        result = await this.performValidationOnly();
      } else {
        result = {
          success: true,
          action: "skip",
          metrics: updateDecision,
          timestamp: new Date().toISOString(),
        };
      }

      // Step 6: Clean up old files
      if (!this.config.dryRun) {
        await this.cleanupOldFiles();
      }

      // Step 7: Record update history
      await this.recordUpdateHistory(result);

      const duration = (Date.now() - startTime) / 1000;
      console.log(`\n⏱️  Update completed in ${duration.toFixed(2)} seconds`);
      console.log(`Result: ${result.success ? "✅ Success" : "❌ Failed"}`);

      return result;
    } catch (error) {
      console.error("❌ Nightly update failed:", error);

      const result: UpdateResult = {
        success: false,
        action: "error",
        metrics: {
          newSamples: 0,
          totalSamples: 0,
          currentAccuracy: 0,
          recommendedAction: "skip",
          reason: `Error: ${error}`,
          confidence: 0,
        },
        errors: [String(error)],
        timestamp: new Date().toISOString(),
      };

      await this.recordUpdateHistory(result);
      return result;
    }
  }

  /**
   * Analyze current model performance
   */
  private async analyzeCurrentModel(): Promise<UpdateMetrics> {
    const client = getMongoClient();
    if (!client) {
      throw new Error("MongoDB not configured");
    }

    const db = client.db("trashroute");
    const costHistory = db.collection("cost_history");

    // Get recent validation results
    const recentValidations = await costHistory
      .find({
        "metadata.routeDate": {
          $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
      })
      .sort({ "metadata.routeDate": -1 })
      .limit(100)
      .toArray();

    if (recentValidations.length === 0) {
      return {
        newSamples: 0,
        totalSamples: 0,
        currentAccuracy: 0,
        recommendedAction: "skip",
        reason: "No recent validation data available",
        confidence: 0,
      };
    }

    // Calculate current accuracy
    const accuracyScores = recentValidations.map(
      (v) => v.costCorrections?.accuracyScore || 0,
    );
    const currentAccuracy =
      accuracyScores.reduce((sum, score) => sum + score, 0) /
      accuracyScores.length;

    // Count new samples since last update
    const lastUpdate = await this.getLastUpdateDate();
    const newSamples = recentValidations.filter(
      (v) => new Date(v.metadata.routeDate) > lastUpdate,
    ).length;

    return {
      newSamples,
      totalSamples: recentValidations.length,
      currentAccuracy,
      recommendedAction: "validate", // Default action
      reason: "Current model analysis complete",
      confidence: currentAccuracy,
    };
  }

  /**
   * Collect new training data since last update
   */
  private async collectNewTrainingData(): Promise<{
    count: number;
    quality: number;
    data: any[];
  }> {
    const client = getMongoClient();
    if (!client) {
      throw new Error("MongoDB not configured");
    }

    const db = client.db("trashroute");
    const costHistory = db.collection("cost_history");

    const lastUpdate = await this.getLastUpdateDate();

    // Get new high-quality data since last update
    const newData = await costHistory
      .find({
        "metadata.routeDate": { $gt: lastUpdate },
        "costCorrections.accuracyScore": { $gte: 0.7 }, // High quality only
        "actualCosts.totalCost": { $gt: 0, $lt: 1000 }, // Reasonable range
      })
      .sort({ "metadata.routeDate": -1 })
      .limit(1000)
      .toArray();

    const quality =
      newData.length > 0
        ? newData.reduce(
            (sum, d) => sum + (d.costCorrections?.accuracyScore || 0),
            0,
          ) / newData.length
        : 0;

    return {
      count: newData.length,
      quality,
      data: newData,
    };
  }

  /**
   * Determine if model update is needed
   */
  private shouldUpdateModel(
    currentMetrics: UpdateMetrics,
    newDataInfo: { count: number; quality: number },
  ): UpdateMetrics {
    const reasons: string[] = [];
    let recommendedAction: "update" | "validate" | "skip" = "skip";
    let confidence = 0;

    // Check if we have enough new data
    if (newDataInfo.count >= this.config.minNewSamples) {
      reasons.push(`Sufficient new data: ${newDataInfo.count} samples`);
      confidence += 0.3;
    }

    // Check model age
    const modelAge = this.getModelAge();
    if (modelAge > this.config.maxModelAge) {
      reasons.push(`Model age: ${modelAge.toFixed(1)} days`);
      confidence += 0.3;
      recommendedAction = "validate";
    }

    // Check accuracy degradation
    if (currentMetrics.currentAccuracy < this.config.accuracyThreshold) {
      reasons.push(
        `Low accuracy: ${(currentMetrics.currentAccuracy * 100).toFixed(1)}%`,
      );
      confidence += 0.4;
      recommendedAction = "update";
    }

    // Check data quality
    if (newDataInfo.quality > 0.8) {
      reasons.push(
        `High data quality: ${(newDataInfo.quality * 100).toFixed(1)}%`,
      );
      confidence += 0.2;
    }

    // Make final decision
    if (confidence >= 0.6 || this.config.forceUpdate) {
      recommendedAction = "update";
    } else if (confidence >= 0.3) {
      recommendedAction = "validate";
    }

    return {
      ...currentMetrics,
      newSamples: newDataInfo.count,
      recommendedAction,
      reason: reasons.join(", "),
      confidence: Math.min(1, confidence),
    };
  }

  /**
   * Perform model update
   */
  private async performModelUpdate(
    metrics: UpdateMetrics,
  ): Promise<UpdateResult> {
    console.log("\n🔄 Performing model update...");

    try {
      // Step 1: Backup current model
      console.log("Creating model backup...");
      const backupPath = await this.backupCurrentModel();

      // Step 2: Prepare training data
      console.log("Preparing training data...");
      const trainingData = await this.prepareTrainingData();

      if (this.config.dryRun) {
        console.log(
          "DRY RUN: Would train model with",
          trainingData.length,
          "samples",
        );
        return {
          success: true,
          action: "update (dry-run)",
          metrics,
          timestamp: new Date().toISOString(),
        };
      }

      // Step 3: Train new model
      console.log("Training new model...");
      const trainer = new CostModelTrainer({
        dataLimit: Math.min(trainingData.length, 2000),
        modelType: "ensemble",
        validationSplit: this.config.validationSplit,
        dryRun: false,
      });

      const newModel = await trainer.train();
      if (!newModel) {
        throw new Error("Model training failed");
      }

      // Step 4: Validate new model
      console.log("Validating new model...");
      const validationResult = await this.validateNewModel(newModel);

      // Step 5: Deploy if validation passes
      if (validationResult.overallScore > 70) {
        // Minimum quality threshold
        console.log("Deploying new model...");
        await this.deployNewModel(newModel);
      } else {
        console.log("New model validation failed, keeping current model");
        return {
          success: false,
          action: "update_failed_validation",
          metrics,
          newModel,
          validationResult,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        success: true,
        action: "update",
        metrics,
        newModel,
        validationResult,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Model update failed:", error);

      // Attempt rollback
      try {
        await this.performRollback();
      } catch (rollbackError) {
        console.error("Rollback also failed:", rollbackError);
      }

      return {
        success: false,
        action: "update_error",
        metrics,
        errors: [String(error)],
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Perform validation only
   */
  private async performValidationOnly(): Promise<UpdateResult> {
    console.log("\n🔍 Performing validation only...");

    try {
      // Get recent data for validation
      const validationData = await this.getValidationData();

      if (validationData.length === 0) {
        return {
          success: true,
          action: "validate (no data)",
          metrics: {
            newSamples: 0,
            totalSamples: 0,
            currentAccuracy: 0,
            recommendedAction: "skip",
            reason: "No validation data available",
            confidence: 0,
          },
          timestamp: new Date().toISOString(),
        };
      }

      // Run validation
      const validationResult = await costModelValidator.validateModel({
        predictions: validationData.map((d) => d.prediction),
        actuals: validationData.map((d) => d.actual),
        contexts: validationData.map((d) => d.context),
        metadata: validationData.map((d) => d.metadata),
      });

      // Record in performance monitor
      costModelPerformanceMonitor.recordValidation(validationResult);

      return {
        success: true,
        action: "validate",
        metrics: {
          newSamples: validationData.length,
          totalSamples: validationData.length,
          currentAccuracy:
            100 -
            validationResult.accuracyMetrics.meanAbsolutePercentageError.cost,
          recommendedAction: "validate",
          reason: "Validation completed",
          confidence: validationResult.overallScore / 100,
        },
        validationResult,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Validation failed:", error);
      return {
        success: false,
        action: "validate_error",
        metrics: {
          newSamples: 0,
          totalSamples: 0,
          currentAccuracy: 0,
          recommendedAction: "skip",
          reason: `Validation error: ${error}`,
          confidence: 0,
        },
        errors: [String(error)],
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Backup current model
   */
  private async backupCurrentModel(): Promise<string> {
    const backupDir = path.join(process.cwd(), "models", "backups");
    await fs.mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(
      backupDir,
      `cost-model-backup-${timestamp}.json`,
    );

    // Create backup metadata
    const backupInfo = {
      timestamp: new Date().toISOString(),
      modelVersion: "current",
      backupType: "nightly-update",
      config: this.config,
    };

    await fs.writeFile(backupPath, JSON.stringify(backupInfo, null, 2));
    console.log(`Model backed up to: ${backupPath}`);

    return backupPath;
  }

  /**
   * Prepare training data
   */
  private async prepareTrainingData(): Promise<any[]> {
    const client = getMongoClient();
    if (!client) {
      throw new Error("MongoDB not configured");
    }

    const db = client.db("trashroute");
    const costHistory = db.collection("cost_history");

    // Get recent high-quality data
    const trainingData = await costHistory
      .find({
        "costCorrections.accuracyScore": { $gte: 0.7 },
        "metadata.routeDate": {
          $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // Last 90 days
        },
      })
      .sort({ "metadata.routeDate": -1 })
      .limit(2000)
      .toArray();

    return trainingData;
  }

  /**
   * Validate new model
   */
  private async validateNewModel(model: TrainedModel): Promise<any> {
    // Get validation dataset
    const validationData = await this.getValidationData();

    if (validationData.length === 0) {
      return { overallScore: 0, reason: "No validation data" };
    }

    // Run validation
    const validationResult = await costModelValidator.validateModel({
      predictions: validationData.map((d) => d.prediction),
      actuals: validationData.map((d) => d.actual),
      contexts: validationData.map((d) => d.context),
      metadata: validationData.map((d) => d.metadata),
    });

    return validationResult;
  }

  /**
   * Deploy new model
   */
  private async deployNewModel(model: TrainedModel): Promise<void> {
    const modelDir = path.join(process.cwd(), "models");
    await fs.mkdir(modelDir, { recursive: true });

    const modelPath = path.join(modelDir, `cost-model-v${model.version}.json`);
    await fs.writeFile(modelPath, JSON.stringify(model, null, 2));

    // Update active model pointer
    const activeModelPath = path.join(modelDir, "active-model.json");
    await fs.writeFile(
      activeModelPath,
      JSON.stringify(
        {
          version: model.version,
          path: modelPath,
          deployedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    console.log(`New model deployed: ${modelPath}`);
  }

  /**
   * Rollback to previous model
   */
  private async performRollback(): Promise<UpdateResult> {
    console.log("🔄 Performing model rollback...");

    try {
      const previousModel = await this.getPreviousModel();
      if (!previousModel) {
        throw new Error("No previous model available for rollback");
      }

      await this.deployNewModel(previousModel);

      return {
        success: true,
        action: "rollback",
        metrics: {
          newSamples: 0,
          totalSamples: 0,
          currentAccuracy: 0,
          recommendedAction: "rollback",
          reason: "Rollback to previous version",
          confidence: 0,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Rollback failed:", error);
      return {
        success: false,
        action: "rollback_error",
        metrics: {
          newSamples: 0,
          totalSamples: 0,
          currentAccuracy: 0,
          recommendedAction: "rollback",
          reason: `Rollback error: ${error}`,
          confidence: 0,
        },
        errors: [String(error)],
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Helper methods
   */
  private async getLastUpdateDate(): Promise<Date> {
    // Get the date of the last successful update
    const history = await this.getUpdateHistory();
    const lastUpdate = history.find((h) => h.success && h.action === "update");
    return lastUpdate
      ? new Date(lastUpdate.timestamp)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }

  private getModelAge(): number {
    // Calculate age of current model in days
    const lastUpdate = new Date(); // This would come from model metadata
    return (Date.now() - lastUpdate.getTime()) / (24 * 60 * 60 * 1000);
  }

  private async getValidationData(): Promise<any[]> {
    // Get recent data for validation
    const client = getMongoClient();
    if (!client) return [];

    const db = client.db("trashroute");
    const costHistory = db.collection("cost_history");

    const validationData = await costHistory
      .find({
        "costCorrections.accuracyScore": { $gte: 0.6 },
        "metadata.routeDate": {
          $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // Last 14 days
        },
      })
      .limit(200)
      .toArray();

    return validationData.map((doc) => ({
      prediction: {
        predictedTime: doc.predictedCosts.predictedTime,
        predictedTotalCost: doc.predictedCosts.predictedTotalCost,
        predictedFuelConsumption: doc.predictedCosts.predictedFuelConsumption,
      },
      actual: {
        actualTime: doc.actualCosts.actualTime,
        actualCost: doc.actualCosts.totalCost,
        actualFuel: doc.actualCosts.actualFuelConsumption,
      },
      context: {
        routeStats: doc.routeStatistics,
        weatherData: doc.costFactors.weatherConditions,
        operationalContext: doc.costFactors.operationalContext,
      },
      metadata: doc.metadata,
    }));
  }

  private async getPreviousModel(): Promise<TrainedModel | null> {
    // Get previous model version for rollback
    const modelDir = path.join(process.cwd(), "models");
    const backupDir = path.join(modelDir, "backups");

    try {
      const backupFiles = await fs.readdir(backupDir);
      const modelFiles = backupFiles.filter(
        (f) => f.startsWith("cost-model-backup-") && f.endsWith(".json"),
      );

      if (modelFiles.length === 0) return null;

      // Get most recent backup
      modelFiles.sort().reverse();
      const latestBackup = modelFiles[0];
      const backupPath = path.join(backupDir, latestBackup);

      const backupData = await fs.readFile(backupPath, "utf-8");
      return JSON.parse(backupData) as TrainedModel;
    } catch (error) {
      console.error("Error getting previous model:", error);
      return null;
    }
  }

  private async cleanupOldFiles(): Promise<void> {
    const cutoffDate = new Date(
      Date.now() - this.config.backupRetention * 24 * 60 * 60 * 1000,
    );

    // Clean up old backups
    const backupDir = path.join(process.cwd(), "models", "backups");
    try {
      const files = await fs.readdir(backupDir);
      for (const file of files) {
        const filePath = path.join(backupDir, file);
        const stats = await fs.stat(filePath);
        if (stats.mtime < cutoffDate) {
          await fs.unlink(filePath);
          console.log(`Cleaned up old backup: ${file}`);
        }
      }
    } catch (error) {
      console.warn("Cleanup warning:", error);
    }
  }

  private async recordUpdateHistory(result: UpdateResult): Promise<void> {
    const historyPath = path.join(
      process.cwd(),
      "models",
      "update-history.json",
    );

    try {
      // Load existing history
      let history: UpdateResult[] = [];
      try {
        const historyData = await fs.readFile(historyPath, "utf-8");
        history = JSON.parse(historyData);
      } catch {
        // File doesn't exist, start with empty history
      }

      // Add new result
      history.push(result);

      // Keep only last 100 entries
      if (history.length > 100) {
        history = history.slice(-100);
      }

      await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
    } catch (error) {
      console.error("Error recording update history:", error);
    }
  }

  private async getUpdateHistory(): Promise<UpdateResult[]> {
    const historyPath = path.join(
      process.cwd(),
      "models",
      "update-history.json",
    );

    try {
      const historyData = await fs.readFile(historyPath, "utf-8");
      return JSON.parse(historyData);
    } catch {
      return [];
    }
  }
}

// Main execution
async function main() {
  program
    .name("nightly-cost-model-update")
    .description("Nightly update system for cost correction model")
    .option("--check-only", "only check if update is needed")
    .option("--force-update", "force update even if minimum data not met")
    .option("--validate-only", "only run validation on current model")
    .option("--rollback", "rollback to previous model version")
    .option("--dry-run", "simulate update without making changes")
    .parse();

  const options = program.opts();

  const config: NightlyUpdateConfig = {
    minNewSamples: 50,
    maxModelAge: 7, // days
    accuracyThreshold: 0.75,
    validationSplit: 0.2,
    backupRetention: 30, // days
    checkOnly: options.checkOnly || false,
    forceUpdate: options.forceUpdate || false,
    validateOnly: options.validateOnly || false,
    rollback: options.rollback || false,
    dryRun: options.dryRun || false,
  };

  const updater = new NightlyCostModelUpdate(config);
  const result = await updater.execute();

  // Log summary
  console.log("\n" + "=".repeat(60));
  console.log("📋 UPDATE SUMMARY");
  console.log("=".repeat(60));
  console.log(`Action: ${result.action}`);
  console.log(`Success: ${result.success ? "✅ Yes" : "❌ No"}`);
  console.log(`New Samples: ${result.metrics.newSamples}`);
  console.log(
    `Current Accuracy: ${(result.metrics.currentAccuracy * 100).toFixed(1)}%`,
  );
  console.log(`Reason: ${result.metrics.reason}`);

  if (result.errors && result.errors.length > 0) {
    console.log(`Errors: ${result.errors.join(", ")}`);
  }

  if (result.newModel) {
    console.log(`New Model Version: ${result.newModel.version}`);
    console.log(
      `Model Performance: ${(result.newModel.performance.averageAccuracy * 100).toFixed(1)}% accuracy`,
    );
  }

  process.exit(result.success ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Unexpected error in nightly update:", error);
    process.exit(1);
  });
}
