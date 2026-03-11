/**
 * Hook for map performance metrics and benchmark reporting.
 * Use with MapLibre web (Overture overlay) — metrics are recorded when the overlay is active.
 */

import { useCallback, useRef } from "react";
import {
  getDefaultPerformanceUtils,
  evaluateBenchmark,
  formatReport,
  type PerformanceMetrics,
  type BenchmarkReport,
} from "@/lib/maplibre-performance";

/**
 * Returns the current performance utils and helpers for metrics/benchmark.
 * Safe to call on web only; on native the map uses a different stack.
 */
export function useMapPerformance() {
  const utils = getDefaultPerformanceUtils();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getMetrics = useCallback((): PerformanceMetrics => {
    return utils.getMetrics();
  }, []);

  /**
   * Run a benchmark for the given duration (seconds), then evaluate against targets.
   */
  const runBenchmark = useCallback(
    (durationSeconds: number = 60): Promise<BenchmarkReport> => {
      return new Promise((resolve) => {
        utils.reset();
        const start = performance.now();
        intervalRef.current = setInterval(() => {
          const elapsed = (performance.now() - start) / 1000;
          if (elapsed >= durationSeconds && intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
            const metrics = utils.getMetrics();
            const report = evaluateBenchmark(metrics, durationSeconds);
            resolve(report);
          }
        }, 500);
      });
    },
    [],
  );

  const getReportSummary = useCallback((report: BenchmarkReport): string => {
    return formatReport(report);
  }, []);

  return { getMetrics, runBenchmark, getReportSummary };
}
