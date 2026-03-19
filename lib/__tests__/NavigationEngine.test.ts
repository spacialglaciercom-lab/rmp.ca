/**
 * Unit tests for NavigationEngine.ts
 * Covers: constructor state, bearing math, maneuver text, voice instructions,
 * snap-to-route, off-route detection, step progression, arrival, announcements,
 * distance remaining, event system, stop, and simulation mode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (must come before the import under test) ──────────────────────────

vi.mock("../routeSnap", () => ({
  createRouteLine: vi.fn(() => "mock-route-line"),
  getRouteLengthMeters: vi.fn(() => 1000),
  snapToRoute: vi.fn(() => ({
    snapped: [-73.0, 45.0],
    currentSegmentIndex: 0,
    distanceToRoute: 5,
    routeProgressMeters: 100,
  })),
}));

vi.mock("../offlineTurnDetection", () => ({
  haversineDistance: vi.fn(() => 100),
}));

vi.mock("@/src/powerSaving", () => ({
  PowerSavingManager: {
    init: vi.fn(() => Promise.resolve()),
    getLocationWatchOptions: vi.fn(() => ({
      accuracy: 4,
      distanceInterval: 5,
      timeInterval: 1000,
    })),
  },
}));

vi.mock("@/lib/expoSpeechVoice", () => ({
  speakNavigation: vi.fn(),
}));

// ── Import under test ────────────────────────────────────────────────────────
import { NavigationEngine } from "../NavigationEngine";
import type { MatchedRoute, MatchedStep } from "../mapMatching";
import { snapToRoute } from "../routeSnap";
import { haversineDistance } from "../offlineTurnDetection";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<MatchedStep> = {}): MatchedStep {
  return {
    geometry: {
      type: "LineString",
      coordinates: [
        [-73.0, 45.0],
        [-73.001, 45.001],
      ],
    },
    maneuver: { type: "turn", modifier: "right" },
    name: "Test Street",
    distance: 100,
    duration: 30,
    ...overrides,
  };
}

function makeRoute(
  points: Array<{ lat: number; lon: number }> = [
    { lat: 45.0, lon: -73.0 },
    { lat: 45.001, lon: -73.001 },
    { lat: 45.002, lon: -73.002 },
  ],
  steps: MatchedStep[] = [],
): MatchedRoute {
  return {
    matchedGeometry: points,
    steps,
    totalDistance: 1000,
    totalDuration: 120,
    legs: [],
  };
}

function makeLocation(lat = 45.0, lon = -73.0) {
  return {
    coords: {
      latitude: lat,
      longitude: lon,
      heading: 0,
      speed: 5,
      accuracy: 10,
    },
  };
}

// ── Constructor ───────────────────────────────────────────────────────────────

describe("NavigationEngine constructor", () => {
  it("initialises all state correctly", () => {
    const route = makeRoute();
    const engine = new NavigationEngine(route);

    expect(engine.route).toBe(route);
    expect(engine.steps).toBe(route.steps);
    expect(engine.currentStepIndex).toBe(0);
    expect(engine.isNavigating).toBe(false);
    expect(engine.distanceToNextManeuver).toBe(Infinity);
    expect(engine.distanceRemaining).toBe(1000);
    expect(engine.lastSegmentIndex).toBe(0);
    expect(engine.simulationMode).toBe(false);
    expect(engine.simulationSpeedMultiplier).toBe(1.0);
    expect(engine.listeners.size).toBe(0);
    expect(engine.announced.size).toBe(0);
    expect(engine.locationSubscription).toBeNull();
    expect(engine.simulationInterval).toBeNull();
  });

  it("respects offRouteThreshold option", () => {
    const engine = new NavigationEngine(makeRoute(), { offRouteThreshold: 75 });
    expect(engine.offRouteThreshold).toBe(75);
  });

  it("defaults offRouteThreshold to 50", () => {
    const engine = new NavigationEngine(makeRoute());
    expect(engine.offRouteThreshold).toBe(50);
  });

  it("sets simulationMode from option", () => {
    const engine = new NavigationEngine(makeRoute(), { simulationMode: true });
    expect(engine.simulationMode).toBe(true);
  });

  it("sets announceDistances to [500, 200, 50]", () => {
    const engine = new NavigationEngine(makeRoute());
    expect(engine.announceDistances).toEqual([500, 200, 50]);
  });
});

// ── _calculateBearing ────────────────────────────────────────────────────────

describe("_calculateBearing", () => {
  let engine: NavigationEngine;
  beforeEach(() => {
    engine = new NavigationEngine(makeRoute());
  });

  it("returns 0 for due north", () => {
    const bearing = engine._calculateBearing(
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
    );
    expect(bearing).toBeCloseTo(0, 0);
  });

  it("returns ~90 for due east", () => {
    const bearing = engine._calculateBearing(
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
    );
    expect(bearing).toBeCloseTo(90, 0);
  });

  it("returns ~180 for due south", () => {
    const bearing = engine._calculateBearing(
      { lat: 1, lon: 0 },
      { lat: 0, lon: 0 },
    );
    expect(bearing).toBeCloseTo(180, 0);
  });

  it("returns ~270 for due west", () => {
    const bearing = engine._calculateBearing(
      { lat: 0, lon: 1 },
      { lat: 0, lon: 0 },
    );
    expect(bearing).toBeCloseTo(270, 0);
  });

  it("returns value in [0, 360)", () => {
    const bearing = engine._calculateBearing(
      { lat: 45.5, lon: -73.5 },
      { lat: 45.501, lon: -73.499 },
    );
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });
});

// ── _maneuverToText ──────────────────────────────────────────────────────────

describe("_maneuverToText", () => {
  let engine: NavigationEngine;
  beforeEach(() => {
    engine = new NavigationEngine(makeRoute());
  });

  it.each([
    [{ type: "turn", modifier: "left" }, "turn left"],
    [{ type: "turn", modifier: "right" }, "turn right"],
    [{ type: "turn", modifier: "slight left" }, "bear left"],
    [{ type: "turn", modifier: "slight right" }, "bear right"],
    [{ type: "turn", modifier: "sharp left" }, "make a sharp left"],
    [{ type: "turn", modifier: "sharp right" }, "make a sharp right"],
    [{ type: "turn", modifier: "straight" }, "continue straight"],
    [{ type: "turn", modifier: "uturn" }, "make a U-turn"],
    [{ type: "new name" }, "continue onto"],
    [{ type: "depart" }, "depart"],
    [{ type: "arrive" }, "you have arrived"],
    [{ type: "merge", modifier: "left" }, "merge left"],
    [{ type: "merge" }, "merge ahead"],
  ])("maps %o → %s", (maneuver, expected) => {
    expect(engine._maneuverToText(maneuver as never)).toBe(expected);
  });

  it("handles roundabout with exit number", () => {
    const text = engine._maneuverToText({ type: "roundabout", exit: 2 });
    expect(text).toBe("enter the roundabout, take exit 2");
  });

  it("handles rotary with exit number", () => {
    const text = engine._maneuverToText({ type: "rotary", exit: 3 });
    expect(text).toBe("enter the rotary, take exit 3");
  });

  it("falls back for unknown maneuver type", () => {
    const text = engine._maneuverToText({ type: "unknown-type" });
    expect(typeof text).toBe("string");
  });
});

// ── _buildVoiceInstruction ───────────────────────────────────────────────────

describe("_buildVoiceInstruction", () => {
  let engine: NavigationEngine;
  beforeEach(() => {
    engine = new NavigationEngine(makeRoute());
  });

  it("includes street name when set and not last spoken", () => {
    const step = makeStep({ name: "Main St", maneuver: { type: "turn", modifier: "left" } });
    const text = engine._buildVoiceInstruction(step, 200);
    expect(text).toContain("Main St");
    expect(text).toContain("turn left");
  });

  it("omits street name when same as last spoken", () => {
    const step = makeStep({ name: "Main St", maneuver: { type: "turn", modifier: "left" } });
    (engine as unknown as { lastSpokenStreetName: string }).lastSpokenStreetName =
      "Main St";
    const text = engine._buildVoiceInstruction(step, 200);
    expect(text).not.toContain("Main St");
  });

  it("formats large distance as rounded 100s", () => {
    const step = makeStep({ maneuver: { type: "turn", modifier: "right" } });
    const text = engine._buildVoiceInstruction(step, 350);
    expect(text).toContain("400 meters");
  });

  it("formats small distance exactly", () => {
    const step = makeStep({ maneuver: { type: "turn", modifier: "right" } });
    const text = engine._buildVoiceInstruction(step, 45);
    expect(text).toContain("45 meters");
  });
});

// ── getState ─────────────────────────────────────────────────────────────────

describe("getState", () => {
  it("returns correct shape with defaults", () => {
    const step0 = makeStep({ name: "Oak Ave" });
    const step1 = makeStep({ name: "Elm St", maneuver: { type: "turn", modifier: "left" } });
    const route = makeRoute(undefined, [step0, step1]);
    const engine = new NavigationEngine(route);

    const state = engine.getState();

    expect(state.currentStepIndex).toBe(0);
    expect(state.totalSteps).toBe(2);
    expect(state.currentStep).toBe(step0);
    expect(state.nextStep).toBe(step1);
    expect(state.distanceRemaining).toBe(1000);
    expect(state.distanceToNextManeuver).toBe(Infinity);
    expect(state.isNavigating).toBe(false);
    expect(state.currentLocation).toBeNull();
    expect(state.streetName).toBe("Oak Ave");
    expect(state.nextManeuverType).toBe("turn");
    expect(state.nextManeuverModifier).toBe("left");
  });

  it("returns undefined currentStep when no steps", () => {
    const engine = new NavigationEngine(makeRoute());
    const state = engine.getState();
    expect(state.currentStep).toBeUndefined();
    expect(state.nextStep).toBeUndefined();
    expect(state.streetName).toBe("");
  });
});

// ── Event system (on / _emit) ────────────────────────────────────────────────

describe("event system", () => {
  let engine: NavigationEngine;
  beforeEach(() => {
    engine = new NavigationEngine(makeRoute());
  });

  it("registers listener and receives event", () => {
    const cb = vi.fn();
    engine.on("update", cb);
    engine._emit("update", { foo: 1 });
    expect(cb).toHaveBeenCalledWith({ foo: 1 });
  });

  it("does not call listener for different event", () => {
    const cb = vi.fn();
    engine.on("update", cb);
    engine._emit("stepChanged", {});
    expect(cb).not.toHaveBeenCalled();
  });

  it("unsubscribe function removes listener", () => {
    const cb = vi.fn();
    const off = engine.on("update", cb);
    off();
    engine._emit("update", {});
    expect(cb).not.toHaveBeenCalled();
  });

  it("supports multiple listeners on same event", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    engine.on("update", cb1);
    engine.on("update", cb2);
    engine._emit("update", "data");
    expect(cb1).toHaveBeenCalledWith("data");
    expect(cb2).toHaveBeenCalledWith("data");
  });
});

// ── stop ─────────────────────────────────────────────────────────────────────

describe("stop", () => {
  it("sets isNavigating to false and clears listeners", () => {
    const engine = new NavigationEngine(makeRoute());
    engine.on("update", vi.fn());
    engine.stop();
    expect(engine.isNavigating).toBe(false);
    expect(engine.listeners.size).toBe(0);
  });

  it("emits stopped event before clearing listeners", () => {
    const engine = new NavigationEngine(makeRoute());
    const cb = vi.fn();
    engine.on("stopped", cb);
    engine.stop();
    expect(cb).toHaveBeenCalled();
  });

  it("clears simulation interval if running", () => {
    vi.useFakeTimers();
    const engine = new NavigationEngine(makeRoute(), { simulationMode: true });
    const route = makeRoute([
      { lat: 45.0, lon: -73.0 },
      { lat: 45.1, lon: -73.1 },
    ]);
    const simEngine = new NavigationEngine(route, { simulationMode: true });
    simEngine._startSimulation();
    expect(simEngine.simulationInterval).not.toBeNull();
    simEngine.stop();
    expect(simEngine.simulationInterval).toBeNull();
    vi.useRealTimers();
    engine.stop();
  });

  it("removes location subscription if present", () => {
    const engine = new NavigationEngine(makeRoute());
    const removeSpy = vi.fn();
    (engine as unknown as { _locationSubscription: { remove: () => void } })
      ._locationSubscription = { remove: removeSpy };
    engine.stop();
    expect(removeSpy).toHaveBeenCalled();
  });
});

// ── _updateDistanceRemaining ─────────────────────────────────────────────────

describe("_updateDistanceRemaining", () => {
  let engine: NavigationEngine;

  beforeEach(() => {
    engine = new NavigationEngine(makeRoute());
  });

  it("uses routeProgressMeters when available", () => {
    engine._updateDistanceRemaining({
      snappedLocation: { lat: 45.0, lon: -73.0 },
      segmentIndex: 0,
      routeProgressMeters: 300,
      totalRouteLength: 1000,
    });
    expect(engine.distanceRemaining).toBe(700);
  });

  it("clamps to 0 when at/past end", () => {
    engine._updateDistanceRemaining({
      snappedLocation: { lat: 45.0, lon: -73.0 },
      segmentIndex: 0,
      routeProgressMeters: 1200,
      totalRouteLength: 1000,
    });
    expect(engine.distanceRemaining).toBe(0);
  });

  it("falls back to haversine when no routeProgressMeters", () => {
    vi.mocked(haversineDistance).mockReturnValue(50);
    engine._updateDistanceRemaining({
      snappedLocation: { lat: 45.0, lon: -73.0 },
      segmentIndex: 0,
    });
    // haversineDistance is called for remaining segments
    expect(haversineDistance).toHaveBeenCalled();
    expect(engine.distanceRemaining).toBeGreaterThanOrEqual(0);
  });
});

// ── _updateProgress (step advancement & arrival) ─────────────────────────────

describe("_updateProgress", () => {
  it("advances to next step when within 20m of step end", () => {
    vi.mocked(haversineDistance).mockReturnValue(15); // < 20m
    const step0 = makeStep();
    const step1 = makeStep({ name: "Next St" });
    const route = makeRoute(undefined, [step0, step1]);
    const engine = new NavigationEngine(route);

    const stepChangedCb = vi.fn();
    engine.on("stepChanged", stepChangedCb);

    engine._updateProgress({
      snappedLocation: { lat: 45.0, lon: -73.0 },
      segmentIndex: 0,
    });

    expect(engine.currentStepIndex).toBe(1);
    expect(stepChangedCb).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1 }),
    );
  });

  it("does not advance when farther than 20m from step end", () => {
    vi.mocked(haversineDistance).mockReturnValue(25); // > 20m
    const step0 = makeStep();
    const step1 = makeStep();
    const route = makeRoute(undefined, [step0, step1]);
    const engine = new NavigationEngine(route);

    engine._updateProgress({
      snappedLocation: { lat: 45.0, lon: -73.0 },
      segmentIndex: 0,
    });

    expect(engine.currentStepIndex).toBe(0);
  });

  it("emits arrived and stops when at last step within 30m", () => {
    vi.mocked(haversineDistance).mockReturnValue(10); // < 30m
    const step0 = makeStep();
    const route = makeRoute(undefined, [step0]);
    const engine = new NavigationEngine(route);

    const arrivedCb = vi.fn();
    engine.on("arrived", arrivedCb);

    engine._updateProgress({
      snappedLocation: { lat: 45.0, lon: -73.0 },
      segmentIndex: 0,
    });

    expect(arrivedCb).toHaveBeenCalled();
    expect(engine.distanceRemaining).toBe(0);
    expect(engine.isNavigating).toBe(false);
  });

  it("clears announced set on step advance", () => {
    vi.mocked(haversineDistance).mockReturnValue(15); // < 20m
    const step0 = makeStep();
    const step1 = makeStep();
    const route = makeRoute(undefined, [step0, step1]);
    const engine = new NavigationEngine(route);

    // Seed announced set
    engine.announced.add("0-200");

    engine._updateProgress({
      snappedLocation: { lat: 45.0, lon: -73.0 },
      segmentIndex: 0,
    });

    expect(engine.announced.size).toBe(0);
  });

  it("no-ops when current step has no geometry", () => {
    const step0 = makeStep({ geometry: { type: "LineString", coordinates: [] } });
    const route = makeRoute(undefined, [step0]);
    const engine = new NavigationEngine(route);

    expect(() =>
      engine._updateProgress({
        snappedLocation: { lat: 45.0, lon: -73.0 },
        segmentIndex: 0,
      }),
    ).not.toThrow();
  });
});

// ── _checkAnnouncements ───────────────────────────────────────────────────────

describe("_checkAnnouncements", () => {
  // _speak uses require() at runtime which bypasses static mocks; spy directly
  function stubSpeak(engine: NavigationEngine) {
    vi.spyOn(
      engine as unknown as { _speak: (t: string) => void },
      "_speak",
    ).mockImplementation(() => {});
  }

  it("emits announcement when within 500m of next maneuver", () => {
    const step0 = makeStep();
    const step1 = makeStep({ name: "Oak Ave", maneuver: { type: "turn", modifier: "right" } });
    const route = makeRoute(undefined, [step0, step1]);
    const engine = new NavigationEngine(route);
    stubSpeak(engine);

    // Set distance to next maneuver within 500m
    (engine as unknown as { _distanceToNextManeuver: number })
      ._distanceToNextManeuver = 400;

    const announceCb = vi.fn();
    engine.on("announcement", announceCb);

    engine._checkAnnouncements();

    expect(announceCb).toHaveBeenCalledWith(
      expect.objectContaining({ distance: 500 }),
    );
  });

  it("does not repeat announcement for same key", () => {
    const step0 = makeStep();
    const step1 = makeStep({ name: "Oak Ave" });
    const route = makeRoute(undefined, [step0, step1]);
    const engine = new NavigationEngine(route);
    stubSpeak(engine);

    (engine as unknown as { _distanceToNextManeuver: number })
      ._distanceToNextManeuver = 30;

    const announceCb = vi.fn();
    engine.on("announcement", announceCb);

    engine._checkAnnouncements(); // keys get added to _announced
    const callsAfterFirst = announceCb.mock.calls.length;
    engine._checkAnnouncements(); // all keys already announced → no new emissions

    // Second call must not add more emissions
    expect(announceCb.mock.calls.length).toBe(callsAfterFirst);
  });

  it("does not announce when no next step", () => {
    const step0 = makeStep();
    const route = makeRoute(undefined, [step0]);
    const engine = new NavigationEngine(route);
    stubSpeak(engine);
    (engine as unknown as { _distanceToNextManeuver: number })
      ._distanceToNextManeuver = 10;

    const announceCb = vi.fn();
    engine.on("announcement", announceCb);
    engine._checkAnnouncements();

    expect(announceCb).not.toHaveBeenCalled();
  });
});

// ── _onLocationUpdate ─────────────────────────────────────────────────────────

describe("_onLocationUpdate", () => {
  beforeEach(() => {
    vi.mocked(snapToRoute).mockReturnValue({
      snapped: [-73.0, 45.0],
      currentSegmentIndex: 0,
      distanceToRoute: 5,
      routeProgressMeters: 100,
    } as never);
    vi.mocked(haversineDistance).mockReturnValue(100);
  });

  it("updates currentLocation", () => {
    const engine = new NavigationEngine(makeRoute([
      { lat: 45.0, lon: -73.0 },
      { lat: 45.001, lon: -73.001 },
    ]));
    engine._onLocationUpdate(makeLocation(45.0, -73.0));
    expect(engine.currentLocation?.lat).toBe(45.0);
    expect(engine.currentLocation?.lon).toBe(-73.0);
  });

  it("emits offRoute when distance exceeds threshold", () => {
    vi.mocked(snapToRoute).mockReturnValue({
      snapped: [-73.0, 45.0],
      currentSegmentIndex: 0,
      distanceToRoute: 100, // > 50m threshold
      routeProgressMeters: 0,
    } as never);

    const engine = new NavigationEngine(makeRoute([
      { lat: 45.0, lon: -73.0 },
      { lat: 45.001, lon: -73.001 },
    ]));

    const offRouteCb = vi.fn();
    engine.on("offRoute", offRouteCb);
    engine._onLocationUpdate(makeLocation());

    expect(offRouteCb).toHaveBeenCalledWith(
      expect.objectContaining({ distance: 100 }),
    );
  });

  it("emits update on every location change", () => {
    const engine = new NavigationEngine(makeRoute([
      { lat: 45.0, lon: -73.0 },
      { lat: 45.001, lon: -73.001 },
    ]));
    const updateCb = vi.fn();
    engine.on("update", updateCb);
    engine._onLocationUpdate(makeLocation());
    expect(updateCb).toHaveBeenCalled();
  });

  it("early-returns for single-point geometry with update emit", () => {
    const engine = new NavigationEngine(
      makeRoute([{ lat: 45.0, lon: -73.0 }]),
    );
    const updateCb = vi.fn();
    engine.on("update", updateCb);
    engine._onLocationUpdate(makeLocation());
    expect(updateCb).toHaveBeenCalled();
  });
});

// ── Simulation mode ───────────────────────────────────────────────────────────

describe("simulation mode", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("_startSimulation sets isNavigating and builds cumulative distances", () => {
    vi.mocked(haversineDistance).mockReturnValue(50);
    const route = makeRoute([
      { lat: 45.0, lon: -73.0 },
      { lat: 45.001, lon: -73.001 },
      { lat: 45.002, lon: -73.002 },
    ]);
    const engine = new NavigationEngine(route, { simulationMode: true });
    engine._startSimulation();

    expect(engine.isNavigating).toBe(true);
    expect(engine.simulationInterval).not.toBeNull();
    engine.stop();
  });

  it("start() in simulation mode emits started and sets isNavigating", async () => {
    vi.mocked(haversineDistance).mockReturnValue(50);
    const route = makeRoute([
      { lat: 45.0, lon: -73.0 },
      { lat: 45.001, lon: -73.001 },
    ]);
    const engine = new NavigationEngine(route, { simulationMode: true });
    const startedCb = vi.fn();
    engine.on("started", startedCb);

    await engine.start();

    expect(startedCb).toHaveBeenCalled();
    expect(engine.isNavigating).toBe(true);
    engine.stop();
  });

  it("setSpeedMultiplier updates multiplier", () => {
    const engine = new NavigationEngine(makeRoute(), { simulationMode: true });
    engine.setSpeedMultiplier(2.5);
    expect(engine.simulationSpeedMultiplier).toBe(2.5);
  });
});
