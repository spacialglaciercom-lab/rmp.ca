/**
 * Map matching: snap GPX trace to road network via Google Maps or OSRM.
 * OSRM is the default provider; Google Maps when the user selects it (native) or when the server exposes a Maps key (web proxy).
 */

import { Platform } from "react-native";
import polyline from "@mapbox/polyline";
import { shouldUseMapsServerProxy } from "./google-maps-config";
import type { RoutingConfig } from "./routing-config";
import {
  detectTurnsFromGPX,
  haversineDistance,
  type TurnInstruction,
} from "./offlineTurnDetection";

/** Get the API base URL for /api/maps/* server proxies (directions, snap-to-roads). */
function getProxyBaseUrl(): string {
  try {
    const oauth = require("@/shared/oauth") as {
      getApiBaseUrl: () => string;
      API_BASE_URL?: string;
    };
    const base = oauth.getApiBaseUrl();
    // On web, avoid empty base so we always hit the API server (e.g. routemasterpro.ca) for directions proxy
    if (Platform.OS === "web" && !base && oauth.API_BASE_URL)
      return oauth.API_BASE_URL.replace(/\/$/, "");
    return (
      base ||
      (oauth.API_BASE_URL
        ? oauth.API_BASE_URL.replace(/\/$/, "")
        : "http://localhost:3000")
    );
  } catch {
    return "http://localhost:3000";
  }
}

export interface OsrmIntersection {
  location: [number, number]; // [lon, lat]
  bearings: number[];
  classes?: string[];
  entry: boolean[];
  in?: number;
  out?: number;
}

export interface MatchedStep {
  geometry: { type: "LineString"; coordinates: [number, number][] };
  maneuver: { type: string; modifier?: string; exit?: number; location?: [number, number] };
  name?: string;
  ref?: string;
  distance: number;
  duration: number;
  intersections?: OsrmIntersection[];
}

export interface MatchedRoute {
  steps: MatchedStep[];
  legs: Array<{ steps?: MatchedStep[]; distance: number; duration: number; annotation?: { nodes: number[] } }>;
  totalDistance: number;
  totalDuration: number;
  matchedGeometry: Array<{ lat: number; lon: number }>;
  /** Flat list of all OSM node IDs along the route (from leg annotations). */
  nodeIds?: number[];
}

/** Public OSRM demo server is strict: small batches and short URLs. */
const BATCH_SIZE = 10;
/** Max points to send to public demo (router.project-osrm.org); longer traces are downsampled. */
const MAX_POINTS_PUBLIC_DEMO = 80;
/** Delay between batches (ms) to respect ~1 req/s. */
const BATCH_DELAY_MS = 1100;

function isPublicDemoServer(baseUrl: string): boolean {
  const u = baseUrl
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase();
  return (
    u === "router.project-osrm.org" || u.includes("routing.openstreetmap.de")
  );
}

/** Downsample to at most maxPoints, keeping first and last and spreading the rest. */
function downsamplePoints(
  points: Array<{ lat: number; lon: number }>,
  maxPoints: number,
): Array<{ lat: number; lon: number }> {
  if (points.length <= maxPoints) return points;
  const out: Array<{ lat: number; lon: number }> = [points[0]];
  const numMiddle = maxPoints - 2;
  for (let i = 1; i <= numMiddle; i++) {
    const idx = Math.round((i / (numMiddle + 1)) * (points.length - 1));
    out.push(points[Math.min(idx, points.length - 1)]);
  }
  out.push(points[points.length - 1]);
  return out;
}

// ── Google Directions API ────────────────────────────────────────────────────

