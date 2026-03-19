/**
 * Open locations in Organic Maps, OsmAnd, or MAPS.ME (offline map apps) via URL schemes.
 * No embedded framework required — opens the user's installed app (no browser).
 *
 * Organic Maps: om://
 * OsmAnd: osmandmaps:// (iOS), geo: (Android when OsmAnd handles it)
 * MAPS.ME: mapswithme:// or mapswithmepro://
 */

import { Linking } from "react-native";

const ORGANIC_MAPS_SCHEME = "om://";
const ORGANIC_MAPS_WEB = "https://omaps.app/";
const MAPSME_SCHEME = "mapswithme://";
const MAPSME_PRO_SCHEME = "mapswithmepro://";
/** OsmAnd app scheme (iOS; Android may use geo: or same scheme). */
const OSMAND_SCHEME = "osmandmaps://";

/**
 * Build Organic Maps URL for a single point (map?v=1&ll=lat,lon&n=title).
 * https://omaps.app/api
 */
export function buildOrganicMapsUrl(
  lat: number,
  lon: number,
  title?: string,
): string {
  const ll = `${lat},${lon}`;
  const params = new URLSearchParams({ v: "1", ll });
  if (title) params.set("n", title);
  return `${ORGANIC_MAPS_SCHEME}map?${params.toString()}`;
}

/**
 * Build Organic Maps URL for multiple points (VRP stops). Shows all pins on the map.
 * Format: om://map?v=1&ll=lat,lon&n=title&ll=lat,lon&n=title...
 * https://omaps.app/api
 */
export function buildOrganicMapsMultiPointUrl(
  points: Array<{ lat: number; lon: number; title?: string }>,
): string {
  if (points.length === 0) return "";
  const parts: string[] = ["v=1"];
  for (const p of points) {
    parts.push(`ll=${p.lat},${p.lon}`);
    if (p.title != null && p.title !== "")
      parts.push(`n=${encodeURIComponent(p.title)}`);
  }
  return `${ORGANIC_MAPS_SCHEME}map?${parts.join("&")}`;
}

/**
 * Open Organic Maps with multiple points (e.g. VRP route stops). User sees all pins and can plan/navigate in Organic Maps.
 */
