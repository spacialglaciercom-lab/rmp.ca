/**
 * Rate limiting middleware for the rmp.ca Node.js API server.
 *
 * Limits are applied in two layers:
 *   1. Global baseline  — catches runaway clients on any route
 *   2. Per-route limits — tighter caps on expensive / billable endpoints
 *
 * All limiters use the default in-memory store (MemoryStore), which is
 * correct for a single Node process.
 *
 * ── Multi-replica upgrade (Redis) ────────────────────────────────────────
 * When running multiple Node replicas (k8s, Cloud Run min-instances > 1),
 * swap the in-memory store for a shared Redis store so limits are enforced
 * cluster-wide:
 *
 *   npm install rate-limit-redis ioredis
 *
 *   import RedisStore from "rate-limit-redis";
 *   import Redis from "ioredis";
 *   const redis = new Redis(process.env.REDIS_URL);
 *   const store = new RedisStore({ sendCommand: (...args) => redis.call(...args) });
 *
 *   Then pass `store` to any rateLimit({ store, ... }) call below.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { createLogger } from "../logger";

const log = createLogger("rate-limits");

// ── Limiters ─────────────────────────────────────────────────────────────

/**
 * Global baseline: 300 requests / minute per IP.
 * Applied to every route — catches runaway or misbehaving clients.
 */
const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests — please slow down." },
  skip: (req) => req.method === "OPTIONS", // never limit CORS preflight
});

/**
 * Optimizer: 15 requests / minute per IP.
 * CPP solves on large city networks can take 30–120s and are CPU-intensive.
 * 15 req/min = one request every 4 seconds sustained — generous for a single driver app.
 */
export const optimizerLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Optimizer rate limit exceeded — max 15 requests/minute.",
  },
});

/**
 * GeoJSON operations: 30 requests / minute per IP.
 * Clean/validate/filter are lighter than full CPP solves but still Python-bound.
 */
export const geojsonLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    ok: false,
    error: "GeoJSON API rate limit exceeded — max 30 requests/minute.",
  },
});

/**
 * AI / Voice: 20 requests / minute per IP.
 * These endpoints call paid third-party APIs (OpenRouter, ElevenLabs, Moonshine).
 * 20 req/min is roughly one voice interaction every 3 seconds — more than enough
 * for a driver having a conversation.
 */
export const aiVoiceLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    ok: false,
    error: "AI/voice rate limit exceeded — max 20 requests/minute.",
  },
});

/**
 * Maps proxy: 60 requests / minute per IP.
 * Google Maps Directions + Places autocomplete used during address search.
 * 60/min = 1 req/s, comfortable for type-ahead without hammering the quota.
 */
export const mapsLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Maps API rate limit exceeded — max 60 requests/minute.",
  },
});

/**
 * Auth: 20 requests per 15 minutes per IP.
 * Covers login, token exchange, OAuth callbacks.
 * Protects against brute-force credential stuffing.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Too many authentication attempts — please wait 15 minutes.",
  },
});

// ── Registration ─────────────────────────────────────────────────────────

/**
 * Register all rate limiters on the Express app.
 *
 * Call this AFTER CORS middleware and BEFORE any route registration so that
 * the global limiter is applied to every request.
 *
 * Per-route limiters (optimizer, ai/voice, etc.) are also registered here
 * so all limits are visible in one place.
 */
export function registerRateLimits(app: Express): void {
  log.info("Registering rate limiters");

  // 1. Global baseline (every route)
  app.use(globalLimiter);

  // 2. Optimizer routes
  app.use("/api/optimize", optimizerLimiter);
  app.use("/api/zones", optimizerLimiter);
  app.use("/overture/optimize", optimizerLimiter);

  // 3. GeoJSON operations
  app.use("/api/geojson", geojsonLimiter);

  // 4. AI / Voice (billable third-party APIs)
  app.use("/api/voice", aiVoiceLimiter);
  app.use("/api/ai", aiVoiceLimiter);
  app.use("/api/analyze-route", aiVoiceLimiter);
  app.use("/api/elevenlabs", aiVoiceLimiter);

  // 5. Maps proxy (Google Maps quota protection)
  app.use("/api/maps", mapsLimiter);

  // 6. Auth endpoints (brute-force protection)
  app.use("/api/auth", authLimiter);
  app.use("/api/oauth", authLimiter);
  app.use("/api/osm/token-exchange", authLimiter);

  log.info("Rate limiters registered");
}
