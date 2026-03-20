/**
 * Tests for optimizeFromGeoJSON + RouteOptimizerSimpleV2 + plugin pipeline
 * (lib/offline-optimizer-v2/)
 *
 * Focus areas:
 *  - Basic GeoJSON → route pipeline correctness
 *  - FuelAwarePlugin: uphill edges cost more (affects Dijkstra balancing)
 *  - TurnPenaltyPlugin: left turns penalized vs right turns
 *  - MultiLineString geometry support
 *  - vehicularOnly filtering (footway / cycleway excluded)
 *  - Custom start point snaps to nearest node
 *  - Disconnected components all covered
 *  - Plugin composition (FuelAware + TurnPenalty together)
 */

import { describe, it, expect } from "vitest";
import { optimizeFromGeoJSON } from "../offline-optimizer-v2/optimizeFromGeoJSON";
import {
  FuelAwarePlugin,
  TurnPenaltyPlugin,
  createTurnPenaltyPlugin,
  fuelMultiplier,
  gradePercent,
  getTurnAngle,
  calculateBearing,
} from "../routing_plugins";
import type { GeoJSONFeatureCollection } from "../offline-optimizer-v2/optimizeFromGeoJSON";

// ─── GeoJSON builder helpers ──────────────────────────────────────────────────

function makeLineFeature(
  coords: number[][],
  props: Record<string, unknown> = {},
) {
  return {
    type: "Feature" as const,
    geometry: { type: "LineString" as const, coordinates: coords },
    properties: { highway: "residential", ...props },
  };
}

function makeMultiLineFeature(
  lines: number[][][],
  props: Record<string, unknown> = {},
) {
  return {
    type: "Feature" as const,
    geometry: { type: "MultiLineString" as const, coordinates: lines },
    properties: { highway: "residential", ...props },
  };
}

function makeFC(
  features: ReturnType<typeof makeLineFeature>[],
): GeoJSONFeatureCollection {
  return { type: "FeatureCollection", features };
}

// ─── Triangle GeoJSON ([lon, lat] format) ─────────────────────────────────────
// A=[0,0], B=[0,0.001], C=[0.001,0] → three segments forming a closed triangle
const TRIANGLE_FC = makeFC([
  makeLineFeature(
    [
      [0.0, 0.0],
      [0.0, 0.001],
    ],
    { highway: "residential" },
  ),
  makeLineFeature(
    [
      [0.0, 0.001],
      [0.001, 0.0],
    ],
    { highway: "residential" },
  ),
  makeLineFeature(
    [
      [0.001, 0.0],
      [0.0, 0.0],
    ],
    { highway: "residential" },
  ),
]);

// ─── Basic pipeline correctness ───────────────────────────────────────────────

describe("optimizeFromGeoJSON – basic pipeline", () => {
  it("produces a non-empty route for a simple triangle", () => {
    const result = optimizeFromGeoJSON(TRIANGLE_FC);

    expect(result.route.length).toBeGreaterThan(0);
    expect(result.totalDistance).toBeGreaterThan(0);
    expect(result.message).toMatch(/offline optimizer/i);
  });

  it("returns empty route for empty FeatureCollection", () => {
    const result = optimizeFromGeoJSON(makeFC([]));

    expect(result.route).toHaveLength(0);
    expect(result.totalDistance).toBe(0);
  });

  it("returns empty route when all features have null geometry", () => {
    const fc: GeoJSONFeatureCollection = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: null, properties: {} }],
    };
    const result = optimizeFromGeoJSON(fc);

    expect(result.route).toHaveLength(0);
  });

  it("route points have valid lat/lon values", () => {
    const result = optimizeFromGeoJSON(TRIANGLE_FC);

    for (const pt of result.route) {
      expect(Number.isFinite(pt.latitude)).toBe(true);
      expect(Number.isFinite(pt.longitude)).toBe(true);
      expect(pt.latitude).toBeGreaterThanOrEqual(-90);
      expect(pt.latitude).toBeLessThanOrEqual(90);
      expect(pt.longitude).toBeGreaterThanOrEqual(-180);
      expect(pt.longitude).toBeLessThanOrEqual(180);
    }
  });

  it("all route points have a nodeId", () => {
    const result = optimizeFromGeoJSON(TRIANGLE_FC);

    for (const pt of result.route) {
      expect(typeof pt.nodeId).toBe("string");
      expect(pt.nodeId!.length).toBeGreaterThan(0);
    }
  });

  it("result message includes component count", () => {
    const result = optimizeFromGeoJSON(TRIANGLE_FC);

    expect(result.message).toMatch(/component/i);
  });
});

