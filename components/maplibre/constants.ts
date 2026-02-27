/**
 * MapLibre style URLs (no API token required).
 * OSM Liberty is a good default; dark variant for dark mode.
 */
export const MAPLIBRE_STYLE_OSM =
  "https://demotiles.maplibre.org/styles/osm-liberty/style.json";
export const MAPLIBRE_STYLE_OSM_DARK =
  "https://demotiles.maplibre.org/styles/osm-dark/style.json";
export const MAPLIBRE_STYLE_STREETS =
  "https://demotiles.maplibre.org/styles/streets/style.json";

/** Overture Maps R2 public bucket base URL. */
export const R2_PUBLIC_BASE = "https://pub-914a188759fd40078f51e48f31a76dba.r2.dev";

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
