/**
 * TSP Solver Tests
 *
 * Tests for the nearest-neighbor TSP heuristic used as fallback
 * when pgRouting/VROOM are unavailable.
 *
 * Covers:
 *   - Empty and single-point inputs
 *   - Haversine distance accuracy
 *   - Nearest-neighbor ordering correctness
 *   - Depot handling (start/end)
 *   - Return-to-depot option
 *   - Duration estimation
 */

import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Haversine distance implementation (mirrors production code)
// ---------------------------------------------------------------------------

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// ---------------------------------------------------------------------------
// TSP Solver implementation (mirrors production code for testing)
// ---------------------------------------------------------------------------

interface TSPPoint {
  id: string;
  lat: number;
  lon: number;
  name?: string;
  demand?: number;
  serviceTime?: number;
}

interface TSPResult {
  orderedPoints: TSPPoint[];
  totalDistance: number;
  estimatedDuration: number;
  algorithm: 'nearest-neighbor' | 'none';
}

function solveTSPNearestNeighbor(
  points: TSPPoint[],
  depot?: { id: string; lat: number; lon: number; name?: string },
  returnToDepot: boolean = true
): TSPResult {
  // Empty case
  if (points.length === 0) {
    return {
      orderedPoints: [],
      totalDistance: 0,
      estimatedDuration: 0,
      algorithm: 'none',
    };
  }

  // Build ordered list using nearest-neighbor
  const allPoints = depot ? [depot as TSPPoint, ...points] : [...points];
  const remaining = new Set(allPoints.map((p) => p.id));
  const ordered: TSPPoint[] = [];
  let totalDistance = 0;

  // Start from depot or first point
  let current = allPoints[0];
  ordered.push(current);
  remaining.delete(current.id);

  // Visit each point by nearest distance
  while (remaining.size > 0) {
    let nearest: TSPPoint | undefined;
    let nearestDist = Infinity;

    for (const p of allPoints) {
      if (remaining.has(p.id)) {
        const dist = haversine(current.lat, current.lon, p.lat, p.lon);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = p;
        }
      }
    }

    if (nearest) {
      totalDistance += nearestDist;
      ordered.push(nearest);
      remaining.delete(nearest.id);
      current = nearest;
    }
  }

  // Return to depot if required
  if (returnToDepot && depot) {
    totalDistance += haversine(current.lat, current.lon, depot.lat, depot.lon);
    ordered.push(depot as TSPPoint);
  }

  // Estimate duration (assume 30 km/h average speed + 2 min per stop)
  const avgSpeedMps = (30 * 1000) / 3600; // 30 km/h in m/s
  const serviceTimePerStop = 120; // 2 minutes in seconds
  const travelTime = totalDistance / avgSpeedMps;
  const serviceTime = points.length * serviceTimePerStop;
  const estimatedDuration = travelTime + serviceTime;

  return {
    orderedPoints: ordered,
    totalDistance,
    estimatedDuration,
    algorithm: 'nearest-neighbor',
  };
}

// ---------------------------------------------------------------------------
// Test fixtures - Montreal area coordinates
// ---------------------------------------------------------------------------

const MONTREAL_DOWNTOWN = { id: 'depot', lat: 45.5017, lon: -73.5673, name: 'Depot Downtown' };

const COLLECTION_POINTS: TSPPoint[] = [
  { id: 'bin-1', lat: 45.5088, lon: -73.5878, name: 'Bin A - Plateau' },
  { id: 'bin-2', lat: 45.5230, lon: -73.5610, name: 'Bin B - Mile End' },
  { id: 'bin-3', lat: 45.4920, lon: -73.5540, name: 'Bin C - Old Port' },
  { id: 'bin-4', lat: 45.5300, lon: -73.6000, name: 'Bin D - Outremont' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TSP Solver - Haversine Distance', () => {
  it('should calculate distance between two nearby points accurately', () => {
    // Montreal downtown to Plateau (~1.8 km)
    const dist = haversine(45.5017, -73.5673, 45.5088, -73.5878);
    expect(dist).toBeGreaterThan(1500);
    expect(dist).toBeLessThan(2500);
  });

  it('should return 0 for identical points', () => {
    const dist = haversine(45.5017, -73.5673, 45.5017, -73.5673);
    expect(dist).toBe(0);
  });

  it('should calculate long-distance accurately (Montreal to Toronto)', () => {
    // Montreal: 45.5017, -73.5673
    // Toronto: 43.6532, -79.3832
    const dist = haversine(45.5017, -73.5673, 43.6532, -79.3832);
    // Actual distance is ~504 km
    expect(dist).toBeGreaterThan(490000);
    expect(dist).toBeLessThan(520000);
  });

  it('should be symmetric', () => {
    const dist1 = haversine(45.5017, -73.5673, 45.5088, -73.5878);
    const dist2 = haversine(45.5088, -73.5878, 45.5017, -73.5673);
    expect(dist1).toBe(dist2);
  });
});