// ─── MultiLineString support ──────────────────────────────────────────────────

describe("optimizeFromGeoJSON – MultiLineString", () => {
  it("handles a MultiLineString feature correctly", () => {
    const fc = makeFC([
      makeMultiLineFeature([
        [
          [0.0, 0.0],
          [0.0, 0.001],
        ],
        [
          [0.0, 0.001],
          [0.001, 0.0],
        ],
      ]),
    ] as any);

    const result = optimizeFromGeoJSON(fc);
    expect(result.route.length).toBeGreaterThan(0);
  });

  it("mixes LineString and MultiLineString in the same collection", () => {
    const fc: GeoJSONFeatureCollection = {
      type: "FeatureCollection",
      features: [
        makeLineFeature(
          [
            [0.0, 0.0],
            [0.0, 0.001],
          ],
          { highway: "residential" },
        ),
        makeMultiLineFeature([
          [
            [0.0, 0.001],
            [0.001, 0.0],
          ],
          [
            [0.001, 0.0],
            [0.0, 0.0],
          ],
        ]) as any,
      ],
    };

    const result = optimizeFromGeoJSON(fc);
    expect(result.route.length).toBeGreaterThan(0);
  });
});

// ─── vehicularOnly filtering ──────────────────────────────────────────────────

describe("optimizeFromGeoJSON – vehicularOnly filtering", () => {
  it("excludes footway features by default", () => {
    const fc = makeFC([
      makeLineFeature(
        [
          [0.0, 0.0],
          [0.0, 0.001],
        ],
        { highway: "footway" },
      ),
    ]);

    const result = optimizeFromGeoJSON(fc);
    expect(result.route).toHaveLength(0);
  });

  it("excludes cycleway features by default", () => {
    const fc = makeFC([
      makeLineFeature(
        [
          [0.0, 0.0],
          [0.0, 0.001],
        ],
        { highway: "cycleway" },
      ),
    ]);

    const result = optimizeFromGeoJSON(fc);
    expect(result.route).toHaveLength(0);
  });

  it("includes residential and excludes footway in a mixed collection", () => {
    const fc = makeFC([
      makeLineFeature(
        [
          [0.0, 0.0],
          [0.0, 0.001],
        ],
        { highway: "residential" },
      ),
      makeLineFeature(
        [
          [0.0, 0.001],
          [0.0, 0.0],
        ],
        { highway: "residential" },
      ),
      // The footway links far-away coordinates that should not appear in route
      makeLineFeature(
        [
          [10.0, 10.0],
          [10.0, 10.001],
        ],
        { highway: "footway" },
      ),
    ]);

    const result = optimizeFromGeoJSON(fc);
    expect(result.route.length).toBeGreaterThan(0);
    // Footway coords (lon~10) should not appear
    expect(result.route.some((p) => p.longitude > 5)).toBe(false);
  });

  it("vehicularOnly=false includes footway features", () => {
    const fc = makeFC([
      makeLineFeature(
        [
          [0.0, 0.0],
          [0.0, 0.001],
        ],
        { highway: "footway" },
      ),
      makeLineFeature(
        [
          [0.0, 0.001],
          [0.0, 0.0],
        ],
        { highway: "footway" },
      ),
    ]);

    const result = optimizeFromGeoJSON(fc, { vehicularOnly: false });
    expect(result.route.length).toBeGreaterThan(0);
  });

  it("allowClasses option includes only specified road classes", () => {
    const fc = makeFC([
      makeLineFeature(
        [
          [0.0, 0.0],
          [0.0, 0.001],
        ],
        { highway: "primary" },
      ),
      makeLineFeature(
        [
          [0.0, 0.001],
          [0.0, 0.0],
        ],
        { highway: "primary" },
      ),
      makeLineFeature(
        [
          [5.0, 5.0],
          [5.0, 5.001],
        ],
        { highway: "secondary" },
      ),
    ]);

    const result = optimizeFromGeoJSON(fc, { allowClasses: ["primary"] });
    // secondary (lon~5) should be excluded
    expect(result.route.some((p) => p.longitude > 4)).toBe(false);
  });
});

// ─── Custom start point ───────────────────────────────────────────────────────

