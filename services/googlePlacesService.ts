/**
 * Google Places API (New) — Autocomplete + Place Details.
 * Same API key as Google Maps (getGoogleMapsApiKey).
 * Use for place search UI (address/POI) in navigation and map.
 *
 * Enable "Places API (New)" in Google Cloud Console. Optionally enable
 * "Places API" or "Places UI Kit" (placewidgets.googleapis.com) for full UI Kit features.
 * https://developers.google.com/maps/documentation/places/web-service/overview
 */

import { Platform } from "react-native";
import { getGoogleMapsApiKey } from "@/lib/google-maps-config";
import { getApiBaseUrl } from "@/shared/oauth";

const PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const PLACES_DETAILS_BASE = "https://places.googleapis.com/v1/places";
const PLACES_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";

// ─── Response types ────────────────────────────────────────────────────────

export interface GooglePlacePrediction {
  placeId: string;
  /** Full text description (e.g. "Amoeba Music, Haight Street, San Francisco, CA, USA"). */
  text: string;
}

export interface GooglePlaceDetails {
  placeId: string;
  displayName: string;
  formattedAddress?: string;
  /** Lat/lng for the place. */
  location: { lat: number; lon: number };
}

// ─── Autocomplete ───────────────────────────────────────────────────────────

async function fetchAutocompleteProxy(
  input: string,
  sessionToken?: string,
  locationBias?: { lat: number; lon: number; radiusMeters?: number }
): Promise<{ suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }> }> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API base URL not configured");
  const url = `${base.replace(/\/$/, "")}/api/maps/places/autocomplete`;
  const body: Record<string, unknown> = { input: input.trim() };
  if (sessionToken) body.sessionToken = sessionToken;
  if (locationBias) {
    body.locationBias = {
      circle: {
        center: { latitude: locationBias.lat, longitude: locationBias.lon },
        radius: locationBias.radiusMeters ?? 50000,
      },
    };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Autocomplete failed");
  return data;
}

async function fetchAutocompleteDirect(
  apiKey: string,
  input: string,
  sessionToken?: string,
  locationBias?: { lat: number; lon: number; radiusMeters?: number }
): Promise<{ suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }> }> {
  const body: Record<string, unknown> = { input: input.trim() };
  if (sessionToken) body.sessionToken = sessionToken;
  if (locationBias) {
    body.locationBias = {
      circle: {
        center: { latitude: locationBias.lat, longitude: locationBias.lon },
        radius: locationBias.radiusMeters ?? 50000,
      },
    };
  }
  const res = await fetch(PLACES_AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? "Autocomplete failed");
  return data;
}

/**
 * Get place predictions (autocomplete) for the given input.
 * On web uses server proxy; on native uses API key directly.
 */
export async function getPlacePredictions(
  input: string,
  options?: {
    sessionToken?: string;
    locationBias?: { lat: number; lon: number; radiusMeters?: number };
  }
): Promise<GooglePlacePrediction[]> {
  if (!input?.trim()) return [];
  if (Platform.OS === "web") {
    const data = await fetchAutocompleteProxy(
      input,
      options?.sessionToken,
      options?.locationBias
    );
    return parsePredictions(data);
  }
  const apiKey = await getGoogleMapsApiKey();
  if (!apiKey) throw new Error("Google API key not configured");
  const data = await fetchAutocompleteDirect(
    apiKey,
    input,
    options?.sessionToken,
    options?.locationBias
  );
  return parsePredictions(data);
}

function parsePredictions(data: {
  suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }>;
}): GooglePlacePrediction[] {
  const list = data.suggestions ?? [];
  const out: GooglePlacePrediction[] = [];
  for (const s of list) {
    const p = s.placePrediction;
    if (!p?.placeId) continue;
    out.push({
      placeId: p.placeId,
      text: p.text?.text ?? "",
    });
  }
  return out;
}

// ─── Place Details ──────────────────────────────────────────────────────────

