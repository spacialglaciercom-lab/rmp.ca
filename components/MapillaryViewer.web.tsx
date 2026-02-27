/**
 * MapillaryViewer — WEB version.
 * Uses an <iframe> instead of react-native-webview (native only).
 * Metro resolves to this file on web so the native WebView is never loaded.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  Dimensions,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { getClosestImageId, buildMapillaryEmbedUrl } from "@/lib/mapillary";
import { useColors } from "@/hooks/use-colors";

interface MapillaryViewerProps {
  latitude: number;
  longitude: number;
  isVisible: boolean;
  onClose: () => void;
}

const SHEET_HEIGHT_RATIO = 0.6;

export function MapillaryViewer({
  latitude,
  longitude,
  isVisible,
  onClose,
}: MapillaryViewerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [imageId, setImageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchImage = useCallback(async () => {
    setLoading(true);
    setError(null);
    setImageId(null);
    try {
      const id = await getClosestImageId(latitude, longitude);
      if (id) {
        setImageId(id);
      } else {
        setError("No street-level imagery available at this location");
      }
    } catch (e) {
      setError("Could not load street view");
      console.warn("[MapillaryViewer] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [latitude, longitude]);

  useEffect(() => {
    if (isVisible && latitude != null && longitude != null) {
      fetchImage();
    }
  }, [isVisible, latitude, longitude, fetchImage]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const { height } = Dimensions.get("window");
  const sheetHeight = height * SHEET_HEIGHT_RATIO;
  const embedUrl = imageId ? buildMapillaryEmbedUrl(imageId) : null;

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={handleClose}
          accessible
          accessibilityLabel="Close street view"
          accessibilityRole="button"
        />

        <View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              backgroundColor: colors.background,
              paddingBottom: insets.bottom,
            },
          ]}
        >
          <View style={styles.dragHandleContainer}>
            <View style={[styles.dragHandle, { backgroundColor: colors.border ?? "#999" }]} />
          </View>

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Street View</Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessible
              accessibilityLabel="Close"
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            {loading && (
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.muted }]}>
                  Finding street imagery...
                </Text>
              </View>
            )}
            {error && !loading && (
              <View style={styles.centered}>
                <MaterialCommunityIcons
                  name="image-off-outline"
                  size={48}
                  color={colors.muted}
                />
                <Text style={[styles.errorText, { color: colors.muted }]}>
                  {error}
                </Text>
              </View>
            )}
            {embedUrl && !loading && (
              <iframe
                src={embedUrl}
                style={{ flex: 1, width: "100%", height: "100%", border: "none" } as any}
                allow="fullscreen"
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  dragHandleContainer: {
    alignItems: "center",
    paddingVertical: 8,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flex: 1,
    minHeight: 200,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
    textAlign: "center",
  },
});
