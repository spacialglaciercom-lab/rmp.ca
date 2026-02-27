/**
 * StreetViewPreview - Full-screen Street View simulation that animates through
 * route waypoints with Google Street View imagery, playback controls, and a mini-map.
 * Native only (requires react-native-webview).
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import Slider from "@react-native-community/slider";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import MapView, { Polyline, Marker } from "react-native-maps";

import { useColors } from "@/hooks/use-colors";
import { Fonts } from "@/lib/_core/theme";
import { getGoogleMapsApiKey } from "@/lib/google-maps-config";
import { generateStreetViewHTML } from "@/lib/streetview-html";
import { haversineDistance } from "@/lib/offlineTurnDetection";

// --- Helpers ---

/** Bearing in degrees (0=N, 90=E) between two {lat,lon} points. Uses radians internally. */
function bearing(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLon = toRad(to.lon - from.lon);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Shortest-arc lerp between two headings in degrees. */
function lerpHeading(a: number, b: number, t: number): number {
  let diff = ((b - a + 540) % 360) - 180;
  return ((a + diff * t) % 360 + 360) % 360;
}

/** Linear interpolation between two points. */
function lerpPoint(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  t: number,
): { lat: number; lon: number } {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
  };
}

function formatDist(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

// --- Constants ---

const BASE_SPEED = 8; // meters per tick at 1x speed
const TICK_MS = 100;
const SPEED_OPTIONS = [0.25, 0.5, 1, 2] as const;
const COVERAGE_SKIP_M = 20;
const MAX_SKIP_M = 200;
const MANUAL_STEP_M = 15; // meters per manual arrow tap

// --- Types ---

interface StreetViewPreviewProps {
  points: { lat: number; lon: number }[];
  isVisible: boolean;
  onClose: () => void;
  trackName?: string;
}

export function StreetViewPreview({
  points,
  isVisible,
  onClose,
  trackName,
}: StreetViewPreviewProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // State
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [svReady, setSvReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [streetName, setStreetName] = useState("");
  const [hasImagery, setHasImagery] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [distanceTraveled, setDistanceTraveled] = useState(0);
  const [currentPos, setCurrentPos] = useState(points[0] ?? { lat: 0, lon: 0 });
  const [currentHeading, setCurrentHeading] = useState(0);

  // Distance traveled ref for animation loop (avoids stale closure)
  const distRef = useRef(0);
  const speedRef = useRef(1);
  const playingRef = useRef(false);

  // Precompute cumulative distance array
  const { cumDist, totalDistance } = useMemo(() => {
    const cd = [0];
    for (let i = 1; i < points.length; i++) {
      cd.push(cd[i - 1] + haversineDistance(points[i - 1], points[i]));
    }
    return { cumDist: cd, totalDistance: cd[cd.length - 1] || 0 };
  }, [points]);

  // Find interpolated position along cumulative distance curve
  const getPositionAtDist = useCallback(
    (d: number): { pos: { lat: number; lon: number }; heading: number; segIdx: number } => {
      const clampedD = Math.max(0, Math.min(d, totalDistance));
      // Binary search for segment
      let lo = 0;
      let hi = cumDist.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cumDist[mid] <= clampedD) lo = mid;
        else hi = mid;
      }
      const segLen = cumDist[lo + 1] - cumDist[lo];
      const t = segLen > 0 ? (clampedD - cumDist[lo]) / segLen : 0;
      const segIdx = lo;
      const pos = lerpPoint(points[segIdx], points[Math.min(segIdx + 1, points.length - 1)], t);
      const head = bearing(
        points[segIdx],
        points[Math.min(segIdx + 1, points.length - 1)],
      );
      return { pos, heading: head, segIdx };
    },
    [points, cumDist, totalDistance],
  );

  // Fetch API key on mount
  useEffect(() => {
    if (isVisible) {
      getGoogleMapsApiKey().then((k) => {
        if (k) setApiKey(k);
        else setLoading(false);
      });
    }
  }, [isVisible]);

  // Keep refs in sync
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  // Animation loop
  useEffect(() => {
    if (!svReady || !playing) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    let prevHeading = currentHeading;

    intervalRef.current = setInterval(() => {
      if (!playingRef.current) return;
      const advance = BASE_SPEED * speedRef.current;
      const newDist = Math.min(distRef.current + advance, totalDistance);
      distRef.current = newDist;

      const { pos, heading: rawHeading } = getPositionAtDist(newDist);
      const smoothed = lerpHeading(prevHeading, rawHeading, 0.3);
      prevHeading = smoothed;

      setDistanceTraveled(newDist);
      setCurrentPos(pos);
      setCurrentHeading(smoothed);

      // Inject into WebView
      webViewRef.current?.injectJavaScript(
        `window.updatePosition(${pos.lat},${pos.lon},${smoothed});true;`,
      );

      // Auto-stop at end
      if (newDist >= totalDistance) {
        setPlaying(false);
      }
    }, TICK_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [svReady, playing, totalDistance, getPositionAtDist]);

  // Handle messages from WebView
  const onMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      switch (msg.type) {
        case "ready":
          setSvReady(true);
          setLoading(false);
          // Set initial position
          if (points.length > 0) {
            const h = points.length > 1 ? bearing(points[0], points[1]) : 0;
            setCurrentHeading(h);
            webViewRef.current?.injectJavaScript(
              `window.updatePosition(${points[0].lat},${points[0].lon},${h});true;`,
            );
          }
          break;
        case "street_name":
          if (msg.name) setStreetName(msg.name);
          break;
        case "status":
          setHasImagery(msg.hasImagery ?? true);
          // Skip forward if no coverage
          if (!msg.hasImagery && playingRef.current) {
            let skipDist = distRef.current;
            let found = false;
            for (let i = 0; i < MAX_SKIP_M / COVERAGE_SKIP_M; i++) {
              skipDist += COVERAGE_SKIP_M;
              if (skipDist >= totalDistance) break;
              const { pos } = getPositionAtDist(skipDist);
              webViewRef.current?.injectJavaScript(
                `window.updatePosition(${pos.lat},${pos.lon},${currentHeading});true;`,
              );
              found = true;
              distRef.current = skipDist;
              setDistanceTraveled(skipDist);
              break;
            }
            if (!found) setHasImagery(false);
          }
          break;
      }
    } catch {}
  }, [points, totalDistance, getPositionAtDist, currentHeading]);

  // Scrubber change
  const handleScrub = useCallback(
    (value: number) => {
      const d = value * totalDistance;
      distRef.current = d;
      setDistanceTraveled(d);
      const { pos, heading: h } = getPositionAtDist(d);
      setCurrentPos(pos);
      setCurrentHeading(h);
      webViewRef.current?.injectJavaScript(
        `window.updatePosition(${pos.lat},${pos.lon},${h});true;`,
      );
    },
    [totalDistance, getPositionAtDist],
  );

  // Manual step forward/backward
  const handleStep = useCallback(
    (direction: 1 | -1) => {
      setPlaying(false);
      const d = Math.max(0, Math.min(distRef.current + direction * MANUAL_STEP_M, totalDistance));
      distRef.current = d;
      setDistanceTraveled(d);
      const { pos, heading: h } = getPositionAtDist(d);
      setCurrentPos(pos);
      setCurrentHeading(h);
      webViewRef.current?.injectJavaScript(
        `window.updatePosition(${pos.lat},${pos.lon},${h});true;`,
      );
    },
    [totalDistance, getPositionAtDist],
  );

  // Cleanup on close
  const handleClose = useCallback(() => {
    setPlaying(false);
    setSvReady(false);
    setLoading(true);
    setStreetName("");
    setHasImagery(true);
    distRef.current = 0;
    setDistanceTraveled(0);
    setApiKey(null);
    onClose();
  }, [onClose]);

  const htmlSource = useMemo(
    () => (apiKey ? { html: generateStreetViewHTML(apiKey) } : null),
    [apiKey],
  );

  // Mini-map region
  const miniRegion = useMemo(() => {
    if (points.length === 0) return undefined;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    const dLat = maxLat - minLat;
    const dLon = maxLon - minLon;
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: Math.max(dLat * 1.3, 0.005),
      longitudeDelta: Math.max(dLon * 1.3, 0.005),
    };
  }, [points]);

  const scrubValue = totalDistance > 0 ? distanceTraveled / totalDistance : 0;

  if (Platform.OS === "web") return null;

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { backgroundColor: "#111" }]}>
        {/* WebView */}
        {htmlSource ? (
          <WebView
            ref={webViewRef}
            source={htmlSource}
            style={styles.webview}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            onMessage={onMessage}
            scrollEnabled={false}
            bounces={false}
          />
        ) : (
          <View style={styles.centered}>
            {loading ? (
              <>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.muted }]}>
                  Loading Street View...
                </Text>
              </>
            ) : (
              <>
                <MaterialCommunityIcons name="google-street-view" size={48} color={colors.muted} />
                <Text style={[styles.loadingText, { color: colors.muted }]}>
                  No Google Maps API key configured
                </Text>
              </>
            )}
          </View>
        )}

        {/* Loading overlay */}
        {loading && htmlSource && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingOverlayText}>Initializing Street View...</Text>
          </View>
        )}

        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <View style={styles.topBarContent}>
            <View style={styles.topBarLeft}>
              {trackName ? (
                <Text style={styles.topBarTitle} numberOfLines={1}>
                  {trackName}
                </Text>
              ) : null}
              {streetName ? (
                <Text style={styles.topBarStreet} numberOfLines={1}>
                  {streetName}
                </Text>
              ) : null}
              {!hasImagery && (
                <Text style={styles.noImageryBadge}>No imagery</Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <MaterialCommunityIcons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Mini-map */}
        {miniRegion && svReady && (
          <View style={[styles.miniMap, { bottom: 140 + insets.bottom }]}>
            <MapView
              style={StyleSheet.absoluteFillObject}
              region={miniRegion}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
              showsUserLocation={false}
              liteMode={Platform.OS === "android"}
            >
              <Polyline
                coordinates={points.map((p) => ({
                  latitude: p.lat,
                  longitude: p.lon,
                }))}
                strokeColor={colors.primary}
                strokeWidth={2}
              />
              <Marker
                coordinate={{
                  latitude: currentPos.lat,
                  longitude: currentPos.lon,
                }}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={[styles.miniMapDot, { backgroundColor: colors.error ?? "#ef4444" }]} />
              </Marker>
            </MapView>
          </View>
        )}

        {/* Manual navigation arrows */}
        {svReady && !playing && (
          <View style={styles.arrowOverlay} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.arrowButton}
              onPress={() => handleStep(-1)}
              disabled={distanceTraveled <= 0}
              activeOpacity={0.7}
            >
              <View style={[styles.arrowInner, distanceTraveled <= 0 && { opacity: 0.3 }]}>
                <MaterialCommunityIcons name="chevron-down" size={32} color="#fff" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.arrowButton}
              onPress={() => handleStep(1)}
              disabled={distanceTraveled >= totalDistance}
              activeOpacity={0.7}
            >
              <View style={[styles.arrowInner, distanceTraveled >= totalDistance && { opacity: 0.3 }]}>
                <MaterialCommunityIcons name="chevron-up" size={32} color="#fff" />
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom controls */}
        {svReady && (
          <View style={[styles.controls, { paddingBottom: insets.bottom + 12 }]}>
            {/* Scrubber */}
            <View style={styles.scrubberRow}>
              <Text style={styles.distLabel}>{formatDist(distanceTraveled)}</Text>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1}
                value={scrubValue}
                onSlidingComplete={handleScrub}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor="rgba(255,255,255,0.3)"
                thumbTintColor={colors.primary}
              />
              <Text style={styles.distLabel}>{formatDist(totalDistance)}</Text>
            </View>

            {/* Play/Pause + Speed chips */}
            <View style={styles.controlRow}>
              <TouchableOpacity
                style={[styles.playButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  if (distanceTraveled >= totalDistance) {
                    // Reset to start if at end
                    distRef.current = 0;
                    setDistanceTraveled(0);
                    const { pos, heading: h } = getPositionAtDist(0);
                    setCurrentPos(pos);
                    setCurrentHeading(h);
                    webViewRef.current?.injectJavaScript(
                      `window.updatePosition(${pos.lat},${pos.lon},${h});true;`,
                    );
                  }
                  setPlaying((p) => !p);
                }}
              >
                <MaterialCommunityIcons
                  name={playing ? "pause" : "play"}
                  size={28}
                  color="#fff"
                />
              </TouchableOpacity>

              <View style={styles.speedChips}>
                {SPEED_OPTIONS.map((s) => {
                  const active = speed === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[
                        styles.speedChip,
                        {
                          borderColor: active ? colors.primary : "rgba(255,255,255,0.4)",
                          backgroundColor: active ? colors.primary : "transparent",
                        },
                      ]}
                      onPress={() => setSpeed(s)}
                    >
                      <Text
                        style={[
                          styles.speedChipText,
                          { color: active ? "#fff" : "rgba(255,255,255,0.8)" },
                        ]}
                      >
                        {s}x
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: "#111",
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
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  loadingOverlayText: {
    color: "#fff",
    marginTop: 12,
    fontSize: 15,
  },
  // Top bar
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  topBarContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topBarLeft: {
    flex: 1,
    marginRight: 12,
  },
  topBarTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  topBarStreet: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    marginTop: 2,
  },
  noImageryBadge: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  // Manual navigation arrows
  arrowOverlay: {
    position: "absolute",
    bottom: "18%",
    alignSelf: "center",
    alignItems: "center",
    gap: 12,
  },
  arrowButton: {
    width: 56,
    height: 56,
    justifyContent: "center",
    alignItems: "center",
  },
  arrowInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  // Mini-map
  miniMap: {
    position: "absolute",
    right: 12,
    width: 120,
    height: 120,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.5)",
  },
  miniMapDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "#fff",
  },
  // Bottom controls
  controls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  scrubberRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  slider: {
    flex: 1,
    marginHorizontal: 8,
  },
  distLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontWeight: "600",
    minWidth: 50,
    textAlign: "center",
  },
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  speedChips: {
    flexDirection: "row",
    gap: 8,
  },
  speedChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  speedChipText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
