import React from "react";
import { View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingIconButton } from "./FloatingIconButton";
import { RouteActionChips } from "./RouteActionChips";
import { ScaleBar } from "./ScaleBar";
import { useMapSidebarStore } from "@/stores/mapSidebarStore";
import { useMapDisplayStore } from "@/stores/mapDisplayStore";
import { useRouter } from "expo-router";

interface MapFloatingControlsProps {
  hasActiveRoute: boolean;
  hasTapDestination?: boolean;
  hasSelectedLocation?: boolean;
  canStartNavigation?: boolean;
  onSearch?: () => void;
  /** Opens the Navigation panel (From/To, transport mode, Start). Shown as a button in the bottom-left. */
  onOpenNavigation?: () => void;
  onDirectionsHere?: () => void;
  onStreetView?: () => void;
  /** Open Mapillary to contribute images. Shown next to Street View when Mapillary is on. */
  onContributeImages?: () => void;
  onStartNavigation?: () => void;
  /** Start collection route (custom in-app navigator). */
  onStartCollectionRoute?: () => void;
  /** Navigate to destination via external app (Google Maps / Apple Maps / Waze). */
  onNavigateExternal?: () => void;
  onFixToRoads?: () => void;
  onClearRoute?: () => void;
  onDownloadGPX?: () => void;
  onDrivePreview?: () => void;
  onOpenInGoogle?: () => void;
  onOpenInOsmAnd?: () => void;
  directionsLoading?: boolean;
  streetViewLoading?: boolean;
  navLoading?: boolean;
  fixToRoadsLoading?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onCompass?: () => void;
  /** Start GPS track recording. */
  onStartRecording?: () => void;
  /** Whether recording is currently active (hides start button). */
  isRecordingActive?: boolean;
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: "box-none",
  },
  topLeft: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topCenter: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomCenter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  rightStack: {
    position: "absolute",
    top: 0,
    right: 0,
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  bottomLeft: {
    position: "absolute",
    bottom: 0,
    left: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});

function MapFloatingControlsInner({
  hasActiveRoute,
  hasTapDestination = false,
  hasSelectedLocation = false,
  canStartNavigation = false,
  onSearch,
  onOpenNavigation,
  onDirectionsHere,
  onStreetView,
  onContributeImages,
  onStartNavigation,
  onStartCollectionRoute,
  onNavigateExternal,
  onFixToRoads,
  onClearRoute,
  onDownloadGPX,
  onDrivePreview,
  onOpenInGoogle,
  onOpenInOsmAnd,
  directionsLoading = false,
  streetViewLoading = false,
  navLoading = false,
  fixToRoadsLoading = false,
  onZoomIn,
  onZoomOut,
  onCompass,
  onStartRecording,
  isRecordingActive = false,
}: MapFloatingControlsProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const openSidebar = useMapSidebarStore((s) => s.openSidebar);
  const showZoomControls = useMapDisplayStore((s) => s.showZoomControls);
  const showCompass = useMapDisplayStore((s) => s.showCompass);
  const showScaleBar = useMapDisplayStore((s) => s.showScaleBar);
  const showMapillary = useMapDisplayStore((s) => s.showMapillary);
  const transparentWidgets = useMapDisplayStore((s) => s.transparentWidgets);

  const topPad = insets.top + 8;
  const bottomPad = insets.bottom + 8;
  const rightPad = 12;
  const leftPad = 12;

  const widgetStyle = transparentWidgets
    ? { backgroundColor: "rgba(42, 42, 42, 0.55)" as const, borderColor: "rgba(68, 68, 68, 0.6)" as const }
    : undefined;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* Top-left: Hamburger + Search (search only when onSearch provided, e.g. Navigation plugin on) */}
      <View style={[styles.topLeft, { top: topPad, left: leftPad }]}>
        <FloatingIconButton icon="menu" onPress={openSidebar} size={44} style={widgetStyle} />
        {onSearch && (
          <FloatingIconButton
            icon="magnify"
            onPress={onSearch}
            size={44}
            style={widgetStyle}
          />
        )}
      </View>

      {/* Bottom center: Route action chips (Directions here, Start Navigation, Fix to roads, Download GPX) */}
      {hasActiveRoute && (
        <View
          style={[
            styles.bottomCenter,
            { paddingBottom: bottomPad + 12, paddingHorizontal: leftPad + 20 },
          ]}
        >
          <RouteActionChips
            hasTapDestination={hasTapDestination}
            hasSelectedLocation={hasSelectedLocation}
            canStartNavigation={canStartNavigation}
            onDirectionsHere={onDirectionsHere}
            onStreetView={onStreetView}
            onContributeImages={onContributeImages}
            onStartNavigation={onStartNavigation}
            onStartCollectionRoute={onStartCollectionRoute}
            onNavigateExternal={onNavigateExternal}
            onFixToRoads={onFixToRoads}
            onClearRoute={onClearRoute}
            onDownloadGPX={onDownloadGPX}
            onDrivePreview={onDrivePreview}
            onOpenInGoogle={onOpenInGoogle}
            onOpenInOsmAnd={onOpenInOsmAnd}
            directionsLoading={directionsLoading}
            streetViewLoading={streetViewLoading}
            navLoading={navLoading}
            fixToRoadsLoading={fixToRoadsLoading}
            showMapillary={showMapillary}
          />
        </View>
      )}

      {/* Right side: Zoom + Compass (respect display options) */}
      {(showZoomControls || showCompass) && (
        <View style={[styles.rightStack, { top: topPad, right: rightPad }]}>
          {showZoomControls && (
            <>
              <FloatingIconButton icon="plus" onPress={onZoomIn ?? (() => {})} size={40} style={widgetStyle} />
              <FloatingIconButton icon="minus" onPress={onZoomOut ?? (() => {})} size={40} style={widgetStyle} />
            </>
          )}
          {showCompass && (
            <FloatingIconButton
              icon="compass-outline"
              onPress={onCompass ?? (() => {})}
              size={40}
              style={widgetStyle}
            />
          )}
          <FloatingIconButton
            icon="help-circle-outline"
            onPress={() => router.push("/(tabs)/help")}
            size={40}
            style={widgetStyle}
          />
        </View>
      )}

      {/* Bottom-left: Navigation (opens From/To panel), Recording, Street View + Scale bar */}
      <View style={[styles.bottomLeft, { bottom: bottomPad + 8, left: leftPad }]}>
        {onOpenNavigation && (
          <FloatingIconButton
            icon="navigation-variant-outline"
            onPress={onOpenNavigation}
            size={44}
            style={widgetStyle}
          />
        )}
        {onStartRecording && !isRecordingActive && (
          <FloatingIconButton
            icon="record-circle-outline"
            onPress={onStartRecording}
            size={44}
            style={widgetStyle}
            iconColor="#E53935"
          />
        )}
        {showMapillary && hasSelectedLocation && onStreetView && (
          <FloatingIconButton
            icon="camera-marker"
            onPress={onStreetView}
            size={44}
            style={widgetStyle}
          />
        )}
        {showMapillary && hasSelectedLocation && onContributeImages && (
          <FloatingIconButton
            icon="camera-plus-outline"
            onPress={onContributeImages}
            size={44}
            style={widgetStyle}
          />
        )}
        {showScaleBar && <ScaleBar />}
      </View>
    </View>
  );
}

export const MapFloatingControls = React.memo(MapFloatingControlsInner);
