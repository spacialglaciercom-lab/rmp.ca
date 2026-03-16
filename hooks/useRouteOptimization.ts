import { useCallback } from "react";
import { useBetaFeatures } from "@/context/BetaFeaturesContext";
import { recordErrorToCrashlytics } from "@/lib/crashlytics-report";
import { trackEvent } from "@/lib/analytics";
import { createLogger } from "@/lib/logger";
import { getEdgePenaltiesFromLeap } from "@/lib/route-ml-enhancement";
import {
  buildTurnExpandedGraph,
  bridgeAllSCCs,
  makeEulerian,
  precomputeSCCs,
  type PipelineProgressCallback,
} from "@/lib/turnAwareGraph";
import {
  solveTurnAwareCPP,
  turnCircuitToRoutePoints,
} from "@/lib/turnAwareCpp";
import { osmToStreetEdges } from "@/lib/osmToStreetEdges";
import { RouteOptimizer } from "@/lib/route-optimizer-v2";
import type {
  Node,
  Way,
  TurnRestriction,
  TurnPenaltyWeights,
} from "@/lib/route-optimizer-v2/types";
import type { OptimizationResult } from "@/lib/route-optimizer-v2/types";
import {
  getCurrentWeather,
  getWeatherForRoutePoints,
  isWeatherConfigured,
} from "@/services/weatherService";
import {
  analyzeRouteWeather,
  buildSegmentsFromPoints,
  getWeatherPenaltyMultiplier,
  type WeatherAnalysisResult,
} from "@/services/weatherAnalysis";

export interface RouteOptimizationOptions {
  customLat?: number;
  customLon?: number;
  turnPenalties?: TurnPenaltyWeights;
  onewayMode?: "A" | "B";
  turnRestrictions?: TurnRestriction[];
  /** When true, route traverses each street twice (both sides / left and right curb). */
  serviceBothSides?: boolean;
  /** Called with pipeline step updates so the UI can show granular progress. */
  onProgress?: (step: string, detail?: string) => void;
}

export type RouteOptimizationResult =
  | (OptimizationResult & {
      type: "standard";
      weatherAnalysis?: WeatherAnalysisResult;
    })
  | {
      type: "turn-aware";
      route: { latitude: number; longitude: number }[];
      totalDistance: number;
      message: string;
      weatherAnalysis?: WeatherAnalysisResult;
      stats?: {
        right_turns: number;
        left_turns: number;
        u_turns: number;
        straight: number;
        total_traversals: number;
        total_distance_km: number;
        efficiency: number;
        oneway_violations: Array<[string, string]>;
        single_pass_segments: Array<[string, string]>;
        dead_ends_identified: number;
        u_turns_avoided: number;
      };
    };

/** Minimal result when optimization fails so we never crash the app. */
const FALLBACK_RESULT: RouteOptimizationResult = {
  type: "standard",
  route: [],
  totalDistance: 0,
  message: "Optimization failed. Please try again.",
};

const log = createLogger("RouteOptimization");

