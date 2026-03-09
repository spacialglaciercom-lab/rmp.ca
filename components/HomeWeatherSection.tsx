/**
 * Home page weather block — Google Weather API (same key as Maps), with OpenWeatherMap fallback.
 * When Google is configured: current conditions, hourly (24h), daily (10 days), history (24h), alerts.
 * When only OpenWeather is configured: current conditions (temp, condition, feels like, humidity, wind).
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTheme } from "@/lib/theme-provider";
import { MinimalCard } from "@/components/minimal";
import {
  isGoogleWeatherConfigured,
  getGoogleCurrentConditions,
  getGoogleHourlyForecast,
  getGoogleDailyForecast,
  getGoogleHourlyHistory,
  getGoogleWeatherAlerts,
} from "@/services/googleWeatherService";
import type {
  GoogleCurrentConditions,
  GoogleForecastHour,
  GoogleForecastDay,
  GoogleHistoryHour,
  GoogleWeatherAlert,
} from "@/services/googleWeatherService";
import { getCurrentWeather, isWeatherConfigured } from "@/services/weatherService";
import type { CurrentWeather } from "@/services/weatherService";
import { cardinalToAbbrev } from "@/lib/weather-utils";

const DEFAULT_LAT = 45.5017;
const DEFAULT_LON = -73.5673;

function getLocation(): Promise<{ lat: number; lon: number }> {
  if (typeof navigator !== "undefined" && "geolocation" in navigator) {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
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
    const getPos = (Location as { getCurrentPositionAsync?: (opts?: object) => Promise<{ coords: { latitude: number; longitude: number } }> }).getCurrentPositionAsync;
    if (getPos) {
      const loc = await getPos({});
      return { lat: loc.coords.latitude, lon: loc.coords.longitude };
    }
  } catch {
    // fallback
  }
  return { lat: DEFAULT_LAT, lon: DEFAULT_LON };
}

function tempStr(t?: { degrees?: number; unit?: string }): string {
  if (t?.degrees == null) return "—";
  return `${Math.round(t.degrees)}°`;
}

function formatDay(d?: { year?: number; month?: number; day?: number }): string {
  if (!d?.year || d.month == null || d.day == null) return "—";
  const date = new Date(d.year, (d.month ?? 1) - 1, d.day);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatHour(d?: { hours?: number }, tz?: string): string {
  if (d?.hours == null) return "—";
  const h = d.hours % 24;
  return `${h}:00`;
}

function windStr(w?: { speed?: { value?: number; unit?: string }; gust?: { value?: number; unit?: string }; direction?: { cardinal?: string } }): string | null {
  if (!w?.speed?.value) return null;
  const spd = Math.round(w.speed.value);
  const unit = w.speed.unit === "MILES_PER_HOUR" ? "mph" : "km/h";
  const dir = cardinalToAbbrev(w.direction?.cardinal);
  const gust = w.gust?.value ? ` (gusts ${Math.round(w.gust.value)})` : "";
  return `${dir ? dir + " " : ""}${spd} ${unit}${gust}`;
}

function windShort(w?: { speed?: { value?: number; unit?: string }; direction?: { cardinal?: string } }): string | null {
  if (!w?.speed?.value) return null;
  const spd = Math.round(w.speed.value);
  const unit = w.speed.unit === "MILES_PER_HOUR" ? "mph" : "km/h";
  const dir = cardinalToAbbrev(w.direction?.cardinal);
  return `${dir ? dir + " " : ""}${spd}${unit}`;
}

type WeatherSource = "google" | "openweather";

export function HomeWeatherSection() {
  const { theme } = useTheme();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [source, setSource] = useState<WeatherSource | null>(null);
  const [current, setCurrent] = useState<GoogleCurrentConditions | null>(null);
  const [openWeatherCurrent, setOpenWeatherCurrent] = useState<CurrentWeather | null>(null);
  const [hourly, setHourly] = useState<GoogleForecastHour[]>([]);
  const [daily, setDaily] = useState<GoogleForecastDay[]>([]);
  const [history, setHistory] = useState<GoogleHistoryHour[]>([]);
  const [alerts, setAlerts] = useState<GoogleWeatherAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const hasFetchedOnce = useRef(false);

  const fetchAll = useCallback(async (isRefresh = false) => {
    const googleOk = await isGoogleWeatherConfigured();
    const openWeatherOk = isWeatherConfigured();
    const anyOk = googleOk || openWeatherOk;
    setConfigured(anyOk);
    if (!anyOk) {
      setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(false);
    try {
      const coords = Platform.OS === "web" ? await getLocation() : await getLocationNative();
      if (googleOk) {
        const [cur, hourRes, dayRes, histRes, alertList] = await Promise.all([
          getGoogleCurrentConditions(coords.lat, coords.lon),
          getGoogleHourlyForecast(coords.lat, coords.lon, 24),
          getGoogleDailyForecast(coords.lat, coords.lon, 10),
          getGoogleHourlyHistory(coords.lat, coords.lon, 24),
          getGoogleWeatherAlerts(coords.lat, coords.lon),
        ]);
        setSource("google");
        setCurrent(cur ?? null);
        setOpenWeatherCurrent(null);
        setHourly(hourRes?.forecastHours ?? []);
        setDaily(dayRes?.forecastDays ?? []);
        setHistory(histRes?.historyHours ?? []);
        setAlerts(alertList ?? []);
      } else {
        const ow = await getCurrentWeather(coords.lat, coords.lon);
        setSource("openweather");
        setCurrent(null);
        setOpenWeatherCurrent(ow ?? null);
        setHourly([]);
        setDaily([]);
        setHistory([]);
        setAlerts([]);
      }
    } catch {
      setError(true);
      setCurrent(null);
      setOpenWeatherCurrent(null);
      setHourly([]);
      setDaily([]);
      setHistory([]);
      setAlerts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      hasFetchedOnce.current = true;
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Refetch weather when user returns to Home tab so data stays current (fixes stale weather on iOS)
  useFocusEffect(
    useCallback(() => {
      if (hasFetchedOnce.current && configured) fetchAll(true);
    }, [configured, fetchAll]),
  );

  if (configured === false) return null;

  const colors = { text: theme.text, muted: theme.textTertiary, border: theme.border, surface: theme.surface };

  if (loading && !refreshing) {
    return (
      <MinimalCard style={styles.card}>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.text} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>Loading weather…</Text>
        </View>
      </MinimalCard>
    );
  }

  return (
    <MinimalCard style={styles.card}>
      <ScrollView
        horizontal={false}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={theme.text} />
        }
      >
        {/* Current */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Current</Text>
        {error && (
          <Text style={[styles.muted, { color: colors.muted }]}>Unable to load weather. Pull to retry.</Text>
        )}
        {current && (
          <View style={[styles.currentRow, { borderBottomColor: colors.border }]}>
            <View>
              <Text style={[styles.tempBig, { color: colors.text }]}>{tempStr(current.temperature)}</Text>
              <Text style={[styles.condition, { color: colors.muted }]}>
                {current.weatherCondition?.description?.text ?? "—"}
              </Text>
              {current.feelsLikeTemperature && (
                <Text style={[styles.feelsLike, { color: colors.muted }]}>
                  Feels like {tempStr(current.feelsLikeTemperature)}
                </Text>
              )}
            </View>
            <View>
              {current.relativeHumidity != null && (
                <Text style={[styles.detail, { color: colors.muted }]}>Humidity {current.relativeHumidity}%</Text>
              )}
              {windStr(current.wind) && (
                <Text style={[styles.detail, { color: colors.muted, marginTop: 4 }]}>{windStr(current.wind)}</Text>
              )}
            </View>
          </View>
        )}
        {openWeatherCurrent && (
          <View style={[styles.currentRow, { borderBottomColor: colors.border }]}>
            <View>
              <Text style={[styles.tempBig, { color: colors.text }]}>{Math.round(openWeatherCurrent.temp)}°</Text>
              <Text style={[styles.condition, { color: colors.muted }]}>
                {openWeatherCurrent.condition?.description ?? openWeatherCurrent.condition?.main ?? "—"}
              </Text>
              <Text style={[styles.feelsLike, { color: colors.muted }]}>
                Feels like {Math.round(openWeatherCurrent.feelsLike)}°
              </Text>
            </View>
            <View>
              <Text style={[styles.detail, { color: colors.muted }]}>Humidity {openWeatherCurrent.humidity}%</Text>
              {openWeatherCurrent.windSpeed != null && openWeatherCurrent.windSpeed > 0 && (
                <Text style={[styles.detail, { color: colors.muted, marginTop: 4 }]}>
                  Wind {Math.round(openWeatherCurrent.windSpeed * 3.6)} km/h
                  {openWeatherCurrent.visibility != null && openWeatherCurrent.visibility < 10000
                    ? ` · Vis. ${(openWeatherCurrent.visibility / 1000).toFixed(1)} km`
                    : ""}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Hourly (next 24h) */}
        {hourly.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 16 }]}>Hourly (24h)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
              {hourly.slice(0, 24).map((h, i) => (
                <View key={i} style={[styles.hourPill, { backgroundColor: theme.surfaceAlt }]}>
                  <Text style={[styles.hourLabel, { color: colors.muted }]}>{formatHour(h.displayDateTime)}</Text>
                  <Text style={[styles.hourTemp, { color: colors.text }]}>{tempStr(h.temperature)}</Text>
                  <Text style={[styles.hourCond, { color: colors.muted }]} numberOfLines={1}>
                    {h.weatherCondition?.description?.text ?? "—"}
                  </Text>
                  {windShort(h.wind) && (
                    <Text style={[styles.hourCond, { color: colors.muted, marginTop: 2 }]} numberOfLines={1}>
                      {windShort(h.wind)}
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>
          </>
        )}

        {/* Daily (10 days) */}
        {daily.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 16 }]}>Daily</Text>
            {daily.map((d, i) => (
              <View key={i} style={[styles.dailyRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.dayLabel, { color: colors.text }]}>{formatDay(d.displayDate)}</Text>
                <View style={styles.dailyCenter}>
                  <Text style={[styles.dailyCond, { color: colors.muted }]} numberOfLines={1}>
                    {d.daytimeForecast?.weatherCondition?.description?.text ?? "—"}
                  </Text>
                  <Text style={[styles.precip, { color: theme.accent }]}>
                    Precip {d.daytimeForecast?.precipitation?.probability?.percent ?? 0}%
                  </Text>
                  {windShort(d.daytimeForecast?.wind) && (
                    <Text style={[styles.precip, { color: colors.muted }]}>
                      {windShort(d.daytimeForecast?.wind)}
                    </Text>
                  )}
                </View>
                <Text style={[styles.dailyTemp, { color: colors.text }]}>
                  {tempStr(d.minTemperature)} / {tempStr(d.maxTemperature)}
                </Text>
              </View>
            ))}
          </>
        )}

        {/* History (last 24h) */}
        {history.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 16 }]}>Last 24 hours</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
              {history.slice(0, 12).map((h, i) => (
                <View key={i} style={[styles.hourPill, { backgroundColor: theme.surfaceAlt }]}>
                  <Text style={[styles.hourLabel, { color: colors.muted }]}>{formatHour(h.displayDateTime)}</Text>
                  <Text style={[styles.hourTemp, { color: colors.text }]}>{tempStr(h.temperature)}</Text>
                </View>
              ))}
            </ScrollView>
          </>
        )}

        {/* Alerts */}
        {alerts.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 16 }]}>Weather alerts</Text>
            {alerts.map((a, i) => (
              <View key={a.alertId ?? i} style={[styles.alertRow, { backgroundColor: theme.surfaceAlt }]}>
                <Text style={[styles.alertTitle, { color: colors.text }]}>{a.title ?? "Alert"}</Text>
                {a.severity && (
                  <Text style={[styles.alertMeta, { color: colors.muted }]}>Severity: {a.severity}</Text>
                )}
                {a.summary && (
                  <Text style={[styles.alertSummary, { color: colors.muted }]}>{a.summary}</Text>
                )}
                {a.instruction && (
                  <Text style={[styles.alertInstruction, { color: colors.muted }]}>{a.instruction}</Text>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </MinimalCard>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 16 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16 },
  loadingText: { fontSize: 14 },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  muted: { fontSize: 13, marginBottom: 8 },
  currentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  tempBig: { fontSize: 32, fontWeight: "600" },
  condition: { fontSize: 16, marginTop: 4 },
  feelsLike: { fontSize: 13, marginTop: 2 },
  detail: { fontSize: 13 },
  horizontalScroll: { marginHorizontal: -4, marginBottom: 4 },
  hourPill: {
    width: 80,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginHorizontal: 4,
    alignItems: "center",
  },
  hourLabel: { fontSize: 11 },
  hourTemp: { fontSize: 16, fontWeight: "600", marginTop: 4 },
  hourCond: { fontSize: 10, maxWidth: 72, textAlign: "center" },
  dailyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  dayLabel: { width: 120, fontSize: 14 },
  dailyCenter: { flex: 1 },
  dailyCond: { fontSize: 13 },
  precip: { fontSize: 11, marginTop: 2 },
  dailyTemp: { fontSize: 14, fontWeight: "600" },
  alertRow: { padding: 12, borderRadius: 10, marginBottom: 8 },
  alertTitle: { fontSize: 15, fontWeight: "600" },
  alertMeta: { fontSize: 12, marginTop: 4 },
  alertSummary: { fontSize: 13, marginTop: 4 },
  alertInstruction: { fontSize: 12, marginTop: 4, fontStyle: "italic" },
});
