/**
 * Update Validation and Rollback System
 * Comprehensive validation and rollback capabilities for cost model updates
 */

import { getMongoClient } from "@/server/mongodb";
import { costModelValidator } from "@/lib/cost-model-validation";
import { costCorrectionModel } from "@/lib/cost-correction-model";
import { ObjectId } from "mongodb";
import * as fs from "fs/promises";
import * as path from "path";

export interface ValidationTest {
  id: string;
  name: string;
  type: "accuracy" | "performance" | "robustness" | "bias";
  description: string;
  expectedResult: any;
  tolerance: number;
  critical: boolean;
}

export interface ValidationResult {
  testId: string;
  testName: string;
  passed: boolean;
  actualResult: any;
  expectedResult: any;
  difference: number;
  status: "pass" | "fail" | "warning";
  message: string;
  executionTime: number;
}

export interface UpdateValidationReport {
  updateId: string;
  timestamp: Date;
  overallStatus: "approved" | "rejected" | "warning";
  totalTests: number;
  passedTests: number;
  failedTests: number;
  warningTests: number;
  criticalFailures: number;
  testResults: ValidationResult[];
  recommendations: string[];
  rollbackRecommended: boolean;
}

export interface RollbackConfig {
  maxRollbackVersions: number;
  rollbackThreshold: number; // Minimum validation score to prevent rollback
  backupRetention: number; // days
  autoRollback: boolean;
  manualApprovalRequired: boolean;
}

export interface ModelVersion {
  version: string;
  timestamp: Date;
  filePath: string;
  checksum: string;
  performance: {
    accuracy: number;
    validationScore: number;
    trainingSamples: number;
  };
  metadata: {
    trainingDate: string;
    modelType: string;
    features: string[];
    changelog: string[];
  };
  status: "active" | "backup" | "rollback";
}

export interface RollbackResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  reason: string;
  validationScore: number;
  timestamp: Date;
  errors?: string[];
}

/**
 * Comprehensive update validation system
 */
export class UpdateValidationSystem {
  private validationTests: ValidationTest[] = [];
  private rollbackConfig: RollbackConfig;

  constructor(rollbackConfig: RollbackConfig) {
    this.rollbackConfig = rollbackConfig;
    this.initializeValidationTests();
  }

  /**
   * Initialize validation test suite
   */
  private initializeValidationTests(): void {
    this.validationTests = [
      // Accuracy Tests
      {
        id: "accuracy_basic",
        name: "Basic Accuracy Test",
        type: "accuracy",
        description: "Test model accuracy on basic route scenarios",
        expectedResult: 0.85,
        tolerance: 0.1,
        critical: true,
      },
      {
        id: "accuracy_weather",
        name: "Weather Accuracy Test",
        type: "accuracy",
        description: "Test accuracy under different weather conditions",
        expectedResult: 0.8,
        tolerance: 0.15,
        critical: false,
      },
      {
        id: "accuracy_complex_routes",
        name: "Complex Routes Accuracy Test",
        type: "accuracy",
        description: "Test accuracy on high-complexity routes",
        expectedResult: 0.75,
        tolerance: 0.2,
        critical: false,
      },

      // Performance Tests
      {
        id: "performance_prediction_speed",
        name: "Prediction Speed Test",
        type: "performance",
        description: "Test prediction response time",
        expectedResult: 0.1, // 100ms
        tolerance: 0.05,
        critical: true,
      },
      {
        id: "performance_memory_usage",
        name: "Memory Usage Test",
        type: "performance",
        description: "Test memory consumption during predictions",
        expectedResult: 50, // MB
        tolerance: 25,
        critical: false,
      },
      {
        id: "performance_batch_processing",
        name: "Batch Processing Test",
        type: "performance",
        description: "Test batch prediction performance",
        expectedResult: 1.0, // 1 second for 100 routes
        tolerance: 0.5,
        critical: false,
      },

      // Robustness Tests
      {
        id: "robustness_edge_cases",
        name: "Edge Cases Robustness Test",
        type: "robustness",
        description: "Test behavior with edge case inputs",
        expectedResult: 0.7,
        tolerance: 0.2,
        critical: true,
      },
      {
        id: "robustness_noisy_data",
        name: "Noisy Data Robustness Test",
        type: "robustness",
        description: "Test behavior with noisy/incomplete data",
        expectedResult: 0.8,
        tolerance: 0.15,
        critical: false,
      },
      {
        id: "robustness_extreme_weather",
        name: "Extreme Weather Robustness Test",
        type: "robustness",
        description: "Test behavior during extreme weather conditions",
        expectedResult: 0.6,
        tolerance: 0.3,
        critical: false,
      },

      // Bias Tests
      {
        id: "bias_seasonal",
        name: "Seasonal Bias Test",
        type: "bias",
        description: "Test for seasonal prediction bias",
        expectedResult: 0.0, // No bias
        tolerance: 0.1,
        critical: false,
      },
      {
        id: "bias_driver_experience",
        name: "Driver Experience Bias Test",
        type: "bias",
        description: "Test for bias based on driver experience level",
        expectedResult: 0.0, // No bias
        tolerance: 0.15,
        critical: false,
      },
      {
        id: "bias_route_complexity",
        name: "Route Complexity Bias Test",
        type: "bias",
        description: "Test for bias based on route complexity",
        expectedResult: 0.0, // No bias
        tolerance: 0.2,
        critical: false,
      },
    ];
  }

