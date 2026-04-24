/**
 * Cost Data Collection Pipeline
 * Automatically collects and processes cost data for daily model updates
 */

import { getMongoClient } from "@/server/mongodb";
import { costPredictionService } from "@/services/costPredictionService";
import { ObjectId } from "mongodb";
import * as fs from "fs/promises";
import * as path from "path";

export interface CostDataCollectionConfig {
  collectionInterval: number; // minutes
  minDataQuality: number;
  maxCollectionAge: number; // days
  batchSize: number;
  retryAttempts: number;
  validationEnabled: boolean;
}

export interface RawCostData {
  routeId: string;
  timestamp: Date;
  routeStatistics: any;
  predictedCosts: any;
  actualCosts: {
    actualTime: number;
    actualFuelConsumption: number;
    totalCost: number;
    laborCosts?: number;
    fuelCosts?: number;
    maintenanceCosts?: number;
    stopsCompleted?: number;
    customerComplaints?: number;
    safetyIncidents?: number;
  };
  operationalContext: any;
  weatherData?: any;
  dataSource: "manual" | "automatic" | "import";
  dataQuality: number;
  validationStatus: "pending" | "validated" | "rejected";
}

export interface ProcessedCostData {
  routeId: string;
  timestamp: Date;
  features: {
    routeDistance: number;
    estimatedTime: number;
    turnComplexity: number;
    weatherSeverity: number;
    temperature: number;
    precipitation: number;
    windSpeed: number;
    visibility: number;
    driverExperience: number;
    timeOfDay: number;
    dayOfWeek: number;
    season: number;
    urbanDensity: number;
    roadConditions: number;
  };
  targets: {
    timeCorrection: number;
    costCorrection: number;
    fuelCorrection: number;
    actualCostPerKm: number;
    actualTimePerKm: number;
    actualFuelPerKm: number;
  };
  metadata: {
    dataQuality: number;
    validationScore: number;
    dataSource: string;
    processingTimestamp: Date;
  };
}

export interface CollectionMetrics {
  totalCollected: number;
  validated: number;
  rejected: number;
  averageQuality: number;
  sources: Record<string, number>;
  timeRange: {
    oldest: Date;
    newest: Date;
  };
}

/**
 * Automated cost data collector
 */
export class CostDataCollector {
  private config: CostDataCollectionConfig;
  private isCollecting: boolean = false;
  private collectionInterval?: NodeJS.Timeout;
  private metrics: CollectionMetrics = {
    totalCollected: 0,
    validated: 0,
    rejected: 0,
    averageQuality: 0,
    sources: {},
    timeRange: {
      oldest: new Date(),
      newest: new Date(),
    },
  };

  constructor(config: CostDataCollectionConfig) {
    this.config = config;
  }

  /**
   * Start automated data collection
   */
  async startCollection(): Promise<void> {
    if (this.isCollecting) {
      console.log("⚠️  Data collection already running");
      return;
    }

    console.log("🚀 Starting automated cost data collection");
    this.isCollecting = true;

    // Initial collection
    await this.collectBatch();

    // Schedule periodic collection
    this.collectionInterval = setInterval(
      async () => {
        await this.collectBatch();
      },
      this.config.collectionInterval * 60 * 1000,
    );

    console.log(
      `✅ Data collection started with ${this.config.collectionInterval} minute intervals`,
    );
  }

  /**
   * Stop automated data collection
   */
  stopCollection(): void {
    if (!this.isCollecting) {
      console.log("⚠️  Data collection not running");
      return;
    }

    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = undefined;
    }

