import { describe, it, expect } from 'vitest';
import { solveLocal, estimateRouteStats } from '../routeSolverLocal';
import type { SolverPoint } from '../routeSolverLocal';

const pts: SolverPoint[] = [
  { id: 'a', lat: 45.00, lon: -73.00 },
  { id: 'b', lat: 45.10, lon: -73.00 },
  { id: 'c', lat: 45.10, lon: -73.10 },
  { id: 'd', lat: 45.00, lon: -73.10 },
];

describe('solveLocal', () => {
  it('throws for zero points', async () => {
    await expect(solveLocal([])).rejects.toThrow();
  });

  it('handles a single point with trivial algorithm', async () => {
    const result = await solveLocal([pts[0]]);
    expect(result.algorithm).toBe('trivial');
    expect(result.totalDistance).toBe(0);
    expect(result.totalDuration).toBe(0);
    expect(result.orderedPoints).toHaveLength(1);
    expect(result.segments).toHaveLength(0);
  });

  it('nearest-neighbor visits all points exactly once', async () => {
    const result = await solveLocal(pts, { algorithm: 'nearest-neighbor' });
    const ids = result.orderedPoints.map((p) => p.id).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('nearest-neighbor sets the algorithm field', async () => {
    const result = await solveLocal(pts, { algorithm: 'nearest-neighbor' });
    expect(result.algorithm).toBe('nearest-neighbor');
  });

  it('2-opt visits all points exactly once', async () => {
    const result = await solveLocal(pts, { algorithm: '2-opt' });
    const ids = result.orderedPoints.map((p) => p.id).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('2-opt sets the algorithm field', async () => {
    const result = await solveLocal(pts, { algorithm: '2-opt' });
    expect(result.algorithm).toBe('2-opt');
  });

  it('totalDistance is positive for multiple points', async () => {
    const result = await solveLocal(pts);
    expect(result.totalDistance).toBeGreaterThan(0);
  });

  it('segments connect consecutive ordered stops', async () => {
    const result = await solveLocal(pts);
    expect(result.segments).toHaveLength(pts.length - 1);
    for (let i = 0; i < result.segments.length; i++) {
      expect(result.segments[i].from).toBe(result.orderedPoints[i].id);
      expect(result.segments[i].to).toBe(result.orderedPoints[i + 1].id);
    }
  });

  it('every segment has a positive distance', async () => {
    const result = await solveLocal(pts);
    for (const seg of result.segments) {
      expect(seg.distance).toBeGreaterThan(0);
    }
  });

  it('totalDistance equals sum of segment distances', async () => {
    const result = await solveLocal(pts);
    const segTotal = result.segments.reduce((s, seg) => s + seg.distance, 0);
    expect(result.totalDistance).toBeCloseTo(segTotal, 5);
  });

  it('solveTime is non-negative', async () => {
    const result = await solveLocal(pts);
    expect(result.solveTime).toBeGreaterThanOrEqual(0);
  });

  it('with depot: orderedPoints includes depot and all stops', async () => {
    const depot: SolverPoint = { id: 'depot', lat: 44.99, lon: -73.05 };
    const result = await solveLocal(pts, { algorithm: 'nearest-neighbor', depot });
    const ids = result.orderedPoints.map((p) => p.id);
    expect(ids).toContain('depot');
    expect(ids).toHaveLength(pts.length + 1);
  });

  it('returnToDepot appends depot as last point', async () => {
    const depot: SolverPoint = { id: 'depot', lat: 44.99, lon: -73.05 };
    const result = await solveLocal(pts, { algorithm: 'nearest-neighbor', depot, returnToDepot: true });
    const ids = result.orderedPoints.map((p) => p.id);
    expect(ids[ids.length - 1]).toBe('depot');
  });

  it('2-opt distance is no worse than nearest-neighbor for same points', async () => {
    const nn = await solveLocal(pts, { algorithm: 'nearest-neighbor' });
    const opt = await solveLocal(pts, { algorithm: '2-opt' });
    expect(opt.totalDistance).toBeLessThanOrEqual(nn.totalDistance + 1);
  });
});

describe('estimateRouteStats', () => {
  it('returns all-zero result for empty array', () => {
    const stats = estimateRouteStats([]);
    expect(stats.totalDistance).toBe(0);
    expect(stats.estimatedDuration).toBe(0);
    expect(stats.boundingBox).toEqual({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
  });

  it('single point bounding box collapses to that point', () => {
    const stats = estimateRouteStats([pts[0]]);
    expect(stats.boundingBox.minLat).toBe(pts[0].lat);
    expect(stats.boundingBox.maxLat).toBe(pts[0].lat);
    expect(stats.boundingBox.minLon).toBe(pts[0].lon);
    expect(stats.boundingBox.maxLon).toBe(pts[0].lon);
  });

  it('bounding box min <= max for a spread of points', () => {
    const stats = estimateRouteStats(pts);
    expect(stats.boundingBox.minLat).toBeLessThanOrEqual(stats.boundingBox.maxLat);
    expect(stats.boundingBox.minLon).toBeLessThanOrEqual(stats.boundingBox.maxLon);
  });

  it('bounding box contains every input point', () => {
    const stats = estimateRouteStats(pts);
    for (const p of pts) {
      expect(p.lat).toBeGreaterThanOrEqual(stats.boundingBox.minLat);
      expect(p.lat).toBeLessThanOrEqual(stats.boundingBox.maxLat);
      expect(p.lon).toBeGreaterThanOrEqual(stats.boundingBox.minLon);
      expect(p.lon).toBeLessThanOrEqual(stats.boundingBox.maxLon);
    }
  });

  it('totalDistance is positive for spread-out points', () => {
    const stats = estimateRouteStats(pts);
    expect(stats.totalDistance).toBeGreaterThan(0);
  });

  it('estimatedDuration is positive for spread-out points', () => {
    const stats = estimateRouteStats(pts);
    expect(stats.estimatedDuration).toBeGreaterThan(0);
  });

  it('custom serviceTime affects estimatedDuration', () => {
    const short = estimateRouteStats(pts.map((p) => ({ ...p, serviceTime: 10 })));
    const long = estimateRouteStats(pts.map((p) => ({ ...p, serviceTime: 600 })));
    expect(long.estimatedDuration).toBeGreaterThan(short.estimatedDuration);
  });
});
