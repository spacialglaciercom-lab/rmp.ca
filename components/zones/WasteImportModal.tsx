/**
 * Import waste points from CSV or GeoJSON. Optional geocode step for rows with address only.
 */
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useColors } from "@/hooks/use-colors";
import { parseWasteFile, type WasteImportRow } from "@/lib/waste-import";
import { searchAddress } from "@/lib/geocode";
import { readFileAsText } from "@/lib/readFileAsText";

interface WasteImportModalProps {
  visible: boolean;
  onClose: () => void;
  onImport: (rows: WasteImportRow[]) => void;
}

const NOMINATIM_RATE_MS = 1100;
const MAX_PREVIEW_ROWS = 5;

export function WasteImportModal({ visible, onClose, onImport }: WasteImportModalProps) {
  const colors = useColors();
  const [rows, setRows] = useState<WasteImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const needGeocode = rows.filter((r) => (r.lat == null || r.lon == null) && r.address?.trim()).length;
  const readyCount = rows.filter((r) => r.lat != null && r.lon != null && !Number.isNaN(r.lat) && !Number.isNaN(r.lon)).length;
  const invalidCount = rows.length - readyCount - needGeocode;

  const processFileContent = useCallback((text: string, name: string) => {
    const parsed = parseWasteFile(text, name);
    if (parsed.length === 0) {
      setError(
        "No valid rows found.\n\n" +
        "CSV format: columns named lat/latitude, lon/longitude (or x/y, coords, location)\n" +
        "GeoJSON format: FeatureCollection with Point features\n\n" +
        "Example CSV:\nlat,lon,type\n45.5087,-73.5540,bin"
      );
      setRows([]);
    } else {
      setRows(parsed);
    }
  }, []);

  const handlePickFile = useCallback(async () => {
    setError(null);
    setLoading(true);
    setFileName(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "application/csv", "application/geo+json", "application/json", "text/plain", "*/*"],
        copyToCacheDirectory: Platform.OS !== "web",
      });
      if (result.canceled) {
        setLoading(false);
        return;
      }
      const file = result.assets[0];
      const uri = file.uri;
      const name = file.name || "file";
      setFileName(name);

      let text: string;
      if (Platform.OS === "web") {
        const assetWithFile = file as { file?: File; uri?: string };
        if (assetWithFile.file && typeof (assetWithFile.file as Blob).slice === "function") {
          text = await readFileAsText(assetWithFile.file);
        } else if (uri) {
          const response = await fetch(uri);
          if (typeof (response as { blob?: () => Promise<Blob> }).blob !== "function") {
            throw new Error("Cannot read file: response.blob is not available");
          }
          const blob = await (response as { blob: () => Promise<Blob> }).blob();
          text = await readFileAsText(blob);
        } else {
          throw new Error("No file or URI available to read");
        }
      } else {
        text = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
      }

      processFileContent(text, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read file.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [processFileContent]);

  const handleGeocode = useCallback(async () => {
    const toGeocode = rows.map((r, i) => ({ row: r, index: i })).filter(({ row }) => (row.lat == null || row.lon == null) && row.address?.trim());
    if (toGeocode.length === 0) return;
    setGeocoding(true);
    setError(null);
    const updated = [...rows];
    let done = 0;
    for (const { row, index } of toGeocode) {
      try {
        const results = await searchAddress(row.address!);
        await new Promise((r) => setTimeout(r, NOMINATIM_RATE_MS));
        if (results.length > 0) {
          updated[index] = { ...row, lat: results[0].lat, lon: results[0].lon };
        }
      } catch (e) {
        setError(`Geocode failed for "${(row.address || "").slice(0, 30)}…": ${e instanceof Error ? e.message : String(e)}`);
      }
      done++;
    }
    setRows(updated);
    setGeocoding(false);
  }, [rows]);

  const handleImport = useCallback(() => {
    const valid = rows.filter((r) => r.lat != null && r.lon != null && !Number.isNaN(r.lat!) && !Number.isNaN(r.lon!));
    if (valid.length === 0) {
      Alert.alert("No valid points", "Geocode rows with only an address, or ensure lat/lon columns are present in your CSV.");
      return;
    }
    onImport(valid);
    onClose();
    setRows([]);
    setError(null);
    setFileName(null);
  }, [rows, onImport, onClose]);

  const handleClose = useCallback(() => {
    onClose();
    setRows([]);
    setError(null);
    setFileName(null);
  }, [onClose]);

  // Preview rows with coordinates
  const previewRows = rows.slice(0, MAX_PREVIEW_ROWS);

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade">
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: colors.text }]}>Import CSV / GeoJSON</Text>

          {rows.length === 0 && !loading && (
            <>
              <TouchableOpacity onPress={handlePickFile} style={[styles.primaryBtn, { backgroundColor: colors.primary }]}>
                <MaterialCommunityIcons name="file-upload-outline" size={20} color="#fff" />
                <Text style={styles.primaryBtnLabel}>Choose file</Text>
              </TouchableOpacity>
              <Text style={[styles.formatHint, { color: colors.muted }]}>
                Supported: CSV with lat/lon columns, GeoJSON with Point features
              </Text>
            </>
          )}

          {loading && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.hint, { color: colors.muted }]}>Reading file…</Text>
            </View>
          )}

          {rows.length > 0 && (
            <ScrollView style={styles.preview} showsVerticalScrollIndicator>
              {fileName && (
                <Text style={[styles.fileName, { color: colors.text }]}>{fileName}</Text>
              )}

              {/* Summary */}
              <View style={[styles.summaryBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.summaryText, { color: colors.text }]}>
                  <Text style={{ fontWeight: "700" }}>{rows.length}</Text> rows parsed
                </Text>
                {readyCount > 0 && (
                  <Text style={[styles.summaryText, { color: "#22c55e" }]}>
                    <Text style={{ fontWeight: "700" }}>{readyCount}</Text> with valid coordinates
                  </Text>
                )}
                {needGeocode > 0 && (
                  <Text style={[styles.summaryText, { color: colors.primary }]}>
                    <Text style={{ fontWeight: "700" }}>{needGeocode}</Text> need geocoding (have address only)
                  </Text>
                )}
                {invalidCount > 0 && (
                  <Text style={[styles.summaryText, { color: colors.error ?? "#ef4444" }]}>
                    <Text style={{ fontWeight: "700" }}>{invalidCount}</Text> invalid (no coords or address)
                  </Text>
                )}
              </View>

              {/* Preview table */}
              {previewRows.length > 0 && (
                <View style={[styles.previewTable, { borderColor: colors.border }]}>
                  <Text style={[styles.previewHeader, { color: colors.muted }]}>Preview (first {previewRows.length}):</Text>
                  {previewRows.map((row, i) => (
                    <View key={i} style={[styles.previewRow, { borderTopColor: colors.border }]}>
                      <Text style={[styles.previewCoord, { color: row.lat != null ? colors.text : colors.muted }]}>
                        {row.lat != null && row.lon != null
                          ? `${row.lat.toFixed(4)}, ${row.lon.toFixed(4)}`
                          : row.address
                            ? `📍 ${row.address.slice(0, 25)}${row.address.length > 25 ? "…" : ""}`
                            : "❌ No coords"}
                      </Text>
                      <Text style={[styles.previewType, { color: colors.muted }]}>
                        {row.type === "dumpster" ? "D" : "B"}
                      </Text>
                    </View>
                  ))}
                  {rows.length > MAX_PREVIEW_ROWS && (
                    <Text style={[styles.previewMore, { color: colors.muted }]}>
                      … and {rows.length - MAX_PREVIEW_ROWS} more
                    </Text>
                  )}
                </View>
              )}

              {needGeocode > 0 && (
                <TouchableOpacity
                  onPress={handleGeocode}
                  disabled={geocoding}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 12, opacity: geocoding ? 0.7 : 1 }]}
                >
                  {geocoding ? <ActivityIndicator size="small" color="#fff" /> : <MaterialCommunityIcons name="map-marker-radius" size={20} color="#fff" />}
                  <Text style={styles.primaryBtnLabel}>{geocoding ? "Geocoding…" : `Geocode ${needGeocode} address(es)`}</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={handleImport}
                disabled={readyCount === 0}
                style={[styles.primaryBtn, { backgroundColor: "#22c55e", marginTop: 12, opacity: readyCount === 0 ? 0.5 : 1 }]}
              >
                <MaterialCommunityIcons name="check" size={20} color="#fff" />
                <Text style={styles.primaryBtnLabel}>Import {readyCount} point(s)</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={handlePickFile} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                <Text style={[styles.secondaryBtnLabel, { color: colors.muted }]}>Choose another file</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {error && (
            <Text style={[styles.error, { color: colors.error ?? "#ef4444" }]}>{error}</Text>
          )}

          <TouchableOpacity onPress={handleClose} style={[styles.cancelBtn, { borderColor: colors.border }]}>
            <Text style={[styles.cancelBtnLabel, { color: colors.text }]}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  box: {
    width: "100%",
    maxWidth: 440,
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  primaryBtnLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    alignItems: "center",
  },
  secondaryBtnLabel: {
    fontSize: 14,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 16,
    alignSelf: "flex-end",
  },
  cancelBtnLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  preview: {
    maxHeight: 320,
  },
  hint: {
    fontSize: 13,
    marginBottom: 4,
  },
  formatHint: {
    fontSize: 12,
    marginTop: 12,
    textAlign: "center",
  },
  fileName: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  summaryBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
    gap: 2,
  },
  summaryText: {
    fontSize: 13,
  },
  previewTable: {
    borderWidth: 1,
    borderRadius: 6,
    overflow: "hidden",
  },
  previewHeader: {
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 6,
    textTransform: "uppercase",
  },
  previewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
  },
  previewCoord: {
    fontSize: 12,
    fontFamily: "monospace",
    flex: 1,
  },
  previewType: {
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 8,
  },
  previewMore: {
    fontSize: 11,
    fontStyle: "italic",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
  },
  error: {
    fontSize: 13,
    marginTop: 12,
  },
});
