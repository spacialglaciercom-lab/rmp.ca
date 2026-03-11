/**
 * Compact weather overlay for the map — shows current conditions in a corner.
 * Lazy-loaded by the weather plugin.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useTheme } from "@/lib/theme-provider";
import { fetchWeather } from "./fetchWeather";

const DEFAULT_LAT = 45.5017;
const DEFAULT_LON = -73.5673;

async function getCoords(): Promise<{ lat: number; lon: number }> {
  if (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    "geolocation" in navigator
  ) {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => resolve({ lat: DEFAULT_LAT, lon: DEFAULT_LON }),
        { timeout: 5000, maximumAge: 300000 },
      );
    });
  }
  try {
    const Location = await import("expo-location");
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return { lat: DEFAULT_LAT, lon: DEFAULT_LON };
    const loc = await Location.getCurrentPositionAsync({});
    return { lat: loc.coords.latitude, lon: loc.coords.longitude };
  } catch {
    return { lat: DEFAULT_LAT, lon: DEFAULT_LON };
  }
}

function formatTemp(degrees?: number): string {
  if (degrees == null) return "—";
  return `${Math.round(degrees)}°`;
}

export default function WeatherOverlay() {
  const { theme } = useTheme();
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const coords = await getCoords();
      const result = await fetchWeather(coords.lat, coords.lon);
      if (!result) {
        setText("No data");
        return;
      }
      if (result.source === "google") {
        const t = result.data.temperature?.degrees;
        const cond = result.data.weatherCondition?.description?.text ?? "—";
        setText(`${formatTemp(t)} · ${cond}`);
      } else {
        const t = result.data.temp;
        const cond = result.data.condition?.description ?? "—";
        setText(`${formatTemp(t)} · ${cond}`);
      }
    } catch {
      setText("Unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const colors = {
    text: theme.text,
    muted: theme.textTertiary,
    surface: theme.surface,
  };

  return (
    <View
      style={[styles.container, { backgroundColor: colors.surface + "E8" }]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.text} />
      ) : (
        <Text style={[styles.text, { color: colors.text }]} numberOfLines={2}>
          {text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 16,
    left: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    maxWidth: 200,
  },
  text: {
    fontSize: 13,
  },
});
