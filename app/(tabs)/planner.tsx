/**
 * Lazy-loaded Planner tab (Phase 1.1). Heavy deps (Leaflet, route optimizer, etc.)
 * load only when the user opens this tab.
 * When the Route Optimizer plugin is disabled, redirect to Home so the planner is fully hidden.
 */
import React, { Suspense, lazy, useEffect, useRef } from "react";
import { useRouter } from "expo-router";

import { TabScreenSkeleton } from "@/components/tab-screen-skeleton";
import { ErrorBoundary } from "@/components/error-boundary";
import { usePluginStore } from "@/stores/pluginStore";

const PlannerContent = lazy(async () => {
  try {
    const mod = await import("@/components/planner-content");
    return mod;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    const cause =
      err instanceof Error && "cause" in err
        ? (err as Error & { cause?: unknown }).cause
        : undefined;
    const causeMessage =
      cause instanceof Error ? cause.message : cause != null ? String(cause) : "";
    throw new Error(
      `Failed to load Planner: ${message}${causeMessage ? ` (${causeMessage})` : ""}`,
      { cause: err instanceof Error ? err : new Error(String(err)) },
    );
  }
});

export default function PlannerScreen() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const routeOptimizerEnabled = usePluginStore((s) =>
    s.isPluginEnabled("routeOptimization", true),
  );

  useEffect(() => {
    if (!routeOptimizerEnabled) {
      routerRef.current.replace("/(tabs)");
    }
  }, [routeOptimizerEnabled]);

  if (!routeOptimizerEnabled) {
    return null;
  }

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <TabScreenSkeleton title="Route Planner" subtitle="Loading..." />
        }
      >
        <PlannerContent />
      </Suspense>
    </ErrorBoundary>
  );
}