/** Map Google maneuver strings to OSRM-compatible maneuver types. */
function googleManeuverToOsrm(maneuver?: string): {
  type: string;
  modifier?: string;
} {
  if (!maneuver) return { type: "new name", modifier: "straight" };
  const m = maneuver.toLowerCase().replace(/-/g, "_");
  if (m === "turn_left") return { type: "turn", modifier: "left" };
  if (m === "turn_right") return { type: "turn", modifier: "right" };
  if (m === "turn_slight_left")
    return { type: "turn", modifier: "slight left" };
  if (m === "turn_slight_right")
    return { type: "turn", modifier: "slight right" };
  if (m === "turn_sharp_left") return { type: "turn", modifier: "sharp left" };
  if (m === "turn_sharp_right")
    return { type: "turn", modifier: "sharp right" };
  if (m === "uturn_left" || m === "uturn_right")
    return { type: "turn", modifier: "uturn" };
  if (m === "roundabout_left" || m === "roundabout_right")
    return {
      type: "roundabout",
      modifier: m.includes("left") ? "left" : "right",
    };
  if (m === "straight") return { type: "new name", modifier: "straight" };
  if (m === "merge") return { type: "merge", modifier: "straight" };
  if (m === "fork_left") return { type: "fork", modifier: "slight left" };
  if (m === "fork_right") return { type: "fork", modifier: "slight right" };
  if (m === "ramp_left") return { type: "on ramp", modifier: "slight left" };
  if (m === "ramp_right") return { type: "on ramp", modifier: "slight right" };
  if (m === "keep_left") return { type: "fork", modifier: "slight left" };
  if (m === "keep_right") return { type: "fork", modifier: "slight right" };
  return { type: "turn", modifier: "straight" };
}

/** Convert a Google Directions leg+steps response into MatchedRoute. */
function parseGoogleDirectionsResponse(data: any): MatchedRoute | null {
  if (data.status !== "OK" || !data.routes?.length) {
    const msg = data.error_message || data.status || "Unknown error";
    console.warn("[Google Directions] API error:", data.status, msg);
    return null;
  }
  const route = data.routes[0];

  const allSteps: MatchedStep[] = [];
  const legs: Array<{
    steps?: MatchedStep[];
    distance: number;
    duration: number;
  }> = [];
  let totalDistance = 0;
  let totalDuration = 0;
  const matchedGeometry: Array<{ lat: number; lon: number }> = [];

  for (const leg of route.legs ?? []) {
    const legSteps: MatchedStep[] = [];
    const legDistance = leg.distance?.value ?? 0;
    const legDuration = leg.duration?.value ?? 0;
    totalDistance += legDistance;
    totalDuration += legDuration;

    for (let si = 0; si < (leg.steps ?? []).length; si++) {
      const step = leg.steps[si];
      const decoded = polyline.decode(step.polyline?.points ?? "");
      const coords: [number, number][] = decoded.map(
        ([lat, lon]: [number, number]) => [lon, lat],
      );

      // Add decoded points to overall geometry
      for (const [lat, lon] of decoded) {
        matchedGeometry.push({ lat, lon });
      }

      const maneuver =
        si === 0
          ? { type: "depart", modifier: "straight" }
          : si === leg.steps.length - 1 &&
              leg === route.legs[route.legs.length - 1]
            ? { type: "arrive", modifier: "straight" }
            : googleManeuverToOsrm(step.maneuver);

      const matched: MatchedStep = {
        geometry: { type: "LineString", coordinates: coords },
        maneuver,
        name: step.html_instructions
          ? step.html_instructions.replace(/<[^>]*>/g, "")
          : undefined,
        distance: step.distance?.value ?? 0,
        duration: step.duration?.value ?? 0,
      };
      legSteps.push(matched);
      allSteps.push(matched);
    }

    legs.push({
      steps: legSteps,
      distance: legDistance,
      duration: legDuration,
    });
  }

  if (allSteps.length === 0) return null;

  return {
    steps: allSteps,
    legs,
    totalDistance,
    totalDuration,
    matchedGeometry,
  };
}

import type { DeliveryRouteParams } from "@/types/routeParams";

/**
 * Options for routing (Google: avoid tolls/highways/ferries; delivery mode for truck routing).
 */
export interface RouteOptions {
  /** Google Directions: avoid=tolls|highways|ferries (any combination). */
  avoid?: ("tolls" | "highways" | "ferries")[];
  /** Delivery params (goods delivery mode, vehicle dimensions for truck routing). */
  deliveryParams?: DeliveryRouteParams;
}

