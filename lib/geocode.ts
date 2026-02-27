/**
 * Geocoding via OpenStreetMap Nominatim (no API key required).
 * Use for address/place search in map and navigation.
 */

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
}

interface NominatimItem {
  lat: string;
  lon: string;
  display_name: string;
}

/**
 * Search for addresses and places. Returns up to 10 results.
 * Nominatim usage policy: 1 request per second; use a descriptive User-Agent.
 */
export async function searchAddress(query: string): Promise<GeocodeResult[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    q: query.trim(),
    format: "json",
    limit: "10",
  });
  const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "RouteMasterPro/1.0 (navigation; address lookup)",
    },
  });
  if (!response.ok) throw new Error(`Geocoding failed: ${response.status}`);
  const data = (await response.json()) as NominatimItem[];
  const list = Array.isArray(data) ? data : [];
  return list
    .filter((item) => item && (item.lat != null || item.lon != null))
    .map((item) => ({
      lat: parseFloat(String(item.lat)),
      lon: parseFloat(String(item.lon)),
      displayName: item.display_name != null && String(item.display_name).trim() !== ""
        ? String(item.display_name)
        : `${item.lat}, ${item.lon}`,
    }))
    .filter((r) => !Number.isNaN(r.lat) && !Number.isNaN(r.lon) && r.displayName != null);
}

export interface ReverseGeocodeResult {
  city: string;
  country: string;
  /** Full address string from Nominatim (e.g. "123 Main St, City, Country"). */
  displayName?: string;
}

/**
 * Reverse geocode a lat/lon to city + country via Nominatim.
 * Returns empty strings if lookup fails. displayName is the full address when available.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<ReverseGeocodeResult> {
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: "json",
      zoom: "18",
    });
    const response = await fetch(`${NOMINATIM_REVERSE_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "RouteMasterPro/1.0 (navigation; reverse geocode)",
      },
    });
    if (!response.ok) return { city: "", country: "" };
    const data = await response.json();
    const addr = data?.address ?? {};
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || "";
    const country = addr.country || "";
    const displayName = data?.display_name ? String(data.display_name).trim() : undefined;
    return { city, country, displayName };
  } catch {
    return { city: "", country: "" };
  }
}
