/**
 * Weather plugin: map overlays, dashboard widget, and data provider.
 * Uses Google Weather API (same key as Maps) or OpenWeatherMap fallback.
 * Components are lazy-loaded for code splitting.
 */

import { lazy } from "react";
import type { Plugin } from "../types";
import { useMapLayerStore } from "@/stores/mapLayerStore";
import { fetchWeather } from "./fetchWeather";

const WEATHER_OVERLAY_LAYER_ID = "weather-overlay";

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
        // TODO: sample points in bbox or use coords, call fetchWeather, aggregate precipitation into polygons
        return { avoidZones: [] };
      },
      widget: WeatherWidget,
      mapOverlay: WeatherOverlay,
    };
  },
};
