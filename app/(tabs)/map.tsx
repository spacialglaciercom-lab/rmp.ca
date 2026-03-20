import React, { Suspense, lazy } from "react";
import { TabScreenSkeleton } from "@/components/tab-screen-skeleton";
import { MapErrorBoundary } from "@/components/error-boundaries/map-error-boundary";

const MapContent = lazy(() => import("@/components/map-content"));

export default function MapScreen() {
  return (
    <MapErrorBoundary>
      <Suspense
        fallback={<TabScreenSkeleton title="Map" subtitle="Loading map..." />}
      >
        <MapContent />
      </Suspense>
    </MapErrorBoundary>
  );
}