export async function openInOrganicMapsWithPoints(
  points: Array<{ lat: number; lon: number; title?: string }>,
  options?: { fallbackToWeb?: boolean; appOnly?: boolean },
): Promise<boolean> {
  if (points.length === 0) return false;
  if (points.length === 1) {
    const p = points[0];
    return openInOrganicMaps(p.lat, p.lon, p.title, {
      appOnly: options?.appOnly,
    });
  }
  const url = buildOrganicMapsMultiPointUrl(points);
  const webUrl = `https://omaps.app/map?${url.replace(/^om:\/\/map\?/, "")}`;

  try {
    const canOpen = await Linking.canOpenURL(ORGANIC_MAPS_SCHEME);
    if (canOpen) {
      await Linking.openURL(url);
      return true;
    }
    if (!options?.appOnly && options?.fallbackToWeb !== false) {
      await Linking.openURL(webUrl);
      return true;
    }
    return false;
  } catch {
    if (!options?.appOnly && options?.fallbackToWeb !== false) {
      try {
        await Linking.openURL(webUrl);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

/**
 * Build MAPS.ME URL for a single point (same format as api-ios).
 */
export function buildMapsMeUrl(
  lat: number,
  lon: number,
  title?: string,
): string {
  const ll = `${lat},${lon}`;
  const params = new URLSearchParams({ v: "1", ll });
  if (title) params.set("n", title);
  return `${MAPSME_SCHEME}map?${params.toString()}`;
}

export type OpenInOrganicMapsOptions = {
  /** When true, only open the native app; do not fall back to web. Caller can show "App not installed" if false. */
  appOnly?: boolean;
};

/**
 * Open a location in Organic Maps if installed.
 * When appOnly is true, only opens the native app (no browser fallback).
 */
export async function openInOrganicMaps(
  lat: number,
  lon: number,
  title?: string,
  options?: OpenInOrganicMapsOptions,
): Promise<boolean> {
  const url = buildOrganicMapsUrl(lat, lon, title);
  const webUrl = `${ORGANIC_MAPS_WEB}map?v=1&ll=${lat},${lon}${title ? `&n=${encodeURIComponent(title)}` : ""}`;

  try {
    const canOpen = await Linking.canOpenURL(ORGANIC_MAPS_SCHEME);
    if (canOpen) {
      await Linking.openURL(url);
      return true;
    }
    if (options?.appOnly) return false;
    await Linking.openURL(webUrl);
    return true;
  } catch {
    if (options?.appOnly) return false;
    try {
      await Linking.openURL(webUrl);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Open a location in MAPS.ME if installed.
 */
export async function openInMapsMe(
  lat: number,
  lon: number,
  title?: string,
): Promise<boolean> {
  const url = buildMapsMeUrl(lat, lon, title);
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Open Organic Maps with a route to the destination (user can start navigation there).
 * Uses om://route?dll=lat,lon&daddr=title&type=vehicle (start = current location if omitted).
 * https://omaps.app/api
 */
export type OfflineMapRouteType =
  | "vehicle"
  | "pedestrian"
  | "bicycle"
  | "transit";

export async function openNavigationInOrganicMaps(
  destinationLat: number,
  destinationLon: number,
  destinationTitle?: string,
  options?: {
    startLat?: number;
    startLon?: number;
    startTitle?: string;
    type?: OfflineMapRouteType;
  },
): Promise<boolean> {
  const type = options?.type ?? "vehicle";
  const params = new URLSearchParams({
    dll: `${destinationLat},${destinationLon}`,
    type,
  });
  if (destinationTitle) params.set("daddr", destinationTitle);
  if (options?.startLat != null && options?.startLon != null) {
    params.set("sll", `${options.startLat},${options.startLon}`);
    if (options.startTitle) params.set("saddr", options.startTitle);
  }
  const url = `${ORGANIC_MAPS_SCHEME}route?${params.toString()}`;
  const webUrl = `https://omaps.app/route?${params.toString()}`;

  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
      return true;
    }
    await Linking.openURL(webUrl);
    return true;
  } catch {
    try {
      await Linking.openURL(webUrl);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Open in the best available offline map app: Organic Maps first, then MAPS.ME.
 * Shows the location; the user can tap "Navigate" / "Route" in Organic Maps for turn-by-turn.
 * On failure, can fall back to opening the coordinates in the system map (optional).
 */
export async function openInOfflineMap(
  lat: number,
  lon: number,
  title?: string,
  options?: { fallbackToWeb?: boolean },
): Promise<boolean> {
  const fallbackToWeb = options?.fallbackToWeb ?? true;

  if (await openInOrganicMaps(lat, lon, title)) return true;
  if (await openInMapsMe(lat, lon, title)) return true;

  if (fallbackToWeb) {
    const webUrl = `${ORGANIC_MAPS_WEB}map?v=1&ll=${lat},${lon}${title ? `&n=${encodeURIComponent(title)}` : ""}`;
    try {
      await Linking.openURL(webUrl);
      return true;
    } catch {
      // last resort: geo: link (opens system map)
      try {
        await Linking.openURL(
          `geo:${lat},${lon}?q=${lat},${lon}${title ? ` (${encodeURIComponent(title)})` : ""}`,
        );
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}

/**
 * Check if Organic Maps can be opened (requires LSApplicationQueriesSchemes in Info.plist for iOS).
 */
export async function canOpenOrganicMaps(): Promise<boolean> {
  try {
    return await Linking.canOpenURL(ORGANIC_MAPS_SCHEME);
  } catch {
    return false;
  }
}

/**
 * Check if MAPS.ME can be opened (requires LSApplicationQueriesSchemes in Info.plist for iOS).
 */
export async function canOpenMapsMe(): Promise<boolean> {
  try {
    return (
      (await Linking.canOpenURL(MAPSME_SCHEME)) ||
      (await Linking.canOpenURL(MAPSME_PRO_SCHEME))
    );
  } catch {
    return false;
  }
}

/**
 * Build OsmAnd app URL (opens the native app with a pin at the location).
 * iOS: osmandmaps://map?pin=lat,lon#zoom/centerLat/centerLon
 * Android: same scheme if registered; otherwise geo: is used by some clients.
 */
export function buildOsmAndUrl(lat: number, lon: number, zoom = 15): string {
  const center = `${zoom}/${lat}/${lon}`;
  return `${OSMAND_SCHEME}map?pin=${lat},${lon}#${center}`;
}

/**
 * Open a location in OsmAnd if installed. App only (no web fallback).
 * Returns true if the app opened, false if OsmAnd is not installed.
 */
export async function openInOsmAnd(
  lat: number,
  lon: number,
  _title?: string,
  options?: { zoom?: number },
): Promise<boolean> {
  const zoom = options?.zoom ?? 15;
  const url = buildOsmAndUrl(lat, lon, zoom);
  try {
    const canOpen = await Linking.canOpenURL(OSMAND_SCHEME);
    if (canOpen) {
      await Linking.openURL(url);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if OsmAnd can be opened (requires LSApplicationQueriesSchemes for osmandmaps on iOS).
 */
export async function canOpenOsmAnd(): Promise<boolean> {
  try {
    return await Linking.canOpenURL(OSMAND_SCHEME);
  } catch {
    return false;
  }
}
