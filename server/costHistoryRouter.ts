/**
 * Cost History Data Collection and Management
 * Stores historical cost data for cost correction model training
 */

import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { getMongoClient } from "./mongodb";
import { ObjectId } from "mongodb";

// Cost history entry schema
const CostHistoryEntrySchema = z.object({
  routeId: z.string(),
  timestamp: z.date(),
  routeStatistics: z.object({
    totalDistance: z.number(), // kilometers
    estimatedTime: z.number(), // minutes
    segmentsRouted: z.number(),
    segmentsExcluded: z.number(),
    turns: z.object({
      leftTurns: z.number(),
      rightTurns: z.number(),
      uTurns: z.number(),
      straightAhead: z.number(),
    }),
  }),
  predictedCosts: z.object({
    predictedTime: z.number(),
    predictedFuelConsumption: z.number(),
    predictedTotalCost: z.number(),
    confidenceScore: z.number(),
    costBreakdown: z.object({
      fuel: z.number(),
      labor: z.number(),
      maintenance: z.number(),
      overhead: z.number(),
    }),
  }),
  actualCosts: z.object({
    actualTime: z.number(), // minutes
    actualFuelConsumption: z.number(), // liters
    totalCost: z.number(), // dollars
    laborCosts: z.number(), // dollars
    fuelCosts: z.number(), // dollars
    maintenanceCosts: z.number(), // dollars
    stopsCompleted: z.number(),
    customerComplaints: z.number().default(0),
    safetyIncidents: z.number().default(0),
  }),
  costFactors: z.object({
    weatherConditions: z
      .object({
        temperature: z.number().optional(),
        precipitation: z.number().optional(),
        windSpeed: z.number().optional(),
        visibility: z.number().optional(),
        condition: z.string().optional(),
        severity: z.number().min(0).max(1).optional(),
      })
      .optional(),
    operationalContext: z.object({
      vehicleType: z.string().default("municipal waste collection truck"),
      driverExperience: z
        .enum(["novice", "intermediate", "experienced"])
        .optional(),
      timeOfDay: z
        .enum(["early_morning", "morning", "afternoon", "evening"])
        .optional(),
      dayOfWeek: z.number().min(0).max(6).optional(),
      season: z.enum(["spring", "summer", "fall", "winter"]).optional(),
    }),
    routeCharacteristics: z.object({
      turnComplexity: z.number(),
      segmentComplexity: z.number(),
      urbanDensity: z.enum(["low", "medium", "high"]).optional(),
      roadConditions: z.enum(["good", "fair", "poor"]).optional(),
    }),
  }),
  costCorrections: z.object({
    timeCorrectionFactor: z.number(), // actual / predicted
    costCorrectionFactor: z.number(), // actual / predicted
    fuelCorrectionFactor: z.number(), // actual / predicted
    accuracyScore: z.number().min(0).max(1),
    primaryErrorSources: z.array(z.string()).optional(),
  }),
  metadata: z.object({
    modelVersion: z.string().default("1.0"),
    source: z.enum(["manual_entry", "automatic_tracking", "import"]),
    createdBy: z.string().optional(),
    routeDate: z.date(), // When the route was actually driven
  }),
});

export type CostHistoryEntry = z.infer<typeof CostHistoryEntrySchema>;

