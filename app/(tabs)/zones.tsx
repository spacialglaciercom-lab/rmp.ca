/**
 * Dedicated Zones tab — map-centric view of truck zone partitions.
 * Renders ZonePage (map 70–80%, sidebar with zone list and stats).
 * When the Zones plugin is disabled, redirect to Home so the Zones tab is fully hidden.
 */
import React, { Suspense, lazy, useEffect } from "react";
import { useRouter } from "expo-router";
import { TabScreenSkeleton } from "@/components/tab-screen-skeleton";
import { usePluginStore } from "@/stores/pluginStore";

const ZonePage = lazy(() =>
  import("@/components/zones/ZonePage").then((m) => ({ default: m.ZonePage }))
);

export default function ZonesScreen() {
  const router = useRouter();
  const zonesEnabled = usePluginStore((s) => s.isPluginEnabled("zones", true));

  useEffect(() => {
    if (!zonesEnabled) {
      router.replace("/(tabs)");
    }
  }, [zonesEnabled, router]);

  if (!zonesEnabled) {
    return null;
  }

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
