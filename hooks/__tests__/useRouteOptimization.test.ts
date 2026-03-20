/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { BetaFeatures } from "@/types/turnAware";
import type { Node, Way } from "@/lib/route-optimizer-v2/types";

const recordCrash = vi.fn().mockResolvedValue(undefined);

const baseBeta: BetaFeatures = {
  enabled: false,
  turnAwareCpp: false,
  learnedPenalties: false,
  weatherOptimizedRouting: false,
  voiceCoPilot: false,
  routeMasterConstraints: false,
  moonshineVoice: false,
  vehicleBreakdown: false,
  emergencyStopInsertion: false,
  realTimeTrafficFeed: false,
  crashCount: 0,
};

let betaFeatures: BetaFeatures = { ...baseBeta };

vi.mock("@/context/BetaFeaturesContext", () => ({
  useBetaFeatures: () => ({
    features: betaFeatures,
    recordCrash,
    enableBeta: vi.fn(),
    disableBeta: vi.fn(),
    toggleTurnAware: vi.fn(),
    toggleLearnedPenalties: vi.fn(),
    toggleWeatherOptimizedRouting: vi.fn(),
    toggleVoiceCoPilot: vi.fn(),
    toggleRouteMasterConstraints: vi.fn(),
    toggleMoonshineVoice: vi.fn(),
    toggleVehicleBreakdown: vi.fn(),
    toggleEmergencyStopInsertion: vi.fn(),
    toggleRealTimeTrafficFeed: vi.fn(),
    isExperimentalRoute: false,
  }),
}));

vi.mock("@/lib/crashlytics-report", () => ({
  recordErrorToCrashlytics: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@/services/weatherService", () => ({
  isWeatherConfigured: () => false,
  getCurrentWeather: vi.fn(),
  getWeatherForRoutePoints: vi.fn(),
}));

vi.mock("@/lib/route-ml-enhancement", () => ({
  getEdgePenaltiesFromLeap: vi.fn(() => Promise.resolve(new Map<string, number>())),
}));

vi.mock("@/lib/onlineReopt/trafficFeed", () => ({
  fetchTrafficMultipliers: vi.fn(() => Promise.resolve(new Map())),
  mergeTrafficPenalties: vi.fn(
    (penalties: Map<string, number> | undefined, mults: Map<string, number>) => {
      const out = new Map(penalties ?? []);
      mults.forEach((v, k) => out.set(k, (out.get(k) ?? 0) + v));
      return out;
    },
  ),
}));

const { mockOptimize } = vi.hoisted(() => ({
  mockOptimize: vi.fn(() => ({
    route: [
      { latitude: 45.5, longitude: -73.56 },
      { latitude: 45.51, longitude: -73.57 },
    ],
    totalDistance: 2.5,
    message: "mock optimize ok",
  })),
}));

vi.mock("@/lib/route-optimizer-v2", () => ({
  RouteOptimizer: class RouteOptimizer {
    optimize = mockOptimize;
  },
}));

