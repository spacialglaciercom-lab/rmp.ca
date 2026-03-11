/**
 * Favorites store — saved places with Zustand + persist.
 * See Master Plan Section 12, AGENT_HANDOFF Phase 4.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
export interface Favorite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category?: string;
  createdAt: string;
}

interface FavoritesState {
  favorites: Favorite[];
  addFavorite: (fav: Omit<Favorite, "id" | "createdAt">) => void;
  removeFavorite: (id: string) => void;
  /** Remove all favorites at once. Use for "Clear all" in UI. */
  clearAllFavorites: () => void;
  importFromGPX: (gpxData: string) => number;
  /** Export a single favorite as a GPX file (one waypoint). */
  exportFavoriteToGPX: (fav: Favorite) => string;
}

function generateId(): string {
  return `fav_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function parsePointsFromFile(
  data: string,
): Array<{ name: string; lat: number; lon: number }> {
  // Try GPX first
  const gpxPoints = parseGPXPoints(data);
  if (gpxPoints.length > 0) return gpxPoints;
  // Try KML
  return parseKMLPoints(data);
}

function parseKMLPoints(
  kmlData: string,
): Array<{ name: string; lat: number; lon: number }> {
  const points: Array<{ name: string; lat: number; lon: number }> = [];
  // KML Placemark: <Placemark>...</Placemark> with <name> and <coordinates>lon,lat[,alt]</coordinates>
  const placemarkRegex = /<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let match;
  while ((match = placemarkRegex.exec(kmlData)) !== null) {
    const inner = match[1];
    const coordMatch = inner.match(/<coordinates>([^<]+)<\/coordinates>/i);
    if (!coordMatch) continue;
    const parts = coordMatch[1].trim().split(/[\s,]+/);
    if (parts.length >= 2) {
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        const nameMatch = inner.match(/<name>([\s\S]*?)<\/name>/i);
        const name = nameMatch
          ? nameMatch[1].trim()
          : `Point ${points.length + 1}`;
        points.push({ name, lat, lon });
      }
    }
  }
  return points;
}

function parseGPXPoints(
  gpxData: string,
): Array<{ name: string; lat: number; lon: number }> {
  const points: Array<{ name: string; lat: number; lon: number }> = [];

  // Parse wpt (waypoint) elements
  const wptRegex =
    /<wpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/wpt>/gi;
  let match;
  while ((match = wptRegex.exec(gpxData)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      const inner = match[3];
      const nameMatch = inner.match(/<name>([\s\S]*?)<\/name>/i);
      const name = nameMatch
        ? nameMatch[1].trim()
        : `Point ${points.length + 1}`;
      points.push({ name, lat, lon });
    }
  }

  // Parse trkpt (track point) elements if no waypoints — add first point as "Imported Track"
  if (points.length === 0) {
    const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>/gi;
    const trackPts: Array<{ lat: number; lon: number }> = [];
    while ((match = trkptRegex.exec(gpxData)) !== null) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        trackPts.push({ lat, lon });
      }
    }
    if (trackPts.length > 0) {
      const nameMatch = gpxData.match(/<name>([\s\S]*?)<\/name>/i);
      const name = nameMatch ? nameMatch[1].trim() : "Imported Track";
      points.push({
        name,
        lat: trackPts[0].lat,
        lon: trackPts[0].lon,
      });
      if (trackPts.length > 1) {
        points.push({
          name: `${name} (end)`,
          lat: trackPts[trackPts.length - 1].lat,
          lon: trackPts[trackPts.length - 1].lon,
        });
      }
    }
  }

  return points;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],

      addFavorite: (fav) => {
        const now = new Date().toISOString();
        set((state) => ({
          favorites: [
            ...state.favorites,
            {
              ...fav,
              id: generateId(),
              createdAt: now,
            },
          ],
        }));
      },

      removeFavorite: (id) => {
        set((state) => ({
          favorites: state.favorites.filter((f) => f.id !== id),
        }));
      },

      clearAllFavorites: () => {
        set({ favorites: [] });
        // Purge persisted key so a huge stored blob (e.g. 1000+ items) is fully removed.
        // Otherwise only in-memory slice may have been cleared and rehydration can bring back stale data.
        const PERSIST_KEY = "trashroute-favorites";
        AsyncStorage.removeItem(PERSIST_KEY).catch(() => {});
      },

      importFromGPX: (gpxData) => {
        const points = parsePointsFromFile(gpxData);
        if (points.length === 0) return 0;
        const now = new Date().toISOString();
        const newFavs: Favorite[] = points.map((p, i) => ({
          id: generateId(),
          name: p.name,
          lat: p.lat,
          lon: p.lon,
          createdAt: now,
        }));
        set((state) => ({
          favorites: [...state.favorites, ...newFavs],
        }));
        return newFavs.length;
      },

      exportFavoriteToGPX: (fav) => {
        const timestamp = new Date().toISOString();
        const safeName = escapeXml(fav.name);
        return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RouteMasterPro" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${safeName}</name>
    <time>${timestamp}</time>
    <desc>Exported from RouteMasterPro My Places</desc>
  </metadata>
  <wpt lat="${fav.lat}" lon="${fav.lon}">
    <name>${safeName}</name>
    <time>${timestamp}</time>
  </wpt>
</gpx>`;
      },
    }),
    {
      name: "trashroute-favorites",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