describe('TSP Solver - Edge Cases', () => {
  it('should handle empty points array', () => {
    const result = solveTSPNearestNeighbor([]);
    expect(result.orderedPoints).toEqual([]);
    expect(result.totalDistance).toBe(0);
    expect(result.estimatedDuration).toBe(0);
    expect(result.algorithm).toBe('none');
  });

  it('should handle single point without depot', () => {
    const singlePoint: TSPPoint[] = [{ id: 'only', lat: 45.5, lon: -73.5 }];
    const result = solveTSPNearestNeighbor(singlePoint);
    expect(result.orderedPoints).toHaveLength(1);
    expect(result.orderedPoints[0].id).toBe('only');
    expect(result.totalDistance).toBe(0);
  });

  it('should handle single point with depot', () => {
    const singlePoint: TSPPoint[] = [{ id: 'only', lat: 45.52, lon: -73.58 }];
    const result = solveTSPNearestNeighbor(singlePoint, MONTREAL_DOWNTOWN, false);
    expect(result.orderedPoints).toHaveLength(2); // depot + point
    expect(result.orderedPoints[0].id).toBe('depot');
    expect(result.orderedPoints[1].id).toBe('only');
    expect(result.totalDistance).toBeGreaterThan(0);
  });

  it('should handle two points correctly', () => {
    const twoPoints: TSPPoint[] = [
      { id: 'a', lat: 45.51, lon: -73.57 },
      { id: 'b', lat: 45.52, lon: -73.58 },
    ];
    const result = solveTSPNearestNeighbor(twoPoints);
    expect(result.orderedPoints).toHaveLength(2);
    expect(result.totalDistance).toBeGreaterThan(0);
  });
});

