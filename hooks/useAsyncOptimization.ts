/**
 * State-machine hook for async Celery-backed route optimization.
 *
 * Flow: IDLE → SUBMITTING → POLLING → SUCCESS | ERROR
 *
 * Uses recursive setTimeout (not setInterval) so a slow status response never
 * stacks requests. AbortController propagates cancellation through both the
 * in-flight fetch and any pending timer, preventing leaks on unmount.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  submitOptimizeJob,
  pollOptimizeStatus,
  type OptimizeRouteParams,
  type OptimizeResponse,
} from "@/services/overtureOptimizerService";

export type TaskStatus = "IDLE" | "SUBMITTING" | "POLLING" | "SUCCESS" | "ERROR";

const POLL_INTERVAL_MS = 2_000;

export function useAsyncOptimization() {
  const [status, setStatus] = useState<TaskStatus>("IDLE");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // Stop everything when the component unmounts.
  useEffect(() => cleanup, [cleanup]);

  const startOptimization = useCallback(
    async (params: OptimizeRouteParams) => {
      cleanup();
      setStatus("SUBMITTING");
      setError(null);
      setResult(null);
      setTaskId(null);

      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      // Recursive poll — schedules itself until terminal state or cancellation.
      const poll = async (id: string) => {
        if (signal.aborted) return;
        try {
          const data = await pollOptimizeStatus(id, signal);
          if (data.status === "SUCCESS" && data.result) {
            setResult(data.result);
            setStatus("SUCCESS");
          } else if (data.status === "FAILURE") {
            setError(data.error ?? "Optimization failed");
            setStatus("ERROR");
          } else if (!signal.aborted) {
            timerRef.current = setTimeout(() => poll(id), POLL_INTERVAL_MS);
          }
        } catch (err) {
          if ((err as { name?: string }).name === "AbortError") return;
          setError((err as Error).message);
          setStatus("ERROR");
        }
      };

      try {
        const { task_id } = await submitOptimizeJob(params);
        if (signal.aborted) return;
        setTaskId(task_id);
        setStatus("POLLING");
        timerRef.current = setTimeout(() => poll(task_id), POLL_INTERVAL_MS);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError((err as Error).message);
        setStatus("ERROR");
      }
    },
    [cleanup],
  );

  const cancelOptimization = useCallback(() => {
    cleanup();
    setStatus("IDLE");
    setTaskId(null);
  }, [cleanup]);

  return { status, taskId, result, error, startOptimization, cancelOptimization };
}
