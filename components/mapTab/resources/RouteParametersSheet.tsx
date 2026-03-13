import React, { useCallback, useEffect, useState } from "react";
import type { ComponentProps } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Switch,
  ScrollView,
  Platform,
  FlatList,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { SectionLabel } from "@/components/minimal";
import {
  useRouteParametersStore,
  RECALC_DISTANCE_OPTIONS,
  type AvoidRoadsState,
  type RecalcDistanceValue,
} from "@/stores/routeParametersStore";
import {
  getAvailableExpoVoicesAsync,
  type ExpoSpeechVoice,
} from "@/lib/expoSpeechVoice";

interface RouteParametersSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called when user taps "Select on map" in Avoid roads. Parent can close the sheet and show the map (e.g. with a coming-soon message). */
  onSelectOnMap?: () => void;
}

type ViewMode = "main" | "avoid" | "preferences" | "recalc" | "voice";

const AVOID_ROADS_OPTIONS: { key: keyof AvoidRoadsState; label: string }[] = [
  { key: "noTollRoads", label: "No toll roads" },
  { key: "avoidLowEmissionZones", label: "Avoid low emission zones" },
  { key: "noShuttleTrain", label: "No shuttle train" },
  { key: "noBorderCrossings", label: "No border crossings" },
  { key: "noIceRoadsOrFords", label: "No ice roads or fords" },
  { key: "noMotorways", label: "No motorways" },
  { key: "avoid4WDRoads", label: "Avoid 4WD roads" },
  { key: "noFerries", label: "No ferries" },
  { key: "avoidTunnels", label: "Avoid tunnels" },
  { key: "noUnpavedRoads", label: "No unpaved roads" },
];

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "85%",
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  rowWithChevron: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  instructionText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  linkText: {
    fontSize: 16,
    fontWeight: "500",
  },
});