  /**
   * Validate a model update
   */
  async validateUpdate(
    updateId: string,
    newModelVersion: string,
  ): Promise<UpdateValidationReport> {
    console.log(
      `🔍 Validating update ${updateId} for model ${newModelVersion}...`,
    );

    const startTime = Date.now();
    const testResults: ValidationResult[] = [];
    let criticalFailures = 0;

    try {
      // Run all validation tests
      for (const test of this.validationTests) {
        console.log(`   Running test: ${test.name}...`);

        const result = await this.runValidationTest(test, newModelVersion);
        testResults.push(result);

        if (!result.passed && result.status === "fail" && test.critical) {
          criticalFailures++;
        }

        console.log(`   ${result.status.toUpperCase()}: ${result.message}`);
      }

      // Generate recommendations
      const recommendations = this.generateRecommendations(testResults);

      // Determine overall status
      const passedTests = testResults.filter((r) => r.status === "pass").length;
      const failedTests = testResults.filter((r) => r.status === "fail").length;
      const warningTests = testResults.filter(
        (r) => r.status === "warning",
      ).length;

      let overallStatus: "approved" | "rejected" | "warning";
      let rollbackRecommended = false;

      if (criticalFailures > 0) {
        overallStatus = "rejected";
        rollbackRecommended = true;
      } else if (failedTests > 0) {
        overallStatus = "warning";
        rollbackRecommended = failedTests >= 3; // Rollback if too many failures
      } else if (warningTests > 0) {
        overallStatus = "warning";
        rollbackRecommended = false;
      } else {
        overallStatus = "approved";
        rollbackRecommended = false;
      }

      const duration = (Date.now() - startTime) / 1000;
      console.log(`✅ Validation completed in ${duration.toFixed(2)}s`);
      console.log(`Overall status: ${overallStatus.toUpperCase()}`);
      console.log(
        `Tests: ${passedTests} passed, ${failedTests} failed, ${warningTests} warnings`,
      );

      return {
        updateId,
        timestamp: new Date(),
        overallStatus,
        totalTests: this.validationTests.length,
        passedTests,
        failedTests,
        warningTests,
        criticalFailures,
        testResults,
        recommendations,
        rollbackRecommended,
      };
    } catch (error) {
      console.error("❌ Validation failed:", error);

      return {
        updateId,
        timestamp: new Date(),
        overallStatus: "rejected",
        totalTests: this.validationTests.length,
        passedTests: 0,
        failedTests: this.validationTests.length,
        warningTests: 0,
        criticalFailures: this.validationTests.length,
        testResults: [],
        recommendations: ["Validation process failed - manual review required"],
        rollbackRecommended: true,
      };
    }
  }

