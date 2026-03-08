/**
 * Lazy-loaded Extract tab. Draw polygon → preview roads → extract & process.
 * When the Overture maps extraction plugin is disabled, redirect to Home so the Extract tab is fully hidden.
 */
import React, { Suspense, lazy, useEffect } from "react";
import { useRouter } from "expo-router";

import { TabScreenSkeleton } from "@/components/tab-screen-skeleton";
import { ErrorBoundary } from "@/components/error-boundary";
import { usePluginStore } from "@/stores/pluginStore";

const ExtractContent = lazy(() => import("@/components/extract-content"));

export default function RecordScreen() {
  const router = useRouter();
  const overtureExtractionEnabled = usePluginStore((s) => s.isPluginEnabled("overture-extraction", true));

  useEffect(() => {
    if (!overtureExtractionEnabled) {
      router.replace("/(tabs)");
    }
  }, [overtureExtractionEnabled, router]);

  if (!overtureExtractionEnabled) {
    return null;
  }

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <TabScreenSkeleton
            title="Extract"
            subtitle="Loading extractor..."
          />
        }
      >
        <ExtractContent />
      </Suspense>
    </ErrorBoundary>
  );
}
