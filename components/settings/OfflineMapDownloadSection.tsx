/**
 * Offline map download — Overture (R2/S3), MapLibre tile packs, and OSM PBF.
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
import { useTheme } from "@/lib/theme-provider";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { confirmDestructive } from "@/lib/confirmDestructive";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  OFFLINE_CITIES,
  getDownloadedRegions,
  downloadCityData,
  downloadCityFromR2,
  downloadOSMPBF,
  deleteDownloadedRegion,
  createMapLibrePack,
  getMapLibrePacks,
  deleteMapLibrePack,
  formatBytes,
  type OfflineCity,
  type DownloadedRegion,
  type DownloadSource,
  type MapLibrePackInfo,
} from "@/lib/offline-map-download";
import { MAPLIBRE_STYLE_OSM, MAPLIBRE_STYLE_OSM_DARK } from "@/components/maplibre/constants";

const SOURCE_STORAGE_KEY = "trashroute_offline_source";

type OfflineSourceUI = DownloadSource | "maplibre_pack";

export const OfflineMapDownloadSection: React.FC = () => {
  const colors = useColors();
  const { colorScheme } = useTheme();
  const [downloaded, setDownloaded] = useState<DownloadedRegion[]>([]);
  const [packs, setPacks] = useState<MapLibrePackInfo[]>([]);
  const [search, setSearch] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const [packProgress, setPackProgress] = useState<number | null>(null);
  const [source, setSource] = useState<OfflineSourceUI>("r2");
  const abortRef = React.useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const [regions, packList] = await Promise.all([getDownloadedRegions(), getMapLibrePacks()]);
    setDownloaded(regions);
    setPacks(packList);
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    refresh();
    AsyncStorage.getItem(SOURCE_STORAGE_KEY).then((v) => {
      if (v === "r2" || v === "s3" || v === "osm_pbf" || v === "maplibre_pack") setSource(v);
    });
  }, [refresh]);

  const handleSourceChange = useCallback((s: OfflineSourceUI) => {
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

      if (source === "maplibre_pack") {
        const packName = `pack_${city.id}`;
        if (packs.some((p) => p.name === packName)) {
          Alert.alert("Already downloaded", `${city.name} map tiles are already downloaded. Delete the pack first to re-download.`);
          return;
        }
        setDownloadingId(city.id);
        setPackProgress(0);
        const styleURL = colorScheme === "dark" ? MAPLIBRE_STYLE_OSM_DARK : MAPLIBRE_STYLE_OSM;
        try {
          await createMapLibrePack(
            city,
            styleURL,
            10,
            16,
            (p) => setPackProgress(p.percentage),
            (err) => {
              setPackProgress(null);
              setDownloadingId(null);
              Alert.alert("Error", err instanceof Error ? err.message : "Download failed.");
            }
          );
          setPackProgress(null);
          await refresh();
          Alert.alert("Done", `Offline map tiles for ${city.name} are ready.`);
        } catch (e) {
          setPackProgress(null);
          Alert.alert("Error", e instanceof Error ? e.message : "Download failed.");
        } finally {
          setDownloadingId(null);
        }
        return;
      }

      if (source === "osm_pbf") {
        const already = downloaded.some((r) => r.source === "osm_pbf" && (r.cityId === city.id || r.id === `${city.id}_osm_pbf`));
        if (already) {
          Alert.alert("Already downloaded", `OSM data for ${city.name} is already downloaded. Delete it first to re-download.`);
          return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setDownloadingId(city.id);
        setDownloadProgress({ done: 0, total: 1, phase: "Requesting OSM data…" });
        try {
          await downloadOSMPBF(
            city,
            (done, total, phase) => setDownloadProgress({ done, total, phase }),
            controller.signal
          );
          setDownloadProgress(null);
          await refresh();
          Alert.alert("Done", `OSM data for ${city.name} downloaded for offline routing.`);
        } catch (e) {
          setDownloadProgress(null);
          Alert.alert("Error", e instanceof Error ? e.message : "Download failed.");
        } finally {
          abortRef.current = null;
          setDownloadingId(null);
        }
        return;
      }

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
    [downloaded, packs, refresh, source, colorScheme]
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

  const handleDeletePack = useCallback(
    (pack: MapLibrePackInfo) => {
      if (Platform.OS === "web") return;
      hapticImpact();
      const cityName = pack.name.startsWith("pack_") ? OFFLINE_CITIES.find((c) => `pack_${c.id}` === pack.name)?.name ?? pack.name : pack.name;
      confirmDestructive(
        "Delete map tiles",
        `Remove offline map tiles for ${cityName}?`,
        async () => {
          await deleteMapLibrePack(pack.name);
          await refresh();
        }
      );
    },
    [refresh]
  );

  if (Platform.OS === "web") return null;

  const sourceOptions: { value: OfflineSourceUI; label: string }[] = [
    { value: "r2", label: "R2 Tiles" },
    { value: "s3", label: "S3 Parquet" },
    { value: "maplibre_pack", label: "Map tiles" },
    { value: "osm_pbf", label: "OSM PBF" },
  ];

  return (
    <View style={{ paddingVertical: 4 }}>
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>
        Download region for offline: R2/S3 (Overture routing), Map tiles (offline viewing), or OSM PBF (offline routing).
      </Text>

      {/* Source toggle */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 14, gap: 8 }}>
        {sourceOptions.map(({ value: s, label }) => {
          const active = source === s;
          return (
            <TouchableOpacity
              key={s}
              onPress={() => handleSourceChange(s)}
              style={{
                minWidth: "47%",
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
                fontSize: 12,
                fontWeight: active ? "600" : "400",
                color: active ? colors.primary : colors.muted,
              }}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {(downloaded.length > 0 || packs.length > 0) && (
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
                      backgroundColor: r.source === "r2" ? colors.primary + "20" : r.source === "osm_pbf" ? "#0ea5e920" : "#f5920020",
                    }}>
                      <Text style={{
                        fontSize: 10,
                        fontWeight: "700",
                        color: r.source === "r2" ? colors.primary : r.source === "osm_pbf" ? "#0ea5e9" : "#f59200",
                      }}>
                        {r.source === "osm_pbf" ? "OSM PBF" : r.source.toUpperCase()}
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
          {packs.map((pack) => {
            const cityName = pack.name.startsWith("pack_")
              ? OFFLINE_CITIES.find((c) => `pack_${c.id}` === pack.name)?.name ?? pack.name
              : pack.name;
            return (
              <View
                key={pack.name}
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
                    <Text style={{ fontSize: 15, fontWeight: "500", color: colors.foreground }}>{cityName}</Text>
                    <View style={{
                      paddingHorizontal: 5,
                      paddingVertical: 1,
                      borderRadius: 4,
                      backgroundColor: colors.primary + "20",
                    }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: colors.primary }}>
                        MAP TILES
                      </Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 12, color: colors.muted }}>Offline map tiles</Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDeletePack(pack)}
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
            );
          })}
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
          const isDownloaded =
            source === "maplibre_pack"
              ? packs.some((p) => p.name === `pack_${city.id}`)
              : source === "osm_pbf"
                ? downloaded.some((r) => r.source === "osm_pbf" && (r.cityId === city.id || r.id === `${city.id}_osm_pbf`))
                : downloaded.some((r) => r.id === city.id);
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
                  {source === "maplibre_pack" && packProgress != null ? (
                    <Text style={{ fontSize: 12, color: colors.muted }}>{packProgress}%</Text>
                  ) : downloadProgress ? (
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>
                        {downloadProgress.done}/{downloadProgress.total}
                      </Text>
                      <Text style={{ fontSize: 10, color: colors.muted }}>
                        {downloadProgress.phase}
                      </Text>
                    </View>
                  ) : null}
                  <ActivityIndicator size="small" color={colors.primary} />
                  {source !== "maplibre_pack" && (
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
                  )}
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
