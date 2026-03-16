/**
 * GeoJSON utilities for converting route data to GeoJSON FeatureCollections.
 * Used by react-native-maps (Geojson component) on native and Leaflet on web
 * to render optimized route polylines as GeoJSON overlays.
 */

import type { MatchedRoute, MatchedStep } from "./mapMatching";

export interface GeoJSONPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface GeoJSONLineString {
  type: "LineString";
  coordinates: [number, number][];
}

export interface GeoJSONMultiLineString {
  type: "MultiLineString";
  coordinates: [number, number][][];
}

export interface GeoJSONFeature<
  G = GeoJSONLineString | GeoJSONPoint | GeoJSONMultiLineString,
> {
  type: "Feature";
  geometry: G;
  properties: Record<string, unknown>;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

/**
 * Convert a MatchedRoute into a GeoJSON FeatureCollection.
 *
 * Produces one LineString feature per step (with distance, duration, maneuver
 * metadata) plus a "full-route" MultiLineString that covers the entire
 * optimized path. Start/end markers are included as Point features.
 */
export function matchedRouteToGeoJSON(
  route: MatchedRoute,
): GeoJSONFeatureCollection {
  const features: GeoJSONFeature[] = [];

  const fullCoords: [number, number][] = route.matchedGeometry.map((p) => [
    p.lon,
    p.lat,
  ]);

  if (fullCoords.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: fullCoords },
      properties: {
        role: "optimized-route",
        totalDistance: route.totalDistance,
        totalDuration: route.totalDuration,
        stepCount: route.steps.length,
      },
    });
  }

  route.steps.forEach((step, idx) => {
    const coords = step.geometry?.coordinates;
    if (!coords || coords.length < 2) return;

    const lineCoords: [number, number][] = coords.map((c) => [c[0], c[1]]);

    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: lineCoords },
      properties: {
        role: "step",
        stepIndex: idx,
        maneuverType: step.maneuver?.type ?? "unknown",
        maneuverModifier: step.maneuver?.modifier,
        name: step.name,
        distance: step.distance,
        duration: step.duration,
      },
    });

    // Step-start marker: clickable orange circle for node inspection / avoid.
    // Use the maneuver location when available; fall back to first geometry coord.
    const maneuverLoc = step.maneuver?.location ?? (coords[0] as [number, number] | undefined);
    if (maneuverLoc) {
      const [lon, lat] = maneuverLoc;

      // Correlate to OSM node ID by finding the closest matchedGeometry point.
      let nodeId: number | undefined;
      if (route.nodeIds && route.matchedGeometry.length > 0) {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < route.matchedGeometry.length; i++) {
          const d =
            Math.abs(route.matchedGeometry[i].lat - lat) +
            Math.abs(route.matchedGeometry[i].lon - lon);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        nodeId = route.nodeIds[bestIdx];
      }

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          role: "step-start",
          stepIndex: idx,
          name: step.name ?? "",
          ref: step.ref ?? "",
          lat,
          lon,
          nodeId: nodeId ?? null,
          maneuverType: step.maneuver?.type ?? "unknown",
        },
      });
    }
  });

  if (route.matchedGeometry.length >= 1) {
    const start = route.matchedGeometry[0];
    const end = route.matchedGeometry[route.matchedGeometry.length - 1];

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [start.lon, start.lat] },
      properties: { role: "start", label: "Start" },
    });

    if (route.matchedGeometry.length > 1) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [end.lon, end.lat] },
        properties: { role: "end", label: "End" },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

/**
 * Convert raw route points (lat/lon array) into a simple GeoJSON
 * FeatureCollection with a single LineString and start/end Point features.
 */
export function routePointsToGeoJSON(
  points: Array<{ lat: number; lon: number }>,
): GeoJSONFeatureCollection {
  const features: GeoJSONFeature[] = [];

  if (points.length >= 2) {
    const coords: [number, number][] = points.map((p) => [p.lon, p.lat]);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { role: "route" },
    });

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [points[0].lon, points[0].lat] },
      properties: { role: "start", label: "Start" },
    });

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [
          points[points.length - 1].lon,
          points[points.length - 1].lat,
        ],
      },
      properties: { role: "end", label: "End" },
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * Convert multi-vehicle route arrays into a GeoJSON FeatureCollection.
 * Each vehicle gets its own LineString feature with a vehicleIndex property.
 */
export function multiVehicleRoutesToGeoJSON(
  vehicleRoutes: Array<Array<{ lat: number; lon: number }>>,
): GeoJSONFeatureCollection {
  const COLORS = ["#F97316", "#3b82f6", "#22c55e", "#eab308", "#a855f7"];
  const features: GeoJSONFeature[] = [];

  vehicleRoutes.forEach((route, vIdx) => {
    if (route.length < 2) return;
    const coords: [number, number][] = route.map((p) => [p.lon, p.lat]);

    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {
        role: "vehicle-route",
        vehicleIndex: vIdx,
        color: COLORS[vIdx % COLORS.length],
        pointCount: route.length,
      },
    });

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [route[0].lon, route[0].lat] },
      properties: {
        role: "vehicle-start",
        vehicleIndex: vIdx,
        label: `V${vIdx + 1} Start`,
      },
    });

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [route[route.length - 1].lon, route[route.length - 1].lat],
      },
      properties: {
        role: "vehicle-end",
        vehicleIndex: vIdx,
        label: `V${vIdx + 1} End`,
      },
    });
  });

  return { type: "FeatureCollection", features };
}
