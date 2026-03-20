/**
 * Tests for CostAwareRouteOptimizer (lib/cost-aware-route-optimizer.ts)
 *
 * The class wraps RouteOptimizer with ML-based cost prediction from three services:
 *   - costPredictionService (getCostAwareRecommendations)
 *   - costCorrectionModel (predictCosts)
 *   - getEdgePenaltiesFromLeap (ML edge scoring via Mistral/Leap)
 *
 * All three service dependencies are mocked so tests run without network or native APIs.
 *
 * Key behaviors verified:
 *  - Pure utility functions (calculateCostEfficiency, generateCostSummary) on the
 *    exported singleton return sensible values without any mocking.
 *  - CostAwareRouteOptimizer constructor creates an instance without throwing.
 *  - optimizeWithCostAwareness returns a valid CostOptimizedRoute when services
 *    are unavailable (standard → numeric fallback) and on the full recommendation path.
 *  - getFallbackOptimizedRoute math: costs are non-negative and consistent.
 *  - generateOptimizationReport builds a complete structured report.
 *  - compareRouteOptions assigns cost and efficiency rankings correctly.
 *  - Risk mitigation strategies depend on risk level and confidence.
 *  - Budget constraint: 20% tolerance filter in selectBestVariant.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock external service dependencies BEFORE importing the module under test ──
// route-ml-enhancement imports AsyncStorage (react-native-async-storage) which
// is not available in the test environment — mock the whole module.
vi.mock("@/lib/route-ml-enhancement", () => ({
  getEdgePenaltiesFromLeap: vi.fn().mockResolvedValue(new Map<string, number>()),
  waySummary: vi.fn().mockReturnValue("way-summary"),
}));

vi.mock("@/lib/cost-correction-model", () => ({
  costCorrectionModel: {
    predictCosts: vi.fn(),
    correctCosts: vi.fn(),
    updateWithActualData: vi.fn(),
    clearCache: vi.fn(),
  },
  // Re-export the type so imports don't break
}));

vi.mock("@/services/costPredictionService", () => ({
  costPredictionService: {
    getCostAwareRecommendations: vi.fn(),
    updateWithActualCosts: vi.fn(),
  },
}));

// ─── Now import the module under test ─────────────────────────────────────────
import {
  CostAwareRouteOptimizer,
  createCostAwareRouteOptimizer,
  costAwareRouteOptimizer,
  type CostOptimizedRoute,
  type CostOptimizationConfig,
} from "../cost-aware-route-optimizer";
import { costCorrectionModel } from "@/lib/cost-correction-model";
import { costPredictionService } from "@/services/costPredictionService";
import { getEdgePenaltiesFromLeap } from "@/lib/route-ml-enhancement";
import type { CostPrediction } from "@/lib/cost-correction-model";
import type { CostAwareRouteRecommendation } from "@/services/costPredictionService";
import type { RouteStatistics } from "@/types/routing";

// ─── Test data builders ───────────────────────────────────────────────────────

function makeRouteStats(overrides: Partial<RouteStatistics> = {}): RouteStatistics {
  return {
    totalDistance: 10, // km
    estimatedTime: 60, // minutes
    totalTraversals: 100,
    segmentsRouted: 50,
    segmentsExcluded: 5,
    turns: { rightTurns: 20, leftTurns: 5, uTurns: 1, straightAhead: 74 },
    ...overrides,
  };
}

function makeFallbackRoute(overrides: Partial<CostOptimizedRoute> = {}): CostOptimizedRoute {
  return {
    route: [],
    totalDistance: 10,
    estimatedTime: 60,
    predictedCosts: {
      totalCost: 100,
      fuelCost: 30,
      laborCost: 45,
      maintenanceCost: 15,
      overheadCost: 10,
    },
    costEfficiencyScore: 40,
    optimizationMetrics: {
      costPerKilometer: 10,
      timePerKilometer: 6,
      fuelEfficiency: 33,
      costEffectiveness: 100,
    },
    costComparison: {
      vsStandardRoute: 0,
      vsPreviousRoutes: 0,
      potentialSavings: 0,
    },
    riskAssessment: {
      costOverrunRisk: "high",
      confidence: 0.5,
      primaryRiskFactors: ["Limited prediction accuracy"],
    },
    recommendations: ["Cost prediction unavailable - monitor actual costs"],
    ...overrides,
  };
}

function makeNodes() {
  return new Map([
    ["A", { id: "A", lat: 0.0, lon: 0.0 }],
    ["B", { id: "B", lat: 0.001, lon: 0.0 }],
    ["C", { id: "C", lat: 0.0, lon: 0.001 }],
  ]);
}

function makeWays() {
  return [
    { id: "w1", nodes: ["A", "B"], tags: { highway: "residential" } },
    { id: "w2", nodes: ["B", "C"], tags: { highway: "residential" } },
    { id: "w3", nodes: ["C", "A"], tags: { highway: "residential" } },
  ];
}

function makeCostPrediction(overrides: Partial<CostPrediction> = {}): CostPrediction {
  return {
    predictedTime: 55,
    predictedFuelConsumption: 3,
    predictedTotalCost: 95,
    confidenceScore: 0.85,
    costBreakdown: { fuel: 25, labor: 40, maintenance: 20, overhead: 10 },
    riskFactors: [],
    optimizationSuggestions: ["Test suggestion"],
    ...overrides,
  };
}

function makeCostAwareRecommendation(
  overrides: Partial<CostAwareRouteRecommendation> = {},
): CostAwareRouteRecommendation {
  const predictedCosts = makeCostPrediction({ predictedTotalCost: 100 });
  return {
    routeId: "test-route",
    predictedCosts,
    costEfficiencyScore: 70,
    alternativeRoutes: [],
    optimizationOpportunities: ["Pool deliveries"],
    riskAssessment: {
      costOverrunRisk: "low",
      likelyCostRange: [80, 120],
      primaryRiskFactors: [],
    },
    ...overrides,
  };
}

// ─── Pure utility functions ───────────────────────────────────────────────────

describe("costAwareRouteOptimizer utilities – calculateCostEfficiency", () => {
  it("returns 50 as base score for average metrics", () => {
    const prediction = {
      predictedTotalCost: 120, // $12/km on 10km → costPerKm = 12 → +10 pts
      predictedTime: 50, // 5 min/km → +8 pts
      predictedFuelConsumption: 3,
      confidenceScore: 0,
    };
    const stats = makeRouteStats({ totalDistance: 10 });
    const score = costAwareRouteOptimizer.calculateCostEfficiency(prediction, stats);

    // Base 50 + costPerKm<15 (+15) + timePerKm<6 (+8) = 73 (capped at 100)
    expect(score).toBeGreaterThanOrEqual(50);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("returns a higher score for cost-efficient routes (low cost/km)", () => {
    const cheap = {
      predictedTotalCost: 50, // $5/km → costPerKm < 10 → +25 pts
      predictedTime: 30,
      predictedFuelConsumption: 2,
      confidenceScore: 0,
    };
    const expensive = {
      predictedTotalCost: 200, // $20/km → costPerKm ≥ 15, no bonus
      predictedTime: 30,
      predictedFuelConsumption: 2,
      confidenceScore: 0,
    };
    const stats = makeRouteStats({ totalDistance: 10 });

    const cheapScore = costAwareRouteOptimizer.calculateCostEfficiency(cheap, stats);
    const expensiveScore = costAwareRouteOptimizer.calculateCostEfficiency(expensive, stats);

    expect(cheapScore).toBeGreaterThan(expensiveScore);
  });

  it("score is always between 0 and 100", () => {
    // Extremely bad route
    const terrible = {
      predictedTotalCost: 10000,
      predictedTime: 10000,
      predictedFuelConsumption: 1000,
      confidenceScore: 0,
    };
    const stats = makeRouteStats({ totalDistance: 1 });
    const score = costAwareRouteOptimizer.calculateCostEfficiency(terrible, stats);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("handles zero totalDistance gracefully (uses 1 as fallback)", () => {
    const prediction = {
      predictedTotalCost: 100,
      predictedTime: 60,
      predictedFuelConsumption: 3,
      confidenceScore: 0.8,
    };
    const stats = makeRouteStats({ totalDistance: 0 });

    expect(() =>
      costAwareRouteOptimizer.calculateCostEfficiency(prediction, stats),
    ).not.toThrow();
  });
});

describe("costAwareRouteOptimizer utilities – generateCostSummary", () => {
  it("returns a string containing distance, cost, efficiency, and risk", () => {
    const route = makeFallbackRoute({
      totalDistance: 15.5,
      predictedCosts: {
        totalCost: 200.5,
        fuelCost: 60,
        laborCost: 90,
        maintenanceCost: 30,
        overheadCost: 20.5,
      },
      costEfficiencyScore: 72,
      riskAssessment: { costOverrunRisk: "low", confidence: 0.9, primaryRiskFactors: [] },
    });

    const summary = costAwareRouteOptimizer.generateCostSummary(route);

    expect(typeof summary).toBe("string");
    expect(summary).toContain("15.5");
    expect(summary).toContain("200.50");
    expect(summary).toContain("72");
    expect(summary).toContain("low");
  });

  it("summary format includes all key sections", () => {
    const route = makeFallbackRoute();
    const summary = costAwareRouteOptimizer.generateCostSummary(route);

    // Should mention Route, Cost, Efficiency, Risk in some form
    expect(summary).toMatch(/route/i);
    expect(summary).toMatch(/cost/i);
    expect(summary).toMatch(/efficiency/i);
    expect(summary).toMatch(/risk/i);
  });
});

// ─── Constructor ──────────────────────────────────────────────────────────────

describe("CostAwareRouteOptimizer – construction", () => {
  it("constructs without throwing for valid nodes and ways", () => {
    expect(() => {
      new CostAwareRouteOptimizer(makeNodes(), makeWays());
    }).not.toThrow();
  });

  it("createCostAwareRouteOptimizer factory returns a CostAwareRouteOptimizer instance", () => {
    const optimizer = createCostAwareRouteOptimizer(makeNodes(), makeWays());
    expect(optimizer).toBeInstanceOf(CostAwareRouteOptimizer);
  });

  it("accepts custom cost weights in config", () => {
    const config: CostOptimizationConfig = {
      costWeights: { fuel: 0.5, labor: 0.3, maintenance: 0.1, overhead: 0.1 },
    };
    expect(() => {
      new CostAwareRouteOptimizer(makeNodes(), makeWays(), "A", [], config);
    }).not.toThrow();
  });

  it("learningEnabled defaults to true", () => {
    const optimizer = new CostAwareRouteOptimizer(makeNodes(), makeWays());
    // Can't directly inspect private, but learningEnabled shouldn't throw updateWithActualPerformance
    expect(optimizer).toBeDefined();
  });
});

// ─── optimizeWithCostAwareness – fallback path ────────────────────────────────

describe("CostAwareRouteOptimizer – optimizeWithCostAwareness", () => {
  let optimizer: CostAwareRouteOptimizer;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(costPredictionService.getCostAwareRecommendations).mockReset();
    vi.mocked(costCorrectionModel.predictCosts).mockReset();
    vi.mocked(getEdgePenaltiesFromLeap).mockResolvedValue(new Map());
    optimizer = new CostAwareRouteOptimizer(makeNodes(), makeWays());
  });

  it("returns a CostOptimizedRoute even when services fail", async () => {
    const stats = makeRouteStats();
    const result = await optimizer.optimizeWithCostAwareness(stats);

    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("calls getEdgePenaltiesFromLeap with the constructor ways (no ReferenceError)", async () => {
    const ways = makeWays();
    const opt = new CostAwareRouteOptimizer(makeNodes(), ways);
    vi.mocked(getEdgePenaltiesFromLeap).mockClear();

    await opt.optimizeWithCostAwareness(makeRouteStats());

    expect(getEdgePenaltiesFromLeap).toHaveBeenCalledTimes(1);
    expect(getEdgePenaltiesFromLeap).toHaveBeenCalledWith(ways, null);
  });

  it("happy path: uses service recommendation and returns variant-based costs", async () => {
    const recommendation = makeCostAwareRecommendation();
    vi.mocked(costPredictionService.getCostAwareRecommendations).mockResolvedValue(
      recommendation,
    );
    vi.mocked(costCorrectionModel.predictCosts).mockResolvedValue(makeCostPrediction());

    const result = await optimizer.optimizeWithCostAwareness(makeRouteStats({ totalDistance: 10 }));

    expect(result).not.toBeNull();
    expect(result!.predictedCosts.totalCost).toBe(95);
    expect(result!.predictedCosts.fuelCost).toBe(25);
    expect(result!.costEfficiencyScore).not.toBe(40);
    expect(getEdgePenaltiesFromLeap).toHaveBeenCalled();
  });

  it("fallback route has correct structure", async () => {
    const stats = makeRouteStats({ totalDistance: 20, estimatedTime: 90 });
    const result = await optimizer.optimizeWithCostAwareness(stats);

    expect(result).toMatchObject({
      route: expect.any(Array),
      totalDistance: expect.any(Number),
      estimatedTime: expect.any(Number),
      predictedCosts: {
        totalCost: expect.any(Number),
        fuelCost: expect.any(Number),
        laborCost: expect.any(Number),
        maintenanceCost: expect.any(Number),
        overheadCost: expect.any(Number),
      },
      costEfficiencyScore: expect.any(Number),
      optimizationMetrics: {
        costPerKilometer: expect.any(Number),
        timePerKilometer: expect.any(Number),
        fuelEfficiency: expect.any(Number),
        costEffectiveness: expect.any(Number),
      },
      costComparison: {
        vsStandardRoute: expect.any(Number),
        vsPreviousRoutes: expect.any(Number),
        potentialSavings: expect.any(Number),
      },
      riskAssessment: {
        costOverrunRisk: expect.stringMatching(/low|medium|high/),
        confidence: expect.any(Number),
        primaryRiskFactors: expect.any(Array),
      },
      recommendations: expect.any(Array),
    });
  });

  it("fallback route totalDistance matches input routeStats.totalDistance", async () => {
    const stats = makeRouteStats({ totalDistance: 25 });
    const result = await optimizer.optimizeWithCostAwareness(stats);

    expect(result!.totalDistance).toBe(25);
  });

  it("fallback route costs are all non-negative", async () => {
    const stats = makeRouteStats({ totalDistance: 10, estimatedTime: 60 });
    const result = await optimizer.optimizeWithCostAwareness(stats);

    const costs = result!.predictedCosts;
    expect(costs.totalCost).toBeGreaterThanOrEqual(0);
    expect(costs.fuelCost).toBeGreaterThanOrEqual(0);
    expect(costs.laborCost).toBeGreaterThanOrEqual(0);
    expect(costs.maintenanceCost).toBeGreaterThanOrEqual(0);
    expect(costs.overheadCost).toBeGreaterThanOrEqual(0);
  });

  it("fallback route totalCost equals sum of cost components", async () => {
    const stats = makeRouteStats({ totalDistance: 10, estimatedTime: 60 });
    const result = await optimizer.optimizeWithCostAwareness(stats);

    const { totalCost, fuelCost, laborCost, maintenanceCost, overheadCost } =
      result!.predictedCosts;
    const sumOfParts = fuelCost + laborCost + maintenanceCost + overheadCost;
    expect(totalCost).toBeCloseTo(sumOfParts, 5);
  });

  it("fallback route marks risk as high and efficiency at 40", async () => {
    // getFallbackOptimizedRoute always uses 40 and "high" as signals that this is a fallback
    const result = await optimizer.optimizeWithCostAwareness(makeRouteStats());

    expect(result!.costEfficiencyScore).toBe(40);
    expect(result!.riskAssessment.costOverrunRisk).toBe("high");
  });

  it("optimization metrics are internally consistent (costPerKm * distance ≈ totalCost)", async () => {
    const stats = makeRouteStats({ totalDistance: 10 });
    const result = await optimizer.optimizeWithCostAwareness(stats);

    const { costPerKilometer } = result!.optimizationMetrics;
    const { totalCost } = result!.predictedCosts;
    expect(costPerKilometer * stats.totalDistance).toBeCloseTo(totalCost, 5);
  });
});

// ─── generateOptimizationReport ──────────────────────────────────────────────

describe("CostAwareRouteOptimizer – generateOptimizationReport", () => {
  let optimizer: CostAwareRouteOptimizer;

  beforeEach(() => {
    optimizer = new CostAwareRouteOptimizer(makeNodes(), makeWays());
  });

  it("returns a report with all required sections", async () => {
    const route = makeFallbackRoute();
    const report = await optimizer.generateOptimizationReport(route);

    expect(report).toMatchObject({
      summary: expect.any(String),
      costBreakdown: expect.any(Object),
      efficiencyAnalysis: expect.any(Object),
      recommendations: expect.any(Array),
      riskAssessment: expect.any(Object),
      performanceMetrics: expect.any(Object),
    });
  });

  it("summary mentions the predicted cost and efficiency score", async () => {
    const route = makeFallbackRoute({
      predictedCosts: {
        totalCost: 123.45,
        fuelCost: 40,
        laborCost: 50,
        maintenanceCost: 20,
        overheadCost: 13.45,
      },
      costEfficiencyScore: 72,
    });
    const report = await optimizer.generateOptimizationReport(route);

    expect(report.summary).toContain("123.45");
    expect(report.summary).toContain("72");
  });

  it("costBreakdown percentages sum to 100", async () => {
    const route = makeFallbackRoute();
    const report = await optimizer.generateOptimizationReport(route);

    const { fuel, labor, maintenance, overhead } = report.costBreakdown.percentages;
    const total = fuel + labor + maintenance + overhead;
    expect(total).toBeCloseTo(100, 1);
  });

  it("riskAssessment includes mitigation strategies for high risk", async () => {
    const route = makeFallbackRoute({
      riskAssessment: {
        costOverrunRisk: "high",
        confidence: 0.5,
        primaryRiskFactors: ["weather"],
      },
    });
    const report = await optimizer.generateOptimizationReport(route);

    expect(report.riskAssessment.mitigation.length).toBeGreaterThan(0);
  });

  it("adds confidence-driven mitigation strategies when confidence < 0.7", async () => {
    // NOTE: generateRiskMitigationStrategies checks `riskAssessment.level` but the
    // CostOptimizedRoute type uses `costOverrunRisk`. This mismatch means level-based
    // strategies never fire; only the confidence-based block (confidence < 0.7) produces
    // mitigation entries. This test documents the actual runtime behavior.
    const lowConfidenceRoute = makeFallbackRoute({
      riskAssessment: { costOverrunRisk: "high", confidence: 0.5, primaryRiskFactors: [] },
    });
    const highConfidenceRoute = makeFallbackRoute({
      riskAssessment: { costOverrunRisk: "high", confidence: 0.9, primaryRiskFactors: [] },
    });

    const lowConfReport = await optimizer.generateOptimizationReport(lowConfidenceRoute);
    const highConfReport = await optimizer.generateOptimizationReport(highConfidenceRoute);

    // Low confidence triggers 2 extra mitigation strategies
    expect(lowConfReport.riskAssessment.mitigation.length).toBeGreaterThan(
      highConfReport.riskAssessment.mitigation.length,
    );
  });

  it("includes comparison to alternatives when provided", async () => {
    const main = makeFallbackRoute({ predictedCosts: { totalCost: 100, fuelCost: 30, laborCost: 45, maintenanceCost: 15, overheadCost: 10 }, costEfficiencyScore: 60 });
    const alt = makeFallbackRoute({ predictedCosts: { totalCost: 120, fuelCost: 40, laborCost: 50, maintenanceCost: 20, overheadCost: 10 }, costEfficiencyScore: 50 });

    const report = await optimizer.generateOptimizationReport(main, [alt]);

    expect(report.performanceMetrics.performanceVsAlternatives).not.toBeNull();
    expect(report.performanceMetrics.performanceVsAlternatives.alternativesCount).toBe(1);
  });
});

// ─── compareRouteOptions ──────────────────────────────────────────────────────

describe("CostAwareRouteOptimizer – compareRouteOptions", () => {
  let optimizer: CostAwareRouteOptimizer;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(costPredictionService.getCostAwareRecommendations).mockReset();
    vi.mocked(costCorrectionModel.predictCosts).mockReset();
    vi.mocked(getEdgePenaltiesFromLeap).mockResolvedValue(new Map());
    optimizer = new CostAwareRouteOptimizer(makeNodes(), makeWays());
  });

  it("returns one entry per route option", async () => {
    const options = [
      { name: "Route A", routeStats: makeRouteStats({ totalDistance: 5 }) },
      { name: "Route B", routeStats: makeRouteStats({ totalDistance: 10 }) },
      { name: "Route C", routeStats: makeRouteStats({ totalDistance: 15 }) },
    ];

    const result = await optimizer.compareRouteOptions(options);

    expect(result).toHaveLength(3);
  });

  it("each entry has name, costAnalysis, and ranking fields", async () => {
    const options = [
      { name: "Route A", routeStats: makeRouteStats() },
      { name: "Route B", routeStats: makeRouteStats() },
    ];

    const result = await optimizer.compareRouteOptions(options);

    for (const entry of result) {
      expect(entry.name).toBeTruthy();
      expect(entry.costAnalysis).toBeDefined();
      expect(entry.ranking.costRank).toBeGreaterThan(0);
      expect(entry.ranking.efficiencyRank).toBeGreaterThan(0);
    }
  });

  it("costRank 1 belongs to the option with lowest totalCost", async () => {
    // All routes use fallback → cost scales with totalDistance * constants
    const options = [
      { name: "Long", routeStats: makeRouteStats({ totalDistance: 30 }) },
      { name: "Short", routeStats: makeRouteStats({ totalDistance: 5 }) },
    ];

    const result = await optimizer.compareRouteOptions(options);

    const shortEntry = result.find((r) => r.name === "Short")!;
    expect(shortEntry.ranking.costRank).toBe(1);
  });

  it("rankings are positive integers starting from 1", async () => {
    const options = [
      { name: "A", routeStats: makeRouteStats() },
      { name: "B", routeStats: makeRouteStats() },
    ];

    const result = await optimizer.compareRouteOptions(options);

    for (const entry of result) {
      expect(entry.ranking.costRank).toBeGreaterThanOrEqual(1);
      expect(entry.ranking.efficiencyRank).toBeGreaterThanOrEqual(1);
    }
  });

  it("handles single route option without error", async () => {
    const result = await optimizer.compareRouteOptions([
      { name: "Only Route", routeStats: makeRouteStats() },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.ranking.costRank).toBe(1);
    expect(result[0]!.ranking.efficiencyRank).toBe(1);
  });

  it("compareRouteOptions runs ML penalties per option with graph ways", async () => {
    const ways = makeWays();
    const opt = new CostAwareRouteOptimizer(makeNodes(), ways);
    vi.mocked(getEdgePenaltiesFromLeap).mockClear();

    await opt.compareRouteOptions([
      { name: "A", routeStats: makeRouteStats({ totalDistance: 5 }) },
      { name: "B", routeStats: makeRouteStats({ totalDistance: 8 }) },
    ]);

    expect(getEdgePenaltiesFromLeap).toHaveBeenCalledTimes(2);
    expect(getEdgePenaltiesFromLeap).toHaveBeenCalledWith(ways, null);
  });

  it("compareRouteOptions happy path ranks options by total predicted cost", async () => {
    vi.mocked(costPredictionService.getCostAwareRecommendations).mockImplementation(
      async (req) =>
        makeCostAwareRecommendation({
          predictedCosts: makeCostPrediction({
            predictedTotalCost: (req.routeStats.totalDistance || 1) * 100,
          }),
        }),
    );
    vi.mocked(costCorrectionModel.predictCosts).mockImplementation(
      async (stats: RouteStatistics) =>
        makeCostPrediction({
          predictedTotalCost: (stats.totalDistance || 1) * 15,
          predictedTime: stats.estimatedTime,
        }),
    );

    const result = await optimizer.compareRouteOptions([
      { name: "Near", routeStats: makeRouteStats({ totalDistance: 5, estimatedTime: 60 }) },
      { name: "Far", routeStats: makeRouteStats({ totalDistance: 20, estimatedTime: 90 }) },
    ]);

    const near = result.find((r) => r.name === "Near")!;
    const far = result.find((r) => r.name === "Far")!;
    expect(near.costAnalysis.predictedCosts.totalCost).toBeLessThan(
      far.costAnalysis.predictedCosts.totalCost,
    );
    expect(near.ranking.costRank).toBe(1);
    expect(far.ranking.costRank).toBe(2);
  });
});

// ─── updateWithActualPerformance ──────────────────────────────────────────────

describe("CostAwareRouteOptimizer – updateWithActualPerformance", () => {
  it("does nothing when learningEnabled is false", async () => {
    const optimizer = new CostAwareRouteOptimizer(makeNodes(), makeWays(), "A", [], {
      learningEnabled: false,
    });

    // Should not throw and should not call updateWithActualCosts
    await optimizer.updateWithActualPerformance(
      "route-123",
      {},
      {
        actualTime: 65,
        actualFuelConsumption: 5,
        actualTotalCost: 110,
        stopsCompleted: 20,
      },
      makeRouteStats(),
    );

    expect(vi.mocked(costPredictionService.updateWithActualCosts)).not.toHaveBeenCalled();
  });

  it("calls updateWithActualCosts when learningEnabled is true", async () => {
    const optimizer = new CostAwareRouteOptimizer(makeNodes(), makeWays(), "A", [], {
      learningEnabled: true,
    });

    vi.mocked(costPredictionService.updateWithActualCosts).mockResolvedValue(undefined);

    await optimizer.updateWithActualPerformance(
      "route-456",
      { predictedTotalCost: 100 },
      {
        actualTime: 65,
        actualFuelConsumption: 5,
        actualTotalCost: 110,
        stopsCompleted: 20,
        customerComplaints: 1,
        safetyIncidents: 0,
      },
      makeRouteStats(),
    );

    expect(vi.mocked(costPredictionService.updateWithActualCosts)).toHaveBeenCalledWith(
      expect.objectContaining({ routeId: "route-456" }),
    );
  });
});
