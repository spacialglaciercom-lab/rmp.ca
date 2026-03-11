# MapLibre performance optimization utilities

App-level utilities for MapLibre GL JS performance: diagnostics, LRU tile cache, task scheduling, worker pool, feature index, and tile lifecycle. All code lives in `C:\trashroute-mobile`; MapLibre GL JS itself remains an unchanged dependency.

## Deliverables

| Item                            | Module                                      | Notes                                                                                                           |
| ------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **PerformanceUtils**            | `performance-utils.ts`                      | Frame timing, FPS, dropped frames, tile load times. Integrated with Overture overlay via `attachToMapRender()`. |
| **LRU TileCache**               | `optimized-tile-cache.ts`                   | In-memory LRU; use with custom protocol or transformRequest. Disk cache remains `lib/tile-cache.ts`.            |
| **VBO Pool**                    | `vertex-buffer-pool.ts`                     | WebGL buffer reuse by size bucket. Use with custom WebGL or forked MapLibre.                                    |
| **ProgramConfigurationSet**     | `program-configuration-set.ts`              | Merge keys and batch render order to minimize shader switches.                                                  |
| **Priority TaskQueue**          | `task-queue.ts`                             | CRITICAL → HIGH → NORMAL → LOW with frame budget (e.g. 8ms).                                                    |
| **Worker pool**                 | `worker-pool.ts`                            | Offload tile decode / GeoJSON / geometry to workers; use transferables.                                         |
| **OptimizedFeaturePositionMap** | `feature-position-map.ts`                   | O(1) insert/lookup, efficient range query for feature state / hover.                                            |
| **TileLifecycleManager**        | `tile-lifecycle-manager.ts`                 | Retain visible + prefetch; dispose others; optional parent tiles for zoom.                                      |
| **Tile priority**               | `tile-priority.ts`                          | Viewport + prefetch ring tile keys; zoom prediction keys.                                                       |
| **Benchmark report**            | `benchmark-report.ts` + `useMapPerformance` | Evaluate metrics vs targets; format report.                                                                     |

## Usage

- **Frame monitoring (web):** The Overture overlay in `route-map.web.tsx` attaches `getDefaultPerformanceUtils()` to the MapLibre `render` event. Use `useMapPerformance()` to read `getMetrics()` or `runBenchmark(durationSeconds)`.
- **LRU cache:** `const cache = new OptimizedTileCache<ArrayBuffer>(500);` then check `cache.get(id)` before fetch and `cache.add(id, data)` after.
- **Task queue:** `const q = new PriorityTaskQueue(); q.schedule(() => {...}, TaskPriority.HIGH);` and in your rAF or map tick call `q.process(8)`.
- **Worker pool:** `pool.setWorkerScript(TILE_DECODE_WORKER_SCRIPT, true);` then `pool.postMessage({ arrayBuffer }, [arrayBuffer])` for decode-offload.
- **Tile lifecycle:** `const mgr = new TileLifecycleManager((id) => cancelOrRelease(id)); mgr.updateRetainedTiles(visibleIds, prefetchIds, parentIds);` then dispose tiles not in retained set.

## Performance targets (from master prompt)

| Metric          | Target       | Measurement                  |
| --------------- | ------------ | ---------------------------- |
| FPS             | Stable 60fps | PerformanceUtils over 60s    |
| Tile load       | ≤1.5s        | Tile load times in metrics   |
| Memory          | −30%         | Chrome DevTools / heap       |
| Shader switches | ≤40/frame    | WebGL Inspector / Spector.js |

Test scenarios: rapid zoom (z0→z16, >45fps), pan storm (30s, memory growth <10MB), style switch (no >100ms drops), data-heavy (500k+ features, UI thread <50ms/frame).
