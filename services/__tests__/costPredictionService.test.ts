/**
 * Unit tests for CostPredictionService.
 *
 * costCorrectionModel.predictCosts is the only external dependency
 * with real logic — mocked here so tests run offline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock costCorrectionModel
// ---------------------------------------------------------------------------
let mockPredictCosts = vi.fn();
let mockLearnFromActualData = vi.fn();
vi.mock("@/lib/cost-correction-model", () => ({
  costCorrectionModel: {
    predictCosts: (...args: unknown[]) => mockPredictCosts(...args),
    learnFromActualData: (...args: unknown[]) => mockLearnFromActualData(...args),
  },
}));

vi.mock("@/services/leapAIService", () => ({
  getLeapWeatherRecommendations: vi.fn(async () => null),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
import type { RouteStatistics } from "@/types/routing";
import type { CostPrediction } from "@/lib/cost-correction-model";
import type { CurrentWeather } from "../weatherService";
import {
  CostPredictionService,
  costPredictionService,
  type CostOptimizationRequest,
  type CostLearningUpdate,
} from "../costPredictionService";

function makeRouteStats(overrides: Partial<RouteStatistics> = {}): RouteStatistics {
  return {
    totalDistance: 20,
    estimatedTime: 90,
    totalTraversals: 100,
    turns: { left: 10, right: 10, uTurn: 0, straight: 80 },
    segmentsRouted: 100,
    segmentsExcluded: 2,
    ...overrides,
  };
}

function makePrediction(overrides: Partial<CostPrediction> = {}): CostPrediction {
  return {
    predictedTime: 90,
    predictedFuelConsumption: 6,
    predictedTotalCost: 150,
    confidenceScore: 0.9,
    costBreakdown: { fuel: 50, labor: 70, maintenance: 15, overhead: 15 },
    riskFactors: [],
    optimizationSuggestions: [],
    ...overrides,
  };
}

function makeWeather(overrides: Partial<CurrentWeather> = {}): CurrentWeather {
  return {
    lat: 45.5, lon: -73.5, timestamp: 1700000000,
    temp: 10, feelsLike: 8, pressure: 1013, humidity: 60,
    visibility: 9000, windSpeed: 3, windDeg: 180, clouds: 20,
    condition: { id: 800, main: "Clear", description: "clear sky", icon: "01d" },
    ...overrides,
  };
}

function makeRequest(overrides: Partial<CostOptimizationRequest> = {}): CostOptimizationRequest {
  return {
    routeStats: makeRouteStats(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CostPredictionService — singleton", () => {
  it("getInstance returns the same instance as the exported singleton", () => {
    const a = CostPredictionService.getInstance();
    const b = CostPredictionService.getInstance();
    expect(a).toBe(b);
    expect(a).toBe(costPredictionService);
  });
});

describe("getCostAwareRecommendations — happy path", () => {
  beforeEach(() => {
    mockPredictCosts.mockResolvedValue(makePrediction());
  });

  it("returns a recommendation with expected shape", async () => {
    const rec = await costPredictionService.getCostAwareRecommendations(makeRequest());
    expect(rec).not.toBeNull();
    expect(typeof rec!.routeId).toBe("string");
    expect(rec!.predictedCosts).toBeDefined();
    expect(rec!.costEfficiencyScore).toBeGreaterThanOrEqual(0);
    expect(rec!.costEfficiencyScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(rec!.alternativeRoutes)).toBe(true);
    expect(Array.isArray(rec!.optimizationOpportunities)).toBe(true);
    expect(rec!.riskAssessment).toBeDefined();
  });

  it("risk is 'low' when confidence is high and weather is calm", async () => {
    const rec = await costPredictionService.getCostAwareRecommendations(
      makeRequest({ weatherData: makeWeather() }),
    );
    expect(rec!.riskAssessment.costOverrunRisk).toBe("low");
  });

  it("risk is 'high' when confidence is low", async () => {
    mockPredictCosts.mockResolvedValue(makePrediction({ confidenceScore: 0.5 }));
    const rec = await costPredictionService.getCostAwareRecommendations(makeRequest());
    expect(rec!.riskAssessment.costOverrunRisk).toBe("high");
  });

  it("identifies fuel optimization opportunity when fuel > 40% of total", async () => {
    // fuel: 80, total: 150 → 53% → should flag
    mockPredictCosts.mockResolvedValue(makePrediction({ costBreakdown: { fuel: 80, labor: 40, maintenance: 15, overhead: 15 } }));
    const rec = await costPredictionService.getCostAwareRecommendations(makeRequest());
    const hasFuelOpportunity = rec!.optimizationOpportunities.some((o) =>
      o.toLowerCase().includes("fuel"),
    );
    expect(hasFuelOpportunity).toBe(true);
  });

  it("always includes the 'track actual costs' opportunity", async () => {
    const rec = await costPredictionService.getCostAwareRecommendations(makeRequest());
    const hasTrackCosts = rec!.optimizationOpportunities.some((o) =>
      o.toLowerCase().includes("track actual"),
    );
    expect(hasTrackCosts).toBe(true);
  });
});

describe("getCostAwareRecommendations — fallback path", () => {
  beforeEach(() => {
    mockPredictCosts.mockResolvedValue(null);
  });

  it("returns a fallback recommendation when prediction is null", async () => {
    const rec = await costPredictionService.getCostAwareRecommendations(makeRequest());
    expect(rec).not.toBeNull();
    expect(rec!.routeId).toMatch(/^fallback_route_/);
    expect(rec!.costEfficiencyScore).toBe(50);
    expect(rec!.riskAssessment.costOverrunRisk).toBe("medium");
  });

  it("fallback includes weather risk factor when rain is heavy", async () => {
    const rec = await costPredictionService.getCostAwareRecommendations(
      makeRequest({ weatherData: makeWeather({ rain1h: 10 }) }),
    );
    const factors = rec!.riskAssessment.primaryRiskFactors.join(" ");
    expect(factors.toLowerCase()).toContain("weather");
  });
});

describe("getBudgetRecommendations", () => {
  it("returns withinBudget=true when costs are below constraints", async () => {
    mockPredictCosts.mockResolvedValue(makePrediction({ predictedTotalCost: 100 }));
    const result = await costPredictionService.getBudgetRecommendations(
      makeRequest({ budgetConstraints: { maxTotalCost: 200 } }),
    );
    expect(result.withinBudget).toBe(true);
    expect(result.costReductionNeeded).toBe(0);
  });

  it("returns withinBudget=false and calculates reduction needed", async () => {
    mockPredictCosts.mockResolvedValue(makePrediction({ predictedTotalCost: 250 }));
    const result = await costPredictionService.getBudgetRecommendations(
      makeRequest({ budgetConstraints: { maxTotalCost: 200 } }),
    );
    expect(result.withinBudget).toBe(false);
    expect(result.costReductionNeeded).toBeCloseTo(50, 1);
    expect(result.recommendations.some((r) => r.includes("50.00"))).toBe(true);
  });

  it("flags fuel budget breach", async () => {
    mockPredictCosts.mockResolvedValue(makePrediction({ costBreakdown: { fuel: 100, labor: 50, maintenance: 10, overhead: 10 } }));
    const result = await costPredictionService.getBudgetRecommendations(
      makeRequest({ budgetConstraints: { maxFuelCost: 50 } }),
    );
    expect(result.withinBudget).toBe(false);
    expect(result.recommendations.some((r) => r.toLowerCase().includes("fuel"))).toBe(true);
  });
});

describe("compareRouteCosts", () => {
  it("ranks routes by cost efficiency", async () => {
    mockPredictCosts
      .mockResolvedValueOnce(makePrediction({ predictedTotalCost: 200 }))
      .mockResolvedValueOnce(makePrediction({ predictedTotalCost: 100 }));

    const routes = [
      { routeId: "r1", routeName: "Expensive", routeStats: makeRouteStats() },
      { routeId: "r2", routeName: "Cheap", routeStats: makeRouteStats() },
    ];
    const results = await costPredictionService.compareRouteCosts(routes);
    expect(results).toHaveLength(2);
    // costRank 1 should be the more efficient one
    const rank1 = results.find((r) => r.costRank === 1);
    expect(rank1?.routeId).toBe("r2");
  });

  it("filters out routes where prediction is null", async () => {
    mockPredictCosts
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makePrediction({ predictedTotalCost: 100 }));

    const routes = [
      { routeId: "r1", routeStats: makeRouteStats() },
      { routeId: "r2", routeStats: makeRouteStats() },
    ];
    const results = await costPredictionService.compareRouteCosts(routes);
    expect(results).toHaveLength(1);
    expect(results[0]!.routeId).toBe("r2");
  });
});

describe("updateWithActualCosts — learning queue", () => {
  it("accumulates updates without processing until batch is full", async () => {
    mockLearnFromActualData.mockResolvedValue(undefined);

    // Fresh instance to have isolated queue
    const svc = new (CostPredictionService as any)();
    svc.learningBatchSize = 3;
    svc.costLearningQueue = [];

    const update: CostLearningUpdate = {
      routeId: "r1",
      predictedCosts: makePrediction(),
      actualCosts: {
        actualTime: 95, actualFuelConsumption: 7, actualStopsCompleted: 20,
        maintenanceCosts: 10, laborCosts: 80, totalCost: 160, customerComplaints: 0, safetyIncidents: 0,
      },
      routeStats: makeRouteStats(),
    };

    await svc.updateWithActualCosts(update);
    await svc.updateWithActualCosts(update);
    expect(mockLearnFromActualData).not.toHaveBeenCalled();

    await svc.updateWithActualCosts(update); // triggers batch
    expect(mockLearnFromActualData).toHaveBeenCalledTimes(3);
  });
});