describe("optimizeFromGeoJSON – custom start point", () => {
  it("starts near the provided coordinates", () => {
    // Square: A=[0,0], B=[0.001,0], C=[0.001,0.001], D=[0,0.001]
    const fc = makeFC([
      makeLineFeature([
        [0.0, 0.0],
        [0.001, 0.0],
      ]),
      makeLineFeature([
        [0.001, 0.0],
        [0.001, 0.001],
      ]),
      makeLineFeature([
        [0.001, 0.001],
        [0.0, 0.001],
      ]),
      makeLineFeature([
        [0.0, 0.001],
        [0.0, 0.0],
      ]),
    ]);

    // Request start near lat=0.001, lon=0.001 (node C)
    const result = optimizeFromGeoJSON(fc, { customLat: 0.001, customLon: 0.001 });

    expect(result.route.length).toBeGreaterThan(0);
    // First point should be close to the requested start
    const first = result.route[0]!;
    const dist = Math.sqrt(
      (first.latitude - 0.001) ** 2 + (first.longitude - 0.001) ** 2,
    );
    expect(dist).toBeLessThan(0.005);
  });
});

// ─── Disconnected components ──────────────────────────────────────────────────

describe("optimizeFromGeoJSON – disconnected components", () => {
  it("covers all segments across two disconnected road clusters", () => {
    const fc = makeFC([
      // Cluster 1: small segment near origin
      makeLineFeature([
        [0.0, 0.0],
        [0.001, 0.0],
      ]),
      makeLineFeature([
        [0.001, 0.0],
        [0.0, 0.0],
      ]),
      // Cluster 2: far away
      makeLineFeature([
        [10.0, 10.0],
        [10.001, 10.0],
      ]),
      makeLineFeature([
        [10.001, 10.0],
        [10.0, 10.0],
      ]),
    ]);

    const result = optimizeFromGeoJSON(fc);

    expect(result.route.length).toBeGreaterThan(0);
    // Both clusters should appear in the route
    const hasOriginCluster = result.route.some((p) => p.longitude < 1);
    const hasRemoteCluster = result.route.some((p) => p.longitude > 9);
    expect(hasOriginCluster).toBe(true);
    expect(hasRemoteCluster).toBe(true);
    // Message should mention 2 components
    expect(result.message).toMatch(/2 component/i);
  });
});

// ─── FuelAwarePlugin ──────────────────────────────────────────────────────────

describe("FuelAwarePlugin – unit tests", () => {
  it("returns 1.0 multiplier for flat road (zero grade)", () => {
    const mult = FuelAwarePlugin.calculateMultiplier(
      [0, 0, 100],
      [0.001, 0, 100],
      {},
      {},
      111,
    );
    expect(mult).toBeCloseTo(1.0, 5);
  });

  it("returns multiplier > 1.0 for uphill road", () => {
    // 10% grade uphill over 100m
    const mult = FuelAwarePlugin.calculateMultiplier(
      [0, 0, 0],
      [0.001, 0, 10], // 10m elevation gain over ~111m
      {},
      {},
      111,
    );
    expect(mult).toBeGreaterThan(1.0);
  });

  it("returns multiplier < 1.0 for steep downhill (within clamp)", () => {
    // Steep downhill — multiplier decreases but is clamped at 0.5
    const mult = FuelAwarePlugin.calculateMultiplier(
      [0, 0, 100],
      [0.001, 0, 0], // 100m elevation drop over ~111m
      {},
      {},
      111,
    );
    expect(mult).toBeGreaterThanOrEqual(0.5);
    expect(mult).toBeLessThan(1.0);
  });

  it("clamps minimum multiplier at 0.5", () => {
    // Extreme downhill: gradePct would go very negative
    const mult = FuelAwarePlugin.calculateMultiplier(
      [0, 0, 10000],
      [0.001, 0, 0],
      {},
      {},
      100,
    );
    expect(mult).toBeGreaterThanOrEqual(0.5);
  });

  it("returns 1.0 transition multiplier (FuelAware has no turn effect)", () => {
    const mult = FuelAwarePlugin.calculateTransitionMultiplier(
      [0, 0, 0],
      [0.001, 0, 0],
      [0.002, 0, 0],
    );
    expect(mult).toBeCloseTo(1.0, 5);
  });
});

