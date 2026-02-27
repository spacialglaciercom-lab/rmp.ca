/**
 * MapLibre GL JS performance diagnostics and benchmarking.
 * Tracks frame timing, FPS, dropped frames, and tile load times.
 * Integrate with map render loop (e.g. map.on('render') or requestAnimationFrame).
 */

const FRAME_TIME_TARGET_60FPS = 1000 / 60; // 16.67ms
const DEFAULT_WINDOW_SIZE = 120; // ~2 seconds at 60fps

export interface PerformanceMetrics {
  fps: number;
  droppedFrames: number;
  totalFrames: number;
  percentDropped: number;
  avgFrameTime: number;
  minFrameTime: number;
  maxFrameTime: number;
  tileLoadTimes: TileLoadEntry[];
}

export interface TileLoadEntry {
  key: string;
  durationMs: number;
  timestamp: number;
}

export class PerformanceUtils {
  private frameTimes: number[] = [];
  private lastTimestamp: number = 0;
  private readonly frameTimeTarget: number;
  private readonly windowSize: number;
  private tileLoadTimes: TileLoadEntry[] = [];
  private readonly maxTileLoadEntries: number;
  private droppedCount = 0;
  private totalCount = 0;
  private _running = false;

  constructor(options?: {
    frameTimeTargetMs?: number;
    windowSize?: number;
    maxTileLoadEntries?: number;
  }) {
    this.frameTimeTarget = options?.frameTimeTargetMs ?? FRAME_TIME_TARGET_60FPS;
    this.windowSize = options?.windowSize ?? DEFAULT_WINDOW_SIZE;
    this.maxTileLoadEntries = options?.maxTileLoadEntries ?? 100;
  }

  /**
   * Record one frame. Call from map 'render' handler or requestAnimationFrame.
   * @param timestamp - performance.now() or event timestamp
   */
  recordFrame(timestamp: number): void {
    if (!this._running && this.lastTimestamp > 0) this._running = true;
    if (this.lastTimestamp > 0) {
      const dt = timestamp - this.lastTimestamp;
      this.frameTimes.push(dt);
      if (this.frameTimes.length > this.windowSize) this.frameTimes.shift();
      this.totalCount++;
      if (dt > this.frameTimeTarget) this.droppedCount++;
    }
    this.lastTimestamp = timestamp;
  }

  /**
   * Record tile load duration for diagnostics.
   */
  recordTileLoad(key: string, durationMs: number): void {
    this.tileLoadTimes.push({ key, durationMs, timestamp: performance.now() });
    if (this.tileLoadTimes.length > this.maxTileLoadEntries) this.tileLoadTimes.shift();
  }

  getMetrics(): PerformanceMetrics {
    const len = this.frameTimes.length;
    const avgFrameTime = len > 0
      ? this.frameTimes.reduce((a, b) => a + b, 0) / len
      : 0;
    const fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
    return {
      fps,
      droppedFrames: this.droppedCount,
      totalFrames: this.totalCount,
      percentDropped: this.totalCount > 0 ? (this.droppedCount / this.totalCount) * 100 : 0,
      avgFrameTime,
      minFrameTime: len > 0 ? Math.min(...this.frameTimes) : 0,
      maxFrameTime: len > 0 ? Math.max(...this.frameTimes) : 0,
      tileLoadTimes: [...this.tileLoadTimes],
    };
  }

  /** Reset frame and tile stats (e.g. when starting a new benchmark). */
  reset(): void {
    this.frameTimes = [];
    this.droppedCount = 0;
    this.totalCount = 0;
    this.lastTimestamp = 0;
    this.tileLoadTimes = [];
  }

  start(): void {
    this._running = true;
    this.lastTimestamp = 0;
  }

  stop(): void {
    this._running = false;
  }

  get running(): boolean {
    return this._running;
  }
}

/** Singleton for app-wide map performance monitoring (optional). */
let defaultInstance: PerformanceUtils | null = null;

export function getDefaultPerformanceUtils(): PerformanceUtils {
  if (!defaultInstance) defaultInstance = new PerformanceUtils();
  return defaultInstance;
}

/**
 * Attach PerformanceUtils to a MapLibre map's render loop.
 * Call once when the map is created. Returns cleanup function.
 */
export function attachToMapRender(
  map: { on: (e: string, fn: () => void) => void; off: (e: string, fn: () => void) => void },
  utils: PerformanceUtils
): () => void {
  utils.start();
  const onRender = () => utils.recordFrame(performance.now());
  map.on("render", onRender);
  return () => {
    map.off("render", onRender);
    utils.stop();
  };
}

/**
 * Run a requestAnimationFrame loop for global FPS monitoring when no map instance exists.
 * Returns cleanup function.
 */
export function startGlobalFrameMonitor(utils: PerformanceUtils): () => void {
  utils.start();
  let rafId: number;
  const tick = (t: number) => {
    utils.recordFrame(t);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(rafId);
    utils.stop();
  };
}