/** Fetch Google Directions — uses server proxy on web to avoid CORS. */
async function fetchGoogleDirections(
  origin: string,
  destination: string,
  waypoints: string,
  apiKey: string,
  options?: RouteOptions,
): Promise<any> {
  const avoid = options?.avoid?.length ? options.avoid.join("|") : undefined;
  const goodsDelivery = options?.deliveryParams?.goodsDelivery ?? false;
  // When goods delivery is on: use departure_time=now for traffic-aware routing
  const departureTime = goodsDelivery ? "now" : undefined;

  const body = {
    origin,
    destination,
    waypoints: waypoints || undefined,
    mode: "driving",
    avoid,
    departureTime,
  };

  if (shouldUseMapsServerProxy()) {
    const base = getProxyBaseUrl();
    const url = `${base}/api/maps/directions`;
    if (!base)
      console.warn(
        "[Google Directions] Proxy base URL is empty; request may fail.",
      );
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      console.warn(
        "[Google Directions] Proxy error:",
        response.status,
        (data as { error?: string }).error ?? data,
      );
    }
    return data;
  } else {
    let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=driving&key=${apiKey}`;
    if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
    if (avoid) url += `&avoid=${encodeURIComponent(avoid)}`;
    if (departureTime === "now") url += `&departure_time=now`;
    const response = await fetch(url);
    return response.json();
  }
}

/** Route between two points using Google Directions API. */
async function googleRouteBetweenPoints(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  apiKey: string,
  options?: RouteOptions,
): Promise<MatchedRoute | null> {
  try {
    const data = await fetchGoogleDirections(
      `${from.lat},${from.lon}`,
      `${to.lat},${to.lon}`,
      "",
      apiKey,
      options,
    );
    return parseGoogleDirectionsResponse(data);
  } catch (err) {
    console.warn("[Google Directions] routeBetweenPoints failed:", err);
    return null;
  }
}

// ── Google Roads API (snap to roads) ─────────────────────────────────────────

/** Max points per snapToRoads request. */
const SNAP_BATCH_SIZE = 100;

/**
 * Snap GPS points to roads using Google Roads API.
 * Returns road-snapped coordinates. Batches automatically for >100 points.
 */
async function googleSnapToRoads(
  points: Array<{ lat: number; lon: number }>,
  apiKey: string,
): Promise<Array<{ lat: number; lon: number }> | null> {
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = () =>
    `${((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0).toFixed(0)}ms`;
  const batches = Math.ceil(points.length / (SNAP_BATCH_SIZE - 1));
  console.log(
    `[SnapToRoads] Starting: ${points.length} points, ${batches} batch(es)`,
  );

  const snapped: Array<{ lat: number; lon: number }> = [];

  for (let i = 0; i < points.length; i += SNAP_BATCH_SIZE - 1) {
    const batchNum = Math.floor(i / (SNAP_BATCH_SIZE - 1)) + 1;
    const batch = points.slice(i, i + SNAP_BATCH_SIZE);
    const path = batch.map((p) => `${p.lat},${p.lon}`).join("|");
    const batchT0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    try {
      let data: any;
      if (shouldUseMapsServerProxy()) {
        const base = getProxyBaseUrl();
        const response = await fetch(`${base}/api/maps/snap-to-roads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, interpolate: true }),
        });
        data = await response.json();
      } else {
        const url = `https://roads.googleapis.com/v1/snapToRoads?interpolate=true&path=${encodeURIComponent(path)}&key=${apiKey}`;
        const response = await fetch(url);
        data = await response.json();
      }
      const batchMs = (
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        batchT0
      ).toFixed(0);
      if (data.error || !data.snappedPoints?.length) {
        console.warn(
          `[SnapToRoads] Batch ${batchNum}/${batches} failed (${batchMs}ms):`,
          data.error?.message ?? "no points",
        );
        if (i === 0) return null;
        break;
      }
      console.log(
        `[SnapToRoads] Batch ${batchNum}/${batches}: ${batch.length} pts -> ${data.snappedPoints.length} snapped (${batchMs}ms)`,
      );

      // Deduplicate overlap point between batches
      const batchPoints = data.snappedPoints.map((sp: any) => ({
        lat: sp.location.latitude,
        lon: sp.location.longitude,
      }));
      if (snapped.length > 0 && batchPoints.length > 0) snapped.pop();
      snapped.push(...batchPoints);
    } catch (err) {
      console.warn(
        `[SnapToRoads] Batch ${batchNum}/${batches} request failed (${((typeof performance !== "undefined" ? performance.now() : Date.now()) - batchT0).toFixed(0)}ms):`,
        err,
      );
      if (i === 0) return null;
      break;
    }
  }

  console.log(
    `[SnapToRoads] Done: ${snapped.length} snapped points (${elapsed()} total)`,
  );
  return snapped.length >= 2 ? snapped : null;
}