describe("FuelAwarePlugin – pipeline integration", () => {
  it("produces a route when FuelAwarePlugin is applied to flat GeoJSON", () => {
    // No elevation ([lon, lat] only — z defaults to 0)
    const result = optimizeFromGeoJSON(TRIANGLE_FC, {
      plugins: [FuelAwarePlugin],
    });

    expect(result.route.length).toBeGreaterThan(0);
    expect(result.totalDistance).toBeGreaterThan(0);
  });

  it("produces a route when FuelAwarePlugin is applied to GeoJSON with elevation", () => {
    // [lon, lat, elevation] — uphill in one direction
    const fc = makeFC([
      makeLineFeature([
        [0.0, 0.0, 0],
        [0.0, 0.001, 50],
      ]),
      makeLineFeature([
        [0.0, 0.001, 50],
        [0.001, 0.0, 0],
      ]),
      makeLineFeature([
        [0.001, 0.0, 0],
        [0.0, 0.0, 0],
      ]),
    ]);

    const result = optimizeFromGeoJSON(fc, { plugins: [FuelAwarePlugin] });
    expect(result.route.length).toBeGreaterThan(0);
  });
});

// ─── TurnPenaltyPlugin ────────────────────────────────────────────────────────

describe("TurnPenaltyPlugin – unit tests", () => {
  it("returns 1.0 multiplier for straight ahead (no turn)", () => {
    // Going north then north again = straight
    const bearingIn = 0; // north
    const bearingOut = 0; // north
    // Simulate: T→U heading north, U→V heading north
    // T=(0,0), U=(0,0.001), V=(0,0.002) — all going north
    const mult = TurnPenaltyPlugin.calculateTransitionMultiplier(
      [0, 0, 0],
      [0, 0.001, 0],
      [0, 0.002, 0],
    );
    expect(mult).toBeCloseTo(1.0, 2);
  });

  it("left turn multiplier > right turn multiplier (default UPS-style penalty)", () => {
    // Create a T-intersection:
    //   T=(0,0), U=(0.001,0) — going east (bearing ~90°)
    //   V_right=(0.001,-0.001) — turning right (south, bearing ~180°)... wait
    // Actually going east, then turning left = going north, right = going south
    // Using lat/lon: east = increasing lon
    //   T=[0, 0] (lon=0, lat=0), U=[0.001, 0] (lon=0.001, lat=0)
    //   V_left=[0.001, 0.001] (going north = left turn from east)
    //   V_right=[0.001, -0.001] (going south = right turn from east)

    const leftMult = TurnPenaltyPlugin.calculateTransitionMultiplier(
      [0, 0, 0], // T
      [0.001, 0, 0], // U (went east)
      [0.001, 0.001, 0], // V (going north = left turn)
    );
    const rightMult = TurnPenaltyPlugin.calculateTransitionMultiplier(
      [0, 0, 0], // T
      [0.001, 0, 0], // U (went east)
      [0.001, -0.001, 0], // V (going south = right turn)
    );

    // Default: leftMult=1.4, rightMult=1.0
    expect(leftMult).toBeGreaterThan(rightMult);
  });

  it("U-turn gets the highest multiplier", () => {
    // Going east then reversing (U-turn)
    const uTurnMult = TurnPenaltyPlugin.calculateTransitionMultiplier(
      [0, 0, 0], // T
      [0.001, 0, 0], // U
      [0, 0, 0], // V = back to T (U-turn)
    );
    const straightMult = TurnPenaltyPlugin.calculateTransitionMultiplier(
      [0, 0, 0],
      [0.001, 0, 0],
      [0.002, 0, 0], // continuing east
    );
    expect(uTurnMult).toBeGreaterThan(straightMult);
  });

  it("createTurnPenaltyPlugin accepts custom multipliers", () => {
    const plugin = createTurnPenaltyPlugin({
      leftMult: 2.0,
      rightMult: 0.8,
      uTurnMult: 5.0,
    });

    // Left turn should cost 2x
    const leftMult = plugin.calculateTransitionMultiplier(
      [0, 0, 0],
      [0.001, 0, 0],
      [0.001, 0.001, 0],
    );
    expect(leftMult).toBeCloseTo(2.0, 1);
  });

  it("calculateMultiplier always returns 1.0 (TurnPenalty is a transition-only plugin)", () => {
    const mult = TurnPenaltyPlugin.calculateMultiplier(
      [0, 0, 0],
      [0.001, 0, 0],
      {},
      {},
      111,
    );
    expect(mult).toBe(1.0);
  });
});

