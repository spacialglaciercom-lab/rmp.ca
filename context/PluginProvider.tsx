"use client";

import React, { useEffect, useRef } from "react";
import { createPluginContext, loadAndRegisterPlugins } from "@/lib/plugins/load";
import { usePluginStore } from "@/stores/pluginStore";

interface PluginProviderProps {
  children: React.ReactNode;
  /** tRPC client from createTRPCClient() */
  trpcClient: unknown;
}

/**
 * Loads and registers plugins at startup and when user toggles plugins in settings.
 * Must be rendered inside providers that supply routing/map stores (e.g. after trpc.Provider).
 */
export function PluginProvider({ children, trpcClient }: PluginProviderProps) {
  const enabledPlugins = usePluginStore((s) => s.enabledPlugins);
  const contextRef = useRef<ReturnType<typeof createPluginContext> | null>(null);

  useEffect(() => {
    if (!contextRef.current) {
      contextRef.current = createPluginContext(trpcClient);
    }
    const ctx = contextRef.current;
    loadAndRegisterPlugins(ctx).catch((err) => {
      console.warn("Plugin load failed:", err);
    });
  }, [trpcClient, enabledPlugins]);

  return <>{children}</>;
}
