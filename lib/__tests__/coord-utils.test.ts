import { describe, it, expect } from "vitest";
import {
  sanitizeLatLonArray,
  sanitizeByVehicle,
  type LatLonPoint,
} from "../coord-utils";

describe("sanitizeLatLonArray", () => {
  it("returns empty array for null or undefined", () => {
    expect(sanitizeLatLonArray(null)).toEqual([]);
    expect(sanitizeLatLonArray(undefined)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(sanitizeLatLonArray([])).toEqual([]);
  });

  it("keeps valid points", () => {
    const input: LatLonPoint[] = [
      { lat: 45.5, lon: -73.5 },
      { lat: 0, lon: 0 },
    ];
    expect(sanitizeLatLonArray(input)).toEqual(input);
  });

  it("filters out points with NaN", () => {
    const input: LatLonPoint[] = [
      { lat: 45.5, lon: -73.5 },
      { lat: NaN, lon: -73.5 },
      { lat: 45.5, lon: NaN },
      { lat: 46, lon: -73 },
    ];
    expect(sanitizeLatLonArray(input)).toEqual([
      { lat: 45.5, lon: -73.5 },
      { lat: 46, lon: -73 },
    ]);
  });

  it("filters out points with missing or non-number lat/lon", () => {
    const input = [
      { lat: 45.5, lon: -73.5 },
      { lat: "45" as unknown as number, lon: -73.5 },
      { lat: 45.5, lon: undefined as unknown as number },
      { lat: 46, lon: -73 },
    ] as LatLonPoint[];
    expect(sanitizeLatLonArray(input)).toEqual([
      { lat: 45.5, lon: -73.5 },
      { lat: 46, lon: -73 },
    ]);
  });

  it("filters out null/undefined entries in array", () => {
    const input = [
      { lat: 45.5, lon: -73.5 },
      null,
      undefined,
      { lat: 46, lon: -73 },
    ] as unknown as LatLonPoint[];
    expect(sanitizeLatLonArray(input)).toEqual([
      { lat: 45.5, lon: -73.5 },
      { lat: 46, lon: -73 },
    ]);
  });
});

describe("sanitizeByVehicle", () => {
  it("returns empty array for null or undefined", () => {
    expect(sanitizeByVehicle(null)).toEqual([]);
    expect(sanitizeByVehicle(undefined)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(sanitizeByVehicle([])).toEqual([]);
  });

  it("sanitizes each vehicle array and drops vehicles with no valid points", () => {
    const input: LatLonPoint[][] = [
      [{ lat: 45.5, lon: -73.5 }, { lat: 46, lon: -73 }],
      [{ lat: NaN, lon: NaN }],
      [{ lat: 45.6, lon: -73.6 }],
    ];
    expect(sanitizeByVehicle(input)).toEqual([
      [{ lat: 45.5, lon: -73.5 }, { lat: 46, lon: -73 }],
      [{ lat: 45.6, lon: -73.6 }],
    ]);
  });

  it("drops vehicles that become empty after sanitizing", () => {
    const input: LatLonPoint[][] = [
      [{ lat: 45.5, lon: -73.5 }],
      [{ lat: NaN, lon: NaN }, { lat: undefined as unknown as number, lon: 0 }],
      [{ lat: 45.6, lon: -73.6 }],
    ];
    expect(sanitizeByVehicle(input)).toEqual([
      [{ lat: 45.5, lon: -73.5 }],
      [{ lat: 45.6, lon: -73.6 }],
    ]);
  });
});
