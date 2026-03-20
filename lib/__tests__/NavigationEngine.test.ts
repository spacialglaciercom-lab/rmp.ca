/**
 * Tests for NavigationEngine.
 *
 * We test the pure computation methods directly (_calculateBearing,
 * _maneuverToText, _buildVoiceInstruction), then drive the location-update
 * pipeline (_onLocationUpdate → _updateProgress / _checkAnnouncements) with
 * realistic London coordinates using the real Turf snap implementation.
 *
 * expo-location is dynamically imported only inside start() which we do not
 * call here, so no location SDK mock is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NavigationEngine } from "../NavigationEngine";
import type { MatchedRoute, MatchedStep } from "../mapMatching";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/src/powerSaving", () => ({
  PowerSavingManager: {
    init: vi.fn().mockResolvedValue(undefined),
    getLocationWatchOptions: vi.fn().mockReturnValue({
      accuracy: 3,
      distanceInterval: 5,
      timeInterval: 1_000,
    }),
  },
}));

vi.mock("@/lib/expoSpeechVoice", () => ({
  speakNavigation: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal MatchedStep with GeoJSON coordinates ([lon, lat] order).
 */
function makeStep(
  coords: Array<[number, number]>,
  maneuver: { type: string; modifier?: string; exit?: number } = {
    type: "turn",
    modifier: "right",
  },
  name = "Test St",
): MatchedStep {
  return {
    geometry: { type: "LineString", coordinates: coords },
    maneuver,
    name,
    distance: 500,
    duration: 60,
  };
}

/**
 * A two-step route along a straight north-south line in London.
 *
 * Segment A→B: lat 51.5074 → 51.5184  (~1.2 km north, lon fixed at -0.1278)
 * Segment B→C: lat 51.5184 → 51.5294  (~1.2 km north continued)
 *
 * GeoJSON step coordinates are [lon, lat].
 */
const POINT_A = { lat: 51.5074, lon: -0.1278 };
const POINT_B = { lat: 51.5184, lon: -0.1278 };
const POINT_C = { lat: 51.5294, lon: -0.1278 };

function makeRoute(): MatchedRoute {
  const step0 = makeStep(
    [
      [POINT_A.lon, POINT_A.lat],
      [POINT_B.lon, POINT_B.lat],
    ],
    { type: "turn", modifier: "right" },
    "Baker St",
  );

  const step1 = makeStep(
    [
      [POINT_B.lon, POINT_B.lat],
      [POINT_C.lon, POINT_C.lat],
    ],
    { type: "arrive" },
    "Baker St",
  );

  return {
    steps: [step0, step1],
    legs: [],
    totalDistance: 2_400,
    totalDuration: 300,
    matchedGeometry: [POINT_A, POINT_B, POINT_C],
  };
}

// ---------------------------------------------------------------------------
// _calculateBearing
// ---------------------------------------------------------------------------

describe("NavigationEngine._calculateBearing", () => {
  const engine = new NavigationEngine(makeRoute());

  it("returns ~0° for due north", () => {
    const bearing = engine._calculateBearing(
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
    );
    expect(bearing).toBeCloseTo(0, 0);
  });

  it("returns ~90° for due east", () => {
    const bearing = engine._calculateBearing(
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
    );
    expect(bearing).toBeCloseTo(90, 0);
  });

  it("returns ~180° for due south", () => {
    const bearing = engine._calculateBearing(
      { lat: 1, lon: 0 },
      { lat: 0, lon: 0 },
    );
    expect(bearing).toBeCloseTo(180, 0);
  });

  it("returns ~270° for due west", () => {
    const bearing = engine._calculateBearing(
      { lat: 0, lon: 1 },
      { lat: 0, lon: 0 },
    );
    expect(bearing).toBeCloseTo(270, 0);
  });

  it("returns a value in [0, 360)", () => {
    const bearing = engine._calculateBearing(POINT_A, POINT_B);
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });
});

