/**
 * Shared cross-stack fixtures: CSV import, GeoJSON import mapping, local TSP solver, perf smoke.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseRouteCSV } from "@/lib/route-import/csvRoute";
import { solveLocal } from "@/lib/routeSolverLocal";
import {
  FIXTURES_ROOT,
  loadPerfLoadFixture,
  loadTspZShapeFixture,
  readFixtureUtf8,
  toImportPointsFromAntimeridianFixture,
  toSolverPointsFromPerfFixture,
  toSolverPointsFromTspFixture,
} from "@/shared/test-fixtures/loadFixtures";

describe("shared/test-fixtures", () => {
  it("exposes fixture root next to loadFixtures.ts", () => {
    const marker = path.join(FIXTURES_ROOT, "algorithms", "tsp_z_shape.json");
    expect(readFileSync(marker, "utf8")).toContain("tsp_z_shape");
  });

  it("parses malformed_headers.csv (latitide typo) like production CSV import", () => {
    const csv = readFixtureUtf8("parsers/malformed_headers.csv");
    const { points, warnings } = parseRouteCSV(csv);
    expect(warnings).toEqual([]);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      lat: 45.4215,
      lon: -75.6972,
      name: "Stop A",
      type: "bin",
      demand: 2,
      timeWindow: { start: "08:00", end: "10:00" },
      serviceTime: 120,
    });
    expect(points[1]).toMatchObject({
      lat: 45.424,
      lon: -75.695,
      name: "Stop B",
      type: "dumpster",
      demand: 4,
      timeWindow: { start: "09:00", end: "11:30" },
      serviceTime: 180,
    });
  });

  it("maps antimeridian_wrap.geojson to import points with time windows", () => {
    const points = toImportPointsFromAntimeridianFixture();
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({
      id: "am-1",
      lat: 10,
      lon: 179.9,
      name: "West of antimeridian",
      type: "waypoint",
      demand: 1,
      timeWindow: { start: "08:00", end: "12:00" },
    });
    expect(points[1]).toMatchObject({
      id: "am-2",
      lat: 10,
      lon: -179.9,
      timeWindow: { start: "08:15", end: "12:15" },
    });
  });

  it("solves tsp_z_shape fixture with local 2-opt and expected visit order", async () => {
    const fixture = loadTspZShapeFixture();
    const points = toSolverPointsFromTspFixture(fixture);
    const result = await solveLocal(points, { algorithm: "2-opt" });
    const ids = result.orderedPoints.map((p) => p.id);
    expect(ids).toEqual(fixture.expected_sequence);
  });

  it("load_200_points supplies >=200 solver points and local solve completes", async () => {
    const perf = loadPerfLoadFixture();
    expect(perf.points.length).toBeGreaterThanOrEqual(200);
    if (perf.expected?.point_count != null) {
      expect(perf.points.length).toBe(perf.expected.point_count);
    }
    const points = toSolverPointsFromPerfFixture(perf);
    const t0 = performance.now();
    const result = await solveLocal(points, { algorithm: "nearest-neighbor" });
    const elapsed = performance.now() - t0;
    expect(result.orderedPoints.length).toBe(points.length);
    expect(elapsed).toBeLessThan(perf.expected?.max_local_solve_time_ms_target ?? 30_000);
  });
});
