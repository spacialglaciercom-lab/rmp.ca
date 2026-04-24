/**
 * O(1) feature position index for range queries (e.g. feature state, hover detection).
 * Replaces linear scan over id+min+max arrays with two-way map structure.
 */

export interface FeatureRange {
  min: number;
  max: number;
}

export class OptimizedFeaturePositionMap {
  private idToRange: Map<string, FeatureRange> = new Map();
  private sortedMins: number[] = [];
  private minToIds: Map<number, Set<string>> = new Map();
  private dirty = false;

  insert(id: string, min: number, max: number): void {
    const existing = this.idToRange.get(id);
    if (existing) {
      const bucket = this.minToIds.get(existing.min);
      if (bucket) {
        bucket.delete(id);
        if (bucket.size === 0) this.minToIds.delete(existing.min);
      }
    }
    this.idToRange.set(id, { min, max });
    let bucket = this.minToIds.get(min);
    if (!bucket) {
      bucket = new Set();
      this.minToIds.set(min, bucket);
    }
    bucket.add(id);
    this.dirty = true;
  }

  remove(id: string): boolean {
    const range = this.idToRange.get(id);
    if (!range) return false;
    this.idToRange.delete(id);
    const bucket = this.minToIds.get(range.min);
    if (bucket) {
      bucket.delete(id);
      if (bucket.size === 0) this.minToIds.delete(range.min);
    }
    this.dirty = true;
    return true;
  }

  get(id: string): FeatureRange | undefined {
    return this.idToRange.get(id);
  }

  private ensureSorted(): void {
    if (!this.dirty) return;
    this.sortedMins = Array.from(this.minToIds.keys()).sort((a, b) => a - b);
    this.dirty = false;
  }

  /**
   * Query all feature IDs whose [min, max] overlaps [queryMin, queryMax].
   */
  queryRange(queryMin: number, queryMax: number): string[] {
    this.ensureSorted();
    const result: string[] = [];
    for (const min of this.sortedMins) {
      if (min > queryMax) break;
      const bucket = this.minToIds.get(min)!;
      for (const id of bucket) {
        const range = this.idToRange.get(id)!;
        if (range.max >= queryMin) result.push(id);
      }
    }
    return result;
  }

  clear(): void {
    this.idToRange.clear();
    this.minToIds.clear();
    this.sortedMins = [];
    this.dirty = false;
  }

  get size(): number {
    return this.idToRange.size;
  }
}
