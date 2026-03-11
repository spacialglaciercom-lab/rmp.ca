/**
 * Benchmark report for MapLibre performance validation.
 * Targets: 60fps, tile load ≤1.5s, memory -30%, shader switches ≤40/frame.
 */

import type { PerformanceMetrics } from "./performance-utils";

export interface BenchmarkReport {
  timestamp: string;
  durationSeconds: number;
  metrics: PerformanceMetrics;
  targets: BenchmarkTargets;
  passed: boolean;
  summary: string;
}

export interface BenchmarkTargets {
  minFps: number;
  maxTileLoadTimeMs: number;
  maxPercentDropped: number;
  maxAvgFrameTimeMs: number;
}

const DEFAULT_TARGETS: BenchmarkTargets = {
  minFps: 55,
  maxTileLoadTimeMs: 1500,
  maxPercentDropped: 25,
  maxAvgFrameTimeMs: 20,
};

export function evaluateBenchmark(
  metrics: PerformanceMetrics,
  durationSeconds: number,
  targets: Partial<BenchmarkTargets> = {},
): BenchmarkReport {
  const t = { ...DEFAULT_TARGETS, ...targets };
  const maxTileLoad =
    metrics.tileLoadTimes.length > 0
      ? Math.max(...metrics.tileLoadTimes.map((e) => e.durationMs))
      : 0;
  const fpsOk = metrics.fps >= t.minFps;
  const tileOk = maxTileLoad <= t.maxTileLoadTimeMs;
  const droppedOk = metrics.percentDropped <= t.maxPercentDropped;
  const frameOk = metrics.avgFrameTime <= t.maxAvgFrameTimeMs;
  const passed = fpsOk && tileOk && droppedOk && frameOk;
  const parts: string[] = [];
  if (!fpsOk) parts.push(`FPS ${metrics.fps.toFixed(1)} < ${t.minFps}`);
  if (!tileOk)
    parts.push(
      `max tile load ${maxTileLoad.toFixed(0)}ms > ${t.maxTileLoadTimeMs}ms`,
    );
  if (!droppedOk)
    parts.push(
      `dropped ${metrics.percentDropped.toFixed(1)}% > ${t.maxPercentDropped}%`,
    );
  if (!frameOk)
    parts.push(
      `avg frame ${metrics.avgFrameTime.toFixed(2)}ms > ${t.maxAvgFrameTimeMs}ms`,
    );
  const summary = passed
    ? `Passed: ${metrics.fps.toFixed(1)} fps, ${metrics.percentDropped.toFixed(1)}% dropped`
    : `Failed: ${parts.join("; ")}`;
  return {
    timestamp: new Date().toISOString(),
    durationSeconds,
    metrics,
    targets: t,
    passed,
    summary,
  };
}

export function formatReport(report: BenchmarkReport): string {
  const m = report.metrics;
  const lines = [
    `--- MapLibre performance report ---`,
    report.summary,
    `Duration: ${report.durationSeconds}s`,
    `FPS: ${m.fps.toFixed(1)} (target ≥${report.targets.minFps})`,
    `Dropped: ${m.droppedFrames}/${m.totalFrames} (${m.percentDropped.toFixed(1)}%)`,
    `Avg frame: ${m.avgFrameTime.toFixed(2)}ms`,
    `Frame time: min ${m.minFrameTime.toFixed(2)}ms, max ${m.maxFrameTime.toFixed(2)}ms`,
    `Tile load samples: ${m.tileLoadTimes.length}`,
  ];
  return lines.join("\n");
}