    this.isCollecting = false;
    console.log("🛑 Data collection stopped");
  }

  /**
   * Collect a batch of cost data
   */
  private async collectBatch(): Promise<void> {
    console.log("\n📊 Starting batch data collection...");
    const startTime = Date.now();

    try {
      // Collect from multiple sources
      const sources = [
        this.collectFromRouteHistory(),
        this.collectFromLiveTracking(),
        this.collectFromManualEntries(),
        this.collectFromExternalSystems(),
      ];

      const results = await Promise.allSettled(sources);

      let totalCollected = 0;
      let totalValidated = 0;
      let totalRejected = 0;
      const sourceCounts: Record<string, number> = {};

      // Process results from each source
      results.forEach((result, index) => {
        const sourceName = [
          "route_history",
          "live_tracking",
          "manual_entries",
          "external_systems",
        ][index];

        if (result.status === "fulfilled") {
          const { collected, validated, rejected } = result.value;
          totalCollected += collected;
          totalValidated += validated;
          totalRejected += rejected;
          sourceCounts[sourceName] = collected;

          console.log(
            `   ✅ ${sourceName}: ${collected} collected, ${validated} validated, ${rejected} rejected`,
          );
        } else {
          console.log(`   ❌ ${sourceName}: ${result.reason}`);
          sourceCounts[sourceName] = 0;
        }
      });

      // Update metrics
      this.updateMetrics(
        totalCollected,
        totalValidated,
        totalRejected,
        sourceCounts,
      );

      const duration = (Date.now() - startTime) / 1000;
      console.log(`✅ Batch collection completed in ${duration.toFixed(2)}s`);
      console.log(
        `   Total: ${totalCollected} collected, ${totalValidated} validated, ${totalRejected} rejected`,
      );
    } catch (error) {
      console.error("❌ Batch collection failed:", error);
    }
  }

  /**
   * Collect data from route history
   */
  private async collectFromRouteHistory(): Promise<{
    collected: number;
    validated: number;
    rejected: number;
  }> {
    const client = getMongoClient();
    if (!client) {
      throw new Error("MongoDB not configured");
    }

    const db = client.db("trashroute");
    const routeHistory = db.collection("route_history");

    // Get recent routes that haven't been processed for cost data
    const since = new Date(
      Date.now() - this.config.maxCollectionAge * 24 * 60 * 60 * 1000,
    );

    const cursor = routeHistory
      .find({
        timestamp: { $gte: since },
        "costCorrections.accuracyScore": { $gte: this.config.minDataQuality },
        "actualCosts.totalCost": { $exists: true, $gt: 0 },
        "metadata.costDataProcessed": { $ne: true },
      })
      .limit(this.config.batchSize);

    let collected = 0;
    let validated = 0;
    let rejected = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) continue;

      try {
        // Process the route data
        const processed = await this.processRouteHistoryData(doc);

        if (processed) {
          // Store processed data
          await this.storeProcessedData(processed);

          // Mark as processed
          await routeHistory.updateOne(
            { _id: doc._id },
            { $set: { "metadata.costDataProcessed": true } },
          );

          collected++;

          if (processed.metadata.validationScore >= 0.8) {
            validated++;
          } else {
            rejected++;
          }
        }
      } catch (error) {
        console.error(`Error processing route ${doc.routeId}:`, error);
        rejected++;
      }
    }

    return { collected, validated, rejected };
  }

  /**
   * Collect data from live tracking systems
   */
  private async collectFromLiveTracking(): Promise<{
    collected: number;
    validated: number;
    rejected: number;
  }> {
    // This would integrate with real-time tracking systems
    console.log("   📡 Collecting from live tracking systems...");

    // Simulate collecting live data
    const liveData = await this.simulateLiveTrackingData();

    let collected = 0;
    let validated = 0;
    let rejected = 0;

    for (const data of liveData) {
      try {
        // Validate live data
        if (this.validateLiveData(data)) {
          await this.storeRawData(data);
          collected++;

          // Process if quality is good
          const quality = this.calculateDataQuality(data);
          if (quality >= this.config.minDataQuality) {
            const processed = await this.processRawData(data);
            if (processed) {
              await this.storeProcessedData(processed);
              validated++;
            } else {
              rejected++;
            }
          } else {
            rejected++;
          }
        } else {
          rejected++;
        }
      } catch (error) {
        console.error("Error processing live data:", error);
        rejected++;
      }
    }

    return { collected, validated, rejected };
  }

  /**
   * Collect manual entries from operators
   */
  private async collectFromManualEntries(): Promise<{
    collected: number;
    validated: number;
    rejected: number;
  }> {
    const client = getMongoClient();
    if (!client) {
      throw new Error("MongoDB not configured");
    }

    const db = client.db("trashroute");
    const manualEntries = db.collection("manual_cost_entries");

    // Get pending manual entries
    const since = new Date(
      Date.now() - this.config.maxCollectionAge * 24 * 60 * 60 * 1000,
    );

    const entries = await manualEntries
      .find({
        timestamp: { $gte: since },
        status: "pending",
        "validation.basic": { $ne: false },
      })
      .limit(this.config.batchSize)
      .toArray();

    let collected = 0;
    let validated = 0;
    let rejected = 0;

    for (const entry of entries) {
      try {
        // Validate manual entry
        if (this.validateManualEntry(entry)) {
          // Process the entry
          const processed = await this.processManualEntry(entry);

          if (processed) {
            await this.storeProcessedData(processed);

            // Mark as processed
            await manualEntries.updateOne(
              { _id: entry._id },
              { $set: { status: "processed", processedAt: new Date() } },
            );

            collected++;

            if (processed.metadata.validationScore >= 0.8) {
              validated++;
            } else {
              rejected++;
            }
          } else {
            rejected++;
          }
        } else {
          rejected++;
          await manualEntries.updateOne(
            { _id: entry._id },
            { $set: { status: "rejected", rejectedAt: new Date() } },
          );
        }
      } catch (error) {
        console.error(`Error processing manual entry ${entry._id}:`, error);
        rejected++;
      }
    }

    return { collected, validated, rejected };
  }

  /**
   * Collect from external systems (fuel cards, GPS, etc.)
   */
  private async collectFromExternalSystems(): Promise<{
    collected: number;
    validated: number;
    rejected: number;
  }> {
    console.log("   🔗 Collecting from external systems...");

    // This would integrate with external APIs
    // For demo, we'll simulate some external data
    const externalData = await this.simulateExternalData();

    let collected = 0;
    let validated = 0;
    let rejected = 0;

    for (const data of externalData) {
      try {
        // Validate and process external data
        const processed = await this.processExternalData(data);

        if (processed) {
          await this.storeProcessedData(processed);
          collected++;

          if (processed.metadata.validationScore >= 0.8) {
            validated++;
          } else {
            rejected++;
          }
        } else {
          rejected++;
        }
      } catch (error) {
        console.error("Error processing external data:", error);
        rejected++;
      }
    }

    return { collected, validated, rejected };
  }

  /**
   * Process route history data
   */
  private async processRouteHistoryData(
    doc: any,
  ): Promise<ProcessedCostData | null> {
    try {
      // Calculate features
      const routeStats = doc.routeStatistics;
      const weather = doc.costFactors?.weatherConditions || {};
      const operational = doc.costFactors?.operationalContext || {};
      const routeChars = doc.costFactors?.routeCharacteristics || {};

      const totalTurns = Math.max(
        1,
        routeStats.turns.leftTurns +
          routeStats.turns.rightTurns +
          routeStats.turns.uTurns +
          routeStats.turns.straightAhead,
      );

      const features = {
        routeDistance: routeStats.totalDistance,
        estimatedTime: routeStats.estimatedTime,
        turnComplexity:
          (routeStats.turns.leftTurns * 2 + routeStats.turns.uTurns * 3) /
          totalTurns,
        weatherSeverity: weather.severity || 0,
        temperature: weather.temperature || 15,
        precipitation: weather.precipitation || 0,
        windSpeed: weather.windSpeed || 0,
        visibility: weather.visibility || 10000,
        driverExperience: this.encodeDriverExperience(
          operational.driverExperience,
        ),
        timeOfDay: this.encodeTimeOfDay(operational.timeOfDay),
        dayOfWeek: operational.dayOfWeek || 1,
        season: this.encodeSeason(operational.season),
        urbanDensity: this.encodeRouteComplexity(routeChars.urbanDensity),
        roadConditions: this.encodeRoadConditions(routeChars.roadConditions),
      };

      // Calculate targets (correction factors)
      const targets = {
        timeCorrection: doc.costCorrections.timeCorrectionFactor,
        costCorrection: doc.costCorrections.costCorrectionFactor,
        fuelCorrection: doc.costCorrections.fuelCorrectionFactor,
        actualCostPerKm: doc.actualCosts.totalCost / routeStats.totalDistance,
        actualTimePerKm: doc.actualCosts.actualTime / routeStats.totalDistance,
        actualFuelPerKm:
          doc.actualCosts.actualFuelConsumption / routeStats.totalDistance,
      };

      // Calculate data quality
      const dataQuality = this.calculateDataQuality({
        hasAllFields: true,
        accuracyScore: doc.costCorrections.accuracyScore,
        reasonableValues: this.validateReasonableValues(targets, features),
        dataCompleteness: this.calculateCompleteness(doc),
      });

      return {
        routeId: doc.routeId,
        timestamp: doc.timestamp,
        features,
        targets,
        metadata: {
          dataQuality,
          validationScore: doc.costCorrections.accuracyScore,
          dataSource: "route_history",
          processingTimestamp: new Date(),
        },
      };
    } catch (error) {
      console.error("Error processing route history data:", error);
      return null;
    }
  }

  /**
   * Store processed data
   */
  private async storeProcessedData(data: ProcessedCostData): Promise<void> {
    const client = getMongoClient();
    if (!client) {
      throw new Error("MongoDB not configured");
    }

    const db = client.db("trashroute");
    const processedData = db.collection("processed_cost_data");

    await processedData.insertOne({
      ...data,
      _id: new ObjectId(),
      createdAt: new Date(),
    });
  }

  /**
   * Store raw data
   */
  private async storeRawData(data: RawCostData): Promise<void> {
    const client = getMongoClient();
    if (!client) {
      throw new Error("MongoDB not configured");
    }

    const db = client.db("trashroute");
    const rawData = db.collection("raw_cost_data");

    await rawData.insertOne({
      ...data,
      _id: new ObjectId(),
      createdAt: new Date(),
    });
  }

  /**
   * Update collection metrics
   */
  private updateMetrics(
    collected: number,
    validated: number,
    rejected: number,
    sourceCounts: Record<string, number>,
  ): void {
    this.metrics.totalCollected += collected;
    this.metrics.validated += validated;
    this.metrics.rejected += rejected;

    // Update source counts
    Object.entries(sourceCounts).forEach(([source, count]) => {
      this.metrics.sources[source] =
        (this.metrics.sources[source] || 0) + count;
    });

    // Update average quality
    const totalProcessed = this.metrics.validated + this.metrics.rejected;
    if (totalProcessed > 0) {
      this.metrics.averageQuality = this.metrics.validated / totalProcessed;
    }
  }

  /**
   * Get collection metrics
   */
  getMetrics(): CollectionMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalCollected: 0,
      validated: 0,
      rejected: 0,
      averageQuality: 0,
      sources: {},
      timeRange: {
        oldest: new Date(),
        newest: new Date(),
      },
    };
  }

  /**
   * Validate data quality
   */
  private validateLiveData(data: any): boolean {
    // Basic validation for live data
    return (
      data &&
      data.actualTime > 0 &&
      data.actualFuelConsumption >= 0 &&
      data.totalCost > 0 &&
      data.routeId
    );
  }

  private validateManualEntry(entry: any): boolean {
    // Validation for manual entries
    return (
      entry &&
      entry.routeStatistics &&
      entry.actualCosts &&
      entry.actualCosts.totalCost > 0 &&
      entry.actualCosts.actualTime > 0
    );
  }

  private validateReasonableValues(targets: any, features: any): boolean {
    // Check if values are reasonable
    return (
      targets.actualCostPerKm > 0 &&
      targets.actualCostPerKm < 50 && // Max $50/km
      targets.actualTimePerKm > 0 &&
      targets.actualTimePerKm < 60 && // Max 60min/km
      targets.actualFuelPerKm > 0 &&
      targets.actualFuelPerKm < 5
    ); // Max 5L/km
  }

  private calculateCompleteness(doc: any): number {
    // Calculate data completeness score
    let score = 0;
    let total = 0;

    // Check required fields
    const requiredFields = [
      "routeStatistics.totalDistance",
      "routeStatistics.estimatedTime",
      "actualCosts.totalCost",
      "actualCosts.actualTime",
      "costFactors.operationalContext",
    ];

    requiredFields.forEach((field) => {
      total++;
      if (this.getNestedValue(doc, field)) score++;
    });

    return total > 0 ? score / total : 0;
  }

  private calculateDataQuality(qualityFactors: any): number {
    // Calculate overall data quality score
    let score = 0;
    let weights = 0;

    if (qualityFactors.hasAllFields) {
      score += 0.3;
      weights += 0.3;
    }

    if (qualityFactors.accuracyScore) {
      score += qualityFactors.accuracyScore * 0.4;
      weights += 0.4;
    }

    if (qualityFactors.reasonableValues) {
      score += 0.2;
      weights += 0.2;
    }

    if (qualityFactors.dataCompleteness) {
      score += qualityFactors.dataCompleteness * 0.1;
      weights += 0.1;
    }

    return weights > 0 ? score / weights : 0;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }

  // Helper methods for data simulation
  private async simulateLiveTrackingData(): Promise<any[]> {
    // Simulate live tracking data
    return [
      {
        routeId: "live_001",
        timestamp: new Date(),
        actualTime: 82,
        actualFuelConsumption: 4.1,
        totalCost: 162.5,
        predictedCosts: {
          predictedTime: 85,
          predictedTotalCost: 165.5,
          predictedFuelConsumption: 4.2,
        },
      },
      {
        routeId: "live_002",
        timestamp: new Date(),
        actualTime: 95,
        actualFuelConsumption: 4.8,
        totalCost: 188.75,
        predictedCosts: {
          predictedTime: 92,
          predictedTotalCost: 178.25,
          predictedFuelConsumption: 4.8,
        },
      },
    ];
  }

  private async simulateExternalData(): Promise<any[]> {
    // Simulate external system data
    return [
      {
        routeId: "external_001",
        timestamp: new Date(),
        fuelCardData: {
          liters: 4.3,
          cost: 6.45,
          station: "Station A",
        },
        gpsData: {
          distance: 12.8,
          duration: 88,
        },
      },
    ];
  }

  // Processing methods for different data types
  private async processRawData(
    data: RawCostData,
  ): Promise<ProcessedCostData | null> {
    // Convert raw data to processed format
    try {
      const quality = this.calculateDataQuality({
        hasAllFields: true,
        accuracyScore: 0.8, // Assume good quality for demo
        reasonableValues: true,
        dataCompleteness: 0.9,
      });

      return {
        routeId: data.routeId,
        timestamp: data.timestamp,
        features: {
          routeDistance: data.routeStatistics?.totalDistance || 10,
          estimatedTime: data.routeStatistics?.estimatedTime || 80,
          turnComplexity: 0.5,
          weatherSeverity: 0.2,
          temperature: 15,
          precipitation: 0,
          windSpeed: 5,
          visibility: 10000,
          driverExperience: 1,
          timeOfDay: 1,
          dayOfWeek: 3,
          season: 0,
          urbanDensity: 1,
          roadConditions: 0,
        },
        targets: {
          timeCorrection:
            data.actualCosts.actualTime /
            (data.predictedCosts?.predictedTime || 80),
          costCorrection:
            data.actualCosts.totalCost /
            (data.predictedCosts?.predictedTotalCost || 160),
          fuelCorrection:
            data.actualCosts.actualFuelConsumption /
            (data.predictedCosts?.predictedFuelConsumption || 4),
          actualCostPerKm:
            data.actualCosts.totalCost /
            (data.routeStatistics?.totalDistance || 10),
          actualTimePerKm:
            data.actualCosts.actualTime /
            (data.routeStatistics?.totalDistance || 10),
          actualFuelPerKm:
            data.actualCosts.actualFuelConsumption /
            (data.routeStatistics?.totalDistance || 10),
        },
        metadata: {
          dataQuality: quality,
          validationScore: 0.8,
          dataSource: data.dataSource,
          processingTimestamp: new Date(),
        },
      };
    } catch (error) {
      console.error("Error processing raw data:", error);
      return null;
    }
  }

  private async processManualEntry(
    entry: any,
  ): Promise<ProcessedCostData | null> {
    // Process manual entry data
    try {
      const routeStats = entry.routeStatistics;
      const actualCosts = entry.actualCosts;

      const quality = this.calculateDataQuality({
        hasAllFields: true,
        accuracyScore: entry.qualityScore || 0.8,
        reasonableValues: this.validateReasonableValues(
          {
            actualCostPerKm: actualCosts.totalCost / routeStats.totalDistance,
            actualTimePerKm: actualCosts.actualTime / routeStats.totalDistance,
            actualFuelPerKm:
              actualCosts.actualFuelConsumption / routeStats.totalDistance,
          },
          {},
        ),
        dataCompleteness: 0.95,
      });

      return {
        routeId: entry.routeId,
        timestamp: entry.timestamp,
        features: {
          routeDistance: routeStats.totalDistance,
          estimatedTime: routeStats.estimatedTime,
          turnComplexity: 0.6,
          weatherSeverity: 0.3,
          temperature: 18,
          precipitation: 0,
          windSpeed: 4,
          visibility: 9000,
          driverExperience: this.encodeDriverExperience(entry.driverExperience),
          timeOfDay: this.encodeTimeOfDay(entry.timeOfDay),
          dayOfWeek: entry.dayOfWeek || 1,
          season: this.encodeSeason(entry.season),
          urbanDensity: this.encodeRouteComplexity(entry.urbanDensity),
          roadConditions: this.encodeRoadConditions(entry.roadConditions),
        },
        targets: {
          timeCorrection: actualCosts.actualTime / routeStats.estimatedTime,
          costCorrection:
            actualCosts.totalCost /
            (entry.predictedCost || routeStats.estimatedTime * 2),
          fuelCorrection:
            actualCosts.actualFuelConsumption / (entry.predictedFuel || 4),
          actualCostPerKm: actualCosts.totalCost / routeStats.totalDistance,
          actualTimePerKm: actualCosts.actualTime / routeStats.totalDistance,
          actualFuelPerKm:
            actualCosts.actualFuelConsumption / routeStats.totalDistance,
        },
        metadata: {
          dataQuality: quality,
          validationScore: entry.qualityScore || 0.8,
          dataSource: "manual_entry",
          processingTimestamp: new Date(),
        },
      };
    } catch (error) {
      console.error("Error processing manual entry:", error);
      return null;
    }
  }

  private async processExternalData(
    data: any,
  ): Promise<ProcessedCostData | null> {
    // Process external system data
    try {
      // Combine external data sources
      const combinedData = {
        distance: data.gpsData?.distance || 10,
        duration: data.gpsData?.duration || 80,
        fuelLiters: data.fuelCardData?.liters || 4,
        fuelCost: data.fuelCardData?.cost || 6,
      };

      const quality = this.calculateDataQuality({
        hasAllFields: true,
        accuracyScore: 0.75,
        reasonableValues: true,
        dataCompleteness: 0.8,
      });

      return {
        routeId: data.routeId,
        timestamp: data.timestamp,
        features: {
          routeDistance: combinedData.distance,
          estimatedTime: combinedData.duration,
          turnComplexity: 0.4,
          weatherSeverity: 0.1,
          temperature: 16,
          precipitation: 0,
          windSpeed: 3,
          visibility: 9500,
          driverExperience: 1,
          timeOfDay: 1,
          dayOfWeek: 2,
          season: 0,
          urbanDensity: 1,
          roadConditions: 0,
        },
        targets: {
          timeCorrection: 1.0, // No prediction to compare against
          costCorrection: 1.0,
          fuelCorrection: 1.0,
          actualCostPerKm:
            (combinedData.fuelCost + combinedData.duration * 1.5) /
            combinedData.distance,
          actualTimePerKm: combinedData.duration / combinedData.distance,
          actualFuelPerKm: combinedData.fuelLiters / combinedData.distance,
        },
        metadata: {
          dataQuality: quality,
          validationScore: 0.75,
          dataSource: "external_systems",
          processingTimestamp: new Date(),
        },
      };
    } catch (error) {
      console.error("Error processing external data:", error);
      return null;
    }
  }

  // Encoding helper methods
  private encodeDriverExperience(experience?: string): number {
    const mapping: { [key: string]: number } = {
      novice: 0,
      intermediate: 1,
      experienced: 2,
    };
    return experience ? (mapping[experience] ?? 1) : 1;
  }

  private encodeTimeOfDay(timeOfDay?: string): number {
    const mapping: { [key: string]: number } = {
      early_morning: 0,
      morning: 1,
      afternoon: 2,
      evening: 3,
    };
    return timeOfDay ? (mapping[timeOfDay] ?? 1) : 1;
  }

  private encodeSeason(season?: string): number {
    const mapping: { [key: string]: number } = {
      spring: 0,
      summer: 1,
      fall: 2,
      winter: 3,
    };
    return season ? (mapping[season] ?? 1) : 1;
  }

  private encodeRouteComplexity(complexity?: string): number {
    const mapping: { [key: string]: number } = {
      low: 0,
      medium: 1,
      high: 2,
    };
    return complexity ? (mapping[complexity] ?? 1) : 1;
  }

  private encodeRoadConditions(conditions?: string): number {
    const mapping: { [key: string]: number } = {
      good: 0,
      fair: 1,
      poor: 2,
    };
    return conditions ? (mapping[conditions] ?? 1) : 1;
  }
}