const setCircuitSpy = vi.fn();
vi.mock("@/stores/circuitStore", () => ({
  useCircuitStore: {
    getState: () => ({
      setCircuit: setCircuitSpy,
      clearCircuit: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/osmToStreetEdges", () => ({
  osmToStreetEdges: vi.fn(() => []),
}));

import { useRouteOptimization } from "../useRouteOptimization";

function tinyGraph(): { nodes: Map<string, Node>; ways: Way[] } {
  const nodes = new Map<string, Node>([
    ["1", { id: "1", lat: 45.5, lon: -73.56 }],
    ["2", { id: "2", lat: 45.51, lon: -73.57 }],
  ]);
  const ways: Way[] = [
    {
      id: "w1",
      nodes: ["1", "2"],
      tags: { highway: "residential" },
    },
  ];
  return { nodes, ways };
}

describe("useRouteOptimization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    betaFeatures = { ...baseBeta };
    mockOptimize.mockImplementation(() => ({
      route: [
        { latitude: 45.5, longitude: -73.56 },
        { latitude: 45.51, longitude: -73.57 },
      ],
      totalDistance: 2.5,
      message: "mock optimize ok",
    }));
  });

  it("returns isTurnAware matching features.turnAwareCpp", () => {
    betaFeatures = { ...baseBeta, turnAwareCpp: true };
    const { result } = renderHook(() => useRouteOptimization());
    expect(result.current.isTurnAware).toBe(true);

    betaFeatures = { ...baseBeta, turnAwareCpp: false };
    const { result: r2 } = renderHook(() => useRouteOptimization());
    expect(r2.current.isTurnAware).toBe(false);
  });

  it("standard path: calls RouteOptimizer and returns type standard result", async () => {
    betaFeatures = { ...baseBeta, turnAwareCpp: false };
    const { result } = renderHook(() => useRouteOptimization());
    const { nodes, ways } = tinyGraph();

    let out: Awaited<ReturnType<typeof result.current.optimizeRoute>>;
    await act(async () => {
      out = await result.current.optimizeRoute(nodes, ways, {
        customLat: 45.5,
        customLon: -73.56,
      });
    });

    expect(out!.type).toBe("standard");
    if (out!.type === "standard") {
      expect(out.route).toHaveLength(2);
      expect(out.totalDistance).toBe(2.5);
      expect(out.message).toBe("mock optimize ok");
    }
    expect(mockOptimize).toHaveBeenCalled();
    expect(setCircuitSpy).not.toHaveBeenCalled();
  });

  it("turn-aware with empty street edges falls back to standard path without setCircuit", async () => {
    betaFeatures = { ...baseBeta, turnAwareCpp: true };
    const { result } = renderHook(() => useRouteOptimization());
    const { nodes, ways } = tinyGraph();

    await act(async () => {
      await result.current.optimizeRoute(nodes, ways);
    });

    expect(mockOptimize).toHaveBeenCalled();
    expect(setCircuitSpy).not.toHaveBeenCalled();
  });

  it("invokes onProgress when turn-aware path runs street-edges step", async () => {
    betaFeatures = { ...baseBeta, turnAwareCpp: true };
    const { result } = renderHook(() => useRouteOptimization());
    const { nodes, ways } = tinyGraph();
    const steps: string[] = [];

    await act(async () => {
      await result.current.optimizeRoute(nodes, ways, {
        onProgress: (step) => steps.push(step),
      });
    });

    expect(steps).toContain("street-edges");
  });

  it("on optimize failure returns fallback after retrying runStandard", async () => {
    betaFeatures = { ...baseBeta, turnAwareCpp: false };
    let call = 0;
    mockOptimize.mockImplementation(() => {
      call += 1;
      if (call === 1) throw new Error("first fail");
      return {
        route: [],
        totalDistance: 0,
        message: "retry ok",
      };
    });

    const { result } = renderHook(() => useRouteOptimization());
    const { nodes, ways } = tinyGraph();

    let out: Awaited<ReturnType<typeof result.current.optimizeRoute>>;
    await act(async () => {
      out = await result.current.optimizeRoute(nodes, ways);
    });

    expect(out!.type).toBe("standard");
    if (out!.type === "standard") {
      expect(out.message).toBe("retry ok");
    }
    expect(mockOptimize).toHaveBeenCalledTimes(2);
  });

  it("when runStandard keeps throwing, returns FALLBACK_RESULT shape", async () => {
    betaFeatures = { ...baseBeta, turnAwareCpp: false };
    mockOptimize.mockImplementation(() => {
      throw new Error("always fail");
    });

    const { result } = renderHook(() => useRouteOptimization());
    const { nodes, ways } = tinyGraph();

    let out: Awaited<ReturnType<typeof result.current.optimizeRoute>>;
    await act(async () => {
      out = await result.current.optimizeRoute(nodes, ways);
    });

    expect(out!.type).toBe("standard");
    if (out!.type === "standard") {
      expect(out.route).toEqual([]);
      expect(out.message).toContain("Optimization failed");
    }
  });
});
