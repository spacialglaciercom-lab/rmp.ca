/**
 * Bottom sheet shown when user taps the map — shows place/store data at that location.
 * Uses Google Places Nearby Search when configured; falls back to Nominatim reverse geocode.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useColors } from "@/hooks/use-colors";
import { useDeviceType } from "@/hooks/useDeviceType";
import { searchNearby, isGooglePlacesConfigured } from "@/services/googlePlacesService";
import { reverseGeocode } from "@/lib/geocode";
import { MinimalButton } from "@/components/minimal";

const PANEL_WIDTH_IPAD = 380;

export interface PlaceInfoData {
  name: string;
  address?: string;
  lat: number;
  lon: number;
}

interface PlaceInfoSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Location tapped on map */
  lat: number;
  lon: number;
  onDirectionsHere?: () => void;
  /** Opens Mapillary street view */
  onStreetView?: () => void;
  /** Opens Mapillary app to contribute images */
  onContributeImages?: () => void;
  /** Opens Google Street View */
  onGoogleStreetView?: () => void;
  onSaveToFavorites?: (name: string, lat: number, lon: number) => void;
  onClear?: () => void;
}

export function PlaceInfoSheet({
  visible,
  onClose,
  lat,
  lon,
  onDirectionsHere,
  onStreetView,
  onContributeImages,
  onGoogleStreetView,
  onSaveToFavorites,
  onClear,
}: PlaceInfoSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const deviceType = useDeviceType();
  const [loading, setLoading] = useState(true);
  const [place, setPlace] = useState<PlaceInfoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadPlace = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPlace(null);
    setSaved(false);
    try {
      const useGoogle = await isGooglePlacesConfigured();
      if (useGoogle) {
        const nearby = await searchNearby(lat, lon, { radiusMeters: 150 });
        if (nearby.length > 0) {
          const p = nearby[0];
          setPlace({
            name: p.displayName,
            address: p.formattedAddress,
            lat: p.location.lat,
            lon: p.location.lon,
          });
          return;
        }
      }
      const rev = await reverseGeocode(lat, lon);
      const name = rev.displayName || (rev.city && rev.country ? `${rev.city}, ${rev.country}` : "Location");
      setPlace({
        name: rev.displayName ? "Address" : name,
        address: rev.displayName || undefined,
        lat,
        lon,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load place");
      setPlace({
        name: "Location",
        address: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
        lat,
        lon,
      });
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

  useEffect(() => {
    if (visible && lat != null && lon != null) {
      loadPlace();
    }
  }, [visible, lat, lon, loadPlace]);

  const handleClose = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    onClose();
  }, [onClose]);

  const handleDirections = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    onDirectionsHere?.();
  }, [onDirectionsHere]);

  const handleStreetView = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    onStreetView?.();
  }, [onStreetView]);

  const handleGoogleStreetView = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    onGoogleStreetView?.();
  }, [onGoogleStreetView]);

  const handleContributeImages = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    onContributeImages?.();
  }, [onContributeImages]);

  const handleSave = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    if (place) {
      onSaveToFavorites?.(place.name, place.lat, place.lon);
      setSaved(true);
    }
  }, [onSaveToFavorites, place]);

  const handleClear = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    onClear?.();
    onClose();
  }, [onClear, onClose]);

  const isIpad = deviceType === "ipad";
  const panelStyle = isIpad
    ? [
        styles.panelIpad,
        {
          width: PANEL_WIDTH_IPAD,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          backgroundColor: colors.surface,
          borderRightColor: colors.border,
        },
      ]
    : [
        styles.panelPhone,
        {
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          maxHeight: "70%",
        },
      ];

  if (!visible) return null;

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
            isIpad ? styles.wrapperIpad : styles.wrapperPhone,
            panelStyle,
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Place
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name="close" size={24} color={colors.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentInner}
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.muted }]}>
                  Loading…
                </Text>
              </View>
            ) : place ? (
              <>
                {error && (
                  <Text style={[styles.errorText, { color: colors.muted }]} numberOfLines={1}>
                    {error}
                  </Text>
                )}
                <View style={[styles.card, { backgroundColor: colors.surfaceAlt ?? colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.placeName, { color: colors.text }]} numberOfLines={2}>
                    {place.name}
                  </Text>
                  {place.address && (
                    <Text style={[styles.address, { color: colors.muted }]} numberOfLines={3}>
                      {place.address}
                    </Text>
                  )}
                  <Text style={[styles.coords, { color: colors.muted }]}>
                    {place.lat.toFixed(5)}, {place.lon.toFixed(5)}
                  </Text>
                </View>

                <View style={styles.actions}>
                  {onDirectionsHere && (
                    <MinimalButton
                      title="Directions here"
                      variant="primary"
                      onPress={handleDirections}
                      style={styles.actionBtn}
                    />
                  )}
                  {Platform.OS !== "web" && onStreetView && (
                    <TouchableOpacity
                      style={[styles.streetViewBtn, { backgroundColor: colors.surfaceAlt ?? colors.surface, borderColor: colors.border }]}
                      onPress={handleStreetView}
                    >
                      <MaterialCommunityIcons name="camera-marker" size={22} color={colors.primary} />
                      <Text style={[styles.streetViewBtnText, { color: colors.text }]}>
                        Mapillary Street View
                      </Text>
                    </TouchableOpacity>
                  )}
                  {Platform.OS !== "web" && onContributeImages && (
                    <TouchableOpacity
                      style={[styles.streetViewBtn, { backgroundColor: colors.surfaceAlt ?? colors.surface, borderColor: colors.border }]}
                      onPress={handleContributeImages}
                    >
                      <MaterialCommunityIcons name="camera-plus-outline" size={22} color="#10B981" />
                      <Text style={[styles.streetViewBtnText, { color: colors.text }]}>
                        Contribute images
                      </Text>
                    </TouchableOpacity>
                  )}
                  {Platform.OS !== "web" && onGoogleStreetView && (
                    <TouchableOpacity
                      style={[styles.streetViewBtn, { backgroundColor: colors.surfaceAlt ?? colors.surface, borderColor: colors.border }]}
                      onPress={handleGoogleStreetView}
                    >
                      <MaterialCommunityIcons name="google-street-view" size={22} color={colors.primary} />
                      <Text style={[styles.streetViewBtnText, { color: colors.text }]}>
                        Google Street View
                      </Text>
                    </TouchableOpacity>
                  )}
                  {onSaveToFavorites && (
                    <MinimalButton
                      title={saved ? "Saved!" : "Save to Favorites"}
                      variant={saved ? "primary" : "secondary"}
                      onPress={handleSave}
                      disabled={saved}
                      style={styles.actionBtn}
                    />
                  )}
                  {onClear && (
                    <TouchableOpacity
                      style={[styles.clearBtn, { borderColor: colors.border }]}
                      onPress={handleClear}
                    >
                      <MaterialCommunityIcons name="map-marker-off-outline" size={20} color={colors.error ?? "#ef4444"} />
                      <Text style={[styles.clearBtnText, { color: colors.error ?? "#ef4444" }]}>
                        Clear marker
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: "row",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  wrapperIpad: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    borderRightWidth: 1,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    overflow: "hidden",
  },
  wrapperPhone: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  panelIpad: {
    flex: 1,
  },
  panelPhone: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  closeBtn: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 20,
    paddingBottom: 32,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 24,
  },
  loadingText: {
    fontSize: 15,
  },
  errorText: {
    fontSize: 12,
    marginBottom: 8,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  placeName: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 6,
  },
  address: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  coords: {
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  actions: {
    gap: 10,
  },
  actionBtn: {
    marginBottom: 0,
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
  },
  clearBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
  streetViewBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  streetViewBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
