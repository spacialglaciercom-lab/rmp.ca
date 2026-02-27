/**
 * Mapillary Contribution Screen — capture street-level imagery with GPS and compass.
 * Requires camera and location permissions. Tracks GPS and device heading while camera is open.
 */
import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { Magnetometer } from "expo-sensors";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useColors } from "@/hooks/use-colors";
import { MapillaryAuthService } from "@/lib/mapillary-auth";
import { uploadToMapillary } from "@/lib/mapillary-upload";

export default function ContributionScreen() {
  const colors = useColors();
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const magnetometerSubscription = useRef<{ remove: () => void } | null>(null);

  const startLocationTracking = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setLocationError("Location permission is required for Mapillary contribution.");
      return;
    }
    setLocationError(null);
    locationSubscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 1,
      },
      (loc) => {
        setLocation({
          lat: loc.coords.latitude,
          lon: loc.coords.longitude,
        });
      }
    );
  }, []);

  useEffect(() => {
    Magnetometer.setUpdateInterval(200);
    const sub = Magnetometer.addListener((data) => {
      const { x, y } = data;
      const angle = Math.atan2(y, x) * (180 / Math.PI);
      const heading = (angle + 360) % 360;
      setHeading(heading);
    });
    magnetometerSubscription.current = sub;
    return () => {
      sub.remove();
      magnetometerSubscription.current = null;
    };
  }, []);

  useEffect(() => {
    startLocationTracking();
    return () => {
      if (locationSubscription.current) {
        locationSubscription.current.remove();
        locationSubscription.current = null;
      }
    };
  }, [startLocationTracking]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || uploading) return;
    if (!location) {
      Alert.alert(
        "Location required",
        "Waiting for GPS. Please ensure location is enabled and try again."
      );
      return;
    }

    const token = await MapillaryAuthService.getAccessToken();
    if (!token) {
      Alert.alert(
        "Not signed in",
        "Please sign in to Mapillary first from the home screen."
      );
      return;
    }

    if (Platform.OS !== "web") hapticImpact();

    setUploading(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        base64: false,
        skipProcessing: false,
      });

      if (!photo?.uri) {
        throw new Error("Failed to capture photo");
      }

      const result = await uploadToMapillary({
        imageUri: photo.uri,
        latitude: location.lat,
        longitude: location.lon,
        heading: Math.round(heading),
        accessToken: token,
      });

      if (result.success) {
        if (Platform.OS !== "web") hapticImpact();
        Alert.alert("Uploaded", "Image uploaded to Mapillary successfully.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      } else {
        Alert.alert("Upload failed", result.error ?? "Unknown error");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      Alert.alert("Error", message);
    } finally {
      setUploading(false);
    }
  }, [location, heading, uploading]);

  if (!cameraPermission?.granted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Text style={[styles.message, { color: colors.foreground }]}>
            Camera access is required to contribute imagery.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={requestCameraPermission}
          >
            <Text style={styles.buttonText}>Grant camera permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={{ color: colors.primary }}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />

      {locationError && (
        <View style={[styles.banner, { backgroundColor: colors.error + "E6" }]}>
          <Text style={styles.bannerText}>{locationError}</Text>
        </View>
      )}

      <View style={[styles.overlay, { backgroundColor: colors.surface + "CC" }]}>
        <Text style={[styles.coords, { color: colors.foreground }]}>
          {location
            ? `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)} · ${Math.round(heading)}°`
            : "Acquiring GPS…"}
        </Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.captureButton, uploading && styles.captureButtonDisabled]}
          onPress={handleCapture}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.captureInner} />
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
        <Text style={[styles.closeText, { color: colors.foreground }]}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
    width: "100%",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  message: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  backButton: {
    marginTop: 20,
  },
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    padding: 12,
  },
  bannerText: {
    color: "#fff",
    textAlign: "center",
    fontSize: 13,
  },
  overlay: {
    position: "absolute",
    bottom: 120,
    left: 16,
    right: 16,
    padding: 10,
    borderRadius: 8,
  },
  coords: {
    fontSize: 12,
    textAlign: "center",
  },
  controls: {
    position: "absolute",
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.9)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 4,
    borderColor: "#fff",
  },
  captureButtonDisabled: {
    opacity: 0.7,
  },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#333",
  },
  closeButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 56 : 24,
    left: 16,
    padding: 10,
  },
  closeText: {
    fontSize: 17,
    fontWeight: "500",
  },
});