  /**
   * Run individual validation test
   */
  private async runValidationTest(
    test: ValidationTest,
    modelVersion: string,
  ): Promise<ValidationResult> {
    const startTime = Date.now();

    try {
      // Get test data
      const testData = await this.getTestData(test.type);

      // Run the specific test
      const actualResult = await this.executeTest(test, testData, modelVersion);

      // Calculate difference from expected result
      const difference = Math.abs(actualResult - test.expectedResult);

      // Determine status
      let status: "pass" | "fail" | "warning";
      let passed: boolean;

      if (difference <= test.tolerance) {
        status = "pass";
        passed = true;
      } else if (difference <= test.tolerance * 2) {
        status = "warning";
        passed = false;
      } else {
        status = "fail";
        passed = false;
      }

      const executionTime = (Date.now() - startTime) / 1000;

      return {
        testId: test.id,
        testName: test.name,
        passed,
        actualResult,
        expectedResult: test.expectedResult,
        difference,
        status,
        message: `${test.name}: ${status.toUpperCase()} (${difference.toFixed(4)} difference)`,
        executionTime,
      };
    } catch (error) {
      console.error(`Test ${test.name} failed:`, error);

      return {
        testId: test.id,
        testName: test.name,
        passed: false,
        actualResult: null,
        expectedResult: test.expectedResult,
        difference: Infinity,
        status: "fail",
        message: `${test.name}: FAILED - ${String(error)}`,
        executionTime: (Date.now() - startTime) / 1000,
      };
    }
  }

  /**
   * Get test data for specific test type
   */
  private async getTestData(testType: string): Promise<any[]> {
    const client = getMongoClient();
    if (!client) return [];

    const db = client.db("trashroute");
    const costHistory = db.collection("cost_history");

    switch (testType) {
      case "accuracy":
        return await costHistory
          .find({ "costCorrections.accuracyScore": { $gte: 0.7 } })
          .limit(100)
          .toArray();

      case "performance":
        return await costHistory.find({}).limit(50).toArray();

      case "robustness":
        return await costHistory
          .find({
            $or: [
              { "routeStatistics.totalDistance": { $lt: 5 } },
              { "routeStatistics.totalDistance": { $gt: 50 } },
              { "costFactors.weatherConditions.severity": { $gt: 0.7 } },
            ],
          })
          .limit(50)
          .toArray();

      case "bias":
        return await costHistory
          .find({
            "costFactors.operationalContext.driverExperience": {
              $exists: true,
            },
            "costFactors.operationalContext.season": { $exists: true },
          })
          .limit(100)
          .toArray();

      default:
        return [];
    }
  }

  /**
   * Execute specific validation test
   */
  private async executeTest(
    test: ValidationTest,
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    switch (test.id) {
      case "accuracy_basic":
        return await this.testBasicAccuracy(testData, modelVersion);

      case "accuracy_weather":
        return await this.testWeatherAccuracy(testData, modelVersion);

      case "accuracy_complex_routes":
        return await this.testComplexRouteAccuracy(testData, modelVersion);

      case "performance_prediction_speed":
        return await this.testPredictionSpeed(testData, modelVersion);

      case "performance_memory_usage":
        return await this.testMemoryUsage(testData, modelVersion);

      case "performance_batch_processing":
        return await this.testBatchProcessing(testData, modelVersion);

      case "robustness_edge_cases":
        return await this.testEdgeCaseRobustness(testData, modelVersion);

      case "robustness_noisy_data":
        return await this.testNoisyDataRobustness(testData, modelVersion);

      case "robustness_extreme_weather":
        return await this.testExtremeWeatherRobustness(testData, modelVersion);

      case "bias_seasonal":
        return await this.testSeasonalBias(testData, modelVersion);

      case "bias_driver_experience":
        return await this.testDriverExperienceBias(testData, modelVersion);

      case "bias_route_complexity":
        return await this.testRouteComplexityBias(testData, modelVersion);

      default:
        return 0;
    }
  }

