/**
 * Sheet for creating a delivery zone partition directly from the Zones page.
 * User pastes or types polygon coordinates, configures truck count + balance metric,
 * then runs partitionZonesByPolygon (single backend call: extract roads + cluster).
 */
import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { BottomSheet } from "@/components/shared/BottomSheet";
import {
  partitionZonesByPolygon,
  type ZoneOutput,
} from "@/services/overtureOptimizerService";

// ---------------------------------------------------------------------------
// Coordinate parsing
// ---------------------------------------------------------------------------

function parseCoords(raw: string): { points: Array<[number, number]>; error: string | null } {
  const s = raw.trim();
  if (!s) return { points: [], error: null };

  // Try JSON array first: [[lat,lon],...] or [[lon,lat],...] — we assume [lat,lon]
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (!Array.isArray(parsed)) return { points: [], error: "Expected a JSON array." };
      const points: Array<[number, number]> = [];
      for (const item of parsed) {
        if (!Array.isArray(item) || item.length < 2) {
          return { points: [], error: "Each entry must be [lat, lon]." };
        }
        const lat = Number(item[0]);
        const lon = Number(item[1]);
        if (!isFinite(lat) || !isFinite(lon)) {
          return { points: [], error: `Invalid coordinate: [${item[0]}, ${item[1]}]` };
        }
        if (lat < -90 || lat > 90) return { points: [], error: `Latitude ${lat} out of range (-90 to 90).` };
        if (lon < -180 || lon > 180) return { points: [], error: `Longitude ${lon} out of range (-180 to 180).` };
        points.push([lat, lon]);
      }
      return { points, error: null };
    } catch {
      return { points: [], error: "Invalid JSON. Expected [[lat,lon],[lat,lon],...]" };
    }
  }

  // Try one lat,lon pair per line
  const lines = s.split(/\r?\n/).filter((l) => l.trim());
  const points: Array<[number, number]> = [];
  for (const line of lines) {
    const parts = line.trim().split(/[\s,]+/);
    if (parts.length < 2) return { points: [], error: `Cannot parse line: "${line}"` };
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (!isFinite(lat) || !isFinite(lon)) return { points: [], error: `Invalid numbers on line: "${line}"` };
    if (lat < -90 || lat > 90) return { points: [], error: `Latitude ${lat} out of range.` };
    if (lon < -180 || lon > 180) return { points: [], error: `Longitude ${lon} out of range.` };
    points.push([lat, lon]);
  }
  return { points, error: null };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: (
    zones: ZoneOutput[],
    polygon: Array<[number, number]>,
    name: string,
    truck_count: number,
    balance_metric: "time" | "distance",
  ) => void;
}

