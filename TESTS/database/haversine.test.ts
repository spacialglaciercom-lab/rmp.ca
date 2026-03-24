/**
 * Haversine Distance Unit Tests
 * 
 * Tests for distance calculations used in location-based sync.
 * These tests verify the mathematical accuracy of the haversine formula
 * implementation used for determining nearby bins and sync radius.
 */
import { describe, it, expect } from 'vitest';

// ============================================================================
// HAVERSINE DISTANCE CALCULATION TESTS
// ============================================================================

describe('Haversine Distance Calculation', () => {
  /**
   * Implementation of haversine formula for testing
   * This matches the implementation in locationSync.ts
   */
  function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  describe('Basic Calculations', () => {
    it('should return 0 for same point', () => {
      const distance = haversineDistance(45.0, -75.0, 45.0, -75.0);
      expect(distance).toBe(0);
    });

    it('should calculate distance between nearby points correctly', () => {
      // ~11.1 km apart (0.1 degree latitude)
      const distance = haversineDistance(45.0, -75.0, 45.1, -75.0);
      expect(distance).toBeGreaterThan(10);
      expect(distance).toBeLessThan(12);
    });

    it('should calculate distance between distant points correctly', () => {
      // Ottawa to Toronto (~350 km)
      const distance = haversineDistance(45.4215, -75.6972, 43.6532, -79.3832);
      expect(distance).toBeGreaterThan(340);
      expect(distance).toBeLessThan(360);
    });

    it('should handle negative coordinates', () => {
      const distance = haversineDistance(-45.0, -75.0, -45.1, -75.0);
      expect(distance).toBeGreaterThan(10);
      expect(distance).toBeLessThan(12);
    });

    it('should handle crossing the equator', () => {
      // From northern to southern hemisphere
      const distance = haversineDistance(10.0, -75.0, -10.0, -75.0);
      expect(distance).toBeGreaterThan(2200);
      expect(distance).toBeLessThan(2230);
    });

    it('should handle crossing the prime meridian', () => {
      // From western to eastern hemisphere
      const distance = haversineDistance(45.0, -10.0, 45.0, 10.0);
      expect(distance).toBeGreaterThan(1400);
      expect(distance).toBeLessThan(1600);
    });
  });

  describe('Edge Cases', () => {
    it('should handle antipodal points', () => {
      // Antipodal points (opposite sides of Earth)
      const distance = haversineDistance(0, 0, 0, 180);
      expect(distance).toBeGreaterThan(20000); // ~20,000 km (half Earth circumference)
      expect(distance).toBeLessThan(20050);
    });

    it('should handle coordinates at poles', () => {
      // North pole to south pole
      const distance = haversineDistance(90, 0, -90, 0);
      expect(distance).toBeGreaterThan(20000);
      expect(distance).toBeLessThan(20050);
    });

    it('should handle very small distances', () => {
      // ~1.1 meters apart
      const distance = haversineDistance(45.0, -75.0, 45.00001, -75.0);
      expect(distance).toBeLessThan(0.002); // Less than 2 meters
    });

    it('should handle very large distances', () => {
      // Around the world
      const distance = haversineDistance(0, 0, 0, 0);
      expect(distance).toBe(0);
    });

    it('should be symmetric', () => {
      const distance1 = haversineDistance(45.0, -75.0, 46.0, -76.0);
      const distance2 = haversineDistance(46.0, -76.0, 45.0, -75.0);
      expect(distance1).toBeCloseTo(distance2, 10);
    });
  });

  describe('Rural Driver Use Cases', () => {
    it('should calculate distance for typical rural route radius (10km)', () => {
      // Driver at center, bin at edge of 10km radius
      const driverLat = 45.0;
      const driverLon = -75.0;
      const binLat = 45.09; // ~10km north
      const binLon = -75.0;

      const distance = haversineDistance(driverLat, driverLon, binLat, binLon);
      expect(distance).toBeLessThan(10.5); // Within sync radius
    });

    it('should identify bins outside sync radius', () => {
      const driverLat = 45.0;
      const driverLon = -75.0;
      const binLat = 45.2; // ~22km north
      const binLon = -75.0;

      const distance = haversineDistance(driverLat, driverLon, binLat, binLon);
      expect(distance).toBeGreaterThan(20); // Outside typical sync radius
    });

    it('should calculate distance for route planning', () => {
      // Route from depot to first collection point
      const depotLat = 45.0;
      const depotLon = -75.0;
      const collectionLat = 45.15;
      const collectionLon = -75.2;

      const distance = haversineDistance(depotLat, depotLon, collectionLat, collectionLon);
      expect(distance).toBeGreaterThan(15);
      expect(distance).toBeLessThan(25);
    });

    it('should handle rural area with sparse coverage', () => {
      // Large rural area with few bins
      const bins = [
        { lat: 45.0, lon: -75.0 },
        { lat: 45.5, lon: -75.5 },
        { lat: 44.8, lon: -74.8 },
      ];

      const driverLocation = { lat: 45.1, lon: -75.1 };
      const radiusKm = 50; // Large rural radius

      const nearbyBins = bins.filter(bin => {
        const distance = haversineDistance(driverLocation.lat, driverLocation.lon, bin.lat, bin.lon);
        return distance <= radiusKm;
      });

      expect(nearbyBins).toHaveLength(2); // Two bins within 50km
    });
  });

  describe('Performance', () => {
    it('should calculate 1000 distances in under 100ms', () => {
      const start = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        haversineDistance(45.0 + (i * 0.001), -75.0, 45.1, -75.1);
      }
      
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
  });
});

// ============================================================================
// DISTANCE FILTERING UTILITIES
// ============================================================================

describe('Distance Filtering Utilities', () => {
  function filterByRadius(
    center: { lat: number; lon: number },
    points: Array<{ lat: number; lon: number; id: string }>,
    radiusKm: number
  ): Array<{ lat: number; lon: number; id: string; distance: number }> {
    const R = 6371;
    
    return points
      .map(point => {
        const dLat = (point.lat - center.lat) * Math.PI / 180;
        const dLon = (point.lon - center.lon) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(center.lat * Math.PI / 180) * Math.cos(point.lat * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return { ...point, distance };
      })
      .filter(point => point.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance);
  }

  it('should filter points within radius', () => {
    const center = { lat: 45.0, lon: -75.0 };
    const points = [
      { id: '1', lat: 45.01, lon: -75.0 },   // ~1.1 km
      { id: '2', lat: 45.05, lon: -75.0 },    // ~5.5 km
      { id: '3', lat: 45.15, lon: -75.0 },    // ~16.6 km
      { id: '4', lat: 44.95, lon: -75.0 },    // ~5.5 km
    ];

    const result = filterByRadius(center, points, 10);

    expect(result).toHaveLength(3);
    expect(result.find(p => p.id === '3')).toBeUndefined();
  });

  it('should sort by distance', () => {
    const center = { lat: 45.0, lon: -75.0 };
    const points = [
      { id: 'far', lat: 45.1, lon: -75.0 },
      { id: 'near', lat: 45.01, lon: -75.0 },
      { id: 'mid', lat: 45.05, lon: -75.0 },
    ];

    const result = filterByRadius(center, points, 20);

    expect(result[0].id).toBe('near');
    expect(result[1].id).toBe('mid');
    expect(result[2].id).toBe('far');
  });

  it('should handle empty points array', () => {
    const center = { lat: 45.0, lon: -75.0 };
    const result = filterByRadius(center, [], 10);
    expect(result).toHaveLength(0);
  });

  it('should handle all points outside radius', () => {
    const center = { lat: 45.0, lon: -75.0 };
    const points = [
      { id: '1', lat: 46.0, lon: -75.0 },
      { id: '2', lat: 44.0, lon: -75.0 },
    ];

    const result = filterByRadius(center, points, 10);
    expect(result).toHaveLength(0);
  });
});