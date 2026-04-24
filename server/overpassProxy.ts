/**
 * Overpass API proxy — avoids CORS issues when calling from web.
 * Native (iOS/Android) can call Overpass directly; web routes through this proxy.
 * 
 * Endpoints:
 *   POST /api/overpass/query  — proxy to Overpass API interpreter
 */

import type { Express, Request, Response as ExpressResponse } from "express";
import { createLogger } from "./logger";

const log = createLogger("overpass-proxy");

/** Public Overpass API endpoints (tried round-robin until one succeeds). */
export const OVERPASS_API_ENDPOINTS: readonly string[] = [
  "https://overpass-api.de/api/interpreter",                  // Main — official, high capacity (DE)
  "https://overpass.openstreetmap.fr/api/interpreter",        // French — reliable, may lag ~minutes (FR)
  "https://overpass.osm.ch/api/interpreter",                  // Swiss — fast, best for European queries (CH)
  "https://overpass.kumi.systems/api/interpreter",            // Kumi Systems — independent, strict rate limits (AT)
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",  // mail.ru (RU)
  "https://overpass.osm.rambler.ru/cgi/interpreter",          // Rambler (RU)
  "https://overpass.private.coffee/api/interpreter",          // private.coffee (AT)
];

const OVERPASS_USER_AGENT =
  "Mozilla/5.0 (compatible; RouteMasterPro/1.0; OSM Extractor)";

const HEADERS = {
  "User-Agent": OVERPASS_USER_AGENT,
  "Content-Type": "application/x-www-form-urlencoded",
};

/** Max query length for GET fallback (URL length limit). */
const MAX_GET_QUERY_LENGTH = 1800;

interface OverpassResponse {
  elements?: Array<{
    type: "node" | "way" | "relation";
    id: number;
    lat?: number;
    lon?: number;
    nodes?: number[];
    tags?: Record<string, string>;
  }>;
  error?: string;
  remark?: string;
}

interface OverpassErrorResponse {
  error?: string;
  remark?: string;
}

function parseOverpassResponseText(
  text: string,
  response: { ok: boolean; status: number },
): OverpassResponse {
  let data: OverpassResponse | OverpassErrorResponse;
  try {
    data = JSON.parse(text) as OverpassResponse | OverpassErrorResponse;
  } catch {
    const hint = text.trimStart().startsWith("<")
      ? "Server returned HTML (check query syntax)."
      : text.slice(0, 200);
    throw new Error(
      response.ok
        ? "Invalid response from Overpass API."
        : `Overpass API error: ${response.status}. ${hint}`,
    );
  }

  if (!response.ok) {
    const err = data as OverpassErrorResponse;
    const msg =
      err.error ??
      err.remark ??
      text.slice(0, 200) ??
      `HTTP ${response.status}`;
    throw new Error(`Overpass API: ${msg}`);
  }

  const err = data as OverpassErrorResponse;
  if (err.error) {
    throw new Error(`Overpass API: ${err.error}`);
  }
  if (
    err.remark &&
    (err.remark.includes("error") || err.remark.includes("timeout"))
  ) {
    throw new Error(`Overpass API: ${err.remark}`);
  }

  return data as OverpassResponse;
}

/**
 * Try a single Overpass API endpoint (POST, then GET if POST fails with 4xx).
 */
async function fetchFromEndpoint(
  endpoint: string,
  query: string,
): Promise<OverpassResponse> {
  const encoded = encodeURIComponent(query);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: `data=${encoded}`,
      headers: HEADERS,
    });
  } catch (networkErr) {
    throw new Error(
      `Network error: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`,
    );
  }

  const text = await response.text();

  if (
    !response.ok &&
    response.status >= 400 &&
    response.status < 500 &&
    encoded.length <= MAX_GET_QUERY_LENGTH
  ) {
    try {
      const getUrl = `${endpoint}?data=${encoded}`;
      const getResponse = await fetch(getUrl, {
        method: "GET",
        headers: { "User-Agent": OVERPASS_USER_AGENT },
      });
      const getText = await getResponse.text();
      if (getResponse.ok) {
        return parseOverpassResponseText(getText, getResponse);
      }
    } catch {
      /* ignore GET fallback failure, use POST result below */
    }
  }

  return parseOverpassResponseText(text, response);
}

export function registerOverpassProxyRoutes(app: Express) {
  /**
   * POST /api/overpass/query
   * Body: { query: string } — Overpass QL query
   * Returns Overpass API JSON response
   */
  app.post("/api/overpass/query", async (req: Request, res: ExpressResponse) => {
    try {
      const { query } = req.body as { query?: string };
      if (!query || typeof query !== "string") {
        res.status(400).json({ error: "query is required" });
        return;
      }

      let lastError: Error | null = null;

      // Try each endpoint in round-robin until one succeeds
      for (let i = 0; i < OVERPASS_API_ENDPOINTS.length; i++) {
        const endpoint = OVERPASS_API_ENDPOINTS[i];
        try {
          const data = await fetchFromEndpoint(endpoint, query);
          res.json(data);
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          log.warn(`Endpoint failed: ${endpoint}`, {
            error: lastError.message,
          });
        }
      }

      throw (
        lastError ??
        new Error("All Overpass API endpoints failed. Please try again later.")
      );
    } catch (err) {
      log.error(
        "overpass query error",
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({
        error: err instanceof Error ? err.message : "Overpass query failed",
      });
    }
  });
}
