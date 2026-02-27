/**
 * Tile lifecycle manager: retain visible + prefetch tiles, dispose the rest.
 * Use with custom tile loading to cancel pending requests and release resources.
 */

export interface TileDisposeCallback {
  (tileId: string): void;
}

export class TileLifecycleManager {
  private retainedIds: Set<string> = new Set();
  private prefetchIds: Set<string> = new Set();
  private onDispose: TileDisposeCallback;

  constructor(onDispose: TileDisposeCallback) {
    this.onDispose = onDispose;
  }

  /**
   * Update which tiles to retain. All others should be disposed.
   * @param visibleIds - tile IDs currently in viewport
   * @param prefetchIds - tile IDs in prefetch ring (e.g. viewport + 2 tiles)
   * @param parentTileIds - optional parent tile IDs for smooth zoom (e.g. keep at 50% opacity)
   */
  updateRetainedTiles(
    visibleIds: string[],
    prefetchIds: string[],
    parentTileIds?: string[]
  ): void {
    const retain = new Set<string>([...visibleIds, ...prefetchIds]);
    if (parentTileIds?.length) parentTileIds.forEach((id) => retain.add(id));
    this.retainedIds = retain;
    this.prefetchIds = new Set(prefetchIds);
  }

  shouldRetain(tileId: string): boolean {
    return this.retainedIds.has(tileId);
  }

  /**
   * Call when a tile is no longer needed. Triggers onDispose(tileId).
   */
  disposeTile(tileId: string): void {
    if (this.retainedIds.has(tileId)) return;
    this.onDispose(tileId);
  }

  /**
   * Dispose all tiles that are not in the current retained set.
   */
  disposeAllExceptRetained(currentTileIds: Iterable<string>): void {
    for (const id of currentTileIds) {
      if (!this.retainedIds.has(id)) this.onDispose(id);
    }
  }

  getRetainedIds(): Set<string> {
    return new Set(this.retainedIds);
  }

  getPrefetchIds(): Set<string> {
    return new Set(this.prefetchIds);
  }
}

/**
 * Get parent tile ID for a given z/x/y (one zoom level up).
 */
export function getParentTileId(z: number, x: number, y: number): string {
  const pz = Math.max(0, z - 1);
  const px = Math.floor(x / 2);
  const py = Math.floor(y / 2);
  return `${pz}/${px}/${py}`;
}

export function tileId(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}
