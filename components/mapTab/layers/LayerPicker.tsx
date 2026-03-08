import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useMapType, type MapTypePreference } from "@/lib/map-type-preference";
import { useMapDisplayStore } from "@/stores/mapDisplayStore";
import { useMapLayerStore, SLOW_LOADING_BASE_LAYERS } from "@/stores/mapLayerStore";
import { useRecordingSettingsStore } from "@/stores/recordingSettingsStore";
import { RecOptionsModal } from "@/components/RecOptionsModal";

interface LayerOption {
  id: string;
  label: string;
  icon: string;
  description?: string;
}

interface MapLayer {
  id: string;
  name: string;
  url: string;
  attribution: string;
  icon: string;
  preview?: string;
}

// Google Maps native map types (work on Android/iOS)
const GOOGLE_MAP_LAYERS: MapLayer[] = [
  {
    id: "google-maps",
    name: "Google Maps",
    url: "",
    attribution: "© Google",
    icon: "google-maps",
    preview: "Standard road map with labels"
  },
  {
    id: "google-satellite",
    name: "Satellite",
    url: "",
    attribution: "© Google",
    icon: "satellite-variant",
    preview: "Photorealistic map based on aerial imagery"
  },
  {
    id: "google-hybrid",
    name: "Hybrid",
    url: "",
    attribution: "© Google",
    icon: "satellite",
    preview: "Satellite view with road labels overlay"
  },
  {
    id: "google-terrain",
    name: "Terrain",
    url: "",
    attribution: "© Google",
    icon: "terrain",
    preview: "Physical map based on terrain information"
  },
];

// OSM-based tile layers (work on iOS/Web)
const OSM_MAP_LAYERS: MapLayer[] = [
  {
    id: "standard",
    name: "Standard",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    icon: "map-outline",
    preview: "Standard street map with clear labels and roads"
  },
  {
    id: "dark",
    name: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    icon: "theme-light-dark",
    preview: "Dark theme for better visibility in low light"
  },
  {
    id: "satellite",
    name: "Satellite (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri &copy; DigitalGlobe",
    icon: "satellite-variant",
    preview: "Aerial imagery for detailed terrain view"
  },
  {
    id: "terrain",
    name: "Terrain (OpenTopo)",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenTopoMap &copy; OpenStreetMap contributors",
    icon: "terrain",
    preview: "Topographic map with elevation contours"
  }
];

// On Android, use Google Maps native types; on iOS/Web, show both Google and OSM options
const MAP_LAYERS: MapLayer[] = Platform.OS === "android" 
  ? GOOGLE_MAP_LAYERS
  : [...GOOGLE_MAP_LAYERS, ...OSM_MAP_LAYERS];

const OVERLAY_LAYERS: LayerOption[] = [
  {
    id: "traffic",
    label: "Traffic",
    icon: "traffic-light",
    description: "Show traffic conditions"
  },
  {
    id: "collection-points",
    label: "Collection Points",
    icon: "map-marker",
    description: "Show waste collection points"
  },
  {
    id: "overture",
    label: "Overture Roads",
    icon: "road-variant",
    description: "Overture Maps transportation overlay (PMTiles)"
  }
];

const DISPLAY_OPTIONS: LayerOption[] = [
  {
    id: "showZoomControls",
    label: "Zoom Controls",
    icon: "magnify-plus-outline",
    description: "Show zoom in/out buttons"
  },
  {
    id: "showCompass",
    label: "Compass",
    icon: "compass-outline",
    description: "Show compass button"
  },
  {
    id: "showScaleBar",
    label: "Scale Bar",
    icon: "ruler",
    description: "Show distance scale"
  },
  {
    id: "showTraffic",
    label: "Traffic Layer",
    icon: "traffic-light",
    description: "Show traffic information"
  }
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 20,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  section: {
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  layerCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    overflow: "hidden",
  },
  layerContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  layerIcon: {
    marginRight: 12,
  },
  layerInfo: {
    flex: 1,
  },
  layerName: {
    fontSize: 16,
    fontWeight: "600",
  },
  layerDescription: {
    fontSize: 13,
    marginTop: 2,
  },
  slowLayerHint: {
    fontSize: 12,
    marginTop: 8,
    marginHorizontal: 4,
    fontStyle: "italic",
  },
  selectedIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  overlayOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 6,
  },
  overlayLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  switch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    padding: 2,
    justifyContent: "center",
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  previewButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 16,
  },
  recButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 6,
  },
  recCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#E53935",
    alignItems: "center",
    justifyContent: "center",
  },
  recCircleInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "white",
  },
});