/**
 * Match GPX trace to roads using Google Roads API (snap) + Directions API (turn-by-turn).
 * Step 1: Snap all GPX points to roads for accurate geometry.
 * Step 2: Route through key waypoints (downsampled from snapped) for turn-by-turn steps.
 */
async function googleMatchGPXToRoads(
  points: Array<{ lat: number; lon: number }>,
  apiKey: string,
  options?: RouteOptions,
): Promise<MatchedRoute | null> {
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = () =>
    `${((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0).toFixed(0)}ms`;
  console.log(`[GoogleMatch] Starting: ${points.length} points`);

  // Step 1: Snap trace to roads for accurate geometry
  const snapped = await googleSnapToRoads(points, apiKey);
  console.log(
    `[GoogleMatch] Snap complete (${elapsed()}): ${snapped ? snapped.length + " points" : "failed"}`,
  );

  // Step 2: Get turn-by-turn via Directions using downsampled waypoints
  const waypointSample = downsamplePoints(points, GOOGLE_MAX_WAYPOINTS + 2);
  console.log(
    `[GoogleMatch] Directions request: ${waypointSample.length} waypoints...`,
  );
  const directionsResult = await googleRouteThroughWaypoints(
    waypointSample,
    apiKey,
    options,
  );
  console.log(
    `[GoogleMatch] Directions complete (${elapsed()}): ${directionsResult ? directionsResult.steps.length + " steps" : "failed"}`,
  );

  if (!directionsResult) return null;

  // If snap succeeded, replace the geometry with the more accurate snapped trace
  if (snapped && snapped.length >= 2) {
    directionsResult.matchedGeometry = snapped;
  }

  console.log(
    `[GoogleMatch] Done (${elapsed()}): ${directionsResult.matchedGeometry.length} geometry pts, ${directionsResult.totalDistance.toFixed(0)}m`,
  );
  return directionsResult;
}

/** Max waypoints per Google Directions request (free tier limit). */
const GOOGLE_MAX_WAYPOINTS = 25;

/** Route through multiple waypoints using Google Directions API. */
async function googleRouteThroughWaypoints(
  points: Array<{ lat: number; lon: number }>,
  apiKey: string,
  options?: RouteOptions,
): Promise<MatchedRoute | null> {
  if (points.length < 2) return null;

  const allLegs: Array<{
    steps?: MatchedStep[];
    distance: number;
    duration: number;
  }> = [];
  const allSteps: MatchedStep[] = [];
  let totalDistance = 0;
  let totalDuration = 0;
  const matchedGeometry: Array<{ lat: number; lon: number }> = [];

  // Chain requests for > GOOGLE_MAX_WAYPOINTS
  for (let i = 0; i < points.length - 1; ) {
    const end = Math.min(i + GOOGLE_MAX_WAYPOINTS + 1, points.length);
    const chunk = points.slice(i, end);
    const origin = chunk[0];
    const destination = chunk[chunk.length - 1];
    const waypoints =
      chunk.length > 2
        ? chunk
            .slice(1, -1)
            .map((p) => `${p.lat},${p.lon}`)
            .join("|")
        : "";

    try {
      const data = await fetchGoogleDirections(
        `${origin.lat},${origin.lon}`,
        `${destination.lat},${destination.lon}`,
        waypoints,
        apiKey,
        options,
      );
      const result = parseGoogleDirectionsResponse(data);
      if (!result) {
        if (i === 0) return null;
        break;
      }

      if (matchedGeometry.length > 0 && result.matchedGeometry.length > 0)
        matchedGeometry.pop();
      matchedGeometry.push(...result.matchedGeometry);
      totalDistance += result.totalDistance;
      totalDuration += result.totalDuration;
      allLegs.push(...result.legs);
      allSteps.push(...result.steps);
    } catch (err) {
      console.warn("[Google Directions] routeThroughWaypoints failed:", err);
      if (i === 0) return null;
      break;
    }

    i = end - 1;
    if (i >= points.length - 1) break;
  }

  if (matchedGeometry.length < 2) return null;

  return {
    steps: allSteps,
    legs: allLegs,
    totalDistance,
    totalDuration,
    matchedGeometry,
  };
}

