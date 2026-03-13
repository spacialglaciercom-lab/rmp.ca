/**
 * Extract connection diagnostics for debugging.
 * Logs clear messages in the console and provides status for the Extract UI.
 * Use when extract WebSocket fails or to verify backend/extract setup.
 */

import { Platform } from "react-native";
import { getExtractConfig } from "@/lib/overtureExtractService";
import { getApiBaseUrl } from "@/shared/oauth";

export interface ExtractDiagnostics {
  wsUrl: string;
  httpBase: string;
  apiBase: string;
  platform: string;
  /** Short explanation of how URLs were chosen */
  source: string;
  /** Checklist for the user when connection fails */
  checklist: string[];
}

export function getExtractDiagnostics(): ExtractDiagnostics {
  const { wsUrl, httpBase } = getExtractConfig();
  const apiBase = getApiBaseUrl();
  const isWeb = Platform.OS === "web";
  const usingProxy = isWeb && wsUrl.replace(/^wss?:\/\//, "").split("/")[0] !== "localhost:9000";

  const source = usingProxy
    ? "Web: using API proxy (same-origin). Backend must proxy /ws/extract and /geojson/:hash to extract service."
    : "Direct to extract service (EXPO_PUBLIC_OVERTURE_EXTRACT_URL or default localhost:9000).";

  const checklist: string[] = [];
  if (usingProxy) {
    checklist.push("Is the backend running? (e.g. pnpm run dev:server or Docker backend on port 3000)");
    checklist.push("Is EXTRACT_WS_UPSTREAM set on the backend? (e.g. http://localhost:9000 or http://extract:4000 in Docker)");
    checklist.push("Is the extract service running? (pnpm run dev:extract → port 9000, or Docker extract container on 4000)");
  } else {
    checklist.push("Is the extract service running? (pnpm run dev:extract on port 9000)");
  }
  checklist.push("DevTools → Network → filter WS or XHR, retry extract, and inspect the failing request.");

  return {
    wsUrl,
    httpBase,
    apiBase,
    platform: Platform.OS,
    source,
    checklist,
  };
}

const CONSOLE_GROUP = "[Extract] Connection diagnostics";

/** Log a clear diagnostics block to the console (dev only). Call when starting extract or when connection fails. */
export function logExtractDiagnostics(): void {
  if (typeof __DEV__ !== "undefined" && !__DEV__) return;
  const d = getExtractDiagnostics();
  if (typeof console.group === "function") {
    console.group(CONSOLE_GROUP);
  } else {
    console.log(`\n========== ${CONSOLE_GROUP} ==========`);
  }
  console.log("WebSocket URL:", d.wsUrl);
  console.log("HTTP base (GeoJSON/download):", d.httpBase);
  console.log("API base:", d.apiBase);
  console.log("Platform:", d.platform);
  console.log("Source:", d.source);
  console.log("If connection fails:");
  d.checklist.forEach((line, i) => console.log(`  ${i + 1}. ${line}`));
  console.log("  → See .env.example for EXTRACT_WS_UPSTREAM and EXPO_PUBLIC_* extract URLs.");
  if (typeof console.groupEnd === "function") {
    console.groupEnd();
  } else {
    console.log("==========================================\n");
  }
}

/** Result of pinging the backend health endpoint */
export interface BackendHealthResult {
  ok: boolean;
  status?: number;
  error?: string;
  url?: string;
}

/** Test if the backend is reachable (GET apiBase/api/health). */
export async function testBackendHealth(): Promise<BackendHealthResult> {
  const apiBase = getApiBaseUrl();
  const url = `${apiBase.replace(/\/$/, "")}/api/health`;
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
    return {
      ok: res.ok,
      status: res.status,
      url,
      ...(res.ok ? {} : { error: await res.text().catch(() => res.statusText) }),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message, url };
  }
}

/** Build a user-facing error message that includes the WS URL and a short hint. */
export function formatExtractConnectionError(wsUrl: string, closeCode?: number): string {
  const codeHint = closeCode === 1006
    ? " (connection failed or closed abnormally — often backend not running or extract proxy misconfigured)"
    : closeCode != null
      ? ` (code ${closeCode})`
      : "";
  return `Extract connection failed${codeHint}. WebSocket: ${wsUrl}. Open the browser console and look for "[Extract] Connection diagnostics" for a checklist.`;
}
