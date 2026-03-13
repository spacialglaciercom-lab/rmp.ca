/**
 * Navigation engine (complete implementation).
 * Real-time turn-by-turn: location tracking, snap-to-route, progress, voice prompts,
 * off-route detection, distance remaining, step advancement, and arrival.
 * Uses expo-location and expo-speech (native). On web, location updates are no-ops.
 * Respects power saving mode for location accuracy and update interval.
 */
/// <reference path="../types/expo-navigation.d.ts" />

import { haversineDistance } from "./offlineTurnDetection";
import {
  createRouteLine,
  getRouteLengthMeters,
  snapToRoute,
} from "./routeSnap";
import type { MatchedPoint } from "./routeSnap";
import type { MatchedRoute, MatchedStep } from "./mapMatching";
import { PowerSavingManager } from "@/src/powerSaving";

type ListenerEntry = { event: string; callback: (data: unknown) => void };

export class NavigationEngine {
  readonly route: MatchedRoute;
  readonly steps: MatchedStep[];
  private _currentStepIndex: number;
  private _isNavigating: boolean;
  private _listeners: Set<ListenerEntry>;
  private _offRouteThreshold: number;
  private _announceDistances: number[];
  private _announced: Set<string>;
  private _currentLocation: {
    lat: number;
    lon: number;
    bearing?: number;
    speed?: number;
    accuracy?: number;
  } | null;
  private _distanceToNextManeuver: number;
  private _distanceRemaining: number;
  /** Last segment index from snap (for UI to show completed portion of route). */
  private _lastSegmentIndex: number;
  private _locationSubscription: { remove: () => void } | null;
  readonly simulationMode: boolean;
  private _simulationInterval: NodeJS.Timeout | null;
  simulationSpeedMultiplier: number;
  /** Avoid repeating the same street name in simulation (e.g. long segment with same name). */
  private lastSpokenStreetName: string;
  private lastSpokenText: string;
  private lastSpokenTime: number;
  /** Turf route line (built once from matchedGeometry). Used for snap and distance remaining. */
  private _routeLine: ReturnType<typeof createRouteLine> | null;
  /** Total route length in meters (set when _routeLine is built). */
  private _routeLengthMeters: number;
  /** Last MatchedPoint from routeSnap (for backward-jump prevention). */
  private _previousMatch: MatchedPoint | undefined;

  get currentStepIndex() { return this._currentStepIndex; }
  get isNavigating() { return this._isNavigating; }
  get currentLocation() { return this._currentLocation; }
  get distanceToNextManeuver() { return this._distanceToNextManeuver; }
  get distanceRemaining() { return this._distanceRemaining; }
  get lastSegmentIndex() { return this._lastSegmentIndex; }
  get listeners() { return this._listeners; }
  get offRouteThreshold() { return this._offRouteThreshold; }
  get announced() { return this._announced; }
  get announceDistances() { return this._announceDistances; }
  get locationSubscription() { return this._locationSubscription; }
  get simulationInterval() { return this._simulationInterval; }

  constructor(
    matchedRoute: MatchedRoute,
    options: { offRouteThreshold?: number; simulationMode?: boolean } = {},
  ) {
    this.route = matchedRoute;
    this.steps = matchedRoute.steps;
    this._currentStepIndex = 0;
    this._isNavigating = false;
    this._listeners = new Set();
    this._offRouteThreshold = options.offRouteThreshold ?? 50;
    this._announceDistances = [500, 200, 50];
    this._announced = new Set();
    this._currentLocation = null;
    this._distanceToNextManeuver = Infinity;
    this._distanceRemaining = matchedRoute.totalDistance;
    this._lastSegmentIndex = 0;
    this._locationSubscription = null;
    this.simulationMode = options.simulationMode ?? false;
    this._simulationInterval = null;
    this.simulationSpeedMultiplier = 1.0;
    this.lastSpokenStreetName = "";
    this.lastSpokenText = "";
    this.lastSpokenTime = 0;
    this._routeLine = null;
    this._routeLengthMeters = 0;
    this._previousMatch = undefined;
  }