export function DeliveryZonePartitionSheet({ visible, onClose, onSuccess }: Props) {
  const colors = useColors();

  const [coordsText, setCoordsText] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [truckCount, setTruckCount] = useState(2);
  const [balanceMetric, setBalanceMetric] = useState<"time" | "distance">("time");
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const { points, error: parseError } = useMemo(() => parseCoords(coordsText), [coordsText]);

  const canRun = points.length >= 3 && !loading;

  const handleClose = useCallback(() => {
    if (loading) return;
    onClose();
  }, [loading, onClose]);

  const handleRun = useCallback(async () => {
    if (!canRun) return;
    hapticImpact();
    setApiError(null);
    setLoading(true);
    try {
      const { zones } = await partitionZonesByPolygon({
        polygon: points,
        truck_count: truckCount,
        balance_metric: balanceMetric,
      });
      const name = zoneName.trim() || `Delivery zones (${new Date().toLocaleDateString()})`;
      onSuccess(zones, points, name, truckCount, balanceMetric);
      // Reset form
      setCoordsText("");
      setZoneName("");
      setTruckCount(2);
      setBalanceMetric("time");
    } catch (e: unknown) {
      setApiError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [canRun, points, truckCount, balanceMetric, zoneName, onSuccess]);

  const adjustTruckCount = useCallback((delta: number) => {
    hapticImpact();
    setTruckCount((n) => Math.min(12, Math.max(1, n + delta)));
  }, []);

  return (
    <BottomSheet visible={visible} onClose={handleClose} title="New zone partition" maxHeight="85%">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ---- Coordinates ---- */}
        <Text style={[styles.label, { color: colors.text }]}>Polygon coordinates</Text>
        <Text style={[styles.hint, { color: colors.muted }]}>
          JSON array: {`[[lat,lon],[lat,lon],...]`} — or one lat,lon per line
        </Text>
        <TextInput
          style={[
            styles.coordsInput,
            {
              color: colors.text,
              backgroundColor: colors.surface,
              borderColor: parseError ? "#ef4444" : colors.border,
            },
          ]}
          value={coordsText}
          onChangeText={(t) => { setCoordsText(t); setApiError(null); }}
          placeholder={"[[45.50,-73.60],[45.51,-73.60],[45.51,-73.58]]"}
          placeholderTextColor={colors.muted}
          multiline
          numberOfLines={5}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {parseError ? (
          <Text style={styles.parseError}>{parseError}</Text>
        ) : points.length > 0 ? (
          <Text style={[styles.parseOk, { color: colors.muted }]}>
            ✓ {points.length} point{points.length !== 1 ? "s" : ""} parsed
            {points.length < 3 ? " — need at least 3" : ""}
          </Text>
        ) : null}

        {/* ---- Zone name ---- */}
        <Text style={[styles.label, { color: colors.text, marginTop: 16 }]}>Zone name (optional)</Text>
        <TextInput
          style={[
            styles.nameInput,
            { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          value={zoneName}
          onChangeText={setZoneName}
          placeholder="e.g. Downtown delivery"
          placeholderTextColor={colors.muted}
        />

        {/* ---- Truck count ---- */}
        <Text style={[styles.label, { color: colors.text, marginTop: 16 }]}>Number of trucks</Text>
        <View style={styles.stepper}>
          <TouchableOpacity
            onPress={() => adjustTruckCount(-1)}
            style={[styles.stepBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            disabled={truckCount <= 1}
          >
            <Text style={[styles.stepBtnText, { color: truckCount <= 1 ? colors.muted : colors.text }]}>−</Text>
          </TouchableOpacity>
          <Text style={[styles.stepValue, { color: colors.text }]}>{truckCount}</Text>
          <TouchableOpacity
            onPress={() => adjustTruckCount(1)}
            style={[styles.stepBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            disabled={truckCount >= 12}
          >
            <Text style={[styles.stepBtnText, { color: truckCount >= 12 ? colors.muted : colors.text }]}>＋</Text>
          </TouchableOpacity>
        </View>

        {/* ---- Balance metric ---- */}
        <Text style={[styles.label, { color: colors.text, marginTop: 16 }]}>Balance metric</Text>
        <View style={[styles.metricToggle, { borderColor: colors.border, backgroundColor: colors.background }]}>
          {(["time", "distance"] as const).map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => { hapticImpact(); setBalanceMetric(m); }}
              style={[
                styles.metricBtn,
                balanceMetric === m && { backgroundColor: colors.primary },
              ]}
            >
              <Text style={[styles.metricBtnText, { color: balanceMetric === m ? "#fff" : colors.muted }]}>
                {m === "time" ? "Time" : "Distance"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ---- API error ---- */}
        {apiError ? (
          <View style={[styles.errorBanner, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
            <Text style={styles.errorBannerText}>{apiError}</Text>
          </View>
        ) : null}

        {/* ---- Run button ---- */}
        <TouchableOpacity
          onPress={handleRun}
          disabled={!canRun}
          style={[
            styles.runBtn,
            { backgroundColor: canRun ? colors.primary : colors.border },
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.runBtnText}>Run Partition</Text>
          )}
        </TouchableOpacity>
        {loading && (
          <Text style={[styles.loadingHint, { color: colors.muted }]}>
            Extracting roads and partitioning — this may take up to 2 minutes…
          </Text>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
  hint: { fontSize: 12, marginBottom: 8 },
  coordsInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 12,
    fontFamily: "monospace",
    minHeight: 100,
    textAlignVertical: "top",
  },
  parseError: { color: "#ef4444", fontSize: 12, marginTop: 4 },
  parseOk: { fontSize: 12, marginTop: 4 },
  nameInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { fontSize: 20, lineHeight: 24 },
  stepValue: { fontSize: 18, fontWeight: "600", minWidth: 28, textAlign: "center" },
  metricToggle: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  metricBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
  },
  metricBtnText: { fontSize: 14, fontWeight: "500" },
  errorBanner: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  errorBannerText: { color: "#b91c1c", fontSize: 13 },
  runBtn: {
    marginTop: 20,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  runBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  loadingHint: { textAlign: "center", fontSize: 12, marginTop: 8 },
});
