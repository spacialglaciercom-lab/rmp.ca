/**
 * Builds a MapLibre style JSON object backed by a PMTiles vector source.
 *
 * Every source is marked `volatile: true` so MapLibre never writes tiles
 * into the ambient cache — the main defence against cache bloat.
 */
export interface PMTilesStyleOptions {
  /** Full pmtiles:// URL, e.g. "pmtiles://https://example.com/transport.pmtiles" */
  url: string;
  /** Optional extra source layers */
  extraSources?: Record<string, any>;
}

export function buildPMTilesStyle(options: PMTilesStyleOptions) {
  const { url, extraSources } = options;

  return {
    version: 8 as const,
    name: "trashroute-pmtiles",
    sources: {
      transport: {
        type: "vector" as const,
        url: url,
        volatile: true,
      },
      ...Object.fromEntries(
        Object.entries(extraSources ?? {}).map(([k, v]) => [
          k,
          { ...v, volatile: true },
        ]),
      ),
    },
    layers: [
      // Background
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f8f9fa" },
      },
      // Road fills by class
      {
        id: "road-motorway",
        type: "line",
        source: "transport",
        "source-layer": "transportation",
        filter: ["==", "class", "motorway"],
        paint: {
          "line-color": "#e892a2",
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 14, 6],
        },
      },
      {
        id: "road-trunk",
        type: "line",
        source: "transport",
        "source-layer": "transportation",
        filter: ["==", "class", "trunk"],
        paint: {
          "line-color": "#f9b29c",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 14, 5],
        },
      },
      {
        id: "road-primary",
        type: "line",
        source: "transport",
        "source-layer": "transportation",
        filter: ["==", "class", "primary"],
        paint: {
          "line-color": "#fcd6a4",
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 14, 4],
        },
      },
      {
        id: "road-secondary",
        type: "line",
        source: "transport",
        "source-layer": "transportation",
        filter: ["==", "class", "secondary"],
        paint: {
          "line-color": "#f7fabf",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 3],
        },
      },
      {
        id: "road-tertiary",
        type: "line",
        source: "transport",
        "source-layer": "transportation",
        filter: ["==", "class", "tertiary"],
        paint: {
          "line-color": "#ffffff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 14, 2.5],
        },
      },
      {
        id: "road-minor",
        type: "line",
        source: "transport",
        "source-layer": "transportation",
        filter: [
          "any",
          ["==", "class", "minor"],
          ["==", "class", "service"],
          ["==", "class", "track"],
        ],
        paint: {
          "line-color": "#ffffff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.5, 14, 1.5],
        },
      },
      // Connectors (intersections / links)
      {
        id: "connector",
        type: "line",
        source: "transport",
        "source-layer": "transportation",
        filter: ["==", "class", "connector"],
        paint: {
          "line-color": "#ccc",
          "line-width": 1,
          "line-dasharray": [2, 2],
        },
      },
    ],
  };
}
