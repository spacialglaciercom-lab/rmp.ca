/**
 * Offline map download — Overture Maps transportation data from public AWS S3.
 * Native only (iOS/Android). Web hides this section.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { confirmDestructive } from "@/lib/confirmDestructive";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  OFFLINE_CITIES,
  getDownloadedRegions,
  downloadCityData,
  downloadCityFromR2,
  deleteDownloadedRegion,
  formatBytes,
  type OfflineCity,
  type DownloadedRegion,
  type DownloadSource,
} from "@/lib/offline-map-download";

const SOURCE_STORAGE_KEY = "trashroute_offline_source";

export const OfflineMapDownloadSection: React.FC = () => {
  const colors = useColors();
  const [downloaded, setDownloaded] = useState<DownloadedRegion[]>([]);
  const [search, setSearch] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const [source, setSource] = useState<DownloadSource>("r2");
  const abortRef = React.useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const regions = await getDownloadedRegions();
    setDownloaded(regions);
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    refresh();
    AsyncStorage.getItem(SOURCE_STORAGE_KEY).then((v) => {
      if (v === "r2" || v === "s3") setSource(v);
    });
  }, [refresh]);

  const handleSourceChange = useCallback((s: DownloadSource) => {
    setSource(s);
    AsyncStorage.setItem(SOURCE_STORAGE_KEY, s);
  }, []);

  const filteredCities = OFFLINE_CITIES.filter((c) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q);
  });

  const handleDownload = useCallback(
    async (city: OfflineCity) => {
      if (Platform.OS === "web") return;
      hapticImpact();
      const already = downloaded.find((r) => r.id === city.id);
      if (already) {
        Alert.alert(
          "Already downloaded",
          `${city.name} is already downloaded (${formatBytes(already.sizeBytes)}). Delete it first to re-download.`
        );
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setDownloadingId(city.id);
      setDownloadProgress({ done: 0, total: 1, phase: "Starting…" });
      try {
        const downloadFn = source === "r2" ? downloadCityFromR2 : downloadCityData;
        const result = await downloadFn(
          city,
          (done, total, phase) => { setDownloadProgress({ done, total, phase }); },
          controller.signal
        );
        setDownloadProgress(null);
        if (result.success) {
          await refresh();
          Alert.alert(
            "Done",
            `Downloaded ${result.fileCount} files (${formatBytes(result.sizeBytes)}) for ${city.name}.`
          );
        } else {
          Alert.alert("Info", result.error ?? "Download failed. Try again.");
        }
      } catch (e) {
        setDownloadProgress(null);
        Alert.alert("Error", e instanceof Error ? e.message : "Download failed.");
      } finally {
        abortRef.current = null;
        setDownloadingId(null);
      }
    },
    [downloaded, refresh, source]
  );

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleDelete = useCallback(
    (region: DownloadedRegion) => {
      if (Platform.OS === "web") return;
      hapticImpact();
      confirmDestructive(
        "Delete map data",
        `Remove ${region.name} (${region.fileCount} files, ${formatBytes(region.sizeBytes)})?`,
        async () => {
          await deleteDownloadedRegion(region.id);
          await refresh();
        }
      );
    },
    [refresh]
  );

  if (Platform.OS === "web") return null;

  return (
    <View style={{ paddingVertical: 4 }}>
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>
        Download Overture Maps data for offline routing. Choose R2 Tiles (recommended, small pre-built files) or S3 Parquet (raw global data).
      </Text>

      {/* Source toggle */}
      <View style={{ flexDirection: "row", marginBottom: 14, gap: 8 }}>
        {(["r2", "s3"] as const).map((s) => {
          const active = source === s;
          const label = s === "r2" ? "R2 Tiles (Recommended)" : "S3 Parquet";
          return (
            <TouchableOpacity
              key={s}
              onPress={() => handleSourceChange(s)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primary + "18" : colors.surface,
                alignItems: "center",
              }}
            >
              <Text style={{
                fontSize: 13,
                fontWeight: active ? "600" : "400",
                color: active ? colors.primary : colors.muted,
              }}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {downloaded.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8 }}>
            Downloaded
          </Text>
          {downloaded.map((r) => (
            <View
              key={r.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 10,
                paddingHorizontal: 12,
                backgroundColor: colors.surface,
                borderRadius: 8,
                marginBottom: 6,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 15, fontWeight: "500", color: colors.foreground }}>{r.name}</Text>
                  {r.source && (
                    <View style={{
                      paddingHorizontal: 5,
                      paddingVertical: 1,
                      borderRadius: 4,
                      backgroundColor: r.source === "r2" ? colors.primary + "20" : "#f5920020",
                    }}>
                      <Text style={{
                        fontSize: 10,
                        fontWeight: "700",
                        color: r.source === "r2" ? colors.primary : "#f59200",
                      }}>
                        {r.source.toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 12, color: colors.muted }}>
                  {r.fileCount} {r.fileCount === 1 ? "file" : "files"} · {formatBytes(r.sizeBytes)} · {r.country}
                </Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>
                  {(r.layers ?? []).join(", ")}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleDelete(r)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: colors.error + "30",
                }}
              >
                <Text style={{ fontSize: 13, color: colors.error, fontWeight: "600" }}>Delete</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8 }}>
        Regions to download
      </Text>
      <TextInput
        placeholder="Search city..."
        placeholderTextColor={colors.muted}
        value={search}
        onChangeText={setSearch}
        style={{
          fontSize: 15,
          color: colors.foreground,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          marginBottom: 12,
        }}
      />

      <View>
        {filteredCities.map((city) => {
          const isDownloaded = downloaded.some((r) => r.id === city.id);
          const isDownloading = downloadingId === city.id;
          return (
            <View
              key={city.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 10,
                paddingHorizontal: 12,
                backgroundColor: colors.surface,
                borderRadius: 8,
                marginBottom: 6,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <View>
                <Text style={{ fontSize: 15, fontWeight: "500", color: colors.foreground }}>{city.name}</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>{city.country}</Text>
              </View>
              {isDownloading ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {downloadProgress && (
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>
                        {downloadProgress.done}/{downloadProgress.total}
                      </Text>
                      <Text style={{ fontSize: 10, color: colors.muted }}>
                        {downloadProgress.phase}
                      </Text>
                    </View>
                  )}
                  <ActivityIndicator size="small" color={colors.primary} />
                  <TouchableOpacity
                    onPress={handleCancel}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 6,
                      backgroundColor: colors.error + "30",
                    }}
                  >
                    <Text style={{ fontSize: 11, color: colors.error, fontWeight: "600" }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : isDownloaded ? (
                <Text style={{ fontSize: 13, color: colors.success, fontWeight: "500" }}>Downloaded</Text>
              ) : (
                <TouchableOpacity
                  onPress={() => handleDownload(city)}
                  disabled={!!downloadingId}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 8,
                    backgroundColor: colors.primary,
                  }}
                >
                  <Text style={{ fontSize: 13, color: "#fff", fontWeight: "600" }}>Download</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
};
