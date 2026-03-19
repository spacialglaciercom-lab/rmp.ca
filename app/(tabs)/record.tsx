/**
 * Extract tab. Draw polygon → preview roads → extract & process.
 * When the Overture maps extraction plugin is disabled, redirect to Home so the Extract tab is fully hidden.
 * On native we import eagerly so the tab is in the main bundle and doesn't require loading a split bundle
 * from Metro (avoids "Failed to load split bundle" when the device can't reach the dev server).
 */
import React, { Suspense, lazy, useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { View, Text, ActivityIndicator, Platform } from "react-native";

import { ErrorBoundary } from "@/components/error-boundary";
import { usePluginStore } from "@/stores/pluginStore";

const ExtractContent =
  Platform.OS === "web"
    ? lazy(() => import("@/components/extract-content"))
    : require("@/components/extract-content").default;

function LoadingFallback() {
    return (
        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
            <Text>Loading extractor...</Text>
            <ActivityIndicator size="large" />
        </View>
    );
}

export default function RecordScreen() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const overtureExtractionEnabled = usePluginStore((s) =>
    s.isPluginEnabled("overture-extraction", true),
  );

  useEffect(() => {
    if (!overtureExtractionEnabled) {
      routerRef.current.replace("/(tabs)");
    }
  }, [overtureExtractionEnabled]);

  if (!overtureExtractionEnabled) {
    return null;
  }

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <LoadingFallback />
        }
      >
        <ExtractContent />
      </Suspense>
    </ErrorBoundary>
  );
}
