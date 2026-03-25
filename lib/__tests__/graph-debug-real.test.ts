/**
 * Graph Debug Test — Real GeoJSON from extract-viveaxgqat.geojson
 *
 * Loads the actual OSM extract, builds the graph, and runs all
 * debug diagnostics to expose loops, duplicates, and structural issues.
 *
 * Run: pnpm test lib/__tests__/graph-debug-real.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GeoJSONParser } from "../route-optimizer-v2/geojsonParser";
import { RouteOptimizer } from "../route-optimizer-v2/routeOptimizer";
import {
  snapshotGraph,
  createTraversalTracer,
  analyzeEdgePatterns,
  printGraphSummary,
  printTraversalTrace,
  type AdjGraph,
  type AdjEntry,
} from "../route-optimizer-v2/graph-debug";

// ─── Load real GeoJSON ──────────────────────────────────────────────────────

const GEOJSON_PATH = "/home/drone/Downloads/extract-viveaxgqat.geojson";

function loadRealGeoJSON() {
  const raw = readFileSync(GEOJSON_PATH, "utf-8");
  return JSON.parse(raw);
}

// ─── Convert RouteOptimizer's private graph to our AdjGraph type ─────────────

function extractGraph(optimizer: RouteOptimizer): AdjGraph {
  // Access private originalGraph via (optimizer as any)
  const internalGraph: Map<string, Array<{
    target: string;
    data: { length: number; oneway: boolean; direction?: string; oneway_violation?: boolean; wayId?: string; geometry?: Array<[number, number]> };
    edgeId: string;
  }>> = (optimizer as any).originalGraph;

  const graph: AdjGraph = new Map();
  for (const [nodeId, entries] of internalGraph.entries()) {
    const adjList: AdjEntry[] = entries.map((e) => ({
      target: e.target,
      edgeId: e.edgeId,
      data: {
        length: e.data.length,
        oneway: e.data.oneway,
        direction: e.data.direction as "forward" | "reverse" | undefined,
        oneway_violation: e.data.oneway_violation,
        wayId: e.data.wayId,
        geometry: e.data.geometry,
      },
    }));
    graph.set(nodeId, adjList);
  }
  return graph;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("graph-debug on real GeoJSON (extract-viveaxgqat)", () => {
  let geojson: ReturnType<typeof loadRealGeoJSON>;

  it("loads, builds graph, runs optimizer, and prints full diagnostics", () => {
    geojson = loadRealGeoJSON();
    expect(geojson.features.length).toBeGreaterThan(0);

    const parser = new GeoJSONParser();
    const { nodes, ways } = parser.parseGeoJSON(geojson);

    console.log(`\n=== GEOJSON SUMMARY ===`);
    console.log(`Total features: ${geojson.features.length}`);
    console.log(`LineStrings (roads): ${geojson.features.filter((f: any) => f.geometry.type === "LineString").length}`);
    console.log(`Points (nodes): ${geojson.features.filter((f: any) => f.geometry.type === "Point").length}`);
    console.log(`Parsed nodes: ${nodes.size}`);
    console.log(`Parsed ways: ${ways.length}`);

    const onewayCount = ways.filter(
      (w) => w.tags?.oneway === "yes" || w.tags?.oneway === "-1" || w.tags?.oneway === "1",
    ).length;
    console.log(`Oneway streets: ${onewayCount}`);

    // Build optimizer
    const optimizer = new RouteOptimizer(nodes, ways, {
      antiLoopMode: "standard",
    });

    // Extract the internal graph BEFORE optimize (originalGraph)
    const internalGraph: AdjGraph | undefined = (optimizer as any).originalGraph;
    if (internalGraph) {
      const snapshot = snapshotGraph(internalGraph);
      printGraphSummary(snapshot);

      const patterns = analyzeEdgePatterns(internalGraph);
      console.log(`\n=== EDGE PATTERN ANALYSIS ===`);
      console.log(`Bidirectional pairs: ${patterns.bidirectionalPairs.length}`);
      console.log(`One-way streets: ${patterns.oneWayStreets.length}`);
      console.log(`Potential U-turn points: ${patterns.potentialUturnPoints.length}`);

      if (patterns.potentialUturnPoints.length > 0) {
        console.log("\n⚠️  Potential U-turn points (first 20):");
        for (const ut of patterns.potentialUturnPoints.slice(0, 20)) {
          console.log(`  Node: ${ut}`);
        }
      }
    }

    // Run optimize — the optimizer's own loop detection will print to stderr
    const result = optimizer.optimize();

    console.log(`\n=== OPTIMIZER RESULT ===`);
    if (result && result.circuit) {
      console.log(`Circuit edges: ${result.circuit.length}`);
      console.log(`Total distance: ${(result.totalDistance / 1000).toFixed(2)} km`);
    } else {
      console.log(`⚠️  No circuit returned (optimizer may have failed due to loops)`);
    }

    const stats = optimizer.getStats();
    console.log(`Stats:`, JSON.stringify(stats, null, 2));

    // Basic sanity
    expect(nodes.size).toBeGreaterThan(0);
    expect(ways.length).toBeGreaterThan(0);
  });
});
