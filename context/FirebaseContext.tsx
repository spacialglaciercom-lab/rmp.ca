"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import type { RouteMetadata } from "@/lib/firebase/fetchRoutes";
import { recordErrorToCrashlytics } from "@/lib/crashlytics-report";

export interface FirebaseRouteItem {
  id: string;
  data: RouteMetadata;
}

interface FirebaseContextValue {
  routes: FirebaseRouteItem[];
  loading: boolean;
  error: Error | null;
  hasInvalidGpx: boolean;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

function useFirestoreSnapshot() {
  const [routes, setRoutes] = useState<FirebaseRouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasInvalidGpx, setHasInvalidGpx] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let mounted = true;

    (async () => {
      try {
        const { firestoreDb, ensureAppCheckReady } = await import("@/lib/firebase/index");
        await ensureAppCheckReady();
        if (!mounted) return;
        const routesRef = firestoreDb.collection("routes");
        unsubscribe = routesRef.onSnapshot(
          (snapshot) => {
            if (!mounted) return;
            const newRoutes: FirebaseRouteItem[] = snapshot.docs.map((doc) => ({
              id: doc.id,
              data: { id: doc.id, ...doc.data() } as RouteMetadata,
            }));
            setRoutes(newRoutes);
            setLoading(false);
            setError(null);

            // Validation: detect invalid GPX and set flag for UI (e.g. alert)
            const invalid = newRoutes.some((r) => r.data.hasInvalidGPX === true);
            setHasInvalidGpx(invalid);

            // Logging: route updates (critical validation step)
            if (__DEV__) {
              console.log(
                "Firebase routes updated:",
                snapshot.docs.map((d) => ({ id: d.id, hasInvalidGPX: d.data()?.hasInvalidGPX }))
              );
            }
          },
          (err: unknown) => {
            if (!mounted) return;
            const e = err instanceof Error ? err : new Error(String(err));
            const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
            recordErrorToCrashlytics(e, "FirestoreListener", {
              firestore_code: code,
              firestore_message: e.message,
            });
            setError(e);
            setLoading(false);
          }
        );
      } catch (e) {
        if (!mounted) return;
        const err = e instanceof Error ? e : new Error(String(e));
        recordErrorToCrashlytics(err, "FirebaseContextInit");
        setError(err);
        setLoading(false);
        setRoutes([]);
      }
    })();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  return { routes, loading, error, hasInvalidGpx };
}

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const { routes, loading, error, hasInvalidGpx } = useFirestoreSnapshot();

  // Alert when invalid GPX detected (re-upload required)
  useEffect(() => {
    if (!hasInvalidGpx) return;
    if (typeof alert !== "undefined") {
      alert("GPX file error detected, re-upload required.");
    }
  }, [hasInvalidGpx]);

  const value: FirebaseContextValue = {
    routes,
    loading,
    error,
    hasInvalidGpx,
  };

  return (
    <FirebaseContext.Provider value={value}>
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebaseRoutes(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (ctx == null) {
    return {
      routes: [],
      loading: false,
      error: null,
      hasInvalidGpx: false,
    };
  }
  return ctx;
}