export function RouteParametersSheet({
  visible,
  onClose,
  onSelectOnMap,
}: RouteParametersSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [viewMode, setViewMode] = useState<ViewMode>("main");
  const [expoVoices, setExpoVoices] = useState<ExpoSpeechVoice[]>([]);
  const [expoVoicesLoading, setExpoVoicesLoading] = useState(false);

  const store = useRouteParametersStore();

  useEffect(() => {
    if (visible) store.hydrate();
  }, [visible]);

  const handleClose = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    setViewMode("main");
    onClose();
  }, [onClose]);

  const handleBack = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    setViewMode("main");
  }, []);

  const openAvoidRoads = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    setViewMode("avoid");
  }, []);

  const openMapSelection = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    if (onSelectOnMap) {
      onSelectOnMap();
    } else {
      Alert.alert(
        "Select on map",
        "Selecting specific roads on the map is not yet supported. Use \"Avoid by type\" below to avoid tolls, motorways, ferries, and more.",
      );
    }
  }, [onSelectOnMap]);

  const openPreferences = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    setViewMode("preferences");
  }, []);

  const openRecalcDistancePicker = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    setViewMode("recalc");
  }, []);

  const openSystemVoicePicker = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    setViewMode("voice");
  }, []);

  useEffect(() => {
    if (
      visible &&
      viewMode === "voice" &&
      expoVoices.length === 0 &&
      !expoVoicesLoading
    ) {
      setExpoVoicesLoading(true);
      getAvailableExpoVoicesAsync()
        .then(setExpoVoices)
        .finally(() => setExpoVoicesLoading(false));
    }
  }, [visible, viewMode, expoVoices.length, expoVoicesLoading]);

  if (!visible) return null;

  const recalcLabel =
    RECALC_DISTANCE_OPTIONS.find((o) => o.value === store.recalcDistanceMeters)
      ?.label ?? "120 m";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View
          style={[
            styles.sheet,
            {
              paddingTop: insets.top + 16,
              paddingBottom: insets.bottom + 24,
              backgroundColor: colors.surface,
              borderBottomColor: colors.border,
            },
          ]}
        >
          {viewMode === "avoid" ? (
            <>
              <View
                style={[styles.header, { borderBottomColor: colors.border }]}
              >
                <View style={styles.headerLeft}>
                  <TouchableOpacity onPress={handleBack} style={{ padding: 4 }}>
                    <MaterialCommunityIcons
                      name="chevron-left"
                      size={28}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                  <Text style={[styles.headerTitle, { color: colors.text }]}>
                    Avoid roads...
                  </Text>
                </View>
                <TouchableOpacity onPress={handleBack} style={{ padding: 8 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: colors.primary,
                    }}
                  >
                    Done
                  </Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={[styles.instructionText, { color: colors.muted }]}>
                  Select roads you want to avoid during navigation. You can
                  either select a road on the map or choose a type from the list
                  below.
                </Text>
                <SectionLabel
                  color={colors.muted}
                  style={{ marginTop: 0, marginBottom: 12 }}
                >
                  SELECT MANUALLY
                </SectionLabel>
                <TouchableOpacity onPress={openMapSelection} style={styles.row}>
                  <Text style={[styles.linkText, { color: colors.primary }]}>
                    Select on map
                  </Text>
                </TouchableOpacity>
                <SectionLabel
                  color={colors.muted}
                  style={{ marginTop: 16, marginBottom: 12 }}
                >
                  AVOID BY TYPE
                </SectionLabel>
                {AVOID_ROADS_OPTIONS.map(({ key, label }) => (
                  <View
                    key={key}
                    style={[
                      styles.row,
                      {
                        backgroundColor: colors.surface,
                        borderRadius: 12,
                        marginBottom: 4,
                        paddingHorizontal: 16,
                      },
                    ]}
                  >
                    <Text style={{ color: colors.text, fontSize: 16, flex: 1 }}>
                      {label}
                    </Text>
                    <Switch
                      value={store.avoidRoads[key]}
                      onValueChange={(v) => store.setAvoidRoads(key, v)}
                      trackColor={{
                        false: colors.border,
                        true: colors.primary + "60",
                      }}
                      thumbColor={
                        store.avoidRoads[key] ? colors.primary : colors.muted
                      }
                    />
                  </View>
                ))}
              </ScrollView>
            </>
          ) : viewMode === "preferences" ? (
            <>
              <View
                style={[styles.header, { borderBottomColor: colors.border }]}
              >
                <View style={styles.headerLeft}>
                  <TouchableOpacity onPress={handleBack} style={{ padding: 4 }}>
                    <MaterialCommunityIcons
                      name="chevron-left"
                      size={28}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                  <Text style={[styles.headerTitle, { color: colors.text }]}>
                    Prefer...
                  </Text>
                </View>
                <TouchableOpacity onPress={handleBack} style={{ padding: 8 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: colors.primary,
                    }}
                  >
                    Done
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.content}>
                <Text style={[styles.instructionText, { color: colors.muted }]}>
                  Route preferences will be available in a future update. These
                  will let you prefer motorways, shortest routes, or scenic
                  roads.
                </Text>
              </View>
            </>
          ) : viewMode === "recalc" ? (
            <>
              <View
                style={[styles.header, { borderBottomColor: colors.border }]}
              >
                <View style={styles.headerLeft}>
                  <TouchableOpacity onPress={handleBack} style={{ padding: 4 }}>
                    <MaterialCommunityIcons
                      name="chevron-left"
                      size={28}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                  <Text style={[styles.headerTitle, { color: colors.text }]}>
                    Recalculate distance
                  </Text>
                </View>
                <TouchableOpacity onPress={handleBack} style={{ padding: 8 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: colors.primary,
                    }}
                  >
                    Done
                  </Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={[styles.instructionText, { color: colors.muted }]}>
                  Set the minimum distance from the route before automatic
                  recalculation triggers.
                </Text>
                {RECALC_DISTANCE_OPTIONS.map(({ value, label }) => {
                  const isSelected = store.recalcDistanceMeters === value;
                  return (
                    <TouchableOpacity
                      key={value}
                      onPress={() => {
                        if (Platform.OS !== "web") hapticImpact();
                        store.setRecalcDistanceMeters(
                          value as RecalcDistanceValue,
                        );
                      }}
                      style={[
                        styles.row,
                        {
                          backgroundColor: colors.surface,
                          borderRadius: 12,
                          marginBottom: 4,
                          paddingHorizontal: 16,
                          borderWidth: 1,
                          borderColor: isSelected
                            ? colors.primary
                            : colors.border,
                        },
                      ]}
                    >
                      <Text style={{ color: colors.text, fontSize: 16 }}>
                        {label}
                      </Text>
                      {isSelected && (
                        <MaterialCommunityIcons
                          name="check"
                          size={20}
                          color={colors.primary}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          ) : viewMode === "voice" ? (
            <>
              <View
                style={[styles.header, { borderBottomColor: colors.border }]}
              >
                <View style={styles.headerLeft}>
                  <TouchableOpacity onPress={handleBack} style={{ padding: 4 }}>
                    <MaterialCommunityIcons
                      name="chevron-left"
                      size={28}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                  <Text style={[styles.headerTitle, { color: colors.text }]}>
                    System voice
                  </Text>
                </View>
                <TouchableOpacity onPress={handleBack} style={{ padding: 8 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: colors.primary,
                    }}
                  >
                    Done
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.content}>
                <Text style={[styles.instructionText, { color: colors.muted }]}>
                  Used for navigation announcements and Co-Pilot when ElevenLabs
                  is off.
                </Text>
                {expoVoicesLoading ? (
                  <Text style={{ color: colors.muted, marginTop: 12 }}>
                    Loading voices…
                  </Text>
                ) : expoVoices.length === 0 ? (
                  <Text style={{ color: colors.muted, marginTop: 12 }}>
                    No voices available.
                  </Text>
                ) : (
                  <FlatList
                    data={expoVoices}
                    keyExtractor={(_, i) => String(i)}
                    style={{ marginTop: 8, maxHeight: 320 }}
                    renderItem={({ item, index }) => {
                      const isSelected = store.expoVoiceIndex === index;
                      const label =
                        item.name || item.language || `Voice ${index + 1}`;
                      return (
                        <TouchableOpacity
                          onPress={() => {
                            if (Platform.OS !== "web") hapticImpact();
                            store.setExpoVoiceIndex(index);
                          }}
                          style={[
                            styles.row,
                            {
                              backgroundColor: colors.surface,
                              borderRadius: 12,
                              marginBottom: 4,
                              paddingHorizontal: 16,
                              borderWidth: 1,
                              borderColor: isSelected
                                ? colors.primary
                                : colors.border,
                            },
                          ]}
                        >
                          <Text
                            style={{ color: colors.text, fontSize: 16 }}
                            numberOfLines={1}
                          >
                            {label}
                          </Text>
                          {isSelected && (
                            <MaterialCommunityIcons
                              name="check"
                              size={20}
                              color={colors.primary}
                            />
                          )}
                        </TouchableOpacity>
                      );
                    }}
                  />
                )}
              </View>
            </>
          ) : (
            <>
              <View
                style={[styles.header, { borderBottomColor: colors.border }]}
              >
                <View>
                  <Text style={[styles.headerTitle, { color: colors.text }]}>
                    Route parameters
                  </Text>
                  <Text
                    style={[styles.headerSubtitle, { color: colors.muted }]}
                  >
                    Driving
                  </Text>
                </View>
                <TouchableOpacity onPress={handleClose} style={{ padding: 8 }}>
                  <MaterialCommunityIcons
                    name="close"
                    size={24}
                    color={colors.text}
                  />
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <TouchableOpacity
                  onPress={openAvoidRoads}
                  style={[styles.rowWithChevron, { marginBottom: 4 }]}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <MaterialCommunityIcons
                      name="alert-circle-outline"
                      size={22}
                      color={colors.muted}
                    />
                    <Text style={{ color: colors.text, fontSize: 16 }}>
                      Avoid roads...
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={24}
                    color={colors.muted}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={openPreferences}
                  style={[styles.rowWithChevron, { marginBottom: 4 }]}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <MaterialCommunityIcons
                      name="alert-circle-outline"
                      size={22}
                      color={colors.muted}
                    />
                    <Text style={{ color: colors.text, fontSize: 16 }}>
                      Prefer...
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={24}
                    color={colors.muted}
                  />
                </TouchableOpacity>

                <ToggleRow
                  icon="home-off-outline"
                  label="Allow private access"
                  value={store.allowPrivateAccess}
                  onValueChange={store.setAllowPrivateAccess}
                  colors={colors}
                />
                <ToggleRow
                  icon="truck-delivery-outline"
                  label="Goods delivery"
                  value={store.goodsDelivery}
                  onValueChange={store.setGoodsDelivery}
                  colors={colors}
                />
                <ToggleRow
                  icon="fuel"
                  label="Fuel-efficient way"
                  value={store.fuelEfficientWay}
                  onValueChange={store.setFuelEfficientWay}
                  colors={colors}
                />
                <ToggleRow
                  icon="walk"
                  label="Consider temporary limitations"
                  value={store.considerTemporaryLimitations}
                  onValueChange={store.setConsiderTemporaryLimitations}
                  colors={colors}
                />
                <ToggleRow
                  icon="account-voice"
                  label="Voice assistance"
                  value={store.voiceAssistanceEnabled}
                  onValueChange={store.setVoiceAssistanceEnabled}
                  colors={colors}
                />
                <ToggleRow
                  icon="map-marker-alert-outline"
                  label="Off-route alert"
                  value={store.offRouteAlertEnabled}
                  onValueChange={store.setOffRouteAlertEnabled}
                  colors={colors}
                />
                {Platform.OS !== "web" && (
                  <TouchableOpacity
                    onPress={openSystemVoicePicker}
                    style={[styles.rowWithChevron, { marginBottom: 4 }]}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <MaterialCommunityIcons
                        name="microphone"
                        size={22}
                        color={colors.muted}
                      />
                      <Text style={{ color: colors.text, fontSize: 16 }}>
                        System voice
                      </Text>
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Text style={{ color: colors.muted, fontSize: 14 }}>
                        Tap to choose
                      </Text>
                      <MaterialCommunityIcons
                        name="chevron-right"
                        size={24}
                        color={colors.muted}
                      />
                    </View>
                  </TouchableOpacity>
                )}

                <SectionLabel
                  color={colors.muted}
                  style={{ marginTop: 20, marginBottom: 12 }}
                >
                  RECALCULATE ROUTE
                </SectionLabel>
                <TouchableOpacity
                  onPress={openRecalcDistancePicker}
                  style={[styles.rowWithChevron, { marginBottom: 4 }]}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <MaterialCommunityIcons
                      name="compass-outline"
                      size={22}
                      color={colors.muted}
                    />
                    <Text style={{ color: colors.text, fontSize: 16 }}>
                      Minimal distance to recalculate route
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Text style={{ color: colors.muted, fontSize: 16 }}>
                      {recalcLabel}
                    </Text>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={24}
                      color={colors.muted}
                    />
                  </View>
                </TouchableOpacity>
                <View
                  style={[
                    styles.row,
                    {
                      backgroundColor: colors.surface,
                      borderRadius: 12,
                      paddingHorizontal: 4,
                    },
                  ]}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <MaterialCommunityIcons
                      name="u-turn-right"
                      size={22}
                      color={colors.primary}
                    />
                    <Text style={{ color: colors.text, fontSize: 16 }}>
                      In case of reverse direction
                    </Text>
                  </View>
                  <Switch
                    value={store.recalcOnReverseDirection}
                    onValueChange={store.setRecalcOnReverseDirection}
                    trackColor={{
                      false: colors.border,
                      true: colors.primary + "60",
                    }}
                    thumbColor={
                      store.recalcOnReverseDirection
                        ? colors.primary
                        : colors.muted
                    }
                  />
                </View>
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
  colors,
}: {
  icon: ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surface,
          borderRadius: 12,
          marginBottom: 4,
          paddingHorizontal: 4,
        },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <MaterialCommunityIcons name={icon} size={22} color={colors.muted} />
        <Text style={{ color: colors.text, fontSize: 16 }}>{label}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primary + "60" }}
        thumbColor={value ? colors.primary : colors.muted}
      />
    </View>
  );
}