  async start(): Promise<void> {
    try {
      const t0 =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = () =>
        `${((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0).toFixed(0)}ms`;

      if (this.simulationMode) {
        console.log(
          `[NavEngine] Starting simulation (${this.route.matchedGeometry.length} points)`,
        );
        this._startSimulation();
        this._emit("started");
        console.log(`[NavEngine] Simulation started in ${elapsed()}`);
        return;
      }

      console.log("[NavEngine] Requesting location permission...");
      const Location = await import("expo-location");
      console.log(`[NavEngine] expo-location imported in ${elapsed()}`);
      const { status } = await Location.requestForegroundPermissionsAsync();
      console.log(`[NavEngine] Permission: ${status} (${elapsed()})`);
      if (status !== "granted") throw new Error("Location permission required");

      this._isNavigating = true;

      console.log("[NavEngine] Initializing PowerSavingManager...");
      await PowerSavingManager.init();
      console.log(`[NavEngine] PowerSaving ready (${elapsed()})`);
      const locationOptions = PowerSavingManager.getLocationWatchOptions();
      this._locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: locationOptions.accuracy,
          distanceInterval: locationOptions.distanceInterval,
          timeInterval: locationOptions.timeInterval,
        },
        (loc: unknown) => {
          const location = loc as {
            coords: {
              latitude: number;
              longitude: number;
              heading?: number;
              speed?: number;
              accuracy?: number;
            };
          };
          this._onLocationUpdate(location);
        },
      );

