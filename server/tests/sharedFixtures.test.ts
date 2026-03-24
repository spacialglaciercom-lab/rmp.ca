/**
 * Ensures server-side Vitest runs can resolve the same shared fixtures as the app (path sanity).
 */
import { describe, it, expect } from "vitest";

import { solveLocal } from "@/lib/routeSolverLocal";
import {
  loadTspZShapeFixture,
  readFixtureUtf8,
  toSolverPointsFromTspFixture,
} from "@/shared/test-fixtures/loadFixtures";

describe("shared fixtures (server test root)", () => {
  it("reads parser CSV via @/shared path alias", () => {
    const csv = readFixtureUtf8("parsers/malformed_headers.csv");
    expect(csv).toContain("latitide");
  });

  it("matches TSP fixture expected_sequence from repo root", async () => {
    const fixture = loadTspZShapeFixture();
    const result = await solveLocal(toSolverPointsFromTspFixture(fixture), { algorithm: "2-opt" });
    expect(result.orderedPoints.map((p) => p.id)).toEqual(fixture.expected_sequence);
  });
});