export const costHistoryRouter = router({
  /** Store a new cost history entry */
  store: publicProcedure
    .input(CostHistoryEntrySchema)
    .mutation(async ({ input }) => {
      const client = getMongoClient();
      if (!client) {
        return { success: false, error: "MongoDB not configured" };
      }

      try {
        const db = client.db("trashroute");
        const collection = db.collection("cost_history");

        // Calculate correction factors
        const costCorrections = {
          timeCorrectionFactor:
            input.predictedCosts.predictedTime !== 0
              ? input.actualCosts.actualTime /
                input.predictedCosts.predictedTime
              : 1,
          costCorrectionFactor:
            input.predictedCosts.predictedTotalCost !== 0
              ? input.actualCosts.totalCost /
                input.predictedCosts.predictedTotalCost
              : 1,
          fuelCorrectionFactor:
            input.predictedCosts.predictedFuelConsumption !== 0
              ? input.actualCosts.actualFuelConsumption /
                input.predictedCosts.predictedFuelConsumption
              : 1,
          accuracyScore:
            input.predictedCosts.predictedTotalCost !== 0
              ? Math.max(
                  0,
                  1 -
                    Math.abs(
                      input.actualCosts.totalCost -
                        input.predictedCosts.predictedTotalCost,
                    ) /
                      input.predictedCosts.predictedTotalCost,
                )
              : 0,
          primaryErrorSources: identifyPrimaryErrorSources(
            input.predictedCosts,
            input.actualCosts,
            input.costFactors,
          ),
        };

        const result = await collection.insertOne({
          ...input,
          costCorrections,
          _id: new ObjectId(),
          createdAt: new Date(),
        });

        return {
          success: true,
          id: result.insertedId.toString(),
          costCorrections,
          message: "Cost history entry stored successfully",
        };
      } catch (error) {
        console.error("[CostHistory] Store failed:", error);
        return { success: false, error: String(error) };
      }
    }),

  /** Get cost history for model training */
  getTrainingData: publicProcedure
    .input(
      z.object({
        limit: z.number().min(50).max(5000).default(1000),
        minAccuracyScore: z.number().min(0).max(1).optional(), // Filter by prediction accuracy
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        vehicleTypes: z.array(z.string()).optional(),
        weatherConditions: z
          .array(z.enum(["clear", "rain", "snow", "fog"]))
          .optional(),
        routeComplexity: z.enum(["low", "medium", "high"]).optional(),
      }),
    )
    .query(async ({ input }) => {
      const client = getMongoClient();
      if (!client) {
        return { entries: [], total: 0, error: "MongoDB not configured" };
      }

      try {
        const db = client.db("trashroute");
        const collection = db.collection("cost_history");

        // Build query filter
        const filter: any = {};

        if (input.startDate || input.endDate) {
          filter["metadata.routeDate"] = {};
          if (input.startDate)
            filter["metadata.routeDate"].$gte = input.startDate;
          if (input.endDate) filter["metadata.routeDate"].$lte = input.endDate;
        }

        if (input.minAccuracyScore !== undefined) {
          filter["costCorrections.accuracyScore"] = {
            $gte: input.minAccuracyScore,
          };
        }

        if (input.vehicleTypes && input.vehicleTypes.length > 0) {
          filter["costFactors.operationalContext.vehicleType"] = {
            $in: input.vehicleTypes,
          };
        }

        if (input.weatherConditions && input.weatherConditions.length > 0) {
          filter["costFactors.weatherConditions.condition"] = {
            $in: input.weatherConditions,
          };
        }

        if (input.routeComplexity) {
          filter["costFactors.routeCharacteristics.turnComplexity"] =
            input.routeComplexity === "low"
              ? { $lte: 0.33 }
              : input.routeComplexity === "high"
                ? { $gte: 0.66 }
                : { $gt: 0.33, $lt: 0.66 };
        }

        const entries = await collection
          .find(filter)
          .sort({ "metadata.routeDate": -1 })
          .limit(input.limit)
          .toArray();

        return {
          entries: entries.map((doc) => ({
            id: doc._id.toString(),
            ...doc,
            _id: undefined,
          })),
          total: entries.length,
        };
      } catch (error) {
        console.error("[CostHistory] Get training data failed:", error);
        return { entries: [], total: 0, error: String(error) };
      }
    }),

  /** Get cost prediction accuracy statistics */
  getAccuracyStats: publicProcedure
    .input(
      z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        groupBy: z
          .enum(["day", "week", "month", "vehicle_type", "weather_condition"])
          .default("week"),
      }),
    )
    .query(async ({ input }) => {
      const client = getMongoClient();
      if (!client) {
        return { error: "MongoDB not configured" };
      }

      try {
        const db = client.db("trashroute");
        const collection = db.collection("cost_history");

        const filter: any = {};
        if (input.startDate || input.endDate) {
          filter["metadata.routeDate"] = {};
          if (input.startDate)
            filter["metadata.routeDate"].$gte = input.startDate;
          if (input.endDate) filter["metadata.routeDate"].$lte = input.endDate;
        }

        let groupByField: any = "";
        // dateFormat removed — unused

        switch (input.groupBy) {
          case "day":
            groupByField = {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$metadata.routeDate",
              },
            };
            break;
          case "week":
            groupByField = {
              $dateToString: { format: "%Y-%W", date: "$metadata.routeDate" },
            };
            break;
          case "month":
            groupByField = {
              $dateToString: { format: "%Y-%m", date: "$metadata.routeDate" },
            };
            break;
          case "vehicle_type":
            groupByField = "$costFactors.operationalContext.vehicleType";
            break;
          case "weather_condition":
            groupByField = "$costFactors.weatherConditions.condition";
            break;
        }

        const stats = await collection
          .aggregate([
            { $match: filter },
            {
              $group: {
                _id: groupByField,
                count: { $sum: 1 },
                avgTimeAccuracy: {
                  $avg: {
                    $subtract: [
                      1,
                      {
                        $abs: {
                          $subtract: [
                            "$costCorrections.timeCorrectionFactor",
                            1,
                          ],
                        },
                      },
                    ],
                  },
                },
                avgCostAccuracy: {
                  $avg: {
                    $subtract: [
                      1,
                      {
                        $abs: {
                          $subtract: [
                            "$costCorrections.costCorrectionFactor",
                            1,
                          ],
                        },
                      },
                    ],
                  },
                },
                avgFuelAccuracy: {
                  $avg: {
                    $subtract: [
                      1,
                      {
                        $abs: {
                          $subtract: [
                            "$costCorrections.fuelCorrectionFactor",
                            1,
                          ],
                        },
                      },
                    ],
                  },
                },
                avgAccuracyScore: { $avg: "$costCorrections.accuracyScore" },
                totalPredictedCost: {
                  $sum: "$predictedCosts.predictedTotalCost",
                },
                totalActualCost: { $sum: "$actualCosts.totalCost" },
                avgPredictedCost: {
                  $avg: "$predictedCosts.predictedTotalCost",
                },
                avgActualCost: { $avg: "$actualCosts.totalCost" },
              },
            },
            { $sort: { _id: 1 } },
          ])
          .toArray();

        return {
          accuracyStats: stats,
          overallAccuracy:
            stats.length > 0
              ? stats.reduce((acc, curr) => acc + curr.avgAccuracyScore, 0) /
                stats.length
              : 0,
          totalBias: stats.reduce(
            (acc, curr) =>
              acc + (curr.totalActualCost - curr.totalPredictedCost),
            0,
          ),
        };
      } catch (error) {
        console.error("[CostHistory] Accuracy stats failed:", error);
        return { error: String(error) };
      }
    }),

  /** Get cost factor analysis for model improvement */
  getCostFactorAnalysis: publicProcedure
    .input(
      z.object({
        factor: z.enum([
          "weather",
          "driver_experience",
          "route_complexity",
          "time_of_day",
          "season",
        ]),
        metric: z
          .enum([
            "time_correction",
            "cost_correction",
            "fuel_correction",
            "accuracy_score",
          ])
          .default("accuracy_score"),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }),
    )
    .query(async ({ input }) => {
      const client = getMongoClient();
      if (!client) {
        return { error: "MongoDB not configured" };
      }

      try {
        const db = client.db("trashroute");
        const collection = db.collection("cost_history");

        const filter: any = {};
        if (input.startDate || input.endDate) {
          filter["metadata.routeDate"] = {};
          if (input.startDate)
            filter["metadata.routeDate"].$gte = input.startDate;
          if (input.endDate) filter["metadata.routeDate"].$lte = input.endDate;
        }

        let groupByField: any = "";
        let metricField = "";

        // Set up grouping based on factor
        switch (input.factor) {
          case "weather":
            groupByField = "$costFactors.weatherConditions.condition";
            break;
          case "driver_experience":
            groupByField = "$costFactors.operationalContext.driverExperience";
            break;
          case "route_complexity":
            groupByField = "$costFactors.routeCharacteristics.urbanDensity";
            break;
          case "time_of_day":
            groupByField = "$costFactors.operationalContext.timeOfDay";
            break;
          case "season":
            groupByField = "$costFactors.operationalContext.season";
            break;
        }

        // Set up metric field
        switch (input.metric) {
          case "time_correction":
            metricField = "$costCorrections.timeCorrectionFactor";
            break;
          case "cost_correction":
            metricField = "$costCorrections.costCorrectionFactor";
            break;
          case "fuel_correction":
            metricField = "$costCorrections.fuelCorrectionFactor";
            break;
          case "accuracy_score":
            metricField = "$costCorrections.accuracyScore";
            break;
        }

        const analysis = await collection
          .aggregate([
            { $match: filter },
            {
              $group: {
                _id: groupByField,
                count: { $sum: 1 },
                avgMetric: { $avg: metricField },
                minMetric: { $min: metricField },
                maxMetric: { $max: metricField },
                stdDev: { $stdDevPop: metricField },
                avgPredictedCost: {
                  $avg: "$predictedCosts.predictedTotalCost",
                },
                avgActualCost: { $avg: "$actualCosts.totalCost" },
                avgPredicted: { $avg: "$predictedCosts.predictedTotalCost" },
                avgActual: { $avg: "$actualCosts.totalCost" },
              },
            },
            { $sort: { avgMetric: -1 } },
          ])
          .toArray();

        return {
          factorAnalysis: analysis,
          insights: generateFactorInsights(
            analysis,
            input.factor,
            input.metric,
          ),
        };
      } catch (error) {
        console.error("[CostHistory] Factor analysis failed:", error);
        return { error: String(error) };
      }
    }),

  /** Export cost training data for ML model */
  exportCostTrainingData: publicProcedure
    .input(
      z.object({
        format: z.enum(["json", "csv"]).default("json"),
        includeWeather: z.boolean().default(true),
        includePerformance: z.boolean().default(true),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        minSampleQuality: z.number().min(0).max(1).default(0.7),
      }),
    )
    .mutation(async ({ input }) => {
      const client = getMongoClient();
      if (!client) {
        return { success: false, error: "MongoDB not configured" };
      }

      try {
        const db = client.db("trashroute");
        const collection = db.collection("cost_history");

        const filter: any = {};
        if (input.startDate || input.endDate) {
          filter["metadata.routeDate"] = {};
          if (input.startDate)
            filter["metadata.routeDate"].$gte = input.startDate;
          if (input.endDate) filter["metadata.routeDate"].$lte = input.endDate;
        }

        // Filter by minimum quality
        filter["costCorrections.accuracyScore"] = {
          $gte: input.minSampleQuality,
        };

        const entries = await collection
          .find(filter)
          .sort({ "metadata.routeDate": -1 })
          .limit(5000) // Limit export size
          .toArray();

        // Transform data for ML training
        const trainingData = entries.map((doc) => ({
          // Features for training
          route_features: {
            total_distance: doc.routeStatistics.totalDistance,
            estimated_time: doc.routeStatistics.estimatedTime,
            turn_complexity:
              (doc.routeStatistics.turns.leftTurns * 2 +
                doc.routeStatistics.turns.uTurns * 3) /
              Math.max(
                1,
                doc.routeStatistics.turns.leftTurns +
                  doc.routeStatistics.turns.rightTurns +
                  doc.routeStatistics.turns.uTurns +
                  doc.routeStatistics.straightAhead,
              ),
            segment_density:
              doc.routeStatistics.totalDistance > 0
                ? doc.routeStatistics.segmentsRouted /
                  doc.routeStatistics.totalDistance
                : 0,
            efficiency_ratio:
              doc.routeStatistics.segmentsRouted /
              Math.max(
                1,
                doc.routeStatistics.segmentsRouted +
                  doc.routeStatistics.segmentsExcluded,
              ),
          },
          weather_features:
            input.includeWeather && doc.costFactors.weatherConditions
              ? {
                  temperature: doc.costFactors.weatherConditions.temperature,
                  precipitation:
                    doc.costFactors.weatherConditions.precipitation,
                  wind_speed: doc.costFactors.weatherConditions.windSpeed,
                  visibility: doc.costFactors.weatherConditions.visibility,
                  severity: doc.costFactors.weatherConditions.severity || 0,
                  condition_encoded: encodeWeatherCondition(
                    doc.costFactors.weatherConditions.condition,
                  ),
                }
              : null,
          operational_features: {
            vehicle_type_encoded: encodeVehicleType(
              doc.costFactors.operationalContext.vehicleType,
            ),
            driver_experience_encoded: encodeDriverExperience(
              doc.costFactors.operationalContext.driverExperience,
            ),
            time_of_day_encoded: encodeTimeOfDay(
              doc.costFactors.operationalContext.timeOfDay,
            ),
            day_of_week: doc.costFactors.operationalContext.dayOfWeek,
            season_encoded: encodeSeason(
              doc.costFactors.operationalContext.season,
            ),
            route_complexity_encoded: encodeRouteComplexity(
              doc.costFactors.routeCharacteristics.urbanDensity,
            ),
          },
          // Target variables (correction factors)
          targets: {
            time_correction_factor: doc.costCorrections.timeCorrectionFactor,
            cost_correction_factor: doc.costCorrections.costCorrectionFactor,
            fuel_correction_factor: doc.costCorrections.fuelCorrectionFactor,
            actual_cost_per_km:
              doc.actualCosts.totalCost / doc.routeStatistics.totalDistance,
            actual_time_per_km:
              doc.actualCosts.actualTime / doc.routeStatistics.totalDistance,
            actual_fuel_per_km:
              doc.actualCosts.actualFuelConsumption /
              doc.routeStatistics.totalDistance,
          },
          metadata: {
            route_id: doc.routeId,
            timestamp: doc.timestamp,
            accuracy_score: doc.costCorrections.accuracyScore,
            model_version: doc.metadata.modelVersion,
            sample_weight: Math.pow(doc.costCorrections.accuracyScore, 2), // Weight by accuracy
          },
        }));

        return {
          success: true,
          data: trainingData,
          count: trainingData.length,
          format: input.format,
          avgAccuracy:
            trainingData.length > 0
              ? trainingData.reduce(
                  (acc, curr) => acc + curr.metadata.accuracy_score,
                  0,
                ) / trainingData.length
              : 0,
        };
      } catch (error) {
        console.error("[CostHistory] Export failed:", error);
        return { success: false, error: String(error) };
      }
    }),
});

