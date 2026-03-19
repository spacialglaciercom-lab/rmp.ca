/**
 * Help screen for TrashRoute Mobile app
 * Provides comprehensive help and guidance for users
 */
import React, { Suspense, lazy } from "react";

import { TabScreenSkeleton } from "@/components/tab-screen-skeleton";

const HelpContent = lazy(() => import("@/components/help-content"));

export default function HelpScreen() {
  return (
    <Suspense
      fallback={
        <TabScreenSkeleton
          title="Help & Support"
          subtitle="Loading help content..."
        />
      }
    >
      <HelpContent />
    </Suspense>
  );
}