interface LayerPickerProps {
  onClose?: () => void;
  onPreviewOnMap?: () => void;
}

function LayerPickerInner({ onClose, onPreviewOnMap }: LayerPickerProps) {
  const colors = useColors();
  const [mapType, setMapType] = useMapType();
  
  // Map layer store
  const activeBaseLayer = useMapLayerStore((s) => s.activeBaseLayer);
  const activeOverlays = useMapLayerStore((s) => s.activeOverlays);
  const setActiveBaseLayer = useMapLayerStore((s) => s.setActiveBaseLayer);
  const toggleOverlay = useMapLayerStore((s) => s.toggleOverlay);
  
  // Get display options from store (use setters as fallback when toggles missing, e.g. before rehydration)
  const showZoomControls = useMapDisplayStore((s) => s.showZoomControls);
  const showCompass = useMapDisplayStore((s) => s.showCompass);
  const showScaleBar = useMapDisplayStore((s) => s.showScaleBar);
  const showTraffic = useMapDisplayStore((s) => s.showTraffic);
  const toggleZoomControls = useMapDisplayStore((s) => s.toggleZoomControls);
  const toggleCompass = useMapDisplayStore((s) => s.toggleCompass);
  const toggleScaleBar = useMapDisplayStore((s) => s.toggleScaleBar);
  const toggleTraffic = useMapDisplayStore((s) => s.toggleTraffic);
  const setShowZoomControls = useMapDisplayStore((s) => s.setShowZoomControls);
  const setShowCompass = useMapDisplayStore((s) => s.setShowCompass);
  const setShowScaleBar = useMapDisplayStore((s) => s.setShowScaleBar);
  const setShowTraffic = useMapDisplayStore((s) => s.setShowTraffic);

  const [selectedBaseLayer, setSelectedBaseLayer] = useState(activeBaseLayer);
  const [recOptionsVisible, setRecOptionsVisible] = useState(false);

  const loggingIntervalSeconds = useRecordingSettingsStore((s) => s.loggingIntervalSeconds);

  const handleBaseLayerSelect = async (layerId: string) => {
    if (Platform.OS !== "web") hapticImpact();
    setSelectedBaseLayer(layerId);
    
    // Update map layer store
    setActiveBaseLayer(layerId);
    
    // Update map type preference for compatibility
    const newMapType: MapTypePreference = layerId === "dark" ? "dark" : "standard";
    await setMapType(newMapType);
  };

  const showOverture = useMapDisplayStore((s) => s.showOverture);
  const toggleOverture = useMapDisplayStore((s) => s.toggleOverture);
  const mapTilesAsOverlay = useMapDisplayStore((s) => s.mapTilesAsOverlay);
  const toggleMapTilesAsOverlay = useMapDisplayStore((s) => s.toggleMapTilesAsOverlay);

  const availableLayers = useMapLayerStore((s) => s.availableLayers);
  const pluginLayerIds = useMapLayerStore((s) => s.pluginLayerIds);
  const pluginOverlayOptions: LayerOption[] = availableLayers
    .filter((l) => l.type === "overlay" && pluginLayerIds.includes(l.id))
    .map((l) => ({
      id: l.id,
      label: l.name,
      icon: l.id === "weather-overlay" ? "weather-partly-cloudy" : "layers",
      description: l.id === "weather-overlay" ? "Current conditions on map" : undefined,
    }));

  const handleOverlayToggle = (overlayId: string) => {
    if (Platform.OS !== "web") hapticImpact();
    // Traffic is driven by mapDisplayStore (native traffic layer); others use mapLayerStore
    if (overlayId === "traffic") {
      if (typeof toggleTraffic === "function") toggleTraffic();
      else setShowTraffic(!showTraffic);
      return;
    }
    if (overlayId === "overture") {
      if (typeof toggleOverture === "function") toggleOverture();
      return;
    }
    toggleOverlay(overlayId);
  };

  const handleDisplayToggle = (optionId: string) => {
    if (Platform.OS !== "web") hapticImpact();
    switch (optionId) {
      case "showZoomControls":
        if (typeof toggleZoomControls === "function") toggleZoomControls();
        else setShowZoomControls(!showZoomControls);
        break;
      case "showCompass":
        if (typeof toggleCompass === "function") toggleCompass();
        else setShowCompass(!showCompass);
        break;
      case "showScaleBar":
        if (typeof toggleScaleBar === "function") toggleScaleBar();
        else setShowScaleBar(!showScaleBar);
        break;
      case "showTraffic":
        if (typeof toggleTraffic === "function") toggleTraffic();
        else setShowTraffic(!showTraffic);
        break;
    }
  };

  const getDisplayOptionState = (optionId: string): boolean => {
    switch (optionId) {
      case "showZoomControls":
        return showZoomControls;
      case "showCompass":
        return showCompass;
      case "showScaleBar":
        return showScaleBar;
      case "showTraffic":
        return showTraffic;
      default:
        return false;
    }
  };

  const renderSwitch = (isActive: boolean) => (
    <View style={[styles.switch, { backgroundColor: isActive ? colors.primary : colors.border }]}>
      <View style={[styles.switchThumb, { 
        backgroundColor: "white",
        alignSelf: isActive ? "flex-end" : "flex-start"
      }]} />
    </View>
  );

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Map Layers
        </Text>
        {onClose && (
          <TouchableOpacity onPress={onClose}>
            <MaterialCommunityIcons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>

      {/* Base Map Layers */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.primary }]}>
          Base Map
        </Text>
        {MAP_LAYERS.map((layer) => {
          const isSelected = selectedBaseLayer === layer.id;
          return (
            <TouchableOpacity
              key={layer.id}
              style={[
                styles.layerCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: isSelected ? colors.primary : colors.border,
                },
              ]}
              onPress={() => handleBaseLayerSelect(layer.id)}
              activeOpacity={0.7}
            >
              <View style={styles.layerContent}>
                <MaterialCommunityIcons
                  name={layer.icon as any}
                  size={24}
                  color={isSelected ? colors.primary : colors.muted}
                  style={styles.layerIcon}
                />
                <View style={styles.layerInfo}>
                  <Text style={[styles.layerName, { color: colors.text }]}>
                    {layer.name}
                  </Text>
                  {layer.preview && (
                    <Text style={[styles.layerDescription, { color: colors.muted }]}>
                      {layer.preview}
                    </Text>
                  )}
                </View>
                {isSelected && (
                  <View style={[styles.selectedIndicator, { backgroundColor: colors.primary }]}>
                    <MaterialCommunityIcons name="check" size={14} color="white" />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
        {SLOW_LOADING_BASE_LAYERS.includes(selectedBaseLayer) && (
          <Text style={[styles.slowLayerHint, { color: colors.muted }]}>
            This layer may take a few seconds to load.
          </Text>
        )}
      </View>

      {/* Overlay Layers */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.primary }]}>
          Overlays
        </Text>
        {[...OVERLAY_LAYERS, ...pluginOverlayOptions].map((overlay) => {
          const isActive = overlay.id === "traffic" ? showTraffic : overlay.id === "overture" ? showOverture : activeOverlays.includes(overlay.id);
          return (
            <TouchableOpacity
              key={overlay.id}
              style={[
                styles.overlayOption,
                {
                  backgroundColor: colors.surface,
                  borderColor: isActive ? colors.primary : colors.border,
                  borderWidth: 1,
                },
              ]}
              onPress={() => handleOverlayToggle(overlay.id)}
              activeOpacity={0.7}
            >
              <View style={styles.overlayLeft}>
                <MaterialCommunityIcons
                  name={overlay.icon as any}
                  size={20}
                  color={isActive ? colors.primary : colors.muted}
                />
                <View>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: "500" }}>
                    {overlay.label}
                  </Text>
                  {overlay.description && (
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>
                      {overlay.description}
                    </Text>
                  )}
                </View>
              </View>
              {renderSwitch(isActive)}
            </TouchableOpacity>
          );
        })}
        {/* When Overture is on: option to draw map tiles on top of R2 (overlay to R2/OSM PBF) */}
        {showOverture && (
          <TouchableOpacity
            style={[
              styles.overlayOption,
              {
                backgroundColor: colors.surface,
                borderColor: mapTilesAsOverlay ? colors.primary : colors.border,
                borderWidth: 1,
                marginTop: 8,
                marginLeft: 12,
              },
            ]}
            onPress={() => {
              if (Platform.OS !== "web") hapticImpact();
              toggleMapTilesAsOverlay?.();
            }}
            activeOpacity={0.7}
          >
            <View style={styles.overlayLeft}>
              <MaterialCommunityIcons
                name="layers-outline"
                size={20}
                color={mapTilesAsOverlay ? colors.primary : colors.muted}
              />
              <View>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: "500" }}>
                  Map tiles on top
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>
                  Draw base map tiles over R2/Overture (overlay to R2 or OSM PBF)
                </Text>
                {mapTilesAsOverlay && (
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                    Download offline tiles + R2 for full offline.
                  </Text>
                )}
              </View>
            </View>
            {renderSwitch(mapTilesAsOverlay)}
          </TouchableOpacity>
        )}
      </View>

      {/* Display Options */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.primary }]}>
          Display Options
        </Text>
        {/* REC — opens logging interval etc. */}
        <TouchableOpacity
          style={[
            styles.recButton,
            styles.overlayOption,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
            },
          ]}
          onPress={() => {
            if (Platform.OS !== "web") hapticImpact();
            setRecOptionsVisible(true);
          }}
          activeOpacity={0.7}
        >
          <View style={styles.recCircle}>
            <View style={styles.recCircleInner} />
          </View>
          <View style={styles.overlayLeft}>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>
              REC
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>
              Logging interval: {loggingIntervalSeconds} sec
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color={colors.muted} />
        </TouchableOpacity>
        {DISPLAY_OPTIONS.map((option) => {
          const isActive = getDisplayOptionState(option.id);
          return (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.overlayOption,
                {
                  backgroundColor: colors.surface,
                  borderColor: isActive ? colors.primary : colors.border,
                  borderWidth: 1,
                },
              ]}
              onPress={() => handleDisplayToggle(option.id)}
              activeOpacity={0.7}
            >
              <View style={styles.overlayLeft}>
                <MaterialCommunityIcons
                  name={option.icon as any}
                  size={20}
                  color={isActive ? colors.primary : colors.muted}
                />
                <View>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: "500" }}>
                    {option.label}
                  </Text>
                  {option.description && (
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>
                      {option.description}
                    </Text>
                  )}
                </View>
              </View>
              {renderSwitch(isActive)}
            </TouchableOpacity>
          );
        })}
      </View>

      <RecOptionsModal
        visible={recOptionsVisible}
        onClose={() => setRecOptionsVisible(false)}
      />

      {/* Preview Button */}
      <TouchableOpacity
        style={[
          styles.previewButton,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
          },
        ]}
        onPress={onPreviewOnMap ?? onClose}
      >
        <MaterialCommunityIcons name="eye-outline" size={20} color={colors.primary} />
        <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "600" }}>
          Preview on Map
        </Text>
      </TouchableOpacity>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

export const LayerPicker = React.memo(LayerPickerInner);