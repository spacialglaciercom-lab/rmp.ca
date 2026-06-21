/**
 * In-memory LRU tile cache for MapLibre tile loading.
 * Use with custom protocol or transformRequest to avoid re-fetching tiles.
 * Map maintains insertion order; we use it for LRU eviction (oldest first).
 */

export interface CachedTile<T = ArrayBuffer> {
  data: T;
  lastAccessed: number;
  size?: number;
}

export class OptimizedTileCache<T = ArrayBuffer> {
  private cache: Map<string, CachedTile<T>> = new Map();
  private readonly maxSize: number;
  private readonly maxMemory: number;
  private currentSize = 0;
  private _hits = 0;
  private _misses = 0;

  /**
   * @param maxSize   Maximum number of tiles to keep in cache (default 500)
   * @param maxMemory Maximum memory in bytes to use (default Infinity)
   */
  constructor(maxSize: number = 500, maxMemory: number = Infinity) {
    this.maxSize = Math.max(1, maxSize);
    this.maxMemory = Math.max(1, maxMemory);
  }

  get(id: string): T | undefined {
    const entry = this.cache.get(id);
    if (!entry) {
      this._misses++;
      return undefined;
    }
    this._hits++;
    entry.lastAccessed = Date.now();
    // Move to end (most recent): delete and re-set
    this.cache.delete(id);
    this.cache.set(id, entry);
    return entry.data;
  }

  add(id: string, data: T, size?: number): void {
    const byteSize =
      size ?? (data instanceof ArrayBuffer ? (data as ArrayBuffer).byteLength : 1);

    // Evict based on count or memory limit
    while (this.cache.size > 0 && (this.cache.size >= this.maxSize || this.currentSize + byteSize > this.maxMemory)) {
      const firstKey = this.cache.keys().next().value as string;
      if (firstKey === undefined) break;
      const old = this.cache.get(firstKey);
      this.cache.delete(firstKey);
      if (old?.size) this.currentSize -= old.size;
    }

    const entry: CachedTile<T> = {
      data,
      lastAccessed: Date.now(),
      size: byteSize,
    };
    this.cache.set(id, entry);
    this.currentSize += byteSize;
  }

  has(id: string): boolean {
    return this.cache.has(id);
  }

  remove(id: string): boolean {
    const entry = this.cache.get(id);
    if (!entry) return false;
    this.cache.delete(id);
    if (entry.size) this.currentSize -= entry.size;
    return true;
  }

  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
    this._hits = 0;
    this._misses = 0;
  }

  getStats(): { size: number; hits: number; misses: number; hitRate: number; currentSize: number } {
    const total = this._hits + this._misses;
    return {
      size: this.cache.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? this._hits / total : 0,
      currentSize: this.currentSize,
    };
  }
}
