/**
 * External Navigation — deep link to Google Maps, Apple Maps, or Waze.
 *
 * For "normal" navigation (depot → route start, last stop → depot, special pickups).
 * The app hands off the destination and steps aside completely. No in-app
 * turn-by-turn, no tracking — the external nav app does all the work.
 */

import { Alert, Linking, Platform } from "react-native";
import type {
  ExternalNavApp,
  ExternalNavAppInfo,
  NormalNavDestination,
} from "@/types/navigation";

// ---------------------------------------------------------------------------
// URL Builders (Universal Links / Web fallbacks)
// ---------------------------------------------------------------------------

function googleMapsWebUrl(
  dest: NormalNavDestination,
  from?: { lat: number; lon: number },
): string {
  const destination = dest.address
    ? encodeURIComponent(dest.address)
    : `${dest.lat},${dest.lon}`;

  const origin = from ? `&origin=${from.lat},${from.lon}` : "";
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}${origin}&travelmode=driving`;
}

function appleMapsUrl(
  dest: NormalNavDestination,
  from?: { lat: number; lon: number },
): string {
  const daddr = dest.address
    ? encodeURIComponent(dest.address)
    : `${dest.lat},${dest.lon}`;
  const saddr = from ? `&saddr=${from.lat},${from.lon}` : "";
  return `https://maps.apple.com/?daddr=${daddr}${saddr}&dirflg=d`;
}

function wazeWebUrl(dest: NormalNavDestination): string {
  return `https://waze.com/ul?ll=${dest.lat},${dest.lon}&navigate=yes`;
}

// ---------------------------------------------------------------------------
// Native App URL Builders (deep link schemes)
// ---------------------------------------------------------------------------

function googleMapsNativeUrl(
  dest: NormalNavDestination,
  from?: { lat: number; lon: number },
): string {
  const destination = dest.address
    ? encodeURIComponent(dest.address)
    : `${dest.lat},${dest.lon}`;
  const origin = from ? `&saddr=${from.lat},${from.lon}` : "";
  return `comgooglemaps://?daddr=${destination}${origin}&directionsmode=driving`;
}

function wazeNativeUrl(dest: NormalNavDestination): string {
  return `waze://?ll=${dest.lat},${dest.lon}&navigate=yes`;
}

// ---------------------------------------------------------------------------
// URL Scheme checks (for canOpenURL on iOS)
// ---------------------------------------------------------------------------

const SCHEME_GOOGLE_MAPS = "comgooglemaps://";
const SCHEME_WAZE = "waze://";

// ---------------------------------------------------------------------------
// Availability Detection
// ---------------------------------------------------------------------------

export async function getAvailableNavApps(): Promise<ExternalNavAppInfo[]> {
  const apps: ExternalNavAppInfo[] = [];

  if (Platform.OS === "ios") {
    apps.push({
      id: "apple_maps",
      name: "Apple Maps",
      icon: "apple",
      available: true,
    });
  }

  const googleAvailable =
    Platform.OS === "web" ||
    (await Linking.canOpenURL(SCHEME_GOOGLE_MAPS).catch(() => false));
  apps.push({
    id: "google_maps",
    name: "Google Maps",
    icon: "google-maps",
    available: !!googleAvailable || Platform.OS === "android",
  });

  if (Platform.OS !== "web") {
    const wazeAvailable = await Linking.canOpenURL(SCHEME_WAZE).catch(
      () => false,
    );
    apps.push({
      id: "waze",
      name: "Waze",
      icon: "waze",
      available: !!wazeAvailable,
    });
  }

  return apps;
}

// ---------------------------------------------------------------------------
// Launch Navigation
// ---------------------------------------------------------------------------