// ── Public routing functions (provider-aware) ────────────────────────────────

/**
 * Get a driven route between two points.
 * Delegates to Google Directions or OSRM based on config.provider.
 */
export async function routeBetweenPoints(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  config: RoutingConfig,
  options?: RouteOptions,
): Promise<MatchedRoute | null> {
  // Server proxy adds the API key; use Google without a client-side key when we hit /api/maps/* (web or native + remote API URL).
  if (
    config.provider === "google" &&
    (config.googleApiKey || shouldUseMapsServerProxy())
  ) {
    return googleRouteBetweenPoints(
      from,
      to,
      config.googleApiKey || "",
      options,
    );
  }

  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const baseUrl = config.baseUrl;
  const url = `${baseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&annotations=nodes`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || data.code !== "Ok" || !data.routes?.length) return null;
    const route = data.routes[0];
    const geometry = route.geometry?.coordinates ?? [];
    const matchedGeometry = geometry.map((c: [number, number]) => ({
      lat: c[1],
      lon: c[0],
    }));
    const legs = route.legs ?? [];
    const steps: MatchedStep[] = legs.flatMap(
      (leg: { steps?: MatchedStep[] }) => leg.steps ?? [],
    );
    const nodeIds: number[] = legs.flatMap(
      (leg: { annotation?: { nodes: number[] } }) => leg.annotation?.nodes ?? [],
    );
    return {
      steps,
      legs: legs.map(
        (leg: {
          distance: number;
          duration: number;
          steps?: MatchedStep[];
          annotation?: { nodes: number[] };
        }) => ({
          steps: leg.steps ?? [],
          distance: leg.distance ?? 0,
          duration: leg.duration ?? 0,
          annotation: leg.annotation,
        }),
      ),
      totalDistance: route.distance ?? 0,
      totalDuration: route.duration ?? 0,
      matchedGeometry,
      nodeIds: nodeIds.length > 0 ? nodeIds : undefined,
    };
  } catch (err) {
    console.warn("Routing route request failed:", err);
    return null;
  }
}

/** Max waypoints per Route request (public OSRM); chain segments to keep all VRP stops. */
const MAX_WAYPOINTS_ROUTE_PUBLIC = 25;

/**
 * Get a driven route through multiple waypoints (VRP stop sequence).
 * Delegates to Google Directions or OSRM based on config.provider.
 */
export async function routeThroughWaypoints(
  points: Array<{ lat: number; lon: number }>,
  config: RoutingConfig,
  options?: RouteOptions,
): Promise<MatchedRoute | null> {
  if (points.length < 2) return null;
  console.log(
    "[Route] waypoints=" + points.length + ", provider=" + config.provider,
  );

  if (
    config.provider === "google" &&
    (config.googleApiKey || shouldUseMapsServerProxy())
  ) {
    return googleRouteThroughWaypoints(
      points,
      config.googleApiKey || "",
      options,
    );
  }

  const allLegs: Array<{
    steps?: MatchedStep[];
    distance: number;
    duration: number;
    annotation?: { nodes: number[] };
  }> = [];
  const allSteps: MatchedStep[] = [];
  const allNodeIds: number[] = [];
  let totalDistance = 0;
  let totalDuration = 0;
  const matchedGeometry: Array<{ lat: number; lon: number }> = [];

  const chunkSize = isPublicDemoServer(config.baseUrl)
    ? MAX_WAYPOINTS_ROUTE_PUBLIC
    : 100;
  for (let i = 0; i < points.length; ) {
    if (i > 0) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    const end = Math.min(i + chunkSize, points.length);
    const chunk = points.slice(i, end);
    const coords = chunk.map((p) => `${p.lon},${p.lat}`).join(";");
    const url = `${config.baseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&annotations=nodes`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok || data.code !== "Ok" || !data.routes?.length) {
        if (i === 0) return null;
        break;
      }
      const route = data.routes[0];
      const geometry = route.geometry?.coordinates ?? [];
      const seg = geometry.map((c: [number, number]) => ({
        lat: c[1],
        lon: c[0],
      }));
      if (matchedGeometry.length > 0 && seg.length > 0) matchedGeometry.pop();
      matchedGeometry.push(...seg);
      totalDistance += route.distance ?? 0;
      totalDuration += route.duration ?? 0;
      const legs = route.legs ?? [];
      for (const leg of legs) {
        allLegs.push(leg);
        if (leg.steps) allSteps.push(...leg.steps);
        if (leg.annotation?.nodes) allNodeIds.push(...leg.annotation.nodes);
      }
    } catch (err) {
      console.warn("OSRM route-through-waypoints failed:", err);
      if (i === 0) return null;
      break;
    }
    i = end - 1;
    if (i >= points.length - 1) break;
  }

  if (matchedGeometry.length < 2) return null;

  return {
    steps: allSteps,
    legs: allLegs,
    totalDistance,
    totalDuration,
    matchedGeometry,
    nodeIds: allNodeIds.length > 0 ? allNodeIds : undefined,
  };
}