// ---------------------------------------------------------------------------
// _maneuverToText
// ---------------------------------------------------------------------------

describe("NavigationEngine._maneuverToText", () => {
  const engine = new NavigationEngine(makeRoute());

  const cases: Array<[{ type: string; modifier?: string; exit?: number }, string]> = [
    [{ type: "turn", modifier: "left" }, "turn left"],
    [{ type: "turn", modifier: "right" }, "turn right"],
    [{ type: "turn", modifier: "slight left" }, "bear left"],
    [{ type: "turn", modifier: "slight right" }, "bear right"],
    [{ type: "turn", modifier: "sharp left" }, "make a sharp left"],
    [{ type: "turn", modifier: "sharp right" }, "make a sharp right"],
    [{ type: "turn", modifier: "uturn" }, "make a U-turn"],
    [{ type: "turn", modifier: "straight" }, "continue straight"],
    [{ type: "arrive" }, "you have arrived"],
    [{ type: "depart" }, "depart"],
    [{ type: "new name" }, "continue onto"],
    [{ type: "roundabout", exit: 2 }, "enter the roundabout, take exit 2"],
    [{ type: "rotary", exit: 3 }, "enter the rotary, take exit 3"],
    [{ type: "merge", modifier: "left" }, "merge left"],
    [{ type: "fork", modifier: "right" }, "turn right"],
    [{ type: "end of road", modifier: "right" }, "turn right"],
  ];

  it.each(cases)("maneuver %o → '%s'", (maneuver, expected) => {
    expect(engine._maneuverToText(maneuver)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// _buildVoiceInstruction
// ---------------------------------------------------------------------------

describe("NavigationEngine._buildVoiceInstruction", () => {
  const engine = new NavigationEngine(makeRoute());

  it("includes street name in the instruction", () => {
    const step = makeStep(
      [[0, 0],[0, 0.01]],
      { type: "turn", modifier: "right" },
      "Oxford St",
    );
    const text = engine._buildVoiceInstruction(step, 300);
    expect(text).toMatch(/Oxford St/);
    expect(text).toMatch(/turn right/);
  });

  it("rounds distance to nearest 100 m when distance > 100 m", () => {
    const step = makeStep([[0, 0],[0, 0.01]], { type: "turn", modifier: "left" });
    const text = engine._buildVoiceInstruction(step, 350);
    expect(text).toMatch(/400 meters/i);
  });

  it("uses exact metres when distance <= 100 m", () => {
    const step = makeStep([[0, 0],[0, 0.01]], { type: "turn", modifier: "right" });
    const text = engine._buildVoiceInstruction(step, 75);
    expect(text).toMatch(/75 meters/i);
  });

  it("omits street name when it matches lastSpokenStreetName", () => {
    const e = new NavigationEngine(makeRoute());
    (e as unknown as { lastSpokenStreetName: string }).lastSpokenStreetName =
      "Baker St";
    const step = makeStep([[0, 0],[0, 0.01]], { type: "turn", modifier: "right" }, "Baker St");
    const text = e._buildVoiceInstruction(step, 200);
    expect(text).not.toMatch(/Baker St/);
  });
});

// ---------------------------------------------------------------------------
// Event system: on / _emit
// ---------------------------------------------------------------------------

describe("NavigationEngine event system", () => {
  it("on() delivers events to the callback", () => {
    const engine = new NavigationEngine(makeRoute());
    const received: unknown[] = [];
    engine.on("testEvent", (data) => received.push(data));

    engine._emit("testEvent", { value: 42 });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ value: 42 });
  });

  it("on() returns an unsubscribe function that removes the listener", () => {
    const engine = new NavigationEngine(makeRoute());
    const received: unknown[] = [];
    const off = engine.on("testEvent", (data) => received.push(data));

    engine._emit("testEvent", "first");
    off();
    engine._emit("testEvent", "second");

    expect(received).toHaveLength(1);
    expect(received[0]).toBe("first");
  });

  it("multiple listeners for the same event all receive it", () => {
    const engine = new NavigationEngine(makeRoute());
    const callsA: unknown[] = [];
    const callsB: unknown[] = [];
    engine.on("x", (d) => callsA.push(d));
    engine.on("x", (d) => callsB.push(d));

    engine._emit("x", "ping");

    expect(callsA).toHaveLength(1);
    expect(callsB).toHaveLength(1);
  });

  it("events with no listeners do not throw", () => {
    const engine = new NavigationEngine(makeRoute());
    expect(() => engine._emit("nonExistentEvent", {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Constructor / getState
// ---------------------------------------------------------------------------

describe("NavigationEngine constructor and getState", () => {
  it("initialises isNavigating to false", () => {
    const engine = new NavigationEngine(makeRoute());
    expect(engine.isNavigating).toBe(false);
  });

  it("initialises distanceRemaining to route totalDistance", () => {
    const route = makeRoute();
    const engine = new NavigationEngine(route);
    expect(engine.distanceRemaining).toBe(route.totalDistance);
  });

  it("initialises currentStepIndex to 0", () => {
    const engine = new NavigationEngine(makeRoute());
    expect(engine.currentStepIndex).toBe(0);
  });

  it("accepts custom offRouteThreshold option", () => {
    const engine = new NavigationEngine(makeRoute(), { offRouteThreshold: 100 });
    expect(engine.offRouteThreshold).toBe(100);
  });

  it("getState reflects initial state", () => {
    const route = makeRoute();
    const engine = new NavigationEngine(route);
    const state = engine.getState();

    expect(state.isNavigating).toBe(false);
    expect(state.currentStepIndex).toBe(0);
    expect(state.totalSteps).toBe(2);
    expect(state.currentLocation).toBeNull();
    expect(state.currentStep).toBe(route.steps[0]);
    expect(state.nextStep).toBe(route.steps[1]);
  });
});

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------

describe("NavigationEngine.stop", () => {
  it("sets isNavigating to false", () => {
    const engine = new NavigationEngine(makeRoute(), { simulationMode: true });
    engine._startSimulation();
    expect(engine.isNavigating).toBe(true);

    engine.stop();
    expect(engine.isNavigating).toBe(false);
  });

  it("clears all event listeners", () => {
    const engine = new NavigationEngine(makeRoute());
    engine.on("foo", vi.fn());
    engine.on("bar", vi.fn());
    expect(engine.listeners.size).toBe(2);

    engine.stop();
    expect(engine.listeners.size).toBe(0);
  });

  it("emits 'stopped' event before clearing listeners", () => {
    const engine = new NavigationEngine(makeRoute());
    const stoppedCalls: unknown[] = [];
    engine.on("stopped", () => stoppedCalls.push(true));

    engine.stop();

    expect(stoppedCalls).toHaveLength(1);
  });

  it("clears the simulation interval when in simulation mode", () => {
    vi.useFakeTimers();
    const engine = new NavigationEngine(makeRoute(), { simulationMode: true });
    engine._startSimulation();
    expect(engine.simulationInterval).not.toBeNull();

    engine.stop();
    expect(engine.simulationInterval).toBeNull();

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// _onLocationUpdate — on-route vs off-route
// ---------------------------------------------------------------------------

describe("NavigationEngine._onLocationUpdate", () => {
  function makeEngine(opts?: { offRouteThreshold?: number }) {
    const engine = new NavigationEngine(makeRoute(), opts);
    // Suppress _speak to avoid require('@/lib/expoSpeechVoice') in Node
    vi.spyOn(engine, "_speak").mockImplementation(() => {});
    return engine;
  }

  it("emits 'update' event with current state for an on-route position", () => {
    const engine = makeEngine();
    const updates: unknown[] = [];
    engine.on("update", (s) => updates.push(s));

    // Point exactly on the route (midpoint A→B)
    engine._onLocationUpdate({
      coords: {
        latitude: (POINT_A.lat + POINT_B.lat) / 2,
        longitude: POINT_A.lon,
      },
    });

    expect(updates).toHaveLength(1);
    expect((updates[0] as { isNavigating: boolean }).isNavigating).toBe(false);
  });

  it("emits 'offRoute' when the vehicle is beyond the threshold", () => {
    const engine = makeEngine({ offRouteThreshold: 50 });
    const offRouteEvents: unknown[] = [];
    engine.on("offRoute", (e) => offRouteEvents.push(e));

    // ~690 m east of the route line — well beyond 50 m
    engine._onLocationUpdate({
      coords: { latitude: 51.513, longitude: -0.117 },
    });

    expect(offRouteEvents).toHaveLength(1);
    const evt = offRouteEvents[0] as { distance: number };
    expect(evt.distance).toBeGreaterThan(50);
  });

  it("does NOT emit 'offRoute' for an on-route position", () => {
    const engine = makeEngine({ offRouteThreshold: 50 });
    const offRouteEvents: unknown[] = [];
    engine.on("offRoute", (e) => offRouteEvents.push(e));

    engine._onLocationUpdate({
      coords: {
        latitude: POINT_A.lat + 0.005, // midway along segment, exactly on line
        longitude: POINT_A.lon,
      },
    });

    expect(offRouteEvents).toHaveLength(0);
  });

  it("updates currentLocation after each call", () => {
    const engine = makeEngine();

    engine._onLocationUpdate({
      coords: { latitude: 51.51, longitude: -0.1278, heading: 45, speed: 10 },
    });

    expect(engine.currentLocation).toMatchObject({
      lat: 51.51,
      lon: -0.1278,
      bearing: 45,
      speed: 10,
    });
  });
});

// ---------------------------------------------------------------------------
// _updateProgress — step advancement and arrival
// ---------------------------------------------------------------------------

describe("NavigationEngine._updateProgress", () => {
  function makeEngine() {
    const engine = new NavigationEngine(makeRoute());
    vi.spyOn(engine, "_speak").mockImplementation(() => {});
    return engine;
  }

  it("advances currentStepIndex when within 20 m of step end", () => {
    const engine = makeEngine();
    expect(engine.currentStepIndex).toBe(0);

    // ~11 m before point B (end of step 0)
    engine._updateProgress({
      snappedLocation: { lat: POINT_B.lat - 0.0001, lon: POINT_B.lon },
      segmentIndex: 0,
    });

    expect(engine.currentStepIndex).toBe(1);
  });

  it("does NOT advance step when farther than 20 m from step end", () => {
    const engine = makeEngine();

    // ~111 m before point B
    engine._updateProgress({
      snappedLocation: { lat: POINT_B.lat - 0.001, lon: POINT_B.lon },
      segmentIndex: 0,
    });

    expect(engine.currentStepIndex).toBe(0);
  });

  it("emits 'stepChanged' when the step advances", () => {
    const engine = makeEngine();
    const stepChanges: unknown[] = [];
    engine.on("stepChanged", (e) => stepChanges.push(e));

    engine._updateProgress({
      snappedLocation: { lat: POINT_B.lat - 0.0001, lon: POINT_B.lon },
      segmentIndex: 0,
    });

    expect(stepChanges).toHaveLength(1);
    expect((stepChanges[0] as { index: number }).index).toBe(1);
  });

  it("emits 'arrived' and stops when within 30 m of final step end", () => {
    const engine = makeEngine();
    const arrivedEvents: unknown[] = [];
    engine.on("arrived", () => arrivedEvents.push(true));

    // Manually advance to the last step
    (engine as unknown as { _currentStepIndex: number })._currentStepIndex = 1;

    // ~22 m before point C (end of step 1)
    engine._updateProgress({
      snappedLocation: { lat: POINT_C.lat - 0.0002, lon: POINT_C.lon },
      segmentIndex: 1,
    });

    expect(arrivedEvents).toHaveLength(1);
    expect(engine.isNavigating).toBe(false);
  });

  it("clears the announced set when step advances", () => {
    const engine = makeEngine();
    const announced = (engine as unknown as { _announced: Set<string> })._announced;
    announced.add("0-500");
    announced.add("0-200");

    engine._updateProgress({
      snappedLocation: { lat: POINT_B.lat - 0.0001, lon: POINT_B.lon },
      segmentIndex: 0,
    });

    expect(announced.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// _checkAnnouncements
// ---------------------------------------------------------------------------

describe("NavigationEngine._checkAnnouncements", () => {
  function makeEngine() {
    const engine = new NavigationEngine(makeRoute());
    vi.spyOn(engine, "_speak").mockImplementation(() => {});
    return engine;
  }

  it("fires an announcement when within 200 m of next maneuver", () => {
    const engine = makeEngine();
    const announcements: unknown[] = [];
    engine.on("announcement", (e) => announcements.push(e));

    (engine as unknown as { _distanceToNextManeuver: number })._distanceToNextManeuver = 180;
    engine._checkAnnouncements();

    // 180 <= 200 and 180 <= 500 → two announcements (200m and 500m keys)
    expect(announcements.length).toBeGreaterThanOrEqual(1);
  });

  it("does not re-announce the same step+distance combination", () => {
    const engine = makeEngine();
    const announcements: unknown[] = [];
    engine.on("announcement", (e) => announcements.push(e));

    (engine as unknown as { _distanceToNextManeuver: number })._distanceToNextManeuver = 45;
    engine._checkAnnouncements();
    const firstCount = announcements.length;

    // Second call — same distances, same step → already announced
    engine._checkAnnouncements();
    expect(announcements.length).toBe(firstCount);
  });

  it("calls _speak with a non-empty instruction string", () => {
    const engine = makeEngine();
    (engine as unknown as { _distanceToNextManeuver: number })._distanceToNextManeuver = 45;
    engine._checkAnnouncements();

    expect(engine._speak).toHaveBeenCalledWith(expect.any(String));
    const spokenText = (engine._speak as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(spokenText.length).toBeGreaterThan(0);
  });

  it("does not fire an announcement when there is no next step", () => {
    const engine = makeEngine();
    // Advance to last step so there is no nextStep
    (engine as unknown as { _currentStepIndex: number })._currentStepIndex = 1;
    (engine as unknown as { _distanceToNextManeuver: number })._distanceToNextManeuver = 10;

    const announcements: unknown[] = [];
    engine.on("announcement", (e) => announcements.push(e));
    engine._checkAnnouncements();

    expect(announcements).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// _snapToRoute
// ---------------------------------------------------------------------------

describe("NavigationEngine._snapToRoute", () => {
  it("returns distanceFromRoute ≈ 0 for a point on the line", () => {
    const engine = new NavigationEngine(makeRoute());
    const result = engine._snapToRoute({
      lat: (POINT_A.lat + POINT_B.lat) / 2,
      lon: POINT_A.lon,
    });

    expect(result.distanceFromRoute).toBeLessThan(5); // within 5 m
  });

  it("returns a large distanceFromRoute for a point far off the line", () => {
    const engine = new NavigationEngine(makeRoute());
    const result = engine._snapToRoute({ lat: 51.513, lon: -0.117 });

    expect(result.distanceFromRoute).toBeGreaterThan(400);
  });

  it("returns routeProgressMeters and totalRouteLength", () => {
    const engine = new NavigationEngine(makeRoute());
    const result = engine._snapToRoute({
      lat: POINT_B.lat,
      lon: POINT_B.lon,
    });

    expect(result.routeProgressMeters).toBeDefined();
    expect(result.totalRouteLength).toBeDefined();
    expect(result.totalRouteLength!).toBeGreaterThan(0);
  });
});