export async function launchExternalNav(
  app: ExternalNavApp,
  destination: NormalNavDestination,
  from?: { lat: number; lon: number },
): Promise<boolean> {
  let nativeUrl: string | undefined;
  let webUrl: string;

  switch (app) {
    case "google_maps":
      nativeUrl =
        Platform.OS !== "web"
          ? googleMapsNativeUrl(destination, from)
          : undefined;
      webUrl = googleMapsWebUrl(destination, from);
      break;
    case "apple_maps":
      webUrl = appleMapsUrl(destination, from);
      break;
    case "waze":
      nativeUrl =
        Platform.OS !== "web" ? wazeNativeUrl(destination) : undefined;
      webUrl = wazeWebUrl(destination);
      break;
    default:
      return false;
  }

  try {
    if (nativeUrl) {
      const canOpenNative = await Linking.canOpenURL(nativeUrl);
      if (canOpenNative) {
        await Linking.openURL(nativeUrl);
        return true;
      }
    }
    await Linking.openURL(webUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Show an action sheet letting the user pick which external nav app to use,
 * then launch it. Falls back to Google Maps web URL if nothing else works.
 */
export async function navigateExternally(
  destination: NormalNavDestination,
  from?: { lat: number; lon: number },
): Promise<void> {
  const apps = await getAvailableNavApps();
  const available = apps.filter((a) => a.available);

  if (available.length === 0) {
    const url = googleMapsWebUrl(destination, from);
    await Linking.openURL(url);
    return;
  }

  if (available.length === 1) {
    const ok = await launchExternalNav(available[0].id, destination, from);
    if (!ok) {
      const url = googleMapsWebUrl(destination, from);
      await Linking.openURL(url);
    }
    return;
  }

  return new Promise<void>((resolve) => {
    const buttons: Array<{ text: string; onPress: () => void }> = available.map(
      (app) => ({
        text: app.name,
        onPress: () => {
          launchExternalNav(app.id, destination, from).then(() => resolve());
        },
      }),
    );
    buttons.push({ text: "Cancel", onPress: () => resolve() });

    Alert.alert(
      "Navigate with",
      destination.label
        ? `Navigate to ${destination.label}`
        : "Choose navigation app",
      buttons,
      { cancelable: false },
    );
  });
}

/**
 * Open OsmAnd with the current route.
 * - On native with gpxString: writes full GPX to a temp file and shares it (application/gpx+xml)
 *   so the user can open in OsmAnd and get the whole track.
 * - Otherwise: uses https://osmand.net/map/ with start/finish only (OsmAnd will compute its own route).
 */
export async function openOsmAndViewer(options?: {
  center?: { lat: number; lon: number };
  waypoints?: Array<{ lat: number; lon: number }>;
  /** Full GPX track XML. When provided on native, the file is shared so OsmAnd can open the whole track. */
  gpxString?: string;
}): Promise<void> {
  const { center, waypoints, gpxString } = options ?? {};

  try {
    if (Platform.OS !== "web" && gpxString && gpxString.trim().length > 0) {
      try {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = await import("expo-sharing");
        if (FileSystem.documentDirectory && typeof Sharing.shareAsync === "function") {
          const filename = `trashroute_osmand_${Date.now()}.gpx`;
          const path = `${FileSystem.documentDirectory}${filename}`;
          await FileSystem.writeAsStringAsync(path, gpxString);
          await Sharing.shareAsync(path, {
            mimeType: "application/gpx+xml",
            dialogTitle: "Open in OsmAnd",
          });
          return;
        }
      } catch {
        // Fall through to URL-based open
      }
    }

    let url: string;
    if (waypoints && waypoints.length >= 2) {
      const start = waypoints[0];
      const finish = waypoints[waypoints.length - 1];
      const midLat =
        waypoints.reduce((s, w) => s + w.lat, 0) / waypoints.length;
      const midLon =
        waypoints.reduce((s, w) => s + w.lon, 0) / waypoints.length;
      const z = 12;
      url = `https://osmand.net/map/?start=${start.lat.toFixed(6)},${start.lon.toFixed(6)}&finish=${finish.lat.toFixed(6)},${finish.lon.toFixed(6)}&profile=car#${z}/${midLat.toFixed(4)}/${midLon.toFixed(4)}`;
    } else if (center) {
      url = `https://osmand.net/map/?pin=${center.lat.toFixed(6)},${center.lon.toFixed(6)}#14/${center.lat.toFixed(4)}/${center.lon.toFixed(4)}`;
    } else {
      url = "https://osmand.net/map/";
    }

    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (canOpen) {
      await Linking.openURL(url);
    }
  } catch {
    Alert.alert(
      "Unable to open OsmAnd",
      "Could not launch OsmAnd. You can install it from the app store or open https://osmand.net in a browser.",
    );
  }
}

/**
 * Open Google Maps centered on a specific location with optional waypoints.
 * Used to view the current route in Google Maps without navigation.
 */
export async function openGoogleMapsViewer(options?: {
  center?: { lat: number; lon: number };
  waypoints?: Array<{ lat: number; lon: number }>;
}): Promise<void> {
  try {
    const { center, waypoints } = options ?? {};
    let nativeUrl: string | undefined;
    let webUrl: string;

    // Build web URL (works everywhere and supports full route display)
    if (waypoints && waypoints.length > 1) {
      // Build directions URL using path format: /maps/dir/origin/waypoint1/.../destination
      // Google Maps URL format that reliably shows complete routes
      const coordStrings = waypoints.map((w) => {
        // Round to 6 decimal places to avoid excessive precision
        return `${w.lat.toFixed(6)},${w.lon.toFixed(6)}`;
      });

      webUrl = `https://www.google.com/maps/dir/${coordStrings.join("/")}`;
      console.log("[openGoogleMapsViewer] Generated route URL with", waypoints.length, "waypoints");
    } else if (center) {
      webUrl = `https://www.google.com/maps/@${center.lat.toFixed(6)},${center.lon.toFixed(6)},14z`;
      console.log("[openGoogleMapsViewer] Generated center URL:", webUrl);
    } else {
      webUrl = "https://www.google.com/maps";
      console.log("[openGoogleMapsViewer] Using default Maps URL");
    }

    // Build native URLs that support waypoints
    if (Platform.OS === "ios") {
      // iOS: Prefer web URL for routes with multiple waypoints (better display)
      // comgooglemaps:// scheme has limited waypoint support
      if (waypoints && waypoints.length > 1) {
        nativeUrl = webUrl;
      } else if (center) {
        nativeUrl = `comgooglemaps://?center=${center.lat},${center.lon}&zoom=14`;
      }
    } else if (Platform.OS === "android") {
      // Android: Always use web URL for proper route display
      // The Google Maps app on Android handles https://maps links excellently
      if (waypoints && waypoints.length > 1) {
        nativeUrl = webUrl;
      } else if (center) {
        nativeUrl = `geo:${center.lat},${center.lon}?z=14`;
      }
    }

    // Try native first, fall back to web
    if (nativeUrl) {
      try {
        const canOpenNative = await Linking.canOpenURL(nativeUrl).catch(() => false);
        if (canOpenNative) {
          await Linking.openURL(nativeUrl);
          return;
        }
      } catch {
        // Fall through to web
      }
    }

    // Fallback to web URL
    const canOpenWeb = await Linking.canOpenURL(webUrl).catch(() => false);
    if (canOpenWeb) {
      await Linking.openURL(webUrl);
    }
  } catch {
    // Silently fail — user can try again or use another method
    Alert.alert(
      "Unable to open Google Maps",
      "Could not launch Google Maps. Please try again.",
    );
  }
}

/**
 * Convenience: navigate from current GPS position to a destination.
 * Requests location permission, gets current position, then launches external nav.
 */
export async function navigateFromCurrentLocation(
  destination: NormalNavDestination,
): Promise<void> {
  let from: { lat: number; lon: number } | undefined;

  try {
    if (Platform.OS === "web") {
      from = await new Promise<{ lat: number; lon: number } | undefined>(
        (resolve) => {
          if (typeof navigator !== "undefined" && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (p) =>
                resolve({
                  lat: p.coords.latitude,
                  lon: p.coords.longitude,
                }),
              () => resolve(undefined),
              { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
            );
          } else {
            resolve(undefined);
          }
        },
      );
    } else {
      const Location = await import("expo-location");
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const getPos = (
          Location as {
            getCurrentPositionAsync?: (opts: object) => Promise<{
              coords: { latitude: number; longitude: number };
            }>;
          }
        ).getCurrentPositionAsync;
        if (getPos) {
          const pos = await getPos({});
          from = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        }
      }
    }
  } catch {
    // proceed without origin — the external app will use the user's current location
  }

  await navigateExternally(destination, from);
}
