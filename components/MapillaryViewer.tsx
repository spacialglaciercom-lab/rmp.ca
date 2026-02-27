/**
 * MapillaryViewer - Street-level imagery bottom-sheet modal using Mapillary embed.
 * Slides up from the bottom, covers ~60% of the screen so the map remains visible behind.
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
  Platform,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
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
    if (Platform.OS !== "web") hapticImpact();
    onClose();
  }, [onClose]);

  const { width, height } = Dimensions.get("window");
  const sheetHeight = height * SHEET_HEIGHT_RATIO;
  const embedUrl = imageId ? buildMapillaryEmbedUrl(imageId) : null;

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      presentationStyle="overFullScreen"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        {/* Top dimmed area - tap to close */}
        <Pressable
          style={styles.backdrop}
          onPress={handleClose}
          accessible
          accessibilityLabel="Close street view"
          accessibilityRole="button"
        />

        {/* Bottom sheet (~60% height) */}
        <View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              backgroundColor: colors.background,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              paddingTop: insets.top > 0 ? 0 : 12,
              paddingBottom: insets.bottom,
            },
          ]}
        >
          {/* Drag handle */}
          <View style={styles.dragHandleContainer}>
            <View style={[styles.dragHandle, { backgroundColor: colors.border ?? "#999" }]} />
          </View>

          {/* Header with Close in top right */}
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

          {/* Content area */}
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
              <WebView
                source={{ uri: embedUrl }}
                style={styles.webview}
                scrollEnabled={true}
                bounces={false}
                javaScriptEnabled={true}
                domStorageEnabled={true}
                startInLoadingState={true}
                renderLoading={() => (
                  <View style={[styles.webviewLoading, { backgroundColor: colors.background }]}>
                    <ActivityIndicator size="large" color={colors.primary} />
                  </View>
                )}
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
    paddingHorizontal: 0,
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
  webview: {
    flex: 1,
    backgroundColor: "#1a1a1a",
  },
  webviewLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
});
