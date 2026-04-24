import { describe, it, expect } from "vitest";
import { splitRouteAtTeleportGaps } from "../coord-utils";

describe("splitRouteAtTeleportGaps", () => {
  it("returns one group when all hops are short", () => {
    const pts = [
      { lat: 45.5, lon: -73.55 },
      { lat: 45.501, lon: -73.55 },
      { lat: 45.502, lon: -73.551 },
    ];
    const g = splitRouteAtTeleportGaps(pts, 600);
    expect(g.length).toBe(1);
    expect(g[0]!.length).toBe(3);
  });

  it("splits when consecutive points are farther than the gap threshold", () => {
    const pts = [
      { lat: 0, lon: 0 },
      { lat: 0.001, lon: 0 },
      { lat: 10, lon: 10 },
      { lat: 10.001, lon: 10 },
    ];
    const g = splitRouteAtTeleportGaps(pts, 600);
    expect(g.length).toBe(2);
    expect(g[0]!.length).toBe(2);
    expect(g[1]!.length).toBe(2);
  });
});
