/**
 * PMTiles custom protocol for MapLibre React Native.
 * Supports remote (pmtiles://https://...) and local (pmtiles://local-{cityId}/) so R2 works offline when downloaded.
 */

import { Platform } from "react-native";

let registered = false;
const localPaths = new Map<string, string>();

function getMapLibre(): any {
  if (Platform.OS === "web") return null;
  try {
    return require("@maplibre/maplibre-react-native").default;
  } catch {
    return null;
  }
}

/**
 * Register a local PMTiles file path for a city so that requests to
 * pmtiles://local-{cityId}/z/x/y are served from that file.
 */
export function registerLocalPmtilesPath(cityId: string, localPath: string): void {
  localPaths.set(`local-${cityId}`, localPath);
}

export function unregisterLocalPmtilesPath(cityId: string): void {
  localPaths.delete(`local-${cityId}`);
}

/**
 * Register the pmtiles custom protocol with MapLibre (native only).
 * Call once at app startup (e.g. in _layout.tsx).
 */
export function registerPMTilesProtocol(): void {
  if (registered) return;
  const MapLibreGL = getMapLibre();
  if (!MapLibreGL?.addCustomProtocol) return;
  try {
    const { PMTiles } = require("pmtiles");
    const remoteCache = new Map<string, InstanceType<typeof PMTiles>>();
    const localCache = new Map<string, InstanceType<typeof PMTiles>>();

    MapLibreGL.addCustomProtocol("pmtiles", async (params: { url: string }) => {
      try {
        const url = params.url.replace("pmtiles://", "");
        const parts = url.split("/").filter(Boolean);
        const z = parseInt(parts[parts.length - 3], 10);
        const x = parseInt(parts[parts.length - 2], 10);
        const y = parseInt(parts[parts.length - 1], 10);
        if (isNaN(z) || isNaN(x) || isNaN(y)) {
          return { data: new ArrayBuffer(0) };
        }

        const prefix = parts.slice(0, -3).join("/");
        const isLocal = prefix.startsWith("local-");
        const key = isLocal ? prefix : (prefix.endsWith(".pmtiles") ? prefix : `${prefix}.pmtiles`);

        if (isLocal) {
          const path = localPaths.get(prefix);
          if (!path) {
            return { data: new ArrayBuffer(0) };
          }
          if (!localCache.has(key)) {
            const FileSystem = require("expo-file-system/legacy").default;
            const base64 = await FileSystem.readAsStringAsync(path, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            localCache.set(key, new PMTiles(bytes.buffer));
          }
          const tile = await localCache.get(key)!.getZxy(z, x, y);
          if (!tile?.data) return { data: new ArrayBuffer(0) };
          return { data: tile.data };
        }

        const pmtilesUrl = key.includes(".pmtiles") ? key : `${prefix}.pmtiles`;
        if (!remoteCache.has(pmtilesUrl)) {
          remoteCache.set(pmtilesUrl, new PMTiles(pmtilesUrl));
        }
        const tile = await remoteCache.get(pmtilesUrl)!.getZxy(z, x, y);
        if (!tile?.data) return { data: new ArrayBuffer(0) };
        return { data: tile.data };
      } catch (e) {
        console.warn("[pmtiles] Tile fetch failed:", e);
        return { data: new ArrayBuffer(0) };
      }
    });

    registered = true;
  } catch (e) {
    console.warn("[maplibre-pmtiles-protocol] Failed to register:", e);
  }
}
