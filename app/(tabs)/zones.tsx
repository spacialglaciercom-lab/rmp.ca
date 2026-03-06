/**
 * Dedicated Zones tab — map-centric view of truck zone partitions.
 * Renders ZonePage (map 70–80%, sidebar with zone list and stats).
 */
import React, { Suspense, lazy } from "react";
import { TabScreenSkeleton } from "@/components/tab-screen-skeleton";

const ZonePage = lazy(() =>
  import("@/components/zones/ZonePage").then((m) => ({ default: m.ZonePage }))
);

export default function ZonesScreen() {
  return (
    <Suspense
      fallback={
        <TabScreenSkeleton title="Zones" subtitle="Loading zones..." />
      }
    >
      <ZonePage />
    </Suspense>
  );
}