/**
 * Cost data validator
 */
export class CostDataValidator {
  /**
   * Validate processed cost data
   */
  static validateProcessedData(data: ProcessedCostData): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check required fields
    if (!data.routeId) errors.push("Missing routeId");
    if (!data.timestamp) errors.push("Missing timestamp");
    if (!data.features) errors.push("Missing features");
    if (!data.targets) errors.push("Missing targets");

    // Validate features
    if (data.features) {
      const requiredFeatures = [
        "routeDistance",
        "estimatedTime",
        "turnComplexity",
        "weatherSeverity",
        "temperature",
        "precipitation",
        "windSpeed",
        "visibility",
        "driverExperience",
        "timeOfDay",
        "dayOfWeek",
        "season",
      ];

      requiredFeatures.forEach((feature) => {
        if (
          data.features[feature as keyof typeof data.features] === undefined
        ) {
          errors.push(`Missing feature: ${feature}`);
        }
      });
    }

    // Validate targets
    if (data.targets) {
      const requiredTargets = [
        "timeCorrection",
        "costCorrection",
        "fuelCorrection",
        "actualCostPerKm",
        "actualTimePerKm",
        "actualFuelPerKm",
      ];

      requiredTargets.forEach((target) => {
        if (data.targets[target as keyof typeof data.targets] === undefined) {
          errors.push(`Missing target: ${target}`);
        }
      });
    }

