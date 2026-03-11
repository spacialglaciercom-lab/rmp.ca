/**
 * Custom bounding-box region download.
 * Lets the user enter lat/lon coordinates and download only the tiles they need
 * from the R2 PMTiles file via HTTP Range requests.
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { confirmDestructive } from "@/lib/confirmDestructive";
import { getDownloadedRegions, type DownloadedRegion } from "@/lib/offline-map-download";
import {
  estimateBboxDownload,
  downloadBboxRegion,
  deleteBboxRegion,
  BBOX_PRESETS,
  type BboxDownloadEstimate,
} from "@/lib/bbox-region-download";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

interface CoordFields {
  minLat: string;
  maxLat: string;
  minLon: string;
  maxLon: string;
}

const EMPTY_COORDS: CoordFields = { minLat: "", maxLat: "", minLon: "", maxLon: "" };

export const BboxRegionDownloadSection: React.FC = () => {
  const colors = useColors();
  const [name, setName] = useState("");
  const [coords, setCoords] = useState<CoordFields>(EMPTY_COORDS);
  const [estimate, setEstimate] = useState<BboxDownloadEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const [regions, setRegions] = useState<DownloadedRegion[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const refreshRegions = useCallback(async () => {
    const all = await getDownloadedRegions();
    setRegions(all.filter((r) => r.source === "r2_bbox"));
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    refreshRegions();
  }, [refreshRegions]);

  const parseBbox = useCallback(() => {
    const minLat = parseFloat(coords.minLat);
    const maxLat = parseFloat(coords.maxLat);
    const minLon = parseFloat(coords.minLon);
    const maxLon = parseFloat(coords.maxLon);
    if ([minLat, maxLat, minLon, maxLon].some(isNaN)) return null;
    if (minLat >= maxLat || minLon >= maxLon) return null;
    if (Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) return null;
    if (Math.abs(minLon) > 180 || Math.abs(maxLon) > 180) return null;
    return { minLat, maxLat, minLon, maxLon };
  }, [coords]);

  const handleEstimate = useCallback(() => {
    const bbox = parseBbox();
    if (!bbox) {
      setEstimateError("Enter valid coordinates first (minLat < maxLat, minLon < maxLon).");
      setEstimate(null);
      return;
    }
    setEstimateError(null);
    const est = estimateBboxDownload(bbox);
    setEstimate(est);
  }, [parseBbox]);

  const handlePreset = useCallback((preset: typeof BBOX_PRESETS[0]) => {
    hapticImpact();
    setCoords({
      minLat: String(preset.bbox.minLat),
      maxLat: String(preset.bbox.maxLat),
      minLon: String(preset.bbox.minLon),
      maxLon: String(preset.bbox.maxLon),
    });
    setName(preset.label);
    setEstimate(null);
    setEstimateError(null);
  }, []);

  const handleDownload = useCallback(async () => {
    const bbox = parseBbox();
    if (!bbox) {
      Alert.alert("Invalid coordinates", "Check that minLat < maxLat and minLon < maxLon.");
      return;
    }
    const regionName = name.trim() || `Region ${new Date().toLocaleDateString()}`;

    hapticImpact();
    setDownloading(true);
    setProgress({ done: 0, total: 1, phase: "Starting…" });

    const controller = new AbortController();
    abortRef.current = controller;

    const result = await downloadBboxRegion(
      regionName,
      bbox,
      (done, total, phase) => setProgress({ done, total, phase }),
      controller.signal,
    );

    abortRef.current = null;
    setDownloading(false);
    setProgress(null);

    if (result.success) {
      setCoords(EMPTY_COORDS);
      setName("");
      setEstimate(null);
      await refreshRegions();
      Alert.alert(
        "Download complete",
        `${result.tileCount} tiles saved (${formatBytes(result.sizeBytes)}).\nThis region is now available for offline route extraction.`,
      );
    } else if (result.error !== "Cancelled") {
      Alert.alert("Download failed", result.error ?? "Unknown error");
    }
  }, [parseBbox, name, refreshRegions]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleDelete = useCallback(async (region: DownloadedRegion) => {
    const confirmed = await confirmDestructive(
      `Delete "${region.name}"?`,
      "This will remove the downloaded tiles from your device.",
      "Delete",
    );
    if (!confirmed) return;
    await deleteBboxRegion(region.id);
    await refreshRegions();
  }, [refreshRegions]);

  if (Platform.OS === "web") return null;

  const bbox = parseBbox();
  const canDownload = !!bbox && !downloading;

  return (
    <View>
      {/* Presets */}
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>
        Quick-select a neighbourhood or enter custom coordinates below.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: "row", gap: 8, paddingRight: 4 }}>
          {BBOX_PRESETS.map((p) => (
            <TouchableOpacity
              key={p.label}
              onPress={() => handlePreset(p)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 20,
                backgroundColor: colors.primary + "22",
                borderWidth: 1,
                borderColor: colors.primary + "55",
              }}
            >
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "500" }}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Name */}
      <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>Region name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Plateau sector A"
        placeholderTextColor={colors.muted}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          color: colors.foreground,
          fontSize: 14,
          marginBottom: 12,
          backgroundColor: colors.surface,
        }}
      />

      {/* Coordinate grid */}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 3 }}>Min Lat (S)</Text>
          <TextInput
            value={coords.minLat}
            onChangeText={(v) => setCoords((c) => ({ ...c, minLat: v }))}
            placeholder="45.514"
            keyboardType="decimal-pad"
            placeholderTextColor={colors.muted}
            style={inputStyle(colors)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 3 }}>Max Lat (N)</Text>
          <TextInput
            value={coords.maxLat}
            onChangeText={(v) => setCoords((c) => ({ ...c, maxLat: v }))}
            placeholder="45.535"
            keyboardType="decimal-pad"
            placeholderTextColor={colors.muted}
            style={inputStyle(colors)}
          />
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 3 }}>Min Lon (W)</Text>
          <TextInput
            value={coords.minLon}
            onChangeText={(v) => setCoords((c) => ({ ...c, minLon: v }))}
            placeholder="-73.582"
            keyboardType="decimal-pad"
            placeholderTextColor={colors.muted}
            style={inputStyle(colors)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 3 }}>Max Lon (E)</Text>
          <TextInput
            value={coords.maxLon}
            onChangeText={(v) => setCoords((c) => ({ ...c, maxLon: v }))}
            placeholder="-73.548"
            keyboardType="decimal-pad"
            placeholderTextColor={colors.muted}
            style={inputStyle(colors)}
          />
        </View>
      </View>

      {/* Estimate */}
      <TouchableOpacity
        onPress={handleEstimate}
        disabled={!bbox}
        style={{
          paddingVertical: 8,
          paddingHorizontal: 16,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: bbox ? colors.primary : colors.border,
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <Text style={{ fontSize: 13, color: bbox ? colors.primary : colors.muted }}>
          Estimate size
        </Text>
      </TouchableOpacity>

      {estimateError && (
        <Text style={{ fontSize: 12, color: colors.error, marginBottom: 8 }}>{estimateError}</Text>
      )}
      {estimate && !estimateError && (
        <View
          style={{
            padding: 10,
            borderRadius: 8,
            backgroundColor: colors.primary + "15",
            marginBottom: 12,
          }}
        >
          <Text style={{ fontSize: 13, color: colors.foreground }}>
            ~{estimate.tileCount} tiles · ~{formatBytes(estimate.estimatedBytes)} · zoom {estimate.zoom[0]}–{estimate.zoom[1]}
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
            Fetched via HTTP range requests — only these tiles are downloaded.
          </Text>
        </View>
      )}

      {/* Progress */}
      {downloading && progress && (
        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
            <Text style={{ fontSize: 12, color: colors.muted, flex: 1 }}>{progress.phase}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {progress.done}/{progress.total}
            </Text>
          </View>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" }}>
            <View
              style={{
                height: "100%",
                borderRadius: 2,
                backgroundColor: colors.primary,
                width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
              }}
            />
          </View>
        </View>
      )}

      {/* Download / Cancel */}
      {downloading ? (
        <TouchableOpacity
          onPress={handleCancel}
          style={{
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: "center",
            backgroundColor: colors.error + "22",
            borderWidth: 1,
            borderColor: colors.error,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: colors.error, fontWeight: "600" }}>Cancel download</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={handleDownload}
          disabled={!canDownload}
          style={{
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: "center",
            backgroundColor: canDownload ? colors.primary : colors.muted + "40",
            marginBottom: 16,
          }}
        >
          {downloading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 15 }}>
              Download region
            </Text>
          )}
        </TouchableOpacity>
      )}

      {/* Downloaded regions list */}
      {regions.length > 0 && (
        <View>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 8 }}>
            Downloaded regions ({regions.length})
          </Text>
          {regions.map((r) => (
            <View
              key={r.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 10,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "500" }}>
                  {r.name}
                </Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                  {r.fileCount} tiles · {formatBytes(r.sizeBytes)} · {formatDate(r.downloadedAt)}
                </Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>
                  {r.bounds.minLat.toFixed(4)},{r.bounds.minLon.toFixed(4)} →{" "}
                  {r.bounds.maxLat.toFixed(4)},{r.bounds.maxLon.toFixed(4)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleDelete(r)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: colors.error + "18",
                }}
              >
                <Text style={{ fontSize: 12, color: colors.error }}>Delete</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

function inputStyle(colors: ReturnType<typeof useColors>) {
  return {
    borderWidth: 1 as const,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.foreground,
    fontSize: 13,
    backgroundColor: colors.surface,
  };
}
