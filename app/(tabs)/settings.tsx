/**
 * Lazy-loaded Settings tab (Phase 1.1). Export, storage, Firebase, etc.
 * load only when the user opens this tab.
 */
import React, { Suspense, lazy } from "react";

import { TabScreenSkeleton } from "@/components/tab-screen-skeleton";
import { ErrorBoundary } from "@/components/error-boundary";

const SettingsContent = lazy(() => import("@/components/settings-content"));

export default function SettingsScreen() {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={<TabScreenSkeleton title="Settings" subtitle="Loading..." />}
      >
        <SettingsContent />
      </Suspense>
    </ErrorBoundary>
  );
}
