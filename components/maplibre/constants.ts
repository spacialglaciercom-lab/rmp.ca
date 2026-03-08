/**
 * MapLibre style URLs — OpenFreeMap (free, no API key, Cloudflare CDN).
 * Drop-in replacement for the old demotiles.maplibre.org demo server which
 * is rate-limited and not suitable for production.
 * Offline packs must use these exact URLs so the map uses cached tiles when loading the same style.
 */
export const MAPLIBRE_STYLE_OSM =
  "https://tiles.openfreemap.org/styles/liberty";
export const MAPLIBRE_STYLE_OSM_DARK =
  "https://tiles.openfreemap.org/styles/dark";
export const MAPLIBRE_STYLE_STREETS =
  "https://tiles.openfreemap.org/styles/bright";

/** Overture Maps R2 public bucket base URL. */
export const R2_PUBLIC_BASE = "https://pub-914a188759fd40078f51e48f31a76dba.r2.dev";

/**
 * Tile URL template for the "map tiles overlay" (raster on top of R2).
 * Same as OSM raster in buildOvertureStyle so behavior is consistent.
 * For full offline overlay, create an offline pack for MAPLIBRE_STYLE_OSM;
 * the pack caches OpenFreeMap tiles; if the base style uses different URLs, prefer those here for pack reuse.
 */
export const MAP_TILES_OVERLAY_TEMPLATE =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/**
 * Rendering and behaviour tweaks.
 * - preferredFramesPerSecond: 60 for smoother pan/zoom; lower (e.g. 30) to save battery.
 * - localizeLabels: use device language for map labels (recommended).
 * - regionDidChangeDebounceTime: ms to debounce region-did-change (reduces re-renders during pan/zoom).
 */
export const MAPLIBRE_RENDER_CONFIG = {
  /** Target FPS. 60 = smooth; 30 = battery-friendly. */
  preferredFramesPerSecond: 60,
  /** Use system language for place names. */
  localizeLabels: true,
  /** Debounce (ms) for onRegionDidChange; 0 = no debounce. */
  regionDidChangeDebounceTime: 0,
} as const;
