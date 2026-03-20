/**
 * Mapillary API v4 service for fetching street-level imagery.
 * Uses Graph API with bbox parameter to find images near coordinates.
 *
 * Token from: https://www.mapillary.com/connect?client_id=33877043798608580
 */

import { Linking, Platform } from "react-native";

/** URL scheme for the Mapillary app (used for deep linking). */
export const MAPILLARY_APP_SCHEME = "mapillary";

/** Deep link to open Mapillary in capture mode. Falls back to opening the app if capture path is not supported. */
export const MAPILLARY_CAPTURE_URL = "mapillary://capture";

/** App Store URL for Mapillary (iOS). */
export const MAPILLARY_APP_STORE_URL =
  "https://apps.apple.com/us/app/mapillary/id757286802";

/** Play Store URL for Mapillary (Android). */
export const MAPILLARY_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.mapillary.app";

/** Mapillary access token. Replace with your own from the developer dashboard if needed. */
export const MAPILLARY_ACCESS_TOKEN =
  "MLY|33877043798608580|f38b33a2ed004d9b01db55776c9da677";

/** Mapillary client ID for embed URLs. */
export const MAPILLARY_CLIENT_ID = "33877043798608580";

const GRAPH_API_BASE = "https://graph.mapillary.com";

/** Small bbox delta (degrees) - must be < 0.01 sq deg total. ~0.003 each way ≈ 0.000036 sq deg. */
const BBOX_DELTA = 0.003;

interface MapillaryImage {
  id: string;
  computed_geometry?: {
    type: string;
    coordinates: [number, number]; // [lon, lat]
  };
}

interface MapillaryImagesResponse {
  data: MapillaryImage[];
}

/**
 * Compute squared distance between two points (avoids sqrt for comparison).
 */
function distSq(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dlat = lat2 - lat1;
  const dlon = lon2 - lon1;
  return dlat * dlat + dlon * dlon;
}

/**
 * Fetch the image_id of the closest Mapillary image to the given coordinates.
 *
 * @param latitude - Latitude
 * @param longitude - Longitude
 * @returns The image_id string, or null if no image found or request fails
 */
export async function fetchMapillaryImage(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const token = MAPILLARY_ACCESS_TOKEN;
  if (!token) {
    console.warn("[Mapillary] No access token configured");
    return null;
  }

  // Create a small bbox around the point (must be < 0.01 sq degrees)
  const minLon = longitude - BBOX_DELTA;
  const maxLon = longitude + BBOX_DELTA;
  const minLat = latitude - BBOX_DELTA;
  const maxLat = latitude + BBOX_DELTA;
  const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;

  const url = `${GRAPH_API_BASE}/images?access_token=${encodeURIComponent(token)}&fields=id,computed_geometry&bbox=${bbox}&limit=20`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("[Mapillary] API error:", res.status, res.statusText);
      return null;
    }
    const json = (await res.json()) as MapillaryImagesResponse;
    const images = json?.data;
    if (!images || images.length === 0) {
      return null;
    }

    // Pick the closest image by coordinates
    let closest = images[0];
    let minDist = Infinity;
    for (const img of images) {
      const coords = img.computed_geometry?.coordinates;
      if (coords) {
        const [lon, lat] = coords;
        const d = distSq(latitude, longitude, lat, lon);
        if (d < minDist) {
          minDist = d;
          closest = img;
        }
      } else {
        // Fallback: no geometry, assume first is fine
        if (minDist === Infinity) closest = img;
      }
    }
    return String(closest.id);
  } catch (e) {
    console.warn("[Mapillary] fetchMapillaryImage failed:", e);
    return null;
  }
}

/** Alias: fetches the closest image ID to the given coordinates. */
export const getClosestImageId = fetchMapillaryImage;

/**
 * Build the Mapillary embed URL for a given image_id.
 * Mapillary embed expects image_key (same as image_id).
 */
export function buildMapillaryEmbedUrl(imageId: string): string {
  return `https://www.mapillary.com/embed?image_key=${imageId}&style=photo&client_id=${MAPILLARY_CLIENT_ID}`;
}

/**
 * Opens the Mapillary app in capture mode via deep link if installed.
 * If not installed, opens the App Store (iOS) or Play Store (Android) so the user can download it.
 */
export async function openMapillaryCapture(): Promise<void> {
  const captureUrl = MAPILLARY_CAPTURE_URL;
  const storeUrl =
    Platform.OS === "ios" ? MAPILLARY_APP_STORE_URL : MAPILLARY_PLAY_STORE_URL;

  try {
    const canOpen = await Linking.canOpenURL(captureUrl);
    if (canOpen) {
      await Linking.openURL(captureUrl);
    } else {
      await Linking.openURL(storeUrl);
    }
  } catch (e) {
    console.warn("[Mapillary] openMapillaryCapture failed:", e);
    // Fallback to store if deep link fails (e.g. app not installed)
    try {
      await Linking.openURL(storeUrl);
    } catch (storeErr) {
      console.warn("[Mapillary] Could not open store:", storeErr);
    }
  }
}