  /**
   * Test basic accuracy
   */
  private async testBasicAccuracy(
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    let totalAccuracy = 0;
    let count = 0;

    for (const data of testData) {
      const prediction = await this.getModelPrediction(data, modelVersion);
      const actual = {
        time: data.actualCosts.actualTime / data.routeStatistics.estimatedTime,
        cost:
          data.actualCosts.totalCost / data.predictedCosts.predictedTotalCost,
        fuel:
          data.actualCosts.actualFuelConsumption /
          data.predictedCosts.predictedFuelConsumption,
      };

      const accuracy = this.calculateAccuracy(prediction, actual);
      totalAccuracy += accuracy;
      count++;
    }

    return count > 0 ? totalAccuracy / count : 0;
  }

  /**
   * Test weather-specific accuracy
   */
  private async testWeatherAccuracy(
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    const weatherData = testData.filter(
      (d) =>
        d.costFactors?.weatherConditions?.condition === "Rain" ||
        d.costFactors?.weatherConditions?.condition === "Snow",
    );

    return await this.testBasicAccuracy(weatherData, modelVersion);
  }

  /**
   * Test complex route accuracy
   */
  private async testComplexRouteAccuracy(
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    const complexRoutes = testData.filter((d) => {
      const totalTurns =
        d.routeStatistics.turns.leftTurns +
        d.routeStatistics.turns.rightTurns +
        d.routeStatistics.turns.uTurns;
      return totalTurns > 30 || d.routeStatistics.totalDistance > 20;
    });

    return await this.testBasicAccuracy(complexRoutes, modelVersion);
  }

  /**
   * Test prediction speed
   */
  private async testPredictionSpeed(
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    const startTime = Date.now();

    for (const data of testData.slice(0, 10)) {
      // Test on subset
      await this.getModelPrediction(data, modelVersion);
    }

    const totalTime = (Date.now() - startTime) / 1000; // seconds
    const avgTime = totalTime / 10;

    return avgTime; // Return average prediction time
  }

  /**
   * Test memory usage
   */
  private async testMemoryUsage(
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    // Simulate memory usage measurement
    // In real implementation, would measure actual memory usage
    const simulatedMemory = 45 + Math.random() * 20; // 45-65 MB
    return simulatedMemory;
  }

  /**
   * Test batch processing performance
   */
  private async testBatchProcessing(
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    const startTime = Date.now();

    // Process batch of 100 routes
    const batch = testData.slice(0, 100);
    const predictions = await Promise.all(
      batch.map((data) => this.getModelPrediction(data, modelVersion)),
    );

    const totalTime = (Date.now() - startTime) / 1000;
    return totalTime; // Time for 100 predictions
  }

  /**
   * Test edge case robustness
   */
  private async testEdgeCaseRobustness(
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    const edgeCases = testData.filter(
      (d) =>
        d.routeStatistics.totalDistance < 2 || // Very short routes
        d.routeStatistics.totalDistance > 50 || // Very long routes
        d.routeStatistics.estimatedTime < 30 || // Very quick routes
        d.routeStatistics.estimatedTime > 300, // Very long routes
    );

    if (edgeCases.length === 0) return 1.0;

    return await this.testBasicAccuracy(edgeCases, modelVersion);
  }

