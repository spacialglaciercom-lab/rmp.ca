import { describe, it, expect } from 'vitest';
import { haversineMeters, haversineKm } from '../_core/geo';

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(45, -73, 45, -73)).toBe(0);
  });

  it('is symmetric', () => {
    const ab = haversineMeters(45.0, -73.0, 45.1, -73.0);
    const ba = haversineMeters(45.1, -73.0, 45.0, -73.0);
    expect(ab).toBeCloseTo(ba, 5);
  });

  it('approx 111_195 m per degree of latitude at equator', () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeCloseTo(111_195, -2);
  });

  it('degree of longitude shrinks with latitude', () => {
    const atEquator = haversineMeters(0, 0, 0, 1);
    const at45 = haversineMeters(45, 0, 45, 1);
    expect(at45).toBeLessThan(atEquator);
  });

  it('increases monotonically with separation', () => {
    const d1 = haversineMeters(45, -73, 45.01, -73);
    const d2 = haversineMeters(45, -73, 45.02, -73);
    expect(d2).toBeGreaterThan(d1);
  });

  it('returns positive value for distinct points', () => {
    expect(haversineMeters(51.5074, -0.1278, 48.8566, 2.3522)).toBeGreaterThan(0);
  });
});

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(45, -73, 45, -73)).toBe(0);
  });

  it('approx 111.195 km per degree of latitude at equator', () => {
    const d = haversineKm(0, 0, 1, 0);
    expect(d).toBeCloseTo(111.195, 0);
  });

  it('haversineKm * 1000 matches haversineMeters', () => {
    const km = haversineKm(45.5, -73.6, 45.6, -73.5);
    const m = haversineMeters(45.5, -73.6, 45.6, -73.5);
    expect(km * 1000).toBeCloseTo(m, 3);
  });

  it('is symmetric', () => {
    const ab = haversineKm(51.5, -0.1, 48.8, 2.3);
    const ba = haversineKm(48.8, 2.3, 51.5, -0.1);
    expect(ab).toBeCloseTo(ba, 5);
  });

  it('London to Paris is roughly 340 km', () => {
    const d = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(350);
  });
});