      this._emit("started");
    } catch (err) {
      this._emit("error", err);
      throw err;
    }
  }

  stop(): void {
    this._isNavigating = false;
    if (this._simulationInterval) {
      clearTimeout(this._simulationInterval);
      this._simulationInterval = null;
    }
    if (this._locationSubscription) {
      this._locationSubscription.remove();
      this._locationSubscription = null;
    }
    this._emit("stopped");
    this._listeners.clear();
  }

  /** Base simulation driving speed in m/s. ~30 km/h for residential streets. */
  private static SIM_BASE_SPEED = 8.3;
  /** Target tick interval for smooth animation (ms). ~15 fps. */
  private static SIM_TICK_MS = 65;

  /** Update the speed multiplier while running. */
  setSpeedMultiplier(multiplier: number): void {
    this.simulationSpeedMultiplier = multiplier;
    if (this._isNavigating && this._simulationInterval) {
      clearTimeout(this._simulationInterval);
      this._simulationInterval = null;
      this._scheduleNextSimTick();
    }
  }

  /** Total meters traveled so far in simulation. Simple scalar — no stale state issues. */
  private _simDistanceTraveled = 0;
  /** Pre-computed cumulative distances for each geometry point from start. */
  private _simCumDists: number[] = [];

  _startSimulation(): void {
    this._isNavigating = true;
    this._simDistanceTraveled = 0;

    const geometry = this.route.matchedGeometry;
    const cum = [0];
    for (let i = 1; i < geometry.length; i++) {
      cum.push(cum[i - 1] + haversineDistance(geometry[i - 1], geometry[i]));
    }
    this._simCumDists = cum;

    console.log(
      `[NavEngine] Simulation: ${geometry.length} points, ${cum[cum.length - 1].toFixed(0)}m total`,
    );
    this._scheduleNextSimTick();
  }

  /** Given a distance along the route, return the interpolated position, bearing, and segment speed. */
  private _positionAtDistance(dist: number): {
    lat: number;
    lon: number;
    bearing: number;
    speed: number;
    segIdx: number;
  } {
    const geometry = this.route.matchedGeometry;
    const cum = this._simCumDists;
    const totalDist = cum[cum.length - 1] ?? 0;

    if (dist <= 0) {
      const bearing =
        geometry.length > 1
          ? this._calculateBearing(geometry[0], geometry[1])
          : 0;
      return {
        ...geometry[0],
        bearing,
        speed: NavigationEngine.SIM_BASE_SPEED,
        segIdx: 0,
      };
    }
    if (dist >= totalDist) {
      const last = geometry[geometry.length - 1];
      const prev = geometry[geometry.length - 2] ?? last;
      return {
        ...last,
        bearing: this._calculateBearing(prev, last),
        speed: 0,
        segIdx: geometry.length - 2,
      };
    }

    let lo = 0;
    let hi = cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= dist) lo = mid;
      else hi = mid - 1;
    }
    const segIdx = lo;

    const segStart = geometry[segIdx];
    const segEnd = geometry[segIdx + 1];
    const segLen = cum[segIdx + 1] - cum[segIdx];
    const t = segLen > 0 ? (dist - cum[segIdx]) / segLen : 0;

    const lat = segStart.lat + (segEnd.lat - segStart.lat) * t;
    const lon = segStart.lon + (segEnd.lon - segStart.lon) * t;
    const bearing = this._calculateBearing(segStart, segEnd);

    let speed = NavigationEngine.SIM_BASE_SPEED;
    if (segIdx < geometry.length - 2) {
      const bearingNext = this._calculateBearing(segEnd, geometry[segIdx + 2]);
      let angleDiff = Math.abs(bearingNext - bearing);
      if (angleDiff > 180) angleDiff = 360 - angleDiff;
      if (angleDiff > 60) speed *= 0.5;
      else if (angleDiff > 30) speed *= 0.75;
    }

    return { lat, lon, bearing, speed, segIdx };
  }

  /** Schedule the next simulation tick. */
  private _scheduleNextSimTick(): void {
    if (!this._isNavigating) return;
    const totalDist = this._simCumDists[this._simCumDists.length - 1] ?? 0;

    if (this._simDistanceTraveled >= totalDist) {
      const final = this._positionAtDistance(totalDist);
      this._onLocationUpdate({
        coords: {
          latitude: final.lat,
          longitude: final.lon,
          heading: final.bearing,
          speed: 0,
          accuracy: 5,
        },
      });
      this.stop();
      return;
    }

    const pos = this._positionAtDistance(this._simDistanceTraveled);

    this._onLocationUpdate({
      coords: {
        latitude: pos.lat,
        longitude: pos.lon,
        heading: pos.bearing,
        speed: pos.speed,
        accuracy: 5,
      },
    });

    const tickSec = NavigationEngine.SIM_TICK_MS / 1000;
    this._simDistanceTraveled +=
      pos.speed * tickSec * this.simulationSpeedMultiplier;

    const tickMs =
      NavigationEngine.SIM_TICK_MS / this.simulationSpeedMultiplier;
    const clampedMs = Math.max(30, Math.min(500, tickMs));
    this._simulationInterval = setTimeout(() => {
      this._scheduleNextSimTick();
    }, clampedMs) as unknown as NodeJS.Timeout;
  }

  _calculateBearing(
    start: { lat: number; lon: number },
    end: { lat: number; lon: number },
  ): number {
    const startLat = (start.lat * Math.PI) / 180;
    const startLon = (start.lon * Math.PI) / 180;
    const endLat = (end.lat * Math.PI) / 180;
    const endLon = (end.lon * Math.PI) / 180;

    const y = Math.sin(endLon - startLon) * Math.cos(endLat);
    const x =
      Math.cos(startLat) * Math.sin(endLat) -
      Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLon - startLon);
    const theta = Math.atan2(y, x);
    const bearing = ((theta * 180) / Math.PI + 360) % 360;
    return bearing;
  }

  _onLocationUpdate(location: {
    coords: {
      latitude: number;
      longitude: number;
      heading?: number;
      speed?: number;
      accuracy?: number;
    };
  }): void {
    this._currentLocation = {
      lat: location.coords.latitude,
      lon: location.coords.longitude,
      bearing: location.coords.heading,
      speed: location.coords.speed,
      accuracy: location.coords.accuracy,
    };

    const routeCoords = this.route.matchedGeometry;
    if (routeCoords.length < 2) {
      this._emit("update", this.getState());
      return;
    }

    const snapped = this._snapToRoute(this._currentLocation);
    this._lastSegmentIndex = snapped.segmentIndex;

    if (snapped.distanceFromRoute > this._offRouteThreshold) {
      this._emit("offRoute", {
        distance: snapped.distanceFromRoute,
        location: this._currentLocation,
        currentStepIndex: this._currentStepIndex,
        segmentIndex: snapped.segmentIndex,
      });
      this._emit("update", this.getState());
      return;
    }

    this._updateProgress(snapped);
    this._updateDistanceRemaining(snapped);
    this._checkAnnouncements();
    this._emit("update", this.getState());
  }

  _snapToRoute(location: { lat: number; lon: number }): {
    snappedLocation: { lat: number; lon: number };
    segmentIndex: number;
    distanceFromRoute: number;
    routeProgressMeters?: number;
    totalRouteLength?: number;
  } {
    const routeCoords = this.route.matchedGeometry;
    if (routeCoords.length < 2) {
      return {
        snappedLocation: routeCoords[0] ?? { lat: 0, lon: 0 },
        segmentIndex: 0,
        distanceFromRoute: 0,
      };
    }

    if (!this._routeLine) {
      this._routeLine = createRouteLine(
        routeCoords.map((p) => [p.lon, p.lat] as [number, number]),
      );
      this._routeLengthMeters = getRouteLengthMeters(this._routeLine);
    }

    const matched = snapToRoute(
      { lon: location.lon, lat: location.lat },
      this._routeLine!,
      this._previousMatch,
      this._offRouteThreshold,
    );
    this._previousMatch = matched;

    return {
      snappedLocation: {
        lat: matched.snapped[1],
        lon: matched.snapped[0],
      },
      segmentIndex: matched.currentSegmentIndex,
      distanceFromRoute: matched.distanceToRoute,
      routeProgressMeters: matched.routeProgressMeters,
      totalRouteLength: this._routeLengthMeters,
    };
  }

  _updateProgress(snapped: {
    snappedLocation: { lat: number; lon: number };
    segmentIndex: number;
  }): void {
    const currentStep = this.steps[this._currentStepIndex];
    if (!currentStep?.geometry?.coordinates?.length) return;

    const coords = currentStep.geometry.coordinates;
    const stepEndCoord = coords[coords.length - 1];
    const stepEnd = { lat: stepEndCoord[1], lon: stepEndCoord[0] };

    const distToStepEnd = haversineDistance(snapped.snappedLocation, stepEnd);
    this._distanceToNextManeuver = distToStepEnd;

    if (distToStepEnd < 20 && this._currentStepIndex < this.steps.length - 1) {
      this._currentStepIndex++;
      this._announced.clear();
      this._emit("stepChanged", {
        step: this.steps[this._currentStepIndex],
        index: this._currentStepIndex,
      });
    }

    if (this._currentStepIndex >= this.steps.length - 1 && distToStepEnd < 30) {
      this._distanceRemaining = 0;
      this._emit("arrived");
      this.stop();
    }
  }

  /** Update remaining distance from current snapped position to end of route. */
  _updateDistanceRemaining(snapped: {
    snappedLocation: { lat: number; lon: number };
    segmentIndex: number;
    routeProgressMeters?: number;
    totalRouteLength?: number;
  }): void {
    if (
      snapped.routeProgressMeters != null &&
      snapped.totalRouteLength != null &&
      snapped.totalRouteLength > 0
    ) {
      this._distanceRemaining = Math.max(
        0,
        snapped.totalRouteLength - snapped.routeProgressMeters,
      );
      return;
    }

    const routeCoords = this.route.matchedGeometry;
    if (routeCoords.length < 2) return;

    const idx = snapped.segmentIndex;
    let remaining = 0;
    if (idx < routeCoords.length - 1) {
      remaining += haversineDistance(
        snapped.snappedLocation,
        routeCoords[idx + 1],
      );
      for (let i = idx + 1; i < routeCoords.length - 1; i++) {
        remaining += haversineDistance(routeCoords[i], routeCoords[i + 1]);
      }
    } else {
      remaining = haversineDistance(
        snapped.snappedLocation,
        routeCoords[routeCoords.length - 1],
      );
    }
    this._distanceRemaining = Math.max(0, remaining);
  }

  _checkAnnouncements(): void {
    const now = Date.now();
    const minRepeatMs = 8000;
    for (const dist of this._announceDistances) {
      const key = `${this._currentStepIndex}-${dist}`;
      if (this._distanceToNextManeuver <= dist && !this._announced.has(key)) {
        this._announced.add(key);
        const nextStep = this.steps[this._currentStepIndex + 1];
        if (nextStep) {
          const text = this._buildVoiceInstruction(
            nextStep,
            this._distanceToNextManeuver,
          );
          if (
            text === this.lastSpokenText &&
            now - this.lastSpokenTime < minRepeatMs
          )
            continue;
          this.lastSpokenText = text;
          this.lastSpokenTime = now;
          this.lastSpokenStreetName = nextStep.name ?? "";
          this._speak(text);
          this._emit("announcement", { text, distance: dist });
        }
      }
    }
  }

  _buildVoiceInstruction(step: MatchedStep, distance: number): string {
    const maneuver = step.maneuver;
    const distText =
      distance > 100
        ? `In ${Math.round(distance / 100) * 100} meters`
        : `In ${Math.round(distance)} meters`;

    const turnText = this._maneuverToText(maneuver);
    const streetName = step.name ?? "";
    const omitStreet = streetName && streetName === this.lastSpokenStreetName;

    if (streetName && !omitStreet) {
      return `${distText}, ${turnText} onto ${streetName}`;
    }
    return `${distText}, ${turnText}`;
  }

  _maneuverToText(maneuver: {
    type?: string;
    modifier?: string;
    exit?: number;
  }): string {
    const type = maneuver?.type ?? "";
    const modifier = maneuver?.modifier ?? "";

    const modifierMap: Record<string, string> = {
      left: "turn left",
      right: "turn right",
      "slight left": "bear left",
      "slight right": "bear right",
      "sharp left": "make a sharp left",
      "sharp right": "make a sharp right",
      straight: "continue straight",
      uturn: "make a U-turn",
    };

    if (type === "turn") return modifierMap[modifier] ?? `turn ${modifier}`;
    if (type === "new name") return "continue onto";
    if (type === "depart") return "depart";
    if (type === "arrive") return "you have arrived";
    if (type === "roundabout") {
      return `enter the roundabout, take exit ${maneuver.exit ?? ""}`;
    }
    if (type === "rotary") {
      return `enter the rotary, take exit ${maneuver.exit ?? ""}`;
    }
    if (type === "fork") return modifierMap[modifier] ?? "keep going";
    if (type === "merge") return `merge ${modifier || "ahead"}`;
    if (type === "end of road")
      return modifierMap[modifier] ?? "at end of road";

    return modifierMap[modifier] ?? type;
  }

  _speak(text: string): void {
    const { speakNavigation } = require("@/lib/expoSpeechVoice");
    speakNavigation(text);
  }

  getState(): {
    currentLocation: {
      lat: number;
      lon: number;
      bearing?: number;
      speed?: number;
      accuracy?: number;
    } | null;
    currentStepIndex: number;
    totalSteps: number;
    currentStep: MatchedStep | undefined;
    nextStep: MatchedStep | undefined;
    distanceToNextManeuver: number;
    distanceRemaining: number;
    segmentIndex: number;
    nextManeuverType?: string;
    nextManeuverModifier?: string;
    streetName: string;
    isNavigating: boolean;
  } {
    const currentStep = this.steps[this._currentStepIndex];
    const nextStep = this.steps[this._currentStepIndex + 1];

    return {
      currentLocation: this._currentLocation,
      currentStepIndex: this._currentStepIndex,
      totalSteps: this.steps.length,
      currentStep,
      nextStep,
      distanceToNextManeuver: this._distanceToNextManeuver,
      distanceRemaining: this._distanceRemaining,
      segmentIndex: this._lastSegmentIndex,
      nextManeuverType: nextStep?.maneuver?.type,
      nextManeuverModifier: nextStep?.maneuver?.modifier,
      streetName: currentStep?.name ?? "",
      isNavigating: this._isNavigating,
    };
  }

  on(event: string, callback: (data: unknown) => void): () => void {
    const entry: ListenerEntry = { event, callback };
    this._listeners.add(entry);
    return () => this._listeners.delete(entry);
  }

  _emit(event: string, data?: unknown): void {
    this._listeners.forEach((entry: ListenerEntry) => {
      if (entry.event === event) entry.callback(data);
    });
  }
}