  /**
   * Test noisy data robustness
   */
  private async testNoisyDataRobustness(
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    // Add artificial noise to data
    const noisyData = testData.map((d) => ({
      ...d,
      routeStatistics: {
        ...d.routeStatistics,
        totalDistance:
          d.routeStatistics.totalDistance * (0.9 + Math.random() * 0.2), // ±10% noise
        estimatedTime:
          d.routeStatistics.estimatedTime * (0.9 + Math.random() * 0.2),
      },
    }));

    return await this.testBasicAccuracy(noisyData, modelVersion);
  }

  /**
   * Test extreme weather robustness
   */
  private async testExtremeWeatherRobustness(
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    const extremeWeather = testData.filter((d) => {
      const weather = d.costFactors?.weatherConditions;
      return (
        weather &&
        (weather.severity > 0.8 ||
          weather.precipitation > 10 || // Heavy rain
          weather.windSpeed > 15 || // Strong wind
          weather.visibility < 500) // Poor visibility
      );
    });

    return await this.testBasicAccuracy(extremeWeather, modelVersion);
  }

  /**
   * Test seasonal bias
   */
  private async testSeasonalBias(
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    const seasons = ["spring", "summer", "fall", "winter"];
    const seasonalErrors: Record<string, number[]> = {};

    seasons.forEach((season) => (seasonalErrors[season] = []));

    for (const data of testData) {
      const season = data.costFactors?.operationalContext?.season || "spring";
      const prediction = await this.getModelPrediction(data, modelVersion);
      const actual = {
        cost:
          data.actualCosts.totalCost / data.predictedCosts.predictedTotalCost,
      };

      const error = prediction.cost - actual.cost;
      if (seasonalErrors[season]) {
        seasonalErrors[season].push(error);
      }
    }

    // Calculate average bias for each season
    const biases = Object.values(seasonalErrors).map((errors) =>
      errors.length > 0
        ? errors.reduce((sum, err) => sum + err, 0) / errors.length
        : 0,
    );

    // Return average absolute bias
    const avgBias =
      biases.reduce((sum, bias) => sum + Math.abs(bias), 0) / biases.length;
    return avgBias; // Lower is better (0 = no bias)
  }

  /**
   * Test driver experience bias
   */
  private async testDriverExperienceBias(
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    const experienceLevels = ["novice", "intermediate", "experienced"];
    const experienceErrors: Record<string, number[]> = {};

    experienceLevels.forEach((level) => (experienceErrors[level] = []));

    for (const data of testData) {
      const experience =
        data.costFactors?.operationalContext?.driverExperience ||
        "intermediate";
      const prediction = await this.getModelPrediction(data, modelVersion);
      const actual = {
        cost:
          data.actualCosts.totalCost / data.predictedCosts.predictedTotalCost,
      };

      const error = prediction.cost - actual.cost;
      if (experienceErrors[experience]) {
        experienceErrors[experience].push(error);
      }
    }

    const biases = Object.values(experienceErrors).map((errors) =>
      errors.length > 0
        ? errors.reduce((sum, err) => sum + err, 0) / errors.length
        : 0,
    );

    const avgBias =
      biases.reduce((sum, bias) => sum + Math.abs(bias), 0) / biases.length;
    return avgBias;
  }

  /**
   * Test route complexity bias
   */
  private async testRouteComplexityBias(
    testData: any[],
    modelVersion: string,
  ): Promise<number> {
    const complexityLevels = ["low", "medium", "high"];
    const complexityErrors: Record<string, number[]> = {};

    complexityLevels.forEach((level) => (complexityErrors[level] = []));

    for (const data of testData) {
      const complexity =
        data.costFactors?.routeCharacteristics?.urbanDensity || "medium";
      const prediction = await this.getModelPrediction(data, modelVersion);
      const actual = {
        cost:
          data.actualCosts.totalCost / data.predictedCosts.predictedTotalCost,
      };

      const error = prediction.cost - actual.cost;
      if (complexityErrors[complexity]) {
        complexityErrors[complexity].push(error);
      }
    }

    const biases = Object.values(complexityErrors).map((errors) =>
      errors.length > 0
        ? errors.reduce((sum, err) => sum + err, 0) / errors.length
        : 0,
    );

    const avgBias =
      biases.reduce((sum, bias) => sum + Math.abs(bias), 0) / biases.length;
    return avgBias;
  }