/**
 * Snap GPX points to roads using OSRM Match API.
 * For Google provider, falls back to routeThroughWaypoints (no match API).
 */
export async function matchGPXToRoads(
  points: Array<{ lat: number; lon: number }>,
  config: RoutingConfig,
  options?: RouteOptions,
): Promise<MatchedRoute | null> {
  if (points.length < 2) return null;
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = () =>
    `${((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0).toFixed(0)}ms`;
  console.log(
    `[MapMatch] Starting: ${points.length} points, provider=${config.provider}, hasApiKey=${!!config.googleApiKey}, baseUrl=${config.baseUrl}`,
  );

  const useGoogle =
    config.provider === "google" &&
    (config.googleApiKey || shouldUseMapsServerProxy());
  if (useGoogle) {
    const result = await googleMatchGPXToRoads(
      points,
      config.googleApiKey || "",
      options,
    );
    console.log(`[MapMatch] Google done in ${elapsed()}`);
    return result;
  }
  console.log(
    `[MapMatch] Falling through to OSRM (provider=${config.provider}, apiKey=${config.googleApiKey ? "present" : "missing"})`,
  );

  const isPublic = isPublicDemoServer(config.baseUrl);
  const usePoints = isPublic
    ? downsamplePoints(points, MAX_POINTS_PUBLIC_DEMO)
    : points;
  // Public demo: small batches + 1s delay to respect rate limits.
  // Private server: large batches (OSRM handles 500+ points) and no delay.
  const batchSize = isPublic ? BATCH_SIZE : 500;
  const batchDelay = isPublic ? BATCH_DELAY_MS : 0;

  const allLegs: Array<{
    steps?: MatchedStep[];
    distance: number;
    duration: number;
    annotation?: { nodes: number[] };
  }> = [];
  const allSteps: MatchedStep[] = [];
  const allNodeIds: number[] = [];
  let totalDistance = 0;
  let totalDuration = 0;

  for (let i = 0; i < usePoints.length; i += batchSize - 1) {
    if (i > 0 && batchDelay > 0) {
      await new Promise((r) => setTimeout(r, batchDelay));
    }
    const batch = usePoints.slice(i, i + batchSize);
    const coords = batch.map((p) => `${p.lon},${p.lat}`).join(";");
    const radiuses = batch.map(() => "25").join(";");

    const url = `${config.baseUrl}/match/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&annotations=nodes&radiuses=${radiuses}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        console.warn(`OSRM match HTTP ${response.status} for batch at ${i}`);
        continue;
      }
      if (data.code !== "Ok" || !data.matchings?.length) {
        console.warn(`OSRM match failed for batch starting at ${i}`);
        continue;
      }

      for (const matching of data.matchings) {
        totalDistance += matching.distance ?? 0;
        totalDuration += matching.duration ?? 0;

        for (const leg of matching.legs ?? []) {
          allLegs.push(leg);
          if (leg.steps) {
            allSteps.push(...leg.steps);
          }
          if (leg.annotation?.nodes) {
            allNodeIds.push(...leg.annotation.nodes);
          }
        }
      }
    } catch (err) {
      console.warn("OSRM match request failed:", err);
      return null;
    }
  }

  if (allSteps.length === 0) {
    console.log(`[MapMatch] OSRM: no steps matched`);
    return null;
  }

  const matchedGeometry = allSteps.flatMap((s) =>
    (s.geometry?.coordinates ?? []).map((c: [number, number]) => ({
      lat: c[1],
      lon: c[0],
    })),
  );

  console.log(
    `[MapMatch] OSRM done in ${((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0).toFixed(0)}ms: ${matchedGeometry.length} geometry pts, ${totalDistance.toFixed(0)}m`,
  );
  return {
    steps: allSteps,
    legs: allLegs,
    totalDistance,
    totalDuration,
    matchedGeometry,
    nodeIds: allNodeIds.length > 0 ? allNodeIds : undefined,
  };
}

/**
 * Build a MatchedRoute from raw points using offline turn detection.
 * NavigationEngine can use this when OSRM is not available.
 */
export function buildOfflineMatchedRoute(
  points: Array<{ lat: number; lon: number }>,
): MatchedRoute {
  const instructions = detectTurnsFromGPX(points, 25);
  const steps: MatchedStep[] = [];
  const matchedGeometry = points.map((p) => ({ lat: p.lat, lon: p.lon }));

  let totalDistance = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalDistance += haversineDistance(points[i], points[i + 1]);
  }
  const totalDuration = totalDistance / 10; // assume ~10 m/s for ETA

  if (instructions.length === 0) {
    steps.push({
      geometry: {
        type: "LineString",
        coordinates: points.map((p) => [p.lon, p.lat]),
      },
      maneuver: { type: "depart", modifier: "straight" },
      distance: totalDistance,
      duration: totalDuration,
    });
    steps.push({
      geometry: {
        type: "LineString",
        coordinates: [
          [points[points.length - 1].lon, points[points.length - 1].lat],
        ],
      },
      maneuver: { type: "arrive", modifier: "straight" },
      distance: 0,
      duration: 0,
    });
    return {
      steps,
      legs: [{ steps, distance: totalDistance, duration: totalDuration }],
      totalDistance,
      totalDuration,
      matchedGeometry,
    };
  }

  let prevIdx = 0;
  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i];
    const segment = points.slice(prevIdx, instr.index + 1);
    const segDist =
      segment.length >= 2
        ? haversineDistance(segment[0], segment[segment.length - 1])
        : 0;
    const maneuverType = i === 0 ? "depart" : turnTypeToManeuver(instr.type);
    steps.push({
      geometry: {
        type: "LineString",
        coordinates: segment.map((p) => [p.lon, p.lat]),
      },
      maneuver: {
        type: maneuverType,
        modifier: turnModifier(instr.type),
      },
      name: undefined,
      distance: segDist,
      duration: segDist / 10,
    });
    prevIdx = instr.index;
  }

  const lastSegment = points.slice(prevIdx);
  if (lastSegment.length >= 2) {
    const segDist = haversineDistance(
      lastSegment[0],
      lastSegment[lastSegment.length - 1],
    );
    steps.push({
      geometry: {
        type: "LineString",
        coordinates: lastSegment.map((p) => [p.lon, p.lat]),
      },
      maneuver: { type: "arrive", modifier: "straight" },
      distance: segDist,
      duration: segDist / 10,
    });
  }

  return {
    steps,
    legs: [{ steps, distance: totalDistance, duration: totalDuration }],
    totalDistance,
    totalDuration,
    matchedGeometry,
  };
}

function turnTypeToManeuver(type: string): string {
  if (type === "turn" || type.includes("u_turn")) return "turn";
  return "turn";
}

function turnModifier(type: string): string {
  if (type === "u_turn") return "uturn";
  if (type === "slight_left") return "slight left";
  if (type === "slight_right") return "slight right";
  if (type === "sharp_left") return "sharp left";
  if (type === "sharp_right") return "sharp right";
  if (type === "turn_left") return "left";
  if (type === "turn_right") return "right";
  if (type === "continue") return "straight";
  return "straight";
}