// Helper functions
function identifyPrimaryErrorSources(
  predicted: any,
  actual: any,
  factors: any,
): string[] {
  const errors: string[] = [];

  const timeError =
    predicted.predictedTime !== 0
      ? Math.abs(actual.actualTime - predicted.predictedTime) /
        predicted.predictedTime
      : 0;
  const costError =
    predicted.predictedTotalCost !== 0
      ? Math.abs(actual.totalCost - predicted.predictedTotalCost) /
        predicted.predictedTotalCost
      : 0;
  const fuelError =
    predicted.predictedFuelConsumption !== 0
      ? Math.abs(
          actual.actualFuelConsumption - predicted.predictedFuelConsumption,
        ) / predicted.predictedFuelConsumption
      : 0;

  if (timeError > 0.3) errors.push("Time prediction significant error");
  if (costError > 0.3) errors.push("Cost prediction significant error");
  if (fuelError > 0.3) errors.push("Fuel prediction significant error");

  if (factors.weatherConditions?.severity > 0.7)
    errors.push("Severe weather impact underestimated");
  if (factors.operationalContext.driverExperience === "novice")
    errors.push("Novice driver performance variance");

  return errors.length > 0 ? errors : ["Minor prediction variance"];
}

function generateFactorInsights(
  analysis: any[],
  factor: string,
  metric: string,
): string[] {
  const insights: string[] = [];

  if (analysis.length === 0) return insights;

  const best = analysis[0];
  const worst = analysis[analysis.length - 1];

  insights.push(
    `${factor}: Best performance in "${best._id || "unknown"}" (${best.avgMetric.toFixed(3)}), worst in "${worst._id || "unknown"}" (${worst.avgMetric.toFixed(3)})`,
  );

  if (best.correlation && worst.correlation) {
    insights.push(
      `Correlation strength: ${best._id || "unknown"} (${best.correlation.toFixed(3)}) vs ${worst._id || "unknown"} (${worst.correlation.toFixed(3)})`,
    );
  }

  return insights;
}