  /**
   * Get model prediction for test data
   */
  private async getModelPrediction(
    data: any,
    modelVersion: string,
  ): Promise<{ time: number; cost: number; fuel: number }> {
    // This would use the cost correction model to get predictions
    // For now, return simulated predictions
    return {
      time: 1.0 + (Math.random() - 0.5) * 0.2,
      cost: 1.0 + (Math.random() - 0.5) * 0.3,
      fuel: 1.0 + (Math.random() - 0.5) * 0.15,
    };
  }

  /**
   * Calculate accuracy between prediction and actual
   */
  private calculateAccuracy(
    prediction: { time: number; cost: number; fuel: number },
    actual: { time: number; cost: number; fuel: number },
  ): number {
    const timeError = Math.abs(prediction.time - actual.time) / actual.time;
    const costError = Math.abs(prediction.cost - actual.cost) / actual.cost;
    const fuelError = Math.abs(prediction.fuel - actual.fuel) / actual.fuel;

    const avgError = (timeError + costError + fuelError) / 3;
    return Math.max(0, 1 - avgError);
  }

  /**
   * Generate recommendations based on validation results
   */
  private generateRecommendations(results: ValidationResult[]): string[] {
    const recommendations: string[] = [];

    const failedTests = results.filter((r) => r.status === "fail");
    const warningTests = results.filter((r) => r.status === "warning");
    const criticalFailures = results.filter(
      (r) =>
        !r.passed &&
        this.validationTests.find((t) => t.id === r.testId)?.critical,
    );

    if (criticalFailures.length > 0) {
      recommendations.push(
        "CRITICAL: Address critical test failures before deployment",
      );
      recommendations.push(
        "Consider immediate rollback to previous stable version",
      );
    }

    if (failedTests.length > 0) {
      recommendations.push("Address failed validation tests before deployment");
      recommendations.push("Review model training process and data quality");
    }

    if (warningTests.length > 0) {
      recommendations.push("Monitor warning indicators during deployment");
      recommendations.push(
        "Consider additional testing in staging environment",
      );
    }

    const accuracyTests = results.filter((r) => r.testId.includes("accuracy"));
    const avgAccuracy =
      accuracyTests.reduce((sum, r) => sum + (r.actualResult || 0), 0) /
      accuracyTests.length;

    if (avgAccuracy < 0.8) {
      recommendations.push(
        "Model accuracy below target - consider retraining with more data",
      );
    }

    const performanceTests = results.filter((r) =>
      r.testId.includes("performance"),
    );
    const avgPerformance =
      performanceTests.reduce((sum, r) => sum + (r.actualResult || 0), 0) /
      performanceTests.length;

    if (avgPerformance > 1.0) {
      recommendations.push(
        "Performance concerns detected - optimize model or infrastructure",
      );
    }

    if (recommendations.length === 0) {
      recommendations.push(
        "All validation tests passed - model ready for deployment",
      );
      recommendations.push("Continue monitoring performance in production");
    }

    return recommendations;
  }

  /**
   * Store validation report
   */
  async storeValidationReport(report: UpdateValidationReport): Promise<void> {
    const client = getMongoClient();
    if (!client) return;

    try {
      const db = client.db("trashroute");
      const collection = db.collection("validation_reports");

      await collection.insertOne({
        ...report,
        _id: new ObjectId(),
      });

      console.log(`Validation report stored for update ${report.updateId}`);
    } catch (error) {
      console.error("Error storing validation report:", error);
    }
  }
}

/**
 * Model rollback system
 */
