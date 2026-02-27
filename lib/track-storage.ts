/**
 * Persistence layer for recorded GPS tracks.
 * Follows the same AsyncStorage pattern as lib/storage.ts.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export interface TrackPoint {
  lat: number;
  lon: number;
  altitude: number | null;
  timestamp: number; // epoch ms
  speed: number | null; // m/s
  accuracy: number | null; // meters
}

export interface SavedTrack {
  id: string;
  name: string;
  createdAt: string; // ISO
  points: TrackPoint[];
  totalDistanceMeters: number;
  elapsedMs: number;
  pointCount: number;
  gpxData: string;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

const SAVED_TRACKS_KEY = "@trashroute:saved_tracks";
const BG_BUFFER_KEY = "@trashroute:bg_track_buffer";
const MAX_SAVED_TRACKS = 50;

function generateTrackId(): string {
  return `trk_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function computeBounds(points: TrackPoint[]): SavedTrack["bounds"] {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLon = Infinity,
    maxLon = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Generate GPX XML with per-point timestamps and elevation.
 * Enhanced version of generateGPXString from routing-context.tsx.
 */
export function generateRecordedTrackGPX(
  name: string,
  points: TrackPoint[]
): string {
  const timestamp = new Date().toISOString();
  const trackPoints = points
    .map((p) => {
      const time = new Date(p.timestamp).toISOString();
      const ele =
        p.altitude != null
          ? `\n        <ele>${p.altitude.toFixed(1)}</ele>`
          : "";
      return `      <trkpt lat="${p.lat}" lon="${p.lon}">${ele}\n        <time>${time}</time>\n      </trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RouteMasterPro"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${timestamp}</time>
    <desc>GPS track recorded with RouteMasterPro</desc>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const trackStorage = {
  async saveTrack(
    name: string,
    points: TrackPoint[],
    totalDistanceMeters: number,
    elapsedMs: number
  ): Promise<SavedTrack> {
    const gpxData = generateRecordedTrackGPX(name, points);
    const track: SavedTrack = {
      id: generateTrackId(),
      name,
      createdAt: new Date().toISOString(),
      points,
      totalDistanceMeters,
      elapsedMs,
      pointCount: points.length,
      gpxData,
      bounds: computeBounds(points),
    };

    try {
      const existing = await this.loadTracks();
      existing.unshift(track);
      const limited = existing.slice(0, MAX_SAVED_TRACKS);
      await AsyncStorage.setItem(SAVED_TRACKS_KEY, JSON.stringify(limited));
    } catch (error) {
      console.error("Error saving recorded track:", error);
    }
    return track;
  },

  async loadTracks(): Promise<SavedTrack[]> {
    try {
      const data = await AsyncStorage.getItem(SAVED_TRACKS_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error("Error loading recorded tracks:", error);
      return [];
    }
  },

  async deleteTrack(id: string): Promise<void> {
    try {
      const tracks = await this.loadTracks();
      const filtered = tracks.filter((t) => t.id !== id);
      await AsyncStorage.setItem(SAVED_TRACKS_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error("Error deleting recorded track:", error);
    }
  },

  async clearAllTracks(): Promise<void> {
    try {
      await AsyncStorage.removeItem(SAVED_TRACKS_KEY);
    } catch (error) {
      console.error("Error clearing recorded tracks:", error);
    }
  },

  // Background buffer helpers
  async readBgBuffer(): Promise<TrackPoint[]> {
    try {
      const data = await AsyncStorage.getItem(BG_BUFFER_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  async appendBgBuffer(points: TrackPoint[]): Promise<void> {
    try {
      const existing = await this.readBgBuffer();
      existing.push(...points);
      await AsyncStorage.setItem(BG_BUFFER_KEY, JSON.stringify(existing));
    } catch (error) {
      console.error("Error writing bg buffer:", error);
    }
  },

  async clearBgBuffer(): Promise<void> {
    try {
      await AsyncStorage.removeItem(BG_BUFFER_KEY);
    } catch {
      // ignore
    }
  },
};
