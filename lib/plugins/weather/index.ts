/**
 * Weather plugin: map overlays, dashboard widget, and data provider.
 * Uses Google Weather API (same key as Maps) or OpenWeatherMap fallback.
 * Components are lazy-loaded for code splitting.
 */

import { lazy } from "react";
import type { Plugin } from "../types";
import { useMapLayerStore } from "@/stores/mapLayerStore";
import { fetchWeather, type WeatherDataResult } from "./fetchWeather";

const WEATHER_OVERLAY_LAYER_ID = "weather-overlay";

/** Precipitation threshold (mm) above which we add an avoid zone. */
const PRECIP_AVOID_MM = 0.5;

/** Max points to sample to limit API calls. */
const MAX_SAMPLE_POINTS = 12;

/** Grid size for bbox sampling (e.g. 3 => 3x3 = 9 points). */
const BBOX_GRID_SIZE = 3;

/** Small half-size (deg) for avoid zone around a rainy point (~1.1 km). */
const AVOID_ZONE_HALF_DEG = 0.01;

/**
 * Get precipitation in mm from weather result. OpenWeather uses mm; Google qpf may be mm or in.
 */
function precipitationMm(result: WeatherDataResult | null): number {
  if (!result) return 0;
  if (result.source === "openweather") {
    return result.data.rain1h ?? 0;
  }
  if (result.source === "google") {
    const q = result.data.precipitation?.qpf?.quantity;
    const unit = (result.data.precipitation?.qpf?.unit ?? "").toLowerCase();
    if (q == null) return 0;
    return unit === "in" || unit === "inch" ? (q as number) * 25.4 : (q as number);
  }
  return 0;
}

/**
 * Build a small square polygon around (lon, lat) in GeoJSON order [lon, lat].
 */
function avoidPolygon(lon: number, lat: number): Array<[number, number]> {
  const h = AVOID_ZONE_HALF_DEG;
  return [
    [lon - h, lat - h],
    [lon + h, lat - h],
    [lon + h, lat + h],
    [lon - h, lat + h],
    [lon - h, lat - h],
  ];
}

export const WeatherWidget = lazy(() =>
  import("./WeatherWidget").then((m) => ({ default: m.default })),
);

export const WeatherOverlay = lazy(() =>
  import("./WeatherOverlay").then((m) => ({ default: m.default })),
);

export const weatherPlugin: Plugin = {
  id: "weather",
  name: "Weather Integration",
  description: "Adds weather overlays and forecasts",
  version: "1.0.0",
  initialize(context) {
    context.stores.mapLayer?.addLayer({
      id: WEATHER_OVERLAY_LAYER_ID,
      name: "Weather",
      url: "",
      attribution: "",
      type: "overlay",
      category: "collection",
    });
  },
  destroy() {
    useMapLayerStore.getState().removeLayer(WEATHER_OVERLAY_LAYER_ID);
  },
  getFeatures() {
    return {
      dataProvider: fetchWeather,
      /**
       * Route-oriented provider: accepts bbox and returns avoidZones (e.g. rainy polygons).
       * Used by route-optimization plugin for weather-aware routing. Stub returns empty until
       * multi-point/bbox weather aggregation is implemented.
       */
      dataProviderForRoute: async (opts: {
        bbox?: [number, number, number, number];
        coords?: Array<{ lat: number; lon: number }>;
      }): Promise<{ avoidZones?: Array<Array<[number, number]>> }> => {
        if (!opts.bbox && !opts.coords?.length) return { avoidZones: [] };

        let points: Array<{ lat: number; lon: number }>;
        if (opts.coords?.length) {
          points = opts.coords.slice(0, MAX_SAMPLE_POINTS);
        } else {
          const [minLon, minLat, maxLon, maxLat] = opts.bbox!;
          points = [];
          for (let i = 0; i < BBOX_GRID_SIZE; i++) {
            for (let j = 0; j < BBOX_GRID_SIZE; j++) {
              const lon =
                minLon +
                (maxLon - minLon) * (i + 0.5) / BBOX_GRID_SIZE;
              const lat =
                minLat +
                (maxLat - minLat) * (j + 0.5) / BBOX_GRID_SIZE;
              points.push({ lat, lon });
            }
          }
        }

        const avoidZones: Array<Array<[number, number]>> = [];
        for (let i = 0; i < points.length; i++) {
          const { lat, lon } = points[i];
          const result = await fetchWeather(lat, lon);
          if (precipitationMm(result) >= PRECIP_AVOID_MM) {
            avoidZones.push(avoidPolygon(lon, lat));
          }
          if (i < points.length - 1) {
            await new Promise((r) => setTimeout(r, 80));
          }
        }
        return { avoidZones };
      },
      widget: WeatherWidget,
      mapOverlay: WeatherOverlay,
    };
  },
};