export function useRouteOptimization() {
  const { features, recordCrash } = useBetaFeatures();

  const optimizeRoute = useCallback(
    async (
      nodes: Map<string, Node>,
      ways: Way[],
      options: RouteOptimizationOptions = {},
    ): Promise<RouteOptimizationResult> => {
    const {
      customLat,
      customLon,
      turnPenalties,
      onewayMode = "B",
      turnRestrictions = [],
      serviceBothSides = false,
      onProgress,
    } = options;

    let mlEdgePenalties: Map<string, number> | undefined;

    const mergeWeatherPenalty = (
      edgePenalties: Map<string, number> | undefined,
      weatherPenalty: number,
      wayIds: string[],
    ): Map<string, number> => {
      const out = new Map(edgePenalties ?? []);
      for (const id of wayIds) {
        out.set(id, (out.get(id) ?? 0) + weatherPenalty);
      }
      return out;
    };

    const runStandard = (
      edgePenalties?: Map<string, number>,
    ): RouteOptimizationResult => {
      const optimizer = new RouteOptimizer(
        nodes,
        ways,
        onewayMode,
        turnRestrictions,
        edgePenalties,
        { serviceBothSides },
      );
      const result = optimizer.optimize(customLat, customLon, turnPenalties);
      return { ...result, type: "standard" };
    };

    const attachWeatherAnalysis = async (
      result: RouteOptimizationResult,
      routePoints: Array<{ latitude: number; longitude: number }>,
      totalDistanceKm: number,
    ): Promise<RouteOptimizationResult> => {
      if (
        !features.weatherOptimizedRouting ||
        !isWeatherConfigured() ||
        routePoints.length < 2
      ) {
        return result;
      }
      try {
        const points = routePoints.map((p) => ({
          lat: p.latitude,
          lon: p.longitude,
        }));
        const weatherMap = await getWeatherForRoutePoints(points);
        const estimatedMinutes = totalDistanceKm * 3; // rough: ~20 km/h average
        const segments = buildSegmentsFromPoints(points, estimatedMinutes);
        const analysis = await analyzeRouteWeather(segments, weatherMap, {
          useLeap: features.weatherOptimizedRouting,
        });
        return { ...result, weatherAnalysis: analysis };
      } catch {
        return result;
      }
    };

    try {
      // --- Fetch weather & ML penalties (can run in parallel with graph work) ---
      const fetchPenaltiesAsync = async (): Promise<{
        mlPenalties?: Map<string, number>;
        weatherSummary: string | null;
      }> => {
        let penalties: Map<string, number> | undefined;
        let weatherSummary: string | null = null;
        if (
          features.weatherOptimizedRouting &&
          isWeatherConfigured() &&
          nodes.size > 0
        ) {
          try {
            const arr = Array.from(nodes.values());
            const centLat =
              arr.length > 0
                ? arr.reduce((s, n) => s + n.lat, 0) / arr.length
                : 0;
            const centLon =
              arr.length > 0
                ? arr.reduce((s, n) => s + n.lon, 0) / arr.length
                : 0;
            const weather = await Promise.race([
              getCurrentWeather(centLat, centLon).catch(() => null),
              new Promise<null>((r) => setTimeout(() => r(null), 8000)),
            ]);
            if (weather) {
              weatherSummary = `${weather.condition.main}, ${weather.temp}°C, vis ${(weather.visibility / 1000).toFixed(1)}km, wind ${weather.windSpeed}m/s`;
              const weatherPenalty = getWeatherPenaltyMultiplier(weather);
              if (weatherPenalty > 0 && ways.length > 0) {
                penalties = mergeWeatherPenalty(
                  penalties,
                  weatherPenalty,
                  ways.map((w) => w.id),
                );
              }
            }
          } catch {
            /* continue without weather */
          }
        }
        if (features.enabled && features.learnedPenalties) {
          try {
            const leapPenalties = await Promise.race([
              getEdgePenaltiesFromLeap(ways, weatherSummary ?? undefined),
              new Promise<Map<string, number>>((r) =>
                setTimeout(() => r(new Map()), 8000),
              ),
            ]);
            const merged = new Map(penalties ?? []);
            leapPenalties.forEach((v, k) =>
              merged.set(k, (merged.get(k) ?? 0) + v),
            );
            penalties = merged;
          } catch {
            /* continue without LEAP */
          }
        }
        return { mlPenalties: penalties, weatherSummary };
      };

      if (features.turnAwareCpp) {
        // Start penalty fetches in parallel with street edge conversion
        const penaltiesPromise = fetchPenaltiesAsync();

        onProgress?.("street-edges", "Converting OSM to street edges...");
        const streetEdges = osmToStreetEdges(nodes, ways);
        log.debug("streetEdges", {
          count: streetEdges.length,
          sample: JSON.stringify(streetEdges.slice(0, 3).map((e) => ({
            id: e.id,
            from: e.from,
            to: e.to,
            coords: e.coordinates.length,
            len: Math.round(e.length),
          }))),
        });
        if (streetEdges.length === 0) {
          mlEdgePenalties = (await penaltiesPromise).mlPenalties;
          return runStandard(mlEdgePenalties);
        }

        // Wait for penalties before building turn graph (penalties affect edge costs)
        const { mlPenalties } = await penaltiesPromise;
        mlEdgePenalties = mlPenalties;

        onProgress?.("turn-graph", "Building turn-expanded graph...");
        const { nodes: turnNodes, edges: turnEdges } =
          await buildTurnExpandedGraph(
            streetEdges,
            undefined,
            mlEdgePenalties,
            onProgress,
          );
        log.debug("turn graph built", {
          turnNodes: turnNodes.length,
          turnEdges: turnEdges.length,
        });
        if (turnEdges.length === 0) return runStandard(mlEdgePenalties);

        // Compute SCCs once and reuse for bridging (avoids double traversal)
        onProgress?.("scc", "Computing connected components...");
        const cachedSCCs = precomputeSCCs(turnEdges);

        // Bridge disconnected SCCs so no segments are silently dropped
        onProgress?.("bridge", "Bridging disconnected components...");
        const preBridgeCount = turnEdges.length;
        const bridged = await bridgeAllSCCs(
          turnEdges,
          streetEdges,
          cachedSCCs,
          onProgress,
        );
        log.debug("bridged edges", {
          total: bridged.length,
          bridges: bridged.length - preBridgeCount,
        });

        // Balance in/out degrees to make graph Eulerian
        onProgress?.("eulerian", "Balancing graph for Eulerian circuit...");
        const preEulerianCount = bridged.length;
        const eulerianEdges = await makeEulerian(bridged, onProgress);
        log.debug("eulerian edges", {
          total: eulerianEdges.length,
          deadhead: eulerianEdges.length - preEulerianCount,
        });

        onProgress?.("circuit", "Solving Eulerian circuit...");
        const { circuit, totalCost, stats } = solveTurnAwareCPP(eulerianEdges);
        log.debug("circuit solved", {
          length: circuit.length,
          totalCost: Math.round(totalCost),
        });

        // Build edge lookup once for debug stats, distance, and route points
        const edgeLookup = new Map<string, (typeof streetEdges)[0]>();
        for (let si = 0; si < streetEdges.length; si++) {
          edgeLookup.set(streetEdges[si]!.id, streetEdges[si]!);
        }

        // Single pass over circuit for all stats (avoids 6+ separate .filter() passes)
        let validRefs = 0,
          bridgeCount = 0,
          deadheadRefs = 0,
          missingRefs = 0;
        let deadheadCount = 0,
          distanceMeters = 0;
        const coveredEdgeIds = new Set<string>();
        const sampleMissing: string[] = [];
        for (let ci = 0; ci < circuit.length; ci++) {
          const e = circuit[ci]!;
          if (e.bridge) {
            bridgeCount++;
            deadheadCount++;
            continue;
          }
          if (e.deadhead) {
            deadheadCount++;
            deadheadRefs++;
          }
          coveredEdgeIds.add(e.to.edgeId);
          const streetEdge = edgeLookup.get(e.to.edgeId);
          if (streetEdge) {
            validRefs++;
            distanceMeters += streetEdge.length;
          } else {
            missingRefs++;
            if (sampleMissing.length < 3) sampleMissing.push(e.to.edgeId);
          }
        }
        const distanceFromLength = distanceMeters / 1000;

        log.debug("circuit edge refs", {
          total: circuit.length,
          validStreetEdge: validRefs,
          bridges: bridgeCount,
          deadheadNonBridge: deadheadRefs,
          missingEdgeId: missingRefs,
          sampleMissing: JSON.stringify(sampleMissing),
        });

        const routePoints = turnCircuitToRoutePoints(streetEdges, circuit);
        log.debug("route points built", { count: routePoints.length });

        // Track segment coverage
        const uniqueStreetEdgeIds = new Set<string>();
        for (let si = 0; si < streetEdges.length; si++) {
          uniqueStreetEdgeIds.add(streetEdges[si]!.id);
        }
        let missingEdgeCount = 0;
        uniqueStreetEdgeIds.forEach((id) => {
          if (!coveredEdgeIds.has(id)) missingEdgeCount++;
        });
        const coveragePct =
          uniqueStreetEdgeIds.size > 0
            ? (coveredEdgeIds.size / uniqueStreetEdgeIds.size) * 100
            : 100;

        let turnAwareResult: RouteOptimizationResult = {
          type: "turn-aware",
          route: routePoints,
          totalDistance: distanceFromLength,
          message: `Turn-aware route. Distance: ${distanceFromLength.toFixed(2)} km. Coverage: ${coveragePct.toFixed(0)}% (${coveredEdgeIds.size}/${uniqueStreetEdgeIds.size} segments). Right: ${stats.right}, Left: ${stats.left}, U-turns: ${stats.uTurn}, Straight: ${stats.straight}. Deadhead: ${deadheadCount}, Bridges: ${bridgeCount}. Total time: ${totalCost.toFixed(0)}s.`,
          stats: {
            right_turns: stats.right,
            left_turns: stats.left,
            u_turns: stats.uTurn,
            straight: stats.straight,
            total_traversals: circuit.length,
            total_distance_km: distanceFromLength,
            efficiency: coveragePct,
            oneway_violations: [],
            single_pass_segments: [],
            dead_ends_identified: missingEdgeCount,
            u_turns_avoided: 0,
          },
        };
        turnAwareResult = await attachWeatherAnalysis(
          turnAwareResult,
          routePoints,
          distanceFromLength,
        );
        trackEvent("route_optimized", {
          type: "turn_aware",
          distance_km: Math.round(distanceFromLength * 10) / 10,
        });
        return turnAwareResult;
      }
      // Standard (non-turn-aware) path: fetch penalties sequentially as before
      const { mlPenalties } = await fetchPenaltiesAsync();
      mlEdgePenalties = mlPenalties;
      let result = runStandard(mlEdgePenalties);
      const routePoints = "route" in result ? result.route : [];
      const totalKm = "totalDistance" in result ? result.totalDistance : 0;
      result = await attachWeatherAnalysis(result, routePoints, totalKm);
      trackEvent("route_optimized", {
        type: "standard",
        distance_km: Math.round(totalKm * 10) / 10,
      });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error("route optimization failed", err);
      if (features.enabled) await recordCrash();
      recordErrorToCrashlytics(err, "RouteOptimizationFallback", {
        message: err.message,
      });
      try {
        return runStandard(mlEdgePenalties);
      } catch {
        return FALLBACK_RESULT;
      }
    }
  }, [features, recordCrash]);

  return { optimizeRoute, isTurnAware: features.turnAwareCpp };
}
