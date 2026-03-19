/**
 * Dev-only status block for Extract: shows WS URL, backend health, optimizer health,
 * and a button to log full diagnostics.
 * Renders only when __DEV__ is true so production builds stay clean.
 */

import React, { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import {
  getExtractDiagnostics,
  logExtractDiagnostics,
  testBackendHealth,
  type BackendHealthResult,
} from "@/lib/extractDiagnostics";
import { healthCheck as optimizerHealthCheck } from "@/services/overtureOptimizerService";
import { useColors } from "@/hooks/use-colors";

export function ExtractConnectionStatus() {
  const colors = useColors();
  const [health, setHealth] = useState<BackendHealthResult | null>(null);
  const [optimizerOk, setOptimizerOk] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);

  const d = getExtractDiagnostics();

  const runHealthCheck = useCallback(async () => {
    setTesting(true);
    setHealth(null);
    setOptimizerOk(null);
    try {
      const [backendResult, optResult] = await Promise.all([
        testBackendHealth(),
        optimizerHealthCheck(),
      ]);
      setHealth(backendResult);
      setOptimizerOk(optResult);
      if (!backendResult.ok && typeof console !== "undefined") {
        console.warn("[Extract] Backend health check failed:", backendResult);
      }
      if (!optResult && typeof console !== "undefined") {
        console.warn("[Extract] Optimizer health check failed (unreachable or not configured)");
      }
    } finally {
      setTesting(false);
    }
  }, []);

  const copyDiagnostics = useCallback(() => {
    logExtractDiagnostics();
    const lines = [
      `WS: ${d.wsUrl}`,
      `HTTP: ${d.httpBase}`,
      `API: ${d.apiBase}`,
      health ? `Backend: ${health.ok ? "OK" : health.error ?? health.status}` : "Backend: not tested",
      optimizerOk != null ? `Optimizer: ${optimizerOk ? "OK" : "offline"}` : "Optimizer: not tested",
    ];
    if (typeof navigator?.clipboard?.writeText === "function") {
      navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
    }
  }, [d, health, optimizerOk]);

  if (typeof __DEV__ === "undefined" || !__DEV__) return null;

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.title, { color: colors.text }]}>🔧 Extract connection (dev)</Text>
      <Text style={[styles.url, { color: colors.muted }]} numberOfLines={2}>
        WS: {d.wsUrl}
      </Text>
      <Text style={[styles.url, { color: colors.muted }]} numberOfLines={1}>
        API: {d.apiBase}
      </Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: colors.primary + "22" }, testing && styles.btnDisabled]}
          onPress={runHealthCheck}
          disabled={testing}
        >
          <Text style={[styles.btnText, { color: colors.primary }]}>{testing ? "Checking…" : "Test connections"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, { backgroundColor: colors.muted + "44" }]} onPress={copyDiagnostics}>
          <Text style={[styles.btnText, { color: colors.text }]}>Log to console</Text>
        </TouchableOpacity>
      </View>
      {health != null && (
        <Text
          style={[
            styles.health,
            health.ok ? { color: "#16a34a" } : { color: "#dc2626" },
          ]}
          numberOfLines={2}
        >
          {health.ok
            ? `Backend OK (${health.status})`
            : `Backend: ${health.error ?? health.status ?? "failed"}`}
        </Text>
      )}
      {optimizerOk != null && (
        <Text
          style={[
            styles.health,
            optimizerOk ? { color: "#16a34a" } : { color: "#dc2626" },
          ]}
          numberOfLines={2}
        >
          {optimizerOk
            ? "Optimizer OK"
            : "Optimizer: offline (set OPTIMIZER_BACKEND_URL on server)"}
        </Text>
      )}
      <Text style={[styles.hint, { color: colors.muted }]} numberOfLines={3}>
        If extract fails: open DevTools → Console, look for "[Extract] Connection diagnostics", and follow the checklist.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  title: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  url: {
    fontSize: 11,
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
    marginBottom: 2,
    opacity: 0.9,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  btn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    fontSize: 11,
  },
  health: {
    fontSize: 11,
    marginTop: 6,
  },
  healthOk: {
    color: "#16a34a",
  },
  healthErr: {
    color: "#dc2626",
  },
  hint: {
    fontSize: 10,
    marginTop: 6,
    opacity: 0.8,
  },
});
