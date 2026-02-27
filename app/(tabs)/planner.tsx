/**
 * Lazy-loaded Planner tab (Phase 1.1). Heavy deps (Leaflet, route optimizer, etc.)
 * load only when the user opens this tab.
 */
import React, { Suspense, lazy } from "react";

import { TabScreenSkeleton } from "@/components/tab-screen-skeleton";
import { ErrorBoundary } from "@/components/error-boundary";

const PlannerContent = lazy(() => import("@/components/planner-content"));

export default function PlannerScreen() {
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
