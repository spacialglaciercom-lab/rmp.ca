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
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useColors } from "@/hooks/use-colors";
import { parseWasteFile, type WasteImportRow } from "@/lib/waste-import";
import { searchAddress } from "@/lib/geocode";

interface WasteImportModalProps {
  visible: boolean;
  onClose: () => void;
  onImport: (rows: WasteImportRow[]) => void;
}

const NOMINATIM_RATE_MS = 1100;

export function WasteImportModal({ visible, onClose, onImport }: WasteImportModalProps) {
  const colors = useColors();
  const [rows, setRows] = useState<WasteImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needGeocode = rows.filter((r) => (r.lat == null || r.lon == null) && r.address?.trim()).length;
  const readyCount = rows.filter((r) => r.lat != null && r.lon != null && !Number.isNaN(r.lat) && !Number.isNaN(r.lon)).length;

  const handlePickFile = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "application/csv", "application/geo+json", "application/json", "text/plain"],
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        setLoading(false);
        return;
      }
      const uri = result.assets[0].uri;
      const text = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
      const parsed = parseWasteFile(text, result.assets[0].name);
      if (parsed.length === 0) {
        setError("No valid rows found. CSV needs columns: lat, lon, type, capacity, address. GeoJSON needs Point features with properties.");
        setRows([]);
      } else {
        setRows(parsed);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read file.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

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
      Alert.alert("No valid points", "Geocode rows with only an address, or ensure lat/lon are present.");
      return;
    }
    onImport(valid);
    onClose();
    setRows([]);
    setError(null);
  }, [rows, onImport, onClose]);

  const handleClose = useCallback(() => {
    onClose();
    setRows([]);
    setError(null);
  }, [onClose]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade">
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: colors.text }]}>Import CSV / GeoJSON</Text>

          {rows.length === 0 && !loading && (
            <TouchableOpacity onPress={handlePickFile} style={[styles.primaryBtn, { backgroundColor: colors.primary }]}>
              <MaterialCommunityIcons name="file-upload-outline" size={20} color="#fff" />
              <Text style={styles.primaryBtnLabel}>Choose file</Text>
            </TouchableOpacity>
          )}

          {loading && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.hint, { color: colors.muted }]}>Reading file…</Text>
            </View>
          )}

          {rows.length > 0 && (
            <ScrollView style={styles.preview} showsVerticalScrollIndicator>
              <Text style={[styles.hint, { color: colors.muted }]}>
                {rows.length} row(s). {readyCount} with coordinates. {needGeocode > 0 ? `${needGeocode} need geocoding.` : ""}
              </Text>
              {needGeocode > 0 && (
                <TouchableOpacity
                  onPress={handleGeocode}
                  disabled={geocoding}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 8, opacity: geocoding ? 0.7 : 1 }]}
                >
                  {geocoding ? <ActivityIndicator size="small" color="#fff" /> : <MaterialCommunityIcons name="map-marker-radius" size={20} color="#fff" />}
                  <Text style={styles.primaryBtnLabel}>{geocoding ? "Geocoding…" : "Geocode addresses"}</Text>
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
    maxWidth: 400,
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
    maxHeight: 200,
  },
  hint: {
    fontSize: 13,
    marginBottom: 4,
  },
  error: {
    fontSize: 13,
    marginTop: 12,
  },
});
