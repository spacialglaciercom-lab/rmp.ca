/**
 * Google Maps API proxy — avoids CORS issues when calling from web.
 * Native (iOS/Android) calls Google APIs directly; web routes through this proxy.
 *
 * Endpoints:
 *   POST /api/maps/directions  — proxy to Google Directions API
 *   POST /api/maps/snap-to-roads — proxy to Google Roads API (snapToRoads)
 *   POST /api/maps/places/autocomplete — Places API (New) Autocomplete
 *   GET  /api/maps/places/details/:placeId — Place Details (New)
 */

import type { Express, Request, Response } from "express";
import { ENV } from "./_core/env";
import { createLogger } from "./logger";

const log = createLogger("maps-proxy");

const GOOGLE_DIRECTIONS_URL =
  "https://maps.googleapis.com/maps/api/directions/json";
const GOOGLE_ROADS_URL = "https://roads.googleapis.com/v1/snapToRoads";
const PLACES_AUTOCOMPLETE_URL =
  "https://places.googleapis.com/v1/places:autocomplete";
const PLACES_DETAILS_BASE = "https://places.googleapis.com/v1/places";
const PLACES_NEARBY_URL =
  "https://places.googleapis.com/v1/places:searchNearby";

export function registerMapsProxyRoutes(app: Express) {
  /**
   * POST /api/maps/directions
   * Body: { origin, destination, waypoints?, mode?, avoid?, departureTime? } — avoid: "tolls|highways|ferries" or array; departureTime: "now" for traffic
   */
  app.post("/api/maps/directions", async (req: Request, res: Response) => {
    const apiKey = ENV.googleMapsApiKey;
    if (!apiKey) {
      res
        .status(503)
        .json({ error: "Google Maps API key not configured on server" });
      return;
    }

    try {
      const { origin, destination, waypoints, mode, avoid, departureTime } =
        req.body as {
          origin: string;
          destination: string;
          waypoints?: string;
          mode?: string;
          avoid?: string | string[];
          departureTime?: "now" | number;
        };

      if (!origin || !destination) {
        res.status(400).json({ error: "origin and destination are required" });
        return;
      }

      let url = `${GOOGLE_DIRECTIONS_URL}?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=${mode || "driving"}&key=${apiKey}`;
      if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
      const avoidStr = Array.isArray(avoid)
        ? avoid.filter(Boolean).join("|")
        : avoid;
      if (avoidStr) url += `&avoid=${encodeURIComponent(avoidStr)}`;
      if (
        departureTime === "now" ||
        (typeof departureTime === "number" && departureTime > 0)
      ) {
        url += `&departure_time=${departureTime === "now" ? "now" : departureTime}`;
      }

      const response = await fetch(url);
      const data = await response.json();
      res.json(data);
    } catch (err) {
      log.error(
        "directions error",
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({ error: "Directions proxy request failed" });
    }
  });

  /**
   * POST /api/maps/snap-to-roads
   * Body: { path, interpolate? }
   */
  app.post("/api/maps/snap-to-roads", async (req: Request, res: Response) => {
    const apiKey = ENV.googleMapsApiKey;
    if (!apiKey) {
      res
        .status(503)
        .json({ error: "Google Maps API key not configured on server" });
      return;
    }

    try {
      const { path, interpolate } = req.body as {
        path: string;
        interpolate?: boolean;
      };

      if (!path) {
        res.status(400).json({ error: "path is required" });
        return;
      }

      const url = `${GOOGLE_ROADS_URL}?path=${encodeURIComponent(path)}&interpolate=${interpolate !== false}&key=${apiKey}`;

      const response = await fetch(url);
      const data = await response.json();
      res.json(data);
    } catch (err) {
      log.error(
        "snap-to-roads error",
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({ error: "Snap-to-roads proxy request failed" });
    }
  });

  /**
   * POST /api/maps/places/autocomplete
   * Body: { input: string, sessionToken?: string, locationBias?: { circle: { center: { latitude, longitude }, radius } } }
   * Proxies to Places API (New) Autocomplete. Requires Places API (New) and optional Places UI Kit enabled.
   */
  app.post(
    "/api/maps/places/autocomplete",
    async (req: Request, res: Response) => {
      const apiKey = ENV.googleMapsApiKey;
      if (!apiKey) {
        res
          .status(503)
          .json({ error: "Google Maps API key not configured on server" });
        return;
      }
      try {
        const { input, sessionToken, locationBias } = req.body as {
          input?: string;
          sessionToken?: string;
          locationBias?: {
            circle?: {
              center: { latitude: number; longitude: number };
              radius: number;
            };
          };
        };
        if (!input || typeof input !== "string" || !input.trim()) {
          res.status(400).json({ error: "input is required" });
          return;
        }
        const body: Record<string, unknown> = { input: input.trim() };
        if (sessionToken) body.sessionToken = sessionToken;
        if (locationBias) body.locationBias = locationBias;
        const response = await fetch(PLACES_AUTOCOMPLETE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
          },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) {
          res.status(response.status).json(data);
          return;
        }
        res.json(data);
      } catch (err) {
        log.error(
          "places autocomplete error",
          err instanceof Error ? err : new Error(String(err)),
        );
        res.status(500).json({ error: "Places autocomplete request failed" });
      }
    },
  );

  /**
   * POST /api/maps/places/nearby
   * Body: { lat: number, lon: number, radiusMeters?: number }
   * Proxies to Places API (New) searchNearby for place-at-location (e.g. tap on map).
   */
  app.post("/api/maps/places/nearby", async (req: Request, res: Response) => {
    const apiKey = ENV.googleMapsApiKey;
    if (!apiKey) {
      res
        .status(503)
        .json({ error: "Google Maps API key not configured on server" });
      return;
    }
    try {
      const { lat, lon, radiusMeters } = req.body as {
        lat?: number;
        lon?: number;
        radiusMeters?: number;
      };
      if (
        lat == null ||
        lon == null ||
        typeof lat !== "number" ||
        typeof lon !== "number"
      ) {
        res.status(400).json({ error: "lat and lon are required" });
        return;
      }
      const radius = Math.min(50000, Math.max(50, radiusMeters ?? 100));
      const body = {
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lon },
            radius,
          },
        },
        includedTypes: ["store", "point_of_interest", "establishment"],
        maxResultCount: 5,
      };
      const response = await fetch(PLACES_NEARBY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location",
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        res.status(response.status).json(data);
        return;
      }
      res.json(data);
    } catch (err) {
      log.error(
        "places nearby error",
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({ error: "Nearby search failed" });
    }
  });

  /**
   * GET /api/maps/places/details/:placeId
   * Query: fields (comma-separated FieldMask) or default id,displayName,formattedAddress,location
   * Proxies to Place Details (New).
   */
  app.get(
    "/api/maps/places/details/:placeId",
    async (req: Request, res: Response) => {
      const apiKey = ENV.googleMapsApiKey;
      if (!apiKey) {
        res
          .status(503)
          .json({ error: "Google Maps API key not configured on server" });
        return;
      }
      try {
        const placeId = req.params.placeId;
        if (!placeId) {
          res.status(400).json({ error: "placeId is required" });
          return;
        }
        const fields =
          (req.query.fields as string) ||
          "id,displayName,formattedAddress,location";
        const url = `${PLACES_DETAILS_BASE}/${encodeURIComponent(placeId)}`;
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": fields,
          },
        });
        const data = await response.json();
        if (!response.ok) {
          res.status(response.status).json(data);
          return;
        }
        res.json(data);
      } catch (err) {
        log.error(
          "places details error",
          err instanceof Error ? err : new Error(String(err)),
        );
        res.status(500).json({ error: "Place details request failed" });
      }
    },
  );
}