async function fetchPlaceDetailsProxy(placeId: string): Promise<{
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API base URL not configured");
  const url = `${base.replace(/\/$/, "")}/api/maps/places/details/${encodeURIComponent(placeId)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Place details failed");
  return data;
}

async function fetchPlaceDetailsDirect(
  apiKey: string,
  placeId: string
): Promise<{
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}> {
  const url = `${PLACES_DETAILS_BASE}/${encodeURIComponent(placeId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? "Place details failed");
  return data;
}

/**
 * Get place details (display name, address, lat/lon) for a place ID.
 * On web uses server proxy; on native uses API key directly.
 */
export async function getPlaceDetails(placeId: string): Promise<GooglePlaceDetails | null> {
  if (!placeId?.trim()) return null;
  try {
    let raw: {
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    };
    if (Platform.OS === "web") {
      raw = await fetchPlaceDetailsProxy(placeId);
    } else {
      const apiKey = await getGoogleMapsApiKey();
      if (!apiKey) return null;
      raw = await fetchPlaceDetailsDirect(apiKey, placeId);
    }
    const lat = raw.location?.latitude;
    const lon = raw.location?.longitude;
    if (lat == null || lon == null) return null;
    return {
      placeId: raw.id ?? placeId,
      displayName: raw.displayName?.text ?? raw.formattedAddress ?? "",
      formattedAddress: raw.formattedAddress,
      location: { lat, lon },
    };
  } catch {
    return null;
  }
}

// ─── Nearby Search (place at location) ───────────────────────────────────────

export interface GooglePlaceNearby {
  placeId: string;
  displayName: string;
  formattedAddress?: string;
  location: { lat: number; lon: number };
}

async function fetchNearbyProxy(
  lat: number,
  lon: number,
  radiusMeters?: number
): Promise<{ places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }> }> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API base URL not configured");
  const res = await fetch(`${base.replace(/\/$/, "")}/api/maps/places/nearby`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon, radiusMeters: radiusMeters ?? 100 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Nearby search failed");
  return data;
}

async function fetchNearbyDirect(
  apiKey: string,
  lat: number,
  lon: number,
  radiusMeters?: number
): Promise<{ places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }> }> {
  const radius = Math.min(50000, Math.max(50, radiusMeters ?? 100));
  const body = {
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lon },
        radius,
      },
    },
    includedTypes: ["store", "point_of_interest", "establishment"],
    maxResultCount: 5,
  };
  const res = await fetch(PLACES_NEARBY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? "Nearby search failed");
  return data;
}

/**
 * Find places near a location (e.g. for tap-on-map). Returns up to 5 places; use first for "place at point".
 * On web uses server proxy; on native uses API key directly. Enable "Places API (New)" and Nearby Search.
 */
export async function searchNearby(
  lat: number,
  lon: number,
  options?: { radiusMeters?: number }
): Promise<GooglePlaceNearby[]> {
  try {
    let data: { places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }> };
    if (Platform.OS === "web") {
      data = await fetchNearbyProxy(lat, lon, options?.radiusMeters);
    } else {
      const apiKey = await getGoogleMapsApiKey();
      if (!apiKey) return [];
      data = await fetchNearbyDirect(apiKey, lat, lon, options?.radiusMeters);
    }
    const places = data.places ?? [];
    return places
      .filter((p) => p?.id && p.location?.latitude != null && p.location?.longitude != null)
      .map((p) => ({
        placeId: p.id!.replace(/^places\//, ""),
        displayName: p.displayName?.text ?? p.formattedAddress ?? "Place",
        formattedAddress: p.formattedAddress,
        location: { lat: p.location!.latitude!, lon: p.location!.longitude! },
      }));
  } catch {
    return [];
  }
}

/**
 * Whether Google Places can be used (same key as Maps).
 * Enable "Places API (New)" in Google Cloud Console.
 */
export async function isGooglePlacesConfigured(): Promise<boolean> {
  if (Platform.OS === "web") {
    const base = getApiBaseUrl();
    if (!base) return false;
    return true;
  }
  const key = await getGoogleMapsApiKey();
  return !!key?.trim();
}
