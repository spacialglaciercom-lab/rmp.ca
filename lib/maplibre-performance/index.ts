/**
 * MapLibre GL JS performance optimization utilities.
 * Use for diagnostics, LRU tile cache, task scheduling, worker offload, and tile lifecycle.
 */

export {
  PerformanceUtils,
  getDefaultPerformanceUtils,
  attachToMapRender,
  startGlobalFrameMonitor,
  type PerformanceMetrics,
  type TileLoadEntry,
} from "./performance-utils";

export { OptimizedTileCache, type CachedTile } from "./optimized-tile-cache";

export { PriorityTaskQueue, TaskPriority, type TaskID } from "./task-queue";

export {
  OptimizedFeaturePositionMap,
  type FeatureRange,
} from "./feature-position-map";

export {
  TileLifecycleManager,
  getParentTileId,
  tileId,
  type TileDisposeCallback,
} from "./tile-lifecycle-manager";

export { VertexBufferPool } from "./vertex-buffer-pool";

export {
  ProgramConfigurationSet,
  getProgramMergeKey,
  type ProgramConfiguration,
  type LayerType,
  type LayerSpecLike,
} from "./program-configuration-set";

export {
  WorkerPool,
  TILE_DECODE_WORKER_SCRIPT,
  type WorkerTask,
} from "./worker-pool";

export {
  evaluateBenchmark,
  formatReport,
  type BenchmarkReport,
  type BenchmarkTargets,
} from "./benchmark-report";

export {
  getViewportTileKeys,
  getZoomPredictionTileKeys,
  PREFETCH_RING,
  type TileKey,
} from "./tile-priority";