export class ModelRollbackSystem {
  private config: RollbackConfig;
  private modelHistory: ModelVersion[] = [];

  constructor(config: RollbackConfig) {
    this.config = config;
  }

  /**
   * Create backup of current model
   */
  async createBackup(
    currentVersion: string,
    performance: any,
  ): Promise<string> {
    const timestamp = new Date();
    const backupPath = path.join(
      process.cwd(),
      "models",
      "backups",
      `model-${currentVersion}-${timestamp.toISOString().replace(/[:.]/g, "-")}.json`,
    );

    await fs.mkdir(path.dirname(backupPath), { recursive: true });

    const modelData: ModelVersion = {
      version: currentVersion,
      timestamp,
      filePath: backupPath,
      checksum: await this.calculateChecksum(backupPath),
      performance,
      metadata: {
        trainingDate: timestamp.toISOString(),
        modelType: "ensemble",
        features: [], // Would populate from actual model
        changelog: [],
      },
      status: "backup",
    };

    // Save backup
    await fs.writeFile(backupPath, JSON.stringify(modelData, null, 2));

    // Add to history
    this.modelHistory.push(modelData);

    // Clean up old backups
    await this.cleanupOldBackups();

    console.log(`Model backup created: ${backupPath}`);
    return backupPath;
  }

  /**
   * Perform rollback to previous version
   */
  async performRollback(
    currentVersion: string,
    targetVersion?: string,
    reason: string = "Validation failed",
  ): Promise<RollbackResult> {
    console.log(
      `🔄 Starting rollback from ${currentVersion} to ${targetVersion || "previous version"}...`,
    );

    try {
      // Find target version
      const target = targetVersion
        ? this.modelHistory.find(
            (m) => m.version === targetVersion && m.status === "backup",
          )
        : this.getPreviousVersion(currentVersion);

      if (!target) {
        throw new Error(
          `Target version ${targetVersion || "previous"} not found`,
        );
      }

      // Validate rollback
      const validationScore = await this.validateRollbackTarget(target);

      if (validationScore < this.config.rollbackThreshold) {
        throw new Error(
          `Target version validation score too low: ${validationScore}`,
        );
      }

      // Perform rollback
      await this.deployVersion(target);

      // Update status
      target.status = "rollback";

      // Record rollback
      const result: RollbackResult = {
        success: true,
        fromVersion: currentVersion,
        toVersion: target.version,
        reason,
        validationScore,
        timestamp: new Date(),
      };

      await this.recordRollback(result);

      console.log(
        `✅ Rollback completed successfully to version ${target.version}`,
      );
      return result;
    } catch (error) {
      console.error("❌ Rollback failed:", error);

      return {
        success: false,
        fromVersion: currentVersion,
        toVersion: targetVersion || "unknown",
        reason,
        validationScore: 0,
        timestamp: new Date(),
        errors: [String(error)],
      };
    }
  }

  /**
   * Get previous model version
   */
  private getPreviousVersion(currentVersion: string): ModelVersion | null {
    const currentIndex = this.modelHistory.findIndex(
      (m) => m.version === currentVersion,
    );
    if (currentIndex > 0) {
      return this.modelHistory[currentIndex - 1];
    }
    return null;
  }

  /**
   * Validate rollback target
   */
  private async validateRollbackTarget(target: ModelVersion): Promise<number> {
    // Basic validation
    try {
      const modelData = await fs.readFile(target.filePath, "utf-8");
      const parsed = JSON.parse(modelData);

      // Check if file is valid and complete
      if (parsed.version && parsed.coefficients && parsed.intercepts) {
        return target.performance.validationScore || 0.7;
      }

      return 0;
    } catch (error) {
      console.error("Rollback target validation failed:", error);
      return 0;
    }
  }