describe("TurnPenaltyPlugin – pipeline integration", () => {
  it("produces a route with TurnPenaltyPlugin applied", () => {
    const result = optimizeFromGeoJSON(TRIANGLE_FC, {
      plugins: [TurnPenaltyPlugin],
    });

    expect(result.route.length).toBeGreaterThan(0);
  });

  it("produces a route with both FuelAware and TurnPenalty plugins composed", () => {
    const result = optimizeFromGeoJSON(TRIANGLE_FC, {
      plugins: [FuelAwarePlugin, TurnPenaltyPlugin],
    });

    expect(result.route.length).toBeGreaterThan(0);
    expect(result.totalDistance).toBeGreaterThan(0);
  });

  it("plugin pipeline covers same nodes as no-plugin optimization", () => {
    const withPlugins = optimizeFromGeoJSON(TRIANGLE_FC, {
      plugins: [FuelAwarePlugin, TurnPenaltyPlugin],
    });
    const noPlugins = optimizeFromGeoJSON(TRIANGLE_FC);

    // Both should visit the same geographic area
    const pluginLons = new Set(withPlugins.route.map((p) => p.longitude.toFixed(3)));
    const noPluginLons = new Set(noPlugins.route.map((p) => p.longitude.toFixed(3)));
    expect(pluginLons).toEqual(noPluginLons);
  });
});

// ─── Math helper functions ────────────────────────────────────────────────────

describe("routing_plugins – math helpers", () => {
  describe("gradePercent", () => {
    it("returns 0 for zero distance (division guard)", () => {
      expect(gradePercent(0, 100, 0)).toBe(0);
      expect(gradePercent(0, 100, 0.5)).toBe(0); // < 1m threshold
    });

    it("returns correct percentage for 10m rise over 100m", () => {
      expect(gradePercent(0, 10, 100)).toBeCloseTo(10, 5);
    });

    it("returns negative for downhill", () => {
      expect(gradePercent(100, 0, 100)).toBeCloseTo(-100, 5);
    });
  });

  describe("fuelMultiplier", () => {
    it("returns 1.0 for zero grade", () => {
      expect(fuelMultiplier(0)).toBe(1.0);
    });

    it("increases for uphill (positive grade)", () => {
      expect(fuelMultiplier(10)).toBeGreaterThan(1.0);
    });

    it("decreases for downhill (negative grade) but stays above minMultiplier", () => {
      const m = fuelMultiplier(-10);
      expect(m).toBeLessThan(1.0);
      expect(m).toBeGreaterThanOrEqual(0.5);
    });

    it("respects custom minMultiplier", () => {
      const m = fuelMultiplier(-1000, 0.8);
      expect(m).toBeGreaterThanOrEqual(0.8);
    });

    it("uphill formula: mult = 1 + grade * 0.1", () => {
      expect(fuelMultiplier(5)).toBeCloseTo(1.5, 5);
      expect(fuelMultiplier(20)).toBeCloseTo(3.0, 5);
    });

    it("downhill formula: mult = 1 + grade * 0.04", () => {
      expect(fuelMultiplier(-5)).toBeCloseTo(0.8, 5);
    });
  });

  describe("getTurnAngle", () => {
    it("returns 0 for straight ahead (same bearing)", () => {
      expect(getTurnAngle(90, 90)).toBe(0);
    });

    it("returns positive for right turn", () => {
      expect(getTurnAngle(0, 90)).toBe(90); // north → east = right
    });

    it("returns negative for left turn", () => {
      expect(getTurnAngle(90, 0)).toBe(-90); // east → north = left
    });

    it("returns ~180 for U-turn", () => {
      const angle = getTurnAngle(0, 180);
      expect(Math.abs(angle)).toBeCloseTo(180, 1);
    });

    it("normalizes values to -180..180 range", () => {
      const angle = getTurnAngle(350, 10);
      expect(angle).toBeGreaterThanOrEqual(-180);
      expect(angle).toBeLessThanOrEqual(180);
    });
  });

  describe("calculateBearing", () => {
    it("returns ~0 (north) when going north", () => {
      const b = calculateBearing(0, 0, 0, 0.001);
      expect(b).toBeCloseTo(0, 0);
    });

    it("returns ~90 (east) when going east", () => {
      const b = calculateBearing(0, 0, 0.001, 0);
      expect(b).toBeCloseTo(90, 0);
    });

    it("returns ~180 (south) when going south", () => {
      const b = calculateBearing(0, 0.001, 0, 0);
      expect(b).toBeCloseTo(180, 0);
    });

    it("returns ~270 (west) when going west", () => {
      const b = calculateBearing(0.001, 0, 0, 0);
      expect(b).toBeCloseTo(270, 0);
    });

    it("result is always in 0–360 range", () => {
      for (let i = 0; i < 8; i++) {
        const angle = (i * 45 * Math.PI) / 180;
        const b = calculateBearing(
          0,
          0,
          Math.cos(angle) * 0.001,
          Math.sin(angle) * 0.001,
        );
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(360);
      }
    });
  });
});
