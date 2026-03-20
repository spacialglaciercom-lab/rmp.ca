/**
 * MapLibre style with Overture Maps transportation overlay from Cloudflare R2 PMTiles.
 * Uses OSM Liberty as base + Overture transportation segments as an overlay layer.
 */

const R2_PUBLIC_BASE = "https://pub-914a188759fd40078f51e48f31a76dba.r2.dev";

/** Version suffix for PMTiles (YYYY-MM). Bump when deploying new Overture builds. */
export const PMTILES_VERSION = "v2026-02";

/** Get PMTiles URL for a city (versioned for safe updates and rollback). */
export function getPMTilesUrl(city: string, version?: string): string {
  const v = version ?? PMTILES_VERSION;
  return `pmtiles://${R2_PUBLIC_BASE}/tiles/${city}-${v}.pmtiles`;
}

/** Get HTTPS URL for a city's PMTiles (for web / pmtiles.js protocol). */
export function getPMTilesHttpsUrl(city: string, version?: string): string {
  const v = version ?? PMTILES_VERSION;
  return `${R2_PUBLIC_BASE}/tiles/${city}-${v}.pmtiles`;
}

/** Available cities with PMTiles on R2. Add more as you build them. */
export const PMTILES_CITIES: string[] = [
  "montreal",
  "laval",
  "longueuil",
  "toronto",
  "vancouver",
  "ottawa",
  "calgary",
  "edmonton",
  "quebec_city",
  "halifax",
  "winnipeg",
  "saskatoon",
  "regina",
  "victoria",
  "hamilton",
  "kitchener",
  "london_on",
  "st_johns",
  "fredericton",
  "charlottetown",
];

/** Overture road layers (for overlay on web and for dynamic layers on native). Exported for MapLibreRouteMap. */
export const OVERTURE_ROAD_LAYERS = [
  {
    id: "overture-roads-minor",
    type: "line" as const,
    source: "overture-transportation",
    "source-layer": "transportation",
    filter: ["all", ["==", ["get", "type"], "connector"]],
    minzoom: 12,
    paint: { "line-color": "rgba(180, 180, 180, 0.4)", "line-width": 1 },
  },
  {
    id: "overture-roads-residential",
    type: "line" as const,
    source: "overture-transportation",
    "source-layer": "transportation",
    filter: [
      "any",
      ["==", ["get", "class"], "residential"],
      ["==", ["get", "class"], "tertiary"],
      ["==", ["get", "class"], "unclassified"],
      ["==", ["get", "class"], "service"],
    ],
    minzoom: 11,
    paint: {
      "line-color": "rgba(200, 200, 200, 0.6)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.5, 14, 2],
    },
  },
  {
    id: "overture-roads-secondary",
    type: "line" as const,
    source: "overture-transportation",
    "source-layer": "transportation",
    filter: [
      "any",
      ["==", ["get", "class"], "secondary"],
      ["==", ["get", "class"], "secondary_link"],
    ],
    minzoom: 9,
    paint: {
      "line-color": "#e8c84a",
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 14, 3],
      "line-opacity": 0.7,
    },
  },
  {
    id: "overture-roads-primary",
    type: "line" as const,
    source: "overture-transportation",
    "source-layer": "transportation",
    filter: [
      "any",
      ["==", ["get", "class"], "primary"],
      ["==", ["get", "class"], "primary_link"],
      ["==", ["get", "class"], "trunk"],
      ["==", ["get", "class"], "trunk_link"],
    ],
    minzoom: 8,
    paint: {
      "line-color": "#e8884a",
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 14, 4],
      "line-opacity": 0.8,
    },
  },
  {
    id: "overture-roads-motorway",
    type: "line" as const,
    source: "overture-transportation",
    "source-layer": "transportation",
    filter: [
      "any",
      ["==", ["get", "class"], "motorway"],
      ["==", ["get", "class"], "motorway_link"],
    ],
    minzoom: 8,
    paint: {
      "line-color": "#e05050",
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 5],
      "line-opacity": 0.8,
    },
  },
  {
    id: "overture-road-labels",
    type: "symbol" as const,
    source: "overture-transportation",
    "source-layer": "transportation",
    filter: ["all", ["has", "name"], ["!=", ["get", "type"], "connector"]],
    minzoom: 13,
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "name"],
      "text-size": 11,
      "text-max-angle": 30,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#333",
      "text-halo-color": "#fff",
      "text-halo-width": 1.5,
    },
  },
];

