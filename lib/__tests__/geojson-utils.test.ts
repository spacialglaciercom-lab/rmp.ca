import { describe, it, expect } from "vitest";
import {
  routePointsToGeoJSON,
  multiVehicleRoutesToGeoJSON,
  matchedRouteToGeoJSON,
} from "../geojson-utils";
import type { MatchedRoute } from "../mapMatching";

describe("routePointsToGeoJSON", () => {
  it("returns empty FeatureCollection for fewer than 2 points", () => {
    expect(routePointsToGeoJSON([])).toEqual({
      type: "FeatureCollection",
      features: [],
    });
    expect(routePointsToGeoJSON([{ lat: 45.5, lon: -73.5 }]).features).toHaveLength(0);
  });

  it("produces one LineString plus start and end Point features", () => {
    const points = [
      { lat: 45.5, lon: -73.5 },
      { lat: 45.51, lon: -73.51 },
      { lat: 45.52, lon: -73.52 },
    ];
    const result = routePointsToGeoJSON(points);
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(3);

    const line = result.features.find((f) => f.geometry.type === "LineString");
    expect(line).toBeDefined();
    expect(line!.geometry.type).toBe("LineString");
    expect((line!.geometry as { coordinates: [number, number][] }).coordinates).toEqual([
      [-73.5, 45.5],
      [-73.51, 45.51],
      [-73.52, 45.52],
    ]);
    expect(line!.properties.role).toBe("route");

    const start = result.features.find(
      (f) => f.geometry.type === "Point" && f.properties.role === "start",
    );
    expect(start).toBeDefined();
    expect((start!.geometry as { coordinates: [number, number] }).coordinates).toEqual([
      -73.5,
      45.5,
    ]);
    expect(start!.properties.label).toBe("Start");

    const end = result.features.find(
      (f) => f.geometry.type === "Point" && f.properties.role === "end",
    );
    expect(end).toBeDefined();
    expect((end!.geometry as { coordinates: [number, number] }).coordinates).toEqual([
      -73.52,
      45.52,
    ]);
    expect(end!.properties.label).toBe("End");
  });
});

describe("multiVehicleRoutesToGeoJSON", () => {
  it("returns empty FeatureCollection when no vehicle has 2+ points", () => {
    expect(multiVehicleRoutesToGeoJSON([])).toEqual({
      type: "FeatureCollection",
      features: [],
    });
    expect(
      multiVehicleRoutesToGeoJSON([[{ lat: 45.5, lon: -73.5 }]]).features,
    ).toHaveLength(0);
  });

  it("produces LineString and start/end Points per vehicle with correct colors and labels", () => {
    const vehicleRoutes = [
      [
        { lat: 45.5, lon: -73.5 },
        { lat: 45.51, lon: -73.51 },
      ],
      [
        { lat: 46, lon: -74 },
        { lat: 46.01, lon: -74.01 },
      ],
    ];
    const result = multiVehicleRoutesToGeoJSON(vehicleRoutes);
    expect(result.type).toBe("FeatureCollection");
    expect(result.features.length).toBeGreaterThanOrEqual(6); // 2 vehicles × (1 line + start + end)

    const v0Line = result.features.find(
      (f) =>
        f.geometry.type === "LineString" &&
        f.properties.role === "vehicle-route" &&
        f.properties.vehicleIndex === 0,
    );
    expect(v0Line).toBeDefined();
    expect(v0Line!.properties.pointCount).toBe(2);
    expect(v0Line!.properties.color).toBe("#F97316");

    const v1Line = result.features.find(
      (f) =>
        f.geometry.type === "LineString" &&
        f.properties.role === "vehicle-route" &&
        f.properties.vehicleIndex === 1,
    );
    expect(v1Line).toBeDefined();
    expect(v1Line!.properties.color).toBe("#3b82f6");

    const v0Start = result.features.find(
      (f) =>
        f.properties.role === "vehicle-start" && f.properties.vehicleIndex === 0,
    );
    expect(v0Start!.properties.label).toBe("V1 Start");

    const v1End = result.features.find(
      (f) => f.properties.role === "vehicle-end" && f.properties.vehicleIndex === 1,
    );
    expect(v1End!.properties.label).toBe("V2 End");
  });
});

describe("matchedRouteToGeoJSON", () => {
  it("produces full-route LineString and step LineStrings plus start/end Points", () => {
    const route: MatchedRoute = {
      steps: [
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [-73.5, 45.5],
              [-73.51, 45.51],
            ],
          },
          maneuver: { type: "depart" },
          distance: 1000,
          duration: 120,
        },
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [-73.51, 45.51],
              [-73.52, 45.52],
            ],
          },
          maneuver: { type: "arrive" },
          distance: 800,
          duration: 90,
        },
      ],
      legs: [
        { steps: [], distance: 1800, duration: 210 },
      ],
      totalDistance: 1800,
      totalDuration: 210,
      matchedGeometry: [
        { lat: 45.5, lon: -73.5 },
        { lat: 45.51, lon: -73.51 },
        { lat: 45.52, lon: -73.52 },
      ],
    };

    const result = matchedRouteToGeoJSON(route);
    expect(result.type).toBe("FeatureCollection");
    expect(result.features.length).toBeGreaterThanOrEqual(4); // full-route + 2 steps + start + end

    const fullRoute = result.features.find(
      (f) => f.properties.role === "optimized-route",
    );
    expect(fullRoute).toBeDefined();
    expect(fullRoute!.geometry.type).toBe("LineString");
    expect(fullRoute!.properties.totalDistance).toBe(1800);
    expect(fullRoute!.properties.stepCount).toBe(2);

    const stepFeatures = result.features.filter(
      (f) => f.properties.role === "step",
    );
    expect(stepFeatures).toHaveLength(2);
    expect(stepFeatures[0]!.properties.stepIndex).toBe(0);
    expect(stepFeatures[0]!.properties.maneuverType).toBe("depart");
    expect(stepFeatures[1]!.properties.maneuverType).toBe("arrive");

    const start = result.features.find(
      (f) => f.properties.role === "start",
    );
    expect(start).toBeDefined();
    expect((start!.geometry as { coordinates: [number, number] }).coordinates).toEqual([
      -73.5,
      45.5,
    ]);

    const end = result.features.find(
      (f) => f.properties.role === "end",
    );
    expect(end).toBeDefined();
    expect((end!.geometry as { coordinates: [number, number] }).coordinates).toEqual([
      -73.52,
      45.52,
    ]);
  });

  it("skips steps with no or single-point geometry", () => {
    const route: MatchedRoute = {
      steps: [
        {
          geometry: {
            type: "LineString",
            coordinates: [[-73.5, 45.5], [-73.51, 45.51]],
          },
          maneuver: { type: "depart" },
          distance: 1000,
          duration: 120,
        },
        {
          geometry: { type: "LineString", coordinates: [] },
          maneuver: { type: "turn" },
          distance: 0,
          duration: 0,
        },
      ],
      legs: [{ steps: [], distance: 1000, duration: 120 }],
      totalDistance: 1000,
      totalDuration: 120,
      matchedGeometry: [
        { lat: 45.5, lon: -73.5 },
        { lat: 45.51, lon: -73.51 },
      ],
    };

    const result = matchedRouteToGeoJSON(route);
    const stepFeatures = result.features.filter(
      (f) => f.properties.role === "step",
    );
    expect(stepFeatures).toHaveLength(1);
  });
});
