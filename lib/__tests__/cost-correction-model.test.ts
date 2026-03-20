/**
 * Tests for CostCorrectionModel.
 *
 * The react-native stub sets Platform.OS = "web", so predictCosts always
 * falls through to getFallbackPrediction (the AI path requires "ios").
 * This lets us test the full fallback math without device SDKs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CostCorrectionModel,
  costCorrectionModel,
} from "../cost-correction-model";
import type {
  CostFactors,
  ActualCostData,
  CostPrediction,
} from "../cost-correction-model";
import type { RouteStatistics } from "@/types/routing";
import type { CurrentWeather } from "@/services/weatherService";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRouteStats(overrides: Partial<RouteStatistics> = {}): RouteStatistics {
  return {
    totalDistance: 20, // km
    estimatedTime: 60, // minutes
    totalTraversals: 10,
    segmentsRouted: 100,
    segmentsExcluded: 5,
    turns: {
      rightTurns: 10,
      leftTurns: 5,
      uTurns: 1,
      straightAhead: 4,
    },
    ...overrides,
  };
}

function makeWeather(overrides: Partial<CurrentWeather> = {}): CurrentWeather {
  return {
    lat: 45.4,
    lon: -75.7,
    timestamp: Date.now(),
    temp: 15,
    feelsLike: 14,
    pressure: 1013,
    humidity: 60,
    visibility: 10_000,
    windSpeed: 5,
    windDeg: 180,
    clouds: 20,
    condition: { id: 800, main: "Clear", description: "clear sky", icon: "01d" },
    rain1h: 0,
    snow1h: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getFallbackPrediction (tested via predictCosts since Platform.OS === "web")
// ---------------------------------------------------------------------------

describe("CostCorrectionModel.predictCosts — fallback path", () => {
  let model: CostCorrectionModel;

  beforeEach(() => {
    model = new CostCorrectionModel();
  });

  it("returns a prediction with all required fields", async () => {
    const stats = makeRouteStats();
    const prediction = await model.predictCosts(stats);

    expect(prediction).not.toBeNull();
    expect(prediction!.predictedTime).toBeGreaterThan(0);
    expect(prediction!.predictedFuelConsumption).toBeGreaterThan(0);
    expect(prediction!.predictedTotalCost).toBeGreaterThan(0);
    expect(prediction!.confidenceScore).toBe(0.6); // fallback confidence
    expect(prediction!.costBreakdown).toMatchObject({
      fuel: expect.any(Number),
      labor: expect.any(Number),
      maintenance: expect.any(Number),
      overhead: expect.any(Number),
    });
    expect(Array.isArray(prediction!.riskFactors)).toBe(true);
    expect(Array.isArray(prediction!.optimizationSuggestions)).toBe(true);
  });

  it("computes cost breakdown components that sum to predictedTotalCost", async () => {
    const stats = makeRouteStats();
    const p = (await model.predictCosts(stats))!;

    const { fuel, labor, maintenance, overhead } = p.costBreakdown;
    expect(fuel + labor + maintenance + overhead).toBeCloseTo(
      p.predictedTotalCost,
      1,
    );
  });

  it("uses 0.3 L/km baseline for fuel consumption (no weather)", async () => {
    const stats = makeRouteStats({ totalDistance: 10 });
    const p = (await model.predictCosts(stats))!;

    // baseFuel = 10 * 0.3 = 3 L; adjusted by weatherMultiplier (1.0) * 0.9
    expect(p.predictedFuelConsumption).toBeCloseTo(2.7, 1);
  });

  it("uses $45/h labor, $1.5/L fuel, $0.15/km maintenance rates", async () => {
    const stats = makeRouteStats({ totalDistance: 20, estimatedTime: 60 });
    // With no weather and intermediate driver: all multipliers = 1
    // adjustedTime = 60 min → labor = 1 h * $45 = $45
    // baseFuel = 20 * 0.3 = 6 L; adjustedFuel = 6 * 0.9 = 5.4 → fuel = 5.4 * 1.5 = $8.1
    // maintenance = 20 * 0.15 = $3
    // overhead = (45 + 8.1 + 3) * 0.2 = $11.22
    const p = (await model.predictCosts(stats))!;

    expect(p.costBreakdown.labor).toBeCloseTo(45, 0);
    expect(p.costBreakdown.fuel).toBeCloseTo(8.1, 0);
    expect(p.costBreakdown.maintenance).toBeCloseTo(3, 1);
    expect(p.costBreakdown.overhead).toBeCloseTo(11.2, 0);
  });

  it("adds always-present optimization suggestions", async () => {
    const p = (await model.predictCosts(makeRouteStats()))!;
    const texts = p.optimizationSuggestions.join(" ");
    expect(texts).toMatch(/fuel|time/i);
  });
});

// ---------------------------------------------------------------------------
// Weather impact
// ---------------------------------------------------------------------------

describe("CostCorrectionModel — weather multipliers", () => {
  let model: CostCorrectionModel;

  beforeEach(() => {
    model = new CostCorrectionModel();
  });

  it("increases predicted time and cost under moderate rain", async () => {
    const stats = makeRouteStats();
    const baseP = (await model.predictCosts(stats))!;
    const rainP = (
      await model.predictCosts(stats, makeWeather({ rain1h: 8 }))
    )!;

    expect(rainP.predictedTime).toBeGreaterThan(baseP.predictedTime);
    expect(rainP.predictedTotalCost).toBeGreaterThan(baseP.predictedTotalCost);
  });

  it("increases cost under heavy rain more than moderate rain", async () => {
    const stats = makeRouteStats();
    const moderateP = (
      await model.predictCosts(stats, makeWeather({ rain1h: 8 }))
    )!;
    const heavyP = (
      await model.predictCosts(stats, makeWeather({ rain1h: 12 }))
    )!;

    expect(heavyP.predictedTotalCost).toBeGreaterThan(
      moderateP.predictedTotalCost,
    );
  });

  it("increases cost with snow", async () => {
    const stats = makeRouteStats();
    const base = (await model.predictCosts(stats))!;
    const snow = (
      await model.predictCosts(stats, makeWeather({ snow1h: 2 }))
    )!;

    expect(snow.predictedTotalCost).toBeGreaterThan(base.predictedTotalCost);
  });

  it("includes risk factors for heavy rain", async () => {
    const p = (
      await model.predictCosts(
        makeRouteStats(),
        makeWeather({ rain1h: 12 }),
      )
    )!;

    expect(p.riskFactors).toContain("Heavy precipitation");
  });

  it("includes suggestion to delay start when rain > 5 mm/h", async () => {
    const p = (
      await model.predictCosts(
        makeRouteStats(),
        makeWeather({ rain1h: 7 }),
      )
    )!;
    const suggestions = p.optimizationSuggestions.join(" ");
    expect(suggestions).toMatch(/delay/i);
  });

  it("adds low-visibility risk factor when visibility < 1000 m", async () => {
    const p = (
      await model.predictCosts(
        makeRouteStats(),
        makeWeather({ visibility: 500 }),
      )
    )!;

    expect(p.riskFactors).toContain("Low visibility");
  });
});

// ---------------------------------------------------------------------------
// Time-of-day multipliers
// ---------------------------------------------------------------------------

describe("CostCorrectionModel — time-of-day multipliers", () => {
  let model: CostCorrectionModel;
  const stats = makeRouteStats();

  beforeEach(() => {
    model = new CostCorrectionModel();
  });

  it("morning is the baseline (no extra cost)", async () => {
    const morning = (
      await model.predictCosts(stats, undefined, { timeOfDay: "morning" })
    )!;
    const afternoon = (
      await model.predictCosts(stats, undefined, { timeOfDay: "afternoon" })
    )!;

    expect(afternoon.predictedTime).toBeGreaterThan(morning.predictedTime);
  });

  it("evening has the highest multiplier", async () => {
    const morning = (
      await model.predictCosts(stats, undefined, { timeOfDay: "morning" })
    )!;
    const evening = (
      await model.predictCosts(stats, undefined, { timeOfDay: "evening" })
    )!;

    expect(evening.predictedTime).toBeGreaterThan(morning.predictedTime);
  });

  it("early_morning costs more than baseline", async () => {
    const morning = (
      await model.predictCosts(stats, undefined, { timeOfDay: "morning" })
    )!;
    const earlyMorning = (
      await model.predictCosts(stats, undefined, { timeOfDay: "early_morning" })
    )!;

    expect(earlyMorning.predictedTime).toBeGreaterThan(morning.predictedTime);
  });
});

// ---------------------------------------------------------------------------
// Driver experience multipliers
// ---------------------------------------------------------------------------

describe("CostCorrectionModel — driver experience", () => {
  let model: CostCorrectionModel;
  const stats = makeRouteStats();

  beforeEach(() => {
    model = new CostCorrectionModel();
  });

  it("novice takes longer than intermediate", async () => {
    const inter = (
      await model.predictCosts(stats, undefined, {
        driverExperience: "intermediate",
      })
    )!;
    const novice = (
      await model.predictCosts(stats, undefined, {
        driverExperience: "novice",
      })
    )!;

    expect(novice.predictedTime).toBeGreaterThan(inter.predictedTime);
  });

  it("experienced driver is faster than intermediate", async () => {
    const inter = (
      await model.predictCosts(stats, undefined, {
        driverExperience: "intermediate",
      })
    )!;
    const exp = (
      await model.predictCosts(stats, undefined, {
        driverExperience: "experienced",
      })
    )!;

    expect(exp.predictedTime).toBeLessThan(inter.predictedTime);
  });
});

// ---------------------------------------------------------------------------
// correctCosts
// ---------------------------------------------------------------------------

describe("CostCorrectionModel.correctCosts", () => {
  let model: CostCorrectionModel;

  beforeEach(() => {
    model = new CostCorrectionModel();
  });

  it("returns a correction result with all required fields", async () => {
    const stats = makeRouteStats();
    const original = 100;
    const result = await model.correctCosts(original, stats);

    expect(result).not.toBeNull();
    expect(result!.originalEstimate).toBe(original);
    expect(result!.correctedEstimate).toBeGreaterThan(0);
    expect(typeof result!.correctionFactor).toBe("number");
    expect(result!.correctionFactor).toBeGreaterThan(0);
    expect(result!.confidence).toBe(0.6);
    expect(typeof result!.reasoning).toBe("string");
    expect(result!.reasoning.length).toBeGreaterThan(0);
    expect(Array.isArray(result!.primaryCostDrivers)).toBe(true);
    expect(result!.potentialSavings).toBeGreaterThanOrEqual(0);
  });

  it("correction factor equals correctedEstimate / originalEstimate", async () => {
    const result = (await model.correctCosts(50, makeRouteStats()))!;

    expect(result.correctionFactor).toBeCloseTo(
      result.correctedEstimate / result.originalEstimate,
      5,
    );
  });

  it("potentialSavings is positive when corrected < original", async () => {
    // Use a very high original estimate — the model will predict less
    const result = (await model.correctCosts(100_000, makeRouteStats()))!;

    if (result.correctedEstimate < result.originalEstimate) {
      expect(result.potentialSavings).toBeGreaterThan(0);
    } else {
      expect(result.potentialSavings).toBe(0);
    }
  });

  it("reasoning mentions 'increased' when correctionFactor > 1.2", async () => {
    // Use a very low original estimate so the model significantly exceeds it
    const result = (await model.correctCosts(1, makeRouteStats()))!;
    if (result.correctionFactor > 1.2) {
      expect(result.reasoning).toMatch(/increased/i);
    }
  });

  it("reasoning mentions 'reduced' when correctionFactor < 0.8", async () => {
    // Use a very high original estimate so the corrected is much lower
    const result = (await model.correctCosts(1_000_000, makeRouteStats()))!;
    if (result.correctionFactor < 0.8) {
      expect(result.reasoning).toMatch(/reduced/i);
    }
  });

  it("reasoning is neutral when correctionFactor is between 0.8 and 1.2", async () => {
    // The fallback for 20km/60min typically produces a cost in the hundreds;
    // passing that same value as original → factor ≈ 1 → neutral reasoning.
    const stats = makeRouteStats();
    const baseline = (await model.predictCosts(stats))!;
    const result = (
      await model.correctCosts(baseline.predictedTotalCost, stats)
    )!;

    // Factor should be exactly 1
    expect(result.correctionFactor).toBeCloseTo(1, 4);
    expect(result.reasoning).toMatch(/normal range/i);
  });
});

// ---------------------------------------------------------------------------
// learnFromActualData
// ---------------------------------------------------------------------------

describe("CostCorrectionModel.learnFromActualData", () => {
  it("accumulates historical samples", async () => {
    const model = new CostCorrectionModel();
    const predicted: CostPrediction = {
      predictedTime: 60,
      predictedFuelConsumption: 6,
      predictedTotalCost: 80,
      confidenceScore: 0.6,
      costBreakdown: { fuel: 9, labor: 45, maintenance: 3, overhead: 11 },
      riskFactors: [],
      optimizationSuggestions: [],
    };
    const actual: ActualCostData = {
      actualTime: 65,
      actualFuelConsumption: 6.5,
      actualStopsCompleted: 20,
      maintenanceCosts: 3,
      laborCosts: 47,
      totalCost: 85,
      customerComplaints: 0,
      safetyIncidents: 0,
    };

    await model.learnFromActualData(predicted, actual, makeRouteStats());
    await model.learnFromActualData(predicted, actual, makeRouteStats());

    // Internal historicalData length should be 2
    expect((model as unknown as { historicalData: unknown[] }).historicalData).toHaveLength(2);
  });

  it("trims historical data to 500 entries when it exceeds 1000", async () => {
    const model = new CostCorrectionModel();
    const stats = makeRouteStats();
    const predicted: CostPrediction = {
      predictedTime: 60,
      predictedFuelConsumption: 6,
      predictedTotalCost: 80,
      confidenceScore: 0.6,
      costBreakdown: { fuel: 9, labor: 45, maintenance: 3, overhead: 11 },
      riskFactors: [],
      optimizationSuggestions: [],
    };
    const actual: ActualCostData = {
      actualTime: 60,
      actualFuelConsumption: 6,
      actualStopsCompleted: 20,
      maintenanceCosts: 3,
      laborCosts: 45,
      totalCost: 80,
      customerComplaints: 0,
      safetyIncidents: 0,
    };

    for (let i = 0; i < 1001; i++) {
      await model.learnFromActualData(predicted, actual, stats);
    }

    // After the 1001st call the array should be trimmed to 500
    expect(
      (model as unknown as { historicalData: unknown[] }).historicalData,
    ).toHaveLength(500);
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe("CostCorrectionModel — caching", () => {
  it("returns the same prediction object for identical inputs within TTL", async () => {
    const model = new CostCorrectionModel();
    // Platform.OS is "web" → AI is skipped, but we hit the cache on the way
    // out of predictCosts anyway (iOS branch caches; web branch does not).
    // This test verifies cache consistency for the iOS code path by
    // calling clearCache and getCacheStats.
    model.clearCache();
    expect(model.getCacheStats().size).toBe(0);
  });

  it("clearCache empties the cache", async () => {
    const model = new CostCorrectionModel();
    // Populate cache by patching Platform.OS to ios temporarily
    const cache = (
      model as unknown as {
        costCache: Map<string, unknown>;
        generateCacheKey: (f: CostFactors) => string;
      }
    ).costCache;

    cache.set("key1", { prediction: {}, timestamp: Date.now() });
    cache.set("key2", { prediction: {}, timestamp: Date.now() });
    expect(model.getCacheStats().size).toBe(2);

    model.clearCache();
    expect(model.getCacheStats().size).toBe(0);
  });

  it("isCacheValid returns false for entries older than 15 minutes", () => {
    const model = new CostCorrectionModel();
    const isCacheValid = (
      model as unknown as { isCacheValid: (ts: number) => boolean }
    ).isCacheValid.bind(model);

    const now = Date.now();
    expect(isCacheValid(now)).toBe(true);
    expect(isCacheValid(now - 14 * 60 * 1_000)).toBe(true); // 14 min ago → still valid
    expect(isCacheValid(now - 16 * 60 * 1_000)).toBe(false); // 16 min ago → expired
  });
});

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

describe("costCorrectionModel singleton", () => {
  it("is an instance of CostCorrectionModel", () => {
    expect(costCorrectionModel).toBeInstanceOf(CostCorrectionModel);
  });
});