    // Validate ranges
    if (data.targets) {
      if (data.targets.timeCorrection <= 0 || data.targets.timeCorrection > 5) {
        errors.push("Invalid time correction factor");
      }
      if (data.targets.costCorrection <= 0 || data.targets.costCorrection > 5) {
        errors.push("Invalid cost correction factor");
      }
      if (data.targets.fuelCorrection <= 0 || data.targets.fuelCorrection > 5) {
        errors.push("Invalid fuel correction factor");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Detect outliers in cost data
   */
  static detectOutliers(data: ProcessedCostData[]): ProcessedCostData[] {
    if (data.length < 10) return []; // Need sufficient data

    // Calculate statistics for each target
    const targets = ["timeCorrection", "costCorrection", "fuelCorrection"];
    const outliers: ProcessedCostData[] = [];

    targets.forEach((target) => {
      const values = data.map(
        (d) => d.targets[target as keyof typeof d.targets],
      );
      const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
      const std = Math.sqrt(
        values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
          values.length,
      );

      // Use 2.5 standard deviations for outlier detection
      const threshold = 2.5 * std;

      data.forEach((item) => {
        const value = item.targets[target as keyof typeof item.targets];
        if (Math.abs(value - mean) > threshold) {
          if (!outliers.includes(item)) {
            outliers.push(item);
          }
        }
      });
    });

    return outliers;
  }
}

// Export singleton instance
export const costDataCollector = new CostDataCollector({
  collectionInterval: 60, // 1 hour
  minDataQuality: 0.7,
  maxCollectionAge: 7, // days
  batchSize: 100,
  retryAttempts: 3,
  validationEnabled: true,
});