describe('TSP Solver - Nearest Neighbor Ordering', () => {
  it('should visit all points exactly once', () => {
    const result = solveTSPNearestNeighbor(COLLECTION_POINTS);
    const visitedIds = new Set(result.orderedPoints.map(p => p.id));
    expect(visitedIds.size).toBe(COLLECTION_POINTS.length);
    for (const point of COLLECTION_POINTS) {
      expect(visitedIds.has(point.id)).toBe(true);
    }
  });

  it('should start from depot when provided', () => {
    const result = solveTSPNearestNeighbor(COLLECTION_POINTS, MONTREAL_DOWNTOWN, false);
    expect(result.orderedPoints[0].id).toBe('depot');
  });

  it('should return to depot when returnToDepot is true', () => {
    const result = solveTSPNearestNeighbor(COLLECTION_POINTS, MONTREAL_DOWNTOWN, true);
    expect(result.orderedPoints[0].id).toBe('depot');
    expect(result.orderedPoints[result.orderedPoints.length - 1].id).toBe('depot');
  });

  it('should not return to depot when returnToDepot is false', () => {
    const result = solveTSPNearestNeighbor(COLLECTION_POINTS, MONTREAL_DOWNTOWN, false);
    const depotCount = result.orderedPoints.filter(p => p.id === 'depot').length;
    expect(depotCount).toBe(1); // Only at start
  });

  it('should choose nearest neighbor at each step', () => {
    // Create a simple linear arrangement where nearest-neighbor is deterministic
    const linearPoints: TSPPoint[] = [
      { id: 'p1', lat: 45.50, lon: -73.56 },
      { id: 'p2', lat: 45.51, lon: -73.56 }, // 1.1 km north of p1
      { id: 'p3', lat: 45.52, lon: -73.56 }, // 1.1 km north of p2
    ];
    const result = solveTSPNearestNeighbor(linearPoints);
    // Should visit in order: p1 -> p2 -> p3 (or reverse)
    expect(result.orderedPoints.map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('TSP Solver - Distance Calculation', () => {
  it('should accumulate total distance correctly', () => {
    const points: TSPPoint[] = [
      { id: 'a', lat: 45.50, lon: -73.56 },
      { id: 'b', lat: 45.51, lon: -73.56 },
    ];
    const result = solveTSPNearestNeighbor(points);
    const expectedDist = haversine(45.50, -73.56, 45.51, -73.56);
    expect(result.totalDistance).toBeCloseTo(expectedDist, 1);
  });

  it('should include return distance when returnToDepot is true', () => {
    const points: TSPPoint[] = [
      { id: 'a', lat: 45.51, lon: -73.57 },
    ];
    const depot = { id: 'depot', lat: 45.50, lon: -73.56 };
    
    const withReturn = solveTSPNearestNeighbor(points, depot, true);
    const withoutReturn = solveTSPNearestNeighbor(points, depot, false);
    
    // With return should have extra distance back to depot
    expect(withReturn.totalDistance).toBeGreaterThan(withoutReturn.totalDistance);
  });

  it('should calculate reasonable total distance for multiple points', () => {
    const result = solveTSPNearestNeighbor(COLLECTION_POINTS);
    // 4 bins in Montreal area - total should be reasonable (< 50 km)
    expect(result.totalDistance).toBeGreaterThan(0);
    expect(result.totalDistance).toBeLessThan(50000);
  });
});

describe('TSP Solver - Duration Estimation', () => {
  it('should estimate duration based on distance and stops', () => {
    const result = solveTSPNearestNeighbor(COLLECTION_POINTS);
    // Duration should include travel time + service time
    // 4 stops * 2 min = 8 min service time minimum
    expect(result.estimatedDuration).toBeGreaterThan(8 * 60);
  });

  it('should scale with number of points', () => {
    const fewPoints = COLLECTION_POINTS.slice(0, 2);
    const manyPoints = [...COLLECTION_POINTS, ...COLLECTION_POINTS.map((p, i) => ({
      ...p,
      id: `extra-${i}`,
    }))];
    
    const fewResult = solveTSPNearestNeighbor(fewPoints);
    const manyResult = solveTSPNearestNeighbor(manyPoints);
    
    // More points = more service time
    expect(manyResult.estimatedDuration).toBeGreaterThan(fewResult.estimatedDuration);
  });

  it('should account for service time per stop', () => {
    const singlePoint: TSPPoint[] = [{ id: 'only', lat: 45.51, lon: -73.57 }];
    const result = solveTSPNearestNeighbor(singlePoint);
    // 1 stop = 2 min service time
    expect(result.estimatedDuration).toBeGreaterThanOrEqual(120);
  });
});

describe('TSP Solver - Algorithm Metadata', () => {
  it('should return algorithm name for non-empty input', () => {
    const result = solveTSPNearestNeighbor(COLLECTION_POINTS);
    expect(result.algorithm).toBe('nearest-neighbor');
  });

  it('should return "none" for empty input', () => {
    const result = solveTSPNearestNeighbor([]);
    expect(result.algorithm).toBe('none');
  });
});

describe('TSP Solver - Real-World Scenarios', () => {
  it('should handle urban collection route', () => {
    // Simulate a real waste collection route in Montreal
    const urbanRoute: TSPPoint[] = [
      { id: 'stop-1', lat: 45.5050, lon: -73.5700, name: 'Commercial District' },
      { id: 'stop-2', lat: 45.5080, lon: -73.5750, name: 'Residential Area A' },
      { id: 'stop-3', lat: 45.5120, lon: -73.5800, name: 'Park Entrance' },
      { id: 'stop-4', lat: 45.5150, lon: -73.5850, name: 'School Zone' },
      { id: 'stop-5', lat: 45.5100, lon: -73.5900, name: 'Residential Area B' },
    ];
    
    const depot = { id: 'garage', lat: 45.5000, lon: -73.5650, name: 'City Garage' };
    const result = solveTSPNearestNeighbor(urbanRoute, depot, true);
    
    // All stops visited
    expect(result.orderedPoints.length).toBe(urbanRoute.length + 2); // +2 for depot start/end
    
    // Reasonable total distance for urban route (< 10 km)
    expect(result.totalDistance).toBeLessThan(10000);
    
    // Reasonable duration (< 1 hour)
    expect(result.estimatedDuration).toBeLessThan(3600);
  });

  it('should handle scattered rural points', () => {
    // Rural points are more spread out
    const ruralRoute: TSPPoint[] = [
      { id: 'farm-1', lat: 45.60, lon: -73.80 },
      { id: 'farm-2', lat: 45.65, lon: -73.75 },
      { id: 'farm-3', lat: 45.55, lon: -73.85 },
    ];
    
    const result = solveTSPNearestNeighbor(ruralRoute);
    
    // Rural routes have larger distances
    expect(result.totalDistance).toBeGreaterThan(5000);
    
    // All points visited
    expect(result.orderedPoints.length).toBe(ruralRoute.length);
  });

  it('should handle points with demand metadata', () => {
    const pointsWithDemand: TSPPoint[] = [
      { id: 'heavy-1', lat: 45.51, lon: -73.57, demand: 100 },
      { id: 'light-1', lat: 45.52, lon: -73.58, demand: 20 },
    ];
    
    const result = solveTSPNearestNeighbor(pointsWithDemand);
    
    // Should still work with demand metadata
    expect(result.orderedPoints).toHaveLength(2);
    // Metadata should be preserved
    expect(result.orderedPoints.find(p => p.id === 'heavy-1')?.demand).toBe(100);
  });
});
