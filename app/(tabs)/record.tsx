/**
 * Lazy-loaded Extract tab. Draw polygon → preview roads → extract & process.
 */
import React, { Suspense, lazy } from "react";

import { TabScreenSkeleton } from "@/components/tab-screen-skeleton";
import { ErrorBoundary } from "@/components/error-boundary";

const ExtractContent = lazy(() => import("@/components/extract-content"));

export default function RecordScreen() {
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