function encodeWeatherCondition(condition?: string): number {
  const mapping: { [key: string]: number } = {
    clear: 0,
    clouds: 1,
    rain: 2,
    snow: 3,
    fog: 4,
    mist: 5,
    haze: 6,
    thunderstorm: 7,
    drizzle: 8,
  };
  return condition ? (mapping[condition.toLowerCase()] ?? 1) : 0;
}

function encodeVehicleType(vehicleType?: string): number {
  const mapping: { [key: string]: number } = {
    "municipal waste collection truck": 0,
    "recycling truck": 1,
    "compactor truck": 2,
    "rear loader": 3,
    "side loader": 4,
    "front loader": 5,
  };
  return vehicleType ? (mapping[vehicleType] ?? 0) : 0;
}

function encodeDriverExperience(experience?: string): number {
  const mapping: { [key: string]: number } = {
    novice: 0,
    intermediate: 1,
    experienced: 2,
  };
  return experience ? (mapping[experience] ?? 1) : 1;
}

function encodeTimeOfDay(timeOfDay?: string): number {
  const mapping: { [key: string]: number } = {
    early_morning: 0,
    morning: 1,
    afternoon: 2,
    evening: 3,
  };
  return timeOfDay ? (mapping[timeOfDay] ?? 1) : 1;
}

function encodeSeason(season?: string): number {
  const mapping: { [key: string]: number } = {
    spring: 0,
    summer: 1,
    fall: 2,
    winter: 3,
  };
  return season ? (mapping[season] ?? 1) : 1;
}

function encodeRouteComplexity(complexity?: string): number {
  const mapping: { [key: string]: number } = {
    low: 0,
    medium: 1,
    high: 2,
  };
  return complexity ? (mapping[complexity] ?? 1) : 1;
}
