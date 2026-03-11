export type LatLon = {
  latitude: number;
  longitude: number;
};

export type PruneRouteLoopsOptions = {
  /**
   * Maximum allowed visits per directed segment (A->B).
   * - One-pass: 1
   * - Two-pass (both sides): 2
   */
  maxSegmentVisits: number;
  /** Coordinate quantization precision for segment keys. Default: 5 (~1m). */
  precision?: number;
  /** Hard cap on pruning iterations. Default: min(50, route.length). */
  maxIterations?: number;
};

export type PruneRouteLoopsResult<T extends LatLon> = {
  route: T[];
  changed: boolean;
  removedPoints: number;
  stats: {
    beforePoints: number;
    afterPoints: number;
    beforeSegments: number;
    afterSegments: number;
    worstSegmentVisitsBefore: number;
    worstSegmentVisitsAfter: number;
    approxDistanceKmBefore: number;
    approxDistanceKmAfter: number;
  };
};

function coordKey(p: LatLon, precision: number): string {
  return `${p.latitude.toFixed(precision)},${p.longitude.toFixed(precision)}`;
}

function segmentKey(a: LatLon, b: LatLon, precision: number): string {
  return `${coordKey(a, precision)}->${coordKey(b, precision)}`;
}

function dedupeConsecutive<T extends LatLon>(
  route: T[],
  precision: number,
): T[] {
  if (route.length <= 1) return route.slice();
  const out: T[] = [route[0]!];
  let lastKey = coordKey(route[0]!, precision);
  for (let i = 1; i < route.length; i++) {
    const k = coordKey(route[i]!, precision);
    if (k === lastKey) continue;
    out.push(route[i]!);
    lastKey = k;
  }
  return out;
}

function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * (sinDLon * sinDLon);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function approxRouteDistanceKm(route: LatLon[]): number {
  let km = 0;
  for (let i = 0; i < route.length - 1; i++) {
    km += haversineKm(route[i]!, route[i + 1]!);
  }
  return km;
}

function computeWorstSegmentVisits(route: LatLon[], precision: number): number {
  if (route.length < 2) return 0;
  const counts = new Map<string, number>();
  let worst = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const k = segmentKey(route[i]!, route[i + 1]!, precision);
    const next = (counts.get(k) ?? 0) + 1;
    counts.set(k, next);
    if (next > worst) worst = next;
  }
  return worst;
}

/**
 * Post-processing loop pruning.
 *
 * Heuristic: if a directed segment (A->B) is traversed more than allowed,
 * remove the loop between the first occurrence and the first disallowed
 * occurrence by splicing out the points that returned back to A.
 *
 * This is intentionally conservative and never returns an empty route.
 */
export function pruneRouteLoops<T extends LatLon>(
  route: T[],
  options: PruneRouteLoopsOptions,
): PruneRouteLoopsResult<T> {
  const precision = options.precision ?? 5;
  const maxSegmentVisits = Math.max(1, Math.floor(options.maxSegmentVisits));
  const maxIterations =
    options.maxIterations ?? Math.min(50, Math.max(1, route.length));

  const original = dedupeConsecutive(route, precision);
  let working = original.slice();

  const worstBefore = computeWorstSegmentVisits(working, precision);
  const distBefore = approxRouteDistanceKm(working);

  let iterations = 0;
  while (iterations < maxIterations && working.length >= 3) {
    iterations++;

    // Map segmentKey -> list of start indices (i where segment is i->i+1)
    const occurrences = new Map<string, number[]>();
    for (let i = 0; i < working.length - 1; i++) {
      const k = segmentKey(working[i]!, working[i + 1]!, precision);
      const arr = occurrences.get(k);
      if (arr) arr.push(i);
      else occurrences.set(k, [i]);
    }

    // Find the first segment that violates the visit cap
    let violatingKey: string | null = null;
    let violatingStarts: number[] | null = null;
    for (const [k, starts] of occurrences) {
      if (starts.length > maxSegmentVisits) {
        violatingKey = k;
        violatingStarts = starts;
        break;
      }
    }

    if (!violatingKey || !violatingStarts) break;

    const i = violatingStarts[0]!;
    const j = violatingStarts[maxSegmentVisits]!; // first disallowed occurrence
    if (j <= i) break;

    // Remove points i+1..j inclusive. This keeps the earliest A, and the B from the disallowed A->B.
    // Example: A,B, ..., A,B  -> remove B..A to collapse the loop.
    working.splice(i + 1, j - i);
    working = dedupeConsecutive(working, precision);
  }

  // Never return a route shorter than 2 points.
  if (working.length < 2) {
    working = original.slice();
  }

  const worstAfter = computeWorstSegmentVisits(working, precision);
  const distAfter = approxRouteDistanceKm(working);

  return {
    route: working,
    changed: working.length !== original.length || worstAfter !== worstBefore,
    removedPoints: Math.max(0, original.length - working.length),
    stats: {
      beforePoints: original.length,
      afterPoints: working.length,
      beforeSegments: Math.max(0, original.length - 1),
      afterSegments: Math.max(0, working.length - 1),
      worstSegmentVisitsBefore: worstBefore,
      worstSegmentVisitsAfter: worstAfter,
      approxDistanceKmBefore: distBefore,
      approxDistanceKmAfter: distAfter,
    },
  };
}
