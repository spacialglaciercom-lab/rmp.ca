/**
 * Add or edit a waste point (bin/dumpster). Supports Use my location and Pick on map.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useColors } from "@/hooks/use-colors";
import type { WastePoint, WastePointType, WastePointCondition } from "@/types";

export interface WastePointFormValues {
  lat: number;
  lon: number;
  type: WastePointType;
  capacityLiters?: number;
  condition?: WastePointCondition;
  address?: string;
}

const DEFAULT_VALUES: WastePointFormValues = {
  lat: 0,
  lon: 0,
  type: "bin",
  capacityLiters: undefined,
  condition: undefined,
  address: "",
};

interface WastePointFormModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (values: WastePointFormValues) => void;
  /** When editing an existing point. */
  editingPoint?: WastePoint | null;
  /** Pre-filled coords when opening after "Pick on map". */
  initialCoords?: { lat: number; lon: number } | null;
  /** Call when user taps "Pick on map" — parent should close modal and enable map pick mode. */
  onRequestPickOnMap?: () => void;
}

export function WastePointFormModal({
  visible,
  onClose,
  onSave,
  editingPoint = null,
  initialCoords = null,
  onRequestPickOnMap,
}: WastePointFormModalProps) {
  const colors = useColors();
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [type, setType] = useState<WastePointType>("bin");
  const [capacityLiters, setCapacityLiters] = useState("");
  const [condition, setCondition] = useState<WastePointCondition | "">("");
  const [address, setAddress] = useState("");
  const [locationLoading, setLocationLoading] = useState(false);

  const isEdit = !!editingPoint;

  useEffect(() => {
    if (!visible) return;
    if (editingPoint) {
      setLat(editingPoint.lat.toString());
      setLon(editingPoint.lon.toString());
      setType(editingPoint.type);
      setCapacityLiters(editingPoint.capacityLiters != null ? String(editingPoint.capacityLiters) : "");
      setCondition(editingPoint.condition ?? "");
      setAddress(editingPoint.address ?? "");
    } else if (initialCoords) {
      setLat(initialCoords.lat.toString());
      setLon(initialCoords.lon.toString());
      setType("bin");
      setCapacityLiters("");
      setCondition("");
      setAddress("");
    } else {
      setLat("");
      setLon("");
      setType("bin");
      setCapacityLiters("");
      setCondition("");
      setAddress("");
    }
  }, [visible, editingPoint, initialCoords]);

  const handleUseMyLocation = useCallback(async () => {
    setLocationLoading(true);
    try {
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 5000,
          });
        });
        setLat(position.coords.latitude.toString());
        setLon(position.coords.longitude.toString());
      } else {
        const Loc = await import("expo-location");
        const { status } = await Loc.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Location", "Permission denied.");
          return;
        }
        const getPos = (Loc as { getCurrentPositionAsync?: (o?: object) => Promise<{ coords: { latitude: number; longitude: number } }> }).getCurrentPositionAsync;
        if (getPos) {
          const pos = await getPos({});
          if (pos?.coords) {
            setLat(pos.coords.latitude.toString());
            setLon(pos.coords.longitude.toString());
          }
        }
      }
    } catch (e) {
      Alert.alert("Location", e instanceof Error ? e.message : "Could not get location.");
    } finally {
      setLocationLoading(false);
    }
  }, []);

  const handlePickOnMap = useCallback(() => {
    onRequestPickOnMap?.();
    onClose();
  }, [onRequestPickOnMap, onClose]);

  const handleSave = useCallback(() => {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
      Alert.alert("Invalid location", "Enter valid latitude and longitude, or use Use my location / Pick on map.");
      return;
    }
    if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      Alert.alert("Invalid location", "Latitude must be between -90 and 90. Longitude must be between -180 and 180.");
      return;
    }
    const cap = capacityLiters.trim() ? parseInt(capacityLiters, 10) : undefined;
    if (cap != null && (Number.isNaN(cap) || cap < 0)) {
      Alert.alert("Invalid capacity", "Capacity must be a positive number (liters).");
      return;
    }
    onSave({
      lat: latNum,
      lon: lonNum,
      type,
      capacityLiters: cap,
      condition: condition || undefined,
      address: address.trim() || undefined,
    });
    onClose();
  }, [lat, lon, type, capacityLiters, condition, address, onSave, onClose]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade">
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.title, { color: colors.text }]}>
            {isEdit ? "Edit bin/dumpster" : "Add bin or dumpster"}
          </Text>

          <Text style={[styles.label, { color: colors.muted }]}>Type</Text>
          <View style={styles.row}>
            <TouchableOpacity
              onPress={() => setType("bin")}
              style={[styles.typeBtn, { backgroundColor: type === "bin" ? "#22c55e" : colors.background, borderColor: colors.border }]}
            >
              <MaterialCommunityIcons name="delete-outline" size={20} color={type === "bin" ? "#fff" : colors.text} />
              <Text style={[styles.typeBtnLabel, { color: type === "bin" ? "#fff" : colors.text }]}>Bin</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setType("dumpster")}
              style={[styles.typeBtn, { backgroundColor: type === "dumpster" ? "#3b82f6" : colors.background, borderColor: colors.border }]}
            >
              <MaterialCommunityIcons name="dump-truck" size={20} color={type === "dumpster" ? "#fff" : colors.text} />
              <Text style={[styles.typeBtnLabel, { color: type === "dumpster" ? "#fff" : colors.text }]}>Dumpster</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { color: colors.muted }]}>Location</Text>
          <View style={styles.row}>
            <TextInput
              value={lat}
              onChangeText={setLat}
              placeholder="Lat"
              placeholderTextColor={colors.muted}
              style={[styles.coordInput, { borderColor: colors.border, color: colors.text }]}
              keyboardType="numbers-and-punctuation"
            />
            <TextInput
              value={lon}
              onChangeText={setLon}
              placeholder="Lon"
              placeholderTextColor={colors.muted}
              style={[styles.coordInput, { borderColor: colors.border, color: colors.text }]}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.row}>
            <TouchableOpacity
              onPress={handleUseMyLocation}
              disabled={locationLoading}
              style={[styles.actionChip, { borderColor: colors.border }]}
            >
              {locationLoading ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialCommunityIcons name="crosshairs-gps" size={18} color={colors.primary} />}
              <Text style={[styles.actionChipLabel, { color: colors.primary }]}>Use my location</Text>
            </TouchableOpacity>
            {onRequestPickOnMap && !isEdit && (
              <TouchableOpacity
                onPress={handlePickOnMap}
                style={[styles.actionChip, { borderColor: colors.border }]}
              >
                <MaterialCommunityIcons name="map-marker-plus" size={18} color={colors.primary} />
                <Text style={[styles.actionChipLabel, { color: colors.primary }]}>Pick on map</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={[styles.label, { color: colors.muted }]}>Capacity (L, optional)</Text>
          <TextInput
            value={capacityLiters}
            onChangeText={setCapacityLiters}
            placeholder="e.g. 240"
            placeholderTextColor={colors.muted}
            style={[styles.input, { borderColor: colors.border, color: colors.text }]}
            keyboardType="number-pad"
          />

          <Text style={[styles.label, { color: colors.muted }]}>Condition (optional)</Text>
          <View style={styles.row}>
            {(["good", "overflowing", "damaged"] as const).map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => setCondition(condition === c ? "" : c)}
                style={[styles.chip, { backgroundColor: condition === c ? colors.primary : colors.background, borderColor: colors.border }]}
              >
                <Text style={[styles.chipLabel, { color: condition === c ? "#fff" : colors.text }]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { color: colors.muted }]}>Address (optional)</Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Street, city"
            placeholderTextColor={colors.muted}
            style={[styles.input, { borderColor: colors.border, color: colors.text }]}
          />

          <View style={styles.footer}>
            <TouchableOpacity onPress={onClose} style={[styles.btn, { borderColor: colors.border }]}>
              <Text style={[styles.btnLabel, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} style={[styles.btn, styles.btnPrimary, { backgroundColor: colors.primary }]}>
              <Text style={[styles.btnLabel, { color: "#fff" }]}>{isEdit ? "Save" : "Add"}</Text>
            </TouchableOpacity>
          </View>
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
  label: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  coordInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    marginHorizontal: 4,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  typeBtn: {
    flex: 1,
    minWidth: 100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  typeBtnLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  actionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionChipLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipLabel: {
    fontSize: 13,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 24,
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
  },
  btnPrimary: {
    borderWidth: 0,
  },
  btnLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
});