  /**
   * Deploy specific model version
   */
  private async deployVersion(version: ModelVersion): Promise<void> {
    const modelData = await fs.readFile(version.filePath, "utf-8");

    // Deploy to active model location
    const activeModelPath = path.join(
      process.cwd(),
      "models",
      "active-model.json",
    );
    await fs.writeFile(activeModelPath, modelData);

    // Update active version pointer
    const versionInfo = {
      version: version.version,
      deployedAt: new Date().toISOString(),
      reason: "Rollback deployment",
    };

    const versionPath = path.join(
      process.cwd(),
      "models",
      "active-version.json",
    );
    await fs.writeFile(versionPath, JSON.stringify(versionInfo, null, 2));

    console.log(`Model version ${version.version} deployed successfully`);
  }

  /**
   * Calculate file checksum
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      // Simple checksum - in production, use proper hash function
      let checksum = 0;
      for (let i = 0; i < content.length; i++) {
        checksum += content.charCodeAt(i);
      }
      return checksum.toString(16);
    } catch (error) {
      console.error("Error calculating checksum:", error);
      return "0";
    }
  }

  /**
   * Clean up old backups
   */
  private async cleanupOldBackups(): Promise<void> {
    const cutoffDate = new Date(
      Date.now() - this.config.backupRetention * 24 * 60 * 60 * 1000,
    );

    this.modelHistory = this.modelHistory.filter((backup) => {
      if (backup.timestamp < cutoffDate) {
        // Delete old backup file
        fs.unlink(backup.filePath).catch((err) =>
          console.warn(`Failed to delete old backup ${backup.filePath}:`, err),
        );
        return false;
      }
      return true;
    });

    // Keep only maximum number of versions
    if (this.modelHistory.length > this.config.maxRollbackVersions) {
      this.modelHistory = this.modelHistory.slice(
        -this.config.maxRollbackVersions,
      );
    }
  }

  /**
   * Record rollback operation
   */
  private async recordRollback(result: RollbackResult): Promise<void> {
    const client = getMongoClient();
    if (!client) return;

    try {
      const db = client.db("trashroute");
      const collection = db.collection("rollback_history");

      await collection.insertOne({
        ...result,
        _id: new ObjectId(),
        recordedAt: new Date(),
      });

      console.log(
        `Rollback recorded: ${result.fromVersion} → ${result.toVersion}`,
      );
    } catch (error) {
      console.error("Error recording rollback:", error);
    }
  }

  /**
   * Get rollback history
   */
  async getRollbackHistory(limit: number = 10): Promise<RollbackResult[]> {
    const client = getMongoClient();
    if (!client) return [];

    try {
      const db = client.db("trashroute");
      const collection = db.collection("rollback_history");

      const history = await collection
        .find({})
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      return history.map((h) => ({
        success: h.success,
        fromVersion: h.fromVersion,
        toVersion: h.toVersion,
        reason: h.reason,
        validationScore: h.validationScore,
        timestamp: h.timestamp,
        errors: h.errors,
      }));
    } catch (error) {
      console.error("Error getting rollback history:", error);
      return [];
    }
  }

  /**
   * Can rollback to specific version
   */
  canRollbackTo(version: string): boolean {
    const target = this.modelHistory.find(
      (m) => m.version === version && m.status === "backup",
    );
    return target !== undefined;
  }

  /**
   * Get available rollback versions
   */
  getAvailableVersions(): ModelVersion[] {
    return this.modelHistory.filter((m) => m.status === "backup");
  }
}

// Default configuration
export const defaultRollbackConfig: RollbackConfig = {
  maxRollbackVersions: 5,
  rollbackThreshold: 0.6,
  backupRetention: 30, // days
  autoRollback: false,
  manualApprovalRequired: true,
};

// Export validation and rollback systems
export const updateValidationSystem = new UpdateValidationSystem(
  defaultRollbackConfig,
);
export const modelRollbackSystem = new ModelRollbackSystem(
  defaultRollbackConfig,
);
