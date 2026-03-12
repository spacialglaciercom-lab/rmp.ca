/**
 * Import GPX/KML — only COMPLETE ROUTES are added as favorites (one entry per route).
 * Individual waypoints or KML placemarks are not added as favorites.
 */

import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { useColors } from "@/hooks/use-colors";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { useRouting } from "@/lib/routing-context";
import { parseGPXForNavigation } from "@/lib/gpxNavParser";
import { trackStorage, type TrackPoint } from "@/lib/track-storage";
import { haversineDistance } from "@/lib/offlineTurnDetection";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

export function ImportExportActions() {
  const colors = useColors();
  const { dispatch } = useRouting();
  const addFavorite = useFavoritesStore((s) => s.addFavorite);

  const handleImport = useCallback(async () => {
    try {
      hapticImpact();
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/gpx+xml",
          "application/vnd.google-earth.kml+xml",
          "application/xml",
          "text/xml",
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      const uri = file.uri;

      let text: string;
      if (Platform.OS === "web") {
        const response = await fetch(uri);
        text = await response.text();
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        text = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      const isGpx = /<gpx[\s>]/i.test(text);
      let routeAdded = false;

      if (isGpx) {
        const parsed = parseGPXForNavigation(text);
        // Only complete routes (track with ≥2 points): add ONE favorite for the route and save as a Trip.
        if (parsed.points.length >= 2) {
          dispatch({ type: "SET_GPX_DATA", payload: text });
          const name = parsed.metadata.name?.trim() || "Imported route";
          addFavorite({
            name,
            lat: parsed.points[0].lat,
            lon: parsed.points[0].lon,
          });
          // Also save as a Trip so full track is viewable in Trips tab
          const trackPoints: TrackPoint[] = parsed.points.map((p) => ({
            lat: p.lat,
            lon: p.lon,
            altitude: p.elevation ?? null,
            timestamp: p.time ? new Date(p.time).getTime() : Date.now(),
            speed: null,
            accuracy: null,
          }));
          let totalDist = 0;
          for (let i = 1; i < trackPoints.length; i++) {
            totalDist += haversineDistance(trackPoints[i - 1], trackPoints[i]);
          }
          const firstTs = trackPoints[0]?.timestamp ?? Date.now();
          const lastTs =
            trackPoints[trackPoints.length - 1]?.timestamp ?? Date.now();
          trackStorage
            .saveTrack(name, trackPoints, totalDist, lastTs - firstTs)
            .catch(() => {});
          routeAdded = true;
        }
        // Waypoints-only GPX: do not add individual points to favorites (user wants only complete routes).
      }
      // KML: do not add placemarks as favorites (only complete routes are added).

      if (routeAdded) {
        Alert.alert(
          "Import complete",
          "Added 1 route to favorites. Open the Map tab to see the route and use Download GPX to export the full file.",
        );
      } else {
        Alert.alert(
          "No route added",
          "Only complete GPX routes (track or route with 2+ points) are added to favorites. This file has waypoints or points only — use the Map tab to load and export if needed.",
        );
      }
    } catch (err) {
      console.error("Import failed:", err);
      Alert.alert("Import failed", "Could not read the file.");
    }
  }, [dispatch, addFavorite]);

  return (
    <View style={[styles.container, { borderBottomColor: colors.border }]}>
      <Text
        style={[
          styles.sectionTitle,
          { color: colors.accentCyan ?? colors.primary },
        ]}
      >
        IMPORT / EXPORT
      </Text>
      <TouchableOpacity
        style={[styles.row, { borderColor: colors.border }]}
        onPress={handleImport}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons
          name="import"
          size={22}
          color={colors.primary}
        />
        <Text style={[styles.rowLabel, { color: colors.text }]}>
          Import GPX/KML
        </Text>
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={colors.muted}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    paddingBottom: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    marginLeft: 12,
  },
});