/**
 * Build a MapLibre style JSON that overlays Overture transportation data
 * on top of a base OSM style. Returns the style as a JSON string (data URI)
 * that MapView can load via mapStyle prop.
 *
 * When mapTilesAsOverlay is true: R2/Overture roads are drawn first, then map tiles
 * (raster) on top with optional opacity — so "map tiles are an overlay to R2".
 * Use rasterOverlayOpacity (0–1) to control; 0.5 keeps roads visible.
 */
export function buildOvertureStyle(options: {
  baseStyleUrl: string;
  city: string;
  showRoads?: boolean;
  /** When true, draw map tiles on top of R2 (overlay). Default false = tiles under R2. */
  mapTilesAsOverlay?: boolean;
  /** Opacity of the raster overlay when mapTilesAsOverlay is true (0–1). Default 0.5. */
  rasterOverlayOpacity?: number;
}): object {
  const {
    city,
    showRoads = true,
    mapTilesAsOverlay = false,
    rasterOverlayOpacity = 0.5,
  } = options;
  const pmtilesUrl = getPMTilesUrl(city);

  const osmRasterSource = {
    type: "raster" as const,
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    tileSize: 256,
    attribution: "&copy; OpenStreetMap contributors",
    maxzoom: 19,
  };

  const osmRasterLayer = {
    id: "osm-base",
    type: "raster" as const,
    source: "osm-raster",
    minzoom: 0,
    maxzoom: 22,
    ...(mapTilesAsOverlay
      ? { paint: { "raster-opacity": rasterOverlayOpacity } }
      : {}),
  };

  const layers =
    mapTilesAsOverlay && showRoads
      ? [
          // R2/Overture roads first (base for overlay mode)
          ...OVERTURE_ROAD_LAYERS,
          // Map tiles as overlay on top of R2
          osmRasterLayer,
        ]
      : [
          // Classic: base map first, then R2 on top
          osmRasterLayer,
          ...(showRoads ? OVERTURE_ROAD_LAYERS : []),
        ];

  return {
    version: 8,
    name: "Overture Transportation",
    sources: {
      "osm-raster": osmRasterSource,
      ...(showRoads
        ? {
            "overture-transportation": {
              type: "vector",
              url: pmtilesUrl,
              minzoom: 8,
              maxzoom: 14,
            },
          }
        : {}),
    },
    layers,
  };
}

/**
 * Build the style as a data URI string that MapLibre can load directly.
 */
export function buildOvertureStyleUri(options: {
  baseStyleUrl: string;
  city: string;
  showRoads?: boolean;
  mapTilesAsOverlay?: boolean;
  rasterOverlayOpacity?: number;
}): string {
  const style = buildOvertureStyle(options);
  const json = JSON.stringify(style);
  return `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
}

/**
 * Build a MapLibre style containing only the Overture overlay (transparent background).
 * Used on web to draw Overture on top of the Leaflet base map.
 */
export function buildOvertureOverlayStyle(options: { city: string }): object {
  const pmtilesUrl = getPMTilesUrl(options.city);
  return {
    version: 8,
    name: "Overture Overlay",
    sources: {
      "overture-transportation": {
        type: "vector",
        url: pmtilesUrl,
        minzoom: 8,
        maxzoom: 14,
      },
    },
    layers: [
      {
        id: "overture-overlay-bg",
        type: "background",
        paint: { "background-color": "rgba(0,0,0,0)" },
      },
      ...OVERTURE_ROAD_LAYERS,
    ],
  };
}
