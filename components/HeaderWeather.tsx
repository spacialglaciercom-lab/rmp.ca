/**
 * Compact weather display for the app header. Prefers Google Weather API (same key as Maps);
 * falls back to OpenWeatherMap if no Google key.
 */
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { getCurrentWeather, isWeatherConfigured } from "@/services/weatherService";
import { getGoogleCurrentConditions, isGoogleWeatherConfigured } from "@/services/googleWeatherService";

const DEFAULT_LAT = 45.5017;
const DEFAULT_LON = -73.5673;

function getLocation(): Promise<{ lat: number; lon: number }> {
  if (typeof navigator !== "undefined" && "geolocation" in navigator) {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          }),
        () => resolve({ lat: DEFAULT_LAT, lon: DEFAULT_LON }),
        { timeout: 5000, maximumAge: 300000 }
      );
    });
  }
  return Promise.resolve({ lat: DEFAULT_LAT, lon: DEFAULT_LON });
}

async function getLocationNative(): Promise<{ lat: number; lon: number }> {
  try {
    const Location = await import("expo-location");
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return { lat: DEFAULT_LAT, lon: DEFAULT_LON };
    const getPos =
      (Location as { getCurrentPositionAsync?: (opts?: object) => Promise<{ coords: { latitude: number; longitude: number } }> })
        .getCurrentPositionAsync;
    if (getPos) {
      const loc = await getPos({});
      return { lat: loc.coords.latitude, lon: loc.coords.longitude };
    }
  } catch {
    // fall through to default
  }
  return { lat: DEFAULT_LAT, lon: DEFAULT_LON };
}

function HeaderWeatherInner({ textColor }: { textColor: string }) {
  const [display, setDisplay] = useState<{ temp: number; main: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasSource, setHasSource] = useState(false);

  const fetchWeather = useCallback(async () => {
    const useGoogle = await isGoogleWeatherConfigured();
    const useOpenWeather = isWeatherConfigured();
    if (!useGoogle && !useOpenWeather) {
      setHasSource(false);
      setLoading(false);
      return;
    }
    setHasSource(true);
    setLoading(true);
    setError(false);
    try {
      const coords =
        Platform.OS === "web" ? await getLocation() : await getLocationNative();
      if (useGoogle) {
        const cur = await getGoogleCurrentConditions(coords.lat, coords.lon);
        if (cur?.temperature) {
          setDisplay({
            temp: Math.round(cur.temperature.degrees ?? 0),
            main: cur.weatherCondition?.description?.text ?? "—",
          });
        } else {
          setDisplay(null);
        }
      } else {
        const w = await getCurrentWeather(coords.lat, coords.lon);
        setDisplay(
          w
            ? {
                temp: Math.round(w.temp),
                main: w.condition?.main ?? "",
              }
            : null
        );
      }
    } catch {
      setError(true);
      setDisplay(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  if (!hasSource && !loading) {
    return (
      <View style={styles.wrap}>
        <Text style={[styles.condition, { color: textColor, opacity: 0.7 }]} numberOfLines={1}>
          —
        </Text>
      </View>
    );
  }
  if (loading) {
    return (
      <View style={styles.wrap}>
        <ActivityIndicator size="small" color={textColor} />
      </View>
    );
  }
  if (error || !display) {
    return (
      <View style={styles.wrap}>
        <Text style={[styles.condition, { color: textColor, opacity: 0.7 }]} numberOfLines={1}>
          —
        </Text>
      </View>
    );
  }

  const { temp, main } = display;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.temp, { color: textColor }]}>{temp}°</Text>
      <Text style={[styles.condition, { color: textColor }]} numberOfLines={1}>
        {main}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  temp: {
    fontSize: 18,
    fontWeight: "600",
  },
  condition: {
    fontSize: 13,
    opacity: 0.9,
    maxWidth: 72,
  },
});

export const HeaderWeather = React.memo(HeaderWeatherInner);
