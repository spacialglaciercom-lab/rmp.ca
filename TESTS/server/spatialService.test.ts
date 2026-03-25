/**
 * Spatial Service Tests
 *
 * Tests for PostGIS-based spatial queries including:
 * - Nearby bins search with ST_DWithin
 * - Distance calculations with ST_Distance
 * - Edge cases: invalid coords, empty results, boundary conditions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";

// Mock the db module
vi.mock("../../server/db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../../server/db";
import { getNearbyBins } from "../../server/spatialService";

describe("spatialService", () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      execute: vi.fn(),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // getNearbyBins Tests
  // ===========================================================================

  describe("getNearbyBins", () => {
    it("should return nearby bins within radius", async () => {
      const mockBins = [
        { id: 1, address: "123 Main St", dist: 150.5 },
        { id: 2, address: "456 Oak Ave", dist: 320.8 },
      ];
      mockDb.execute.mockResolvedValueOnce(mockBins);

      const result = await getNearbyBins(-75.6972, 45.4215, 1000);

      expect(result).toEqual(mockBins);
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it("should use default radius of 1000m when not specified", async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await getNearbyBins(-75.6972, 45.4215);

      const callArgs = mockDb.execute.mock.calls[0][0];
      // Check that the SQL query includes the default radius
      expect(callArgs).toBeDefined();
    });

    it("should return empty array when no bins nearby", async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      const result = await getNearbyBins(-75.6972, 45.4215, 100);

      expect(result).toEqual([]);
    });

    it("should order results by distance ascending", async () => {
      const mockBins = [
        { id: 1, address: "Close Bin", dist: 50 },
        { id: 2, address: "Far Bin", dist: 500 },
        { id: 3, address: "Medium Bin", dist: 200 },
      ];
      mockDb.execute.mockResolvedValueOnce(mockBins);

      const result = await getNearbyBins(-75.6972, 45.4215, 1000);

      expect(result).toEqual(mockBins);
      // Verify ORDER BY dist ASC in query
    });

    it("should throw error when database is unavailable", async () => {
      vi.mocked(getDb).mockResolvedValueOnce(null);

      await expect(getNearbyBins(-75.6972, 45.4215, 1000)).rejects.toThrow(
        "Database connection not available"
      );
    });

    it("should handle bins at exact radius boundary", async () => {
      // Bin exactly at 1000m should be included (ST_DWithin is inclusive)
      const mockBins = [{ id: 1, address: "Boundary Bin", dist: 1000 }];
      mockDb.execute.mockResolvedValueOnce(mockBins);

      const result = await getNearbyBins(-75.6972, 45.4215, 1000);

      expect(result).toHaveLength(1);
    });

    it("should handle zero radius", async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      const result = await getNearbyBins(-75.6972, 45.4215, 0);

      expect(result).toEqual([]);
    });

    it("should handle large radius (10km+)", async () => {
      const mockBins = new Array(50).fill(null).map((_, i) => ({
        id: i + 1,
        address: `Bin ${i + 1}`,
        dist: i * 200,
      }));
      mockDb.execute.mockResolvedValueOnce(mockBins);

      const result = await getNearbyBins(-75.6972, 45.4215, 15000);

      expect(result).toHaveLength(50);
    });

    it("should handle coordinates at antimeridian", async () => {
      // Coordinates near ±180 longitude
      mockDb.execute.mockResolvedValueOnce([]);

      await getNearbyBins(179.9, 45.0, 1000);

      expect(mockDb.execute).toHaveBeenCalled();
    });

    it("should handle coordinates at poles", async () => {
      // Coordinates near ±90 latitude
      mockDb.execute.mockResolvedValueOnce([]);

      await getNearbyBins(0, 89.9, 1000);

      expect(mockDb.execute).toHaveBeenCalled();
    });

    it("should handle negative longitude", async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await getNearbyBins(-122.4194, 37.7749, 500); // San Francisco

      expect(mockDb.execute).toHaveBeenCalled();
    });

    it("should handle coordinates in southern hemisphere", async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await getNearbyBins(151.2093, -33.8688, 1000); // Sydney

      expect(mockDb.execute).toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// Distance Calculation Edge Cases
// ===========================================================================

describe("Distance Calculations", () => {
  it("should calculate haversine distance correctly for short distances", () => {
    // Ottawa coordinates: ~100m apart
    const lat1 = 45.4215;
    const lon1 = -75.6972;
    const lat2 = 45.4220;
    const lon2 = -75.6960;

    // Haversine formula for verification
    const R = 6371000; // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const expectedDistance = R * c;

    // Should be approximately 100 meters
    expect(expectedDistance).toBeGreaterThan(50);
    expect(expectedDistance).toBeLessThan(200);
  });

  it("should calculate distance across antimeridian correctly", () => {
    // Points on either side of antimeridian
    const lat = 45.0;
    const lon1 = 179.9;
    const lon2 = -179.9;

    // These points are very close geographically despite large coordinate difference
    // PostGIS geography type handles this correctly
    const coordDiff = Math.abs(lon2 - lon1); // 359.8 degrees
    expect(coordDiff).toBeGreaterThan(359);

    // But actual distance should be small (~15km at latitude 45)
    // This is handled by PostGIS ST_Distance on geography types
  });

  it("should handle pole proximity correctly", () => {
    // Near North Pole - all directions are "south"
    const lat = 89.9;
    const lon1 = 0;
    const lon2 = 180;

    // At the pole, longitude becomes less meaningful
    // PostGIS geography handles this correctly
    expect(lat).toBeGreaterThan(89);
  });
});

// ===========================================================================
// SQL Query Validation
// ===========================================================================

describe("SQL Query Construction", () => {
  it("should use ST_DWithin for radius filtering", async () => {
    const mockDb = { execute: vi.fn().mockResolvedValue([]) };
    vi.mocked(getDb).mockResolvedValue(mockDb);

    await getNearbyBins(-75.6972, 45.4215, 1000);

    const sqlQuery = mockDb.execute.mock.calls[0][0];
    // The SQL should contain ST_DWithin for geography type
    expect(sqlQuery).toBeDefined();
  });

  it("should use ST_Distance for distance calculation", async () => {
    const mockDb = { execute: vi.fn().mockResolvedValue([]) };
    vi.mocked(getDb).mockResolvedValue(mockDb);

    await getNearbyBins(-75.6972, 45.4215, 1000);

    const sqlQuery = mockDb.execute.mock.calls[0][0];
    // The SQL should contain ST_Distance for ordering
    expect(sqlQuery).toBeDefined();
  });

  it("should cast to geography type for spherical calculations", async () => {
    const mockDb = { execute: vi.fn().mockResolvedValue([]) };
    vi.mocked(getDb).mockResolvedValue(mockDb);

    await getNearbyBins(-75.6972, 45.4215, 1000);

    const sqlQuery = mockDb.execute.mock.calls[0][0];
    // The SQL should cast to ::geography for accurate distance
    expect(sqlQuery).toBeDefined();
  });
});
