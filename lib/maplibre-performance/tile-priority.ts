/**
 * Tile loading priority: viewport first, then prefetch ring.
 * Use with custom tile sources or protocols to load visible tiles before adjacent/zoom.
 */

export const PREFETCH_RING = 2; // tiles beyond viewport in each direction

export interface TileKey {
  z: number;
  x: number;
  y: number;
  key: string;
}

/**
 * Get tile keys for a viewport (z, x range, y range) with optional prefetch ring.
 * Priority 1: tiles in [xMin, xMax] x [yMin, yMax]. Priority 2: ring around that.
 */
export function getViewportTileKeys(
  z: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  prefetchRing: number = PREFETCH_RING,
): { viewport: TileKey[]; prefetch: TileKey[] } {
  const viewport: TileKey[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      viewport.push({ z, x, y, key: `${z}/${x}/${y}` });
    }
  }
  if (prefetchRing <= 0) return { viewport, prefetch: [] };
  const prefetchSet = new Set(viewport.map((t) => t.key));
  const prefetch: TileKey[] = [];
  const xLo = xMin - prefetchRing;
  const xHi = xMax + prefetchRing;
  const yLo = yMin - prefetchRing;
  const yHi = yMax + prefetchRing;
  for (let x = xLo; x <= xHi; x++) {
    for (let y = yLo; y <= yHi; y++) {
      if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) continue;
      const key = `${z}/${x}/${y}`;
      if (!prefetchSet.has(key)) {
        prefetchSet.add(key);
        prefetch.push({ z, x, y, key });
      }
    }
  }
  return { viewport, prefetch };
}

/**
 * Get tile keys at target zoom for zoom prediction (e.g. during pinch).
 */
export function getZoomPredictionTileKeys(
  targetZ: number,
  centerX: number,
  centerY: number,
  radius: number = 2,
): TileKey[] {
  const xMin = Math.floor(centerX - radius);
  const xMax = Math.floor(centerX + radius);
  const yMin = Math.floor(centerY - radius);
  const yMax = Math.floor(centerY + radius);
  const out: TileKey[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      out.push({ z: targetZ, x, y, key: `${targetZ}/${x}/${y}` });
    }
  }
  return out;
}
