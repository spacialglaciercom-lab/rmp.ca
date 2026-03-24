/**
 * Shared test fixtures: load files and map to shapes used by import + solver tests.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { featureCollectionToImportPoints } from "@/lib/route-import/geojsonPoints";
import type { ParsedRoutePoint } from "@/lib/route-import/pointTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURES_ROOT = __dirname;

/** Matches lib/routeSolver SolverPoint fields used in local solve. */
export interface FixtureSolverPoint {
  id: string;
  lat: number;
  lon: number;
  name?: string;
  demand?: number;
  serviceTime?: number;
  timeWindow?: {
    start?: string;
    end?: string;
  };
}

export function readFixtureUtf8(relativePath: string): string {
  return readFileSync(path.join(__dirname, relativePath), "utf8");
}

export interface TspZShapeFixture {
  name: string;
  description?: string;
  input_points: Array<{
    id: string;
    lat: number;
    lon: number;
    name?: string;
    demand?: number;
  }>;
  expected_sequence: string[];
}

export function loadTspZShapeFixture(): TspZShapeFixture {
  return JSON.parse(readFixtureUtf8("algorithms/tsp_z_shape.json")) as TspZShapeFixture;
}

export function toSolverPointsFromTspFixture(fixture: TspZShapeFixture): FixtureSolverPoint[] {
  return fixture.input_points.map((p) => ({
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    name: p.name,
    demand: p.demand,
  }));
}

export interface PerfLoadFixture {
  name: string;
  format: string;
  columns: string[];
  points: Array<[string, number, number, number, number]>;
  expected?: {
    point_count?: number;
    max_local_solve_time_ms_target?: number;
    warn_if_ui_blocking_over_ms?: number;
  };
}

export function loadPerfLoadFixture(): PerfLoadFixture {
  return JSON.parse(readFixtureUtf8("perf/load_200_points.json")) as PerfLoadFixture;
}

export function toSolverPointsFromPerfFixture(fixture: PerfLoadFixture): FixtureSolverPoint[] {
  return fixture.points.map((row) => ({
    id: row[0],
    lat: row[1],
    lon: row[2],
    demand: row[3],
    serviceTime: row[4],
  }));
}

export interface AntimeridianFixture {
  type: "FeatureCollection";
  name?: string;
  features: unknown[];
  expected?: {
    srid?: number;
    route_should_cross_antimeridian?: boolean;
    max_direct_pair_distance_meters?: number;
  };
}

export function loadAntimeridianFixture(): AntimeridianFixture {
  return JSON.parse(readFixtureUtf8("spatial/antimeridian_wrap.geojson")) as AntimeridianFixture;
}

export function toImportPointsFromAntimeridianFixture(): ParsedRoutePoint[] {
  const data = loadAntimeridianFixture();
  return featureCollectionToImportPoints({
    type: "FeatureCollection",
    features: data.features as Parameters<typeof featureCollectionToImportPoints>[0]["features"],
  });
}
