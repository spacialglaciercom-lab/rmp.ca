/**
 * Lazy-loaded Planner tab (Phase 1.1). Heavy deps (Leaflet, route optimizer, etc.)
 * load only when the user opens this tab.
 * When the Route Optimizer plugin is disabled, redirect to Home so the planner is fully hidden.
 */
import React, { Suspense, lazy, useEffect } from "react";
import { useRouter } from "expo-router";

import { TabScreenSkeleton } from "@/components/tab-screen-skeleton";
import { ErrorBoundary } from "@/components/error-boundary";
import { usePluginStore } from "@/stores/pluginStore";

const PlannerContent = lazy(() => import("@/components/planner-content"));

export default function PlannerScreen() {
  const router = useRouter();
  const routeOptimizerEnabled = usePluginStore((s) => s.isPluginEnabled("routeOptimization", true));

  useEffect(() => {
    if (!routeOptimizerEnabled) {
      router.replace("/(tabs)");
    }
  }, [routeOptimizerEnabled, router]);

  if (!routeOptimizerEnabled) {
    return null;
  }

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <TabScreenSkeleton
            title="Route Planner"
            subtitle="Loading..."
          />
        }
      >
        <PlannerContent />
      </Suspense>
    </ErrorBoundary>
  );
}
