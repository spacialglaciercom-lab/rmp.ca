/**
 * Optimizer proxy — forwards requests for the Python FastAPI optimizer
 * endpoints through the Node.js server.
 *
 * This lets a single Cloud Run URL serve both the Node tRPC API and the
 * Python optimizer backend.  When the client hits /api/optimize,
 * /api/geojson/*, /api/zones/*, /overture/*, or /health, the request is
 * forwarded to the Python backend at OPTIMIZER_BACKEND_URL.
 *
 * Set OPTIMIZER_BACKEND_URL in the environment:
 *   - Local dev: http://localhost:8000
 *   - Production: an internal Cloud Run URL (e.g. the service's
 *     .run.internal address or a second Cloud Run service URL).
 *
 * If OPTIMIZER_BACKEND_URL is not set, returns a helpful error.
 */
import type { Express, Request, Response } from "express";
import { createLogger } from "./logger";

const log = createLogger("optimizer-proxy");

const PROXY_MAX_RETRIES = 2;
const PROXY_RETRY_DELAY_MS = 500;

/** Retry a fetch call up to maxRetries times on network/timeout errors.
 *  HTTP 4xx/5xx responses from the upstream are NOT retried — only hard
 *  connection failures (ECONNREFUSED, AbortError, etc.) are. */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = PROXY_MAX_RETRIES,
): Promise<globalThis.Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      log.info(`Optimizer retry attempt ${attempt}/${maxRetries} for ${url}`);
      await new Promise((r) => setTimeout(r, PROXY_RETRY_DELAY_MS * attempt));
    }
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      lastError = err;
      const name = (err as { name?: string }).name;
      // AbortError = our own timeout — don't retry, it will keep timing out
      if (name === "AbortError" || name === "TimeoutError") throw err;
    }
  }
  throw lastError;
}

const rawOptimizerUrl =
  process.env.OPTIMIZER_BACKEND_URL ||
  process.env.EXPO_PUBLIC_OPTIMIZER_URL ||
  "";

/** Ensure URL has a scheme so fetch() works (env may be set without https://). */
const OPTIMIZER_BACKEND_URL = rawOptimizerUrl
  ? rawOptimizerUrl.startsWith("http://") ||
    rawOptimizerUrl.startsWith("https://")
    ? rawOptimizerUrl.replace(/\/$/, "")
    : `https://${rawOptimizerUrl.replace(/\/$/, "")}`
  : "";

/** Paths that should be forwarded to the Python optimizer backend. */
const OPTIMIZER_PATHS = [
  "/api/optimize",
  "/api/geojson/clean",
  "/api/geojson/filter",
  "/api/geojson/validate",
  "/api/geojson/roads",
  "/api/zones/partition",
  "/api/zones/partition-by-polygon",
  "/api/zones/partition-from-geojson",
  "/api/zones/partition-from-points",
  "/overture/optimize",
];

async function proxyToOptimizer(req: Request, res: Response): Promise<void> {
  if (!OPTIMIZER_BACKEND_URL) {
    res.status(503).json({
      ok: false,
      error: "Optimizer backend not configured",
      hint: "Set OPTIMIZER_BACKEND_URL environment variable to the Python FastAPI optimizer URL (e.g. http://localhost:8000)",
    });
    return;
  }

  const targetUrl = `${OPTIMIZER_BACKEND_URL.replace(/\/$/, "")}${req.originalUrl}`;
  log.info("Proxying optimizer request", {
    method: req.method,
    path: req.originalUrl,
    target: targetUrl,
  });

  try {
    const headers: Record<string, string> = {
      "Content-Type": req.headers["content-type"] || "application/json",
    };

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(120_000), // 2 min timeout for optimizer
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const upstream = await fetchWithRetry(targetUrl, fetchOptions);
    const body = await upstream.text();

    // Forward status code and response
    res.status(upstream.status);

    // Forward content-type header
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);

    res.send(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown proxy error";
    log.error(
      "Optimizer proxy failed",
      err instanceof Error ? err : new Error(message),
    );
    res.status(502).json({
      ok: false,
      error: "Optimizer backend unreachable",
      details: message,
      target: targetUrl,
    });
  }
}

export function registerOptimizerProxyRoutes(app: Express): void {
  const status = OPTIMIZER_BACKEND_URL
    ? `proxying to ${OPTIMIZER_BACKEND_URL}`
    : "not configured (set OPTIMIZER_BACKEND_URL)";
  log.info(`Optimizer proxy: ${status}`);

  // Register exact routes for optimizer endpoints
  for (const path of OPTIMIZER_PATHS) {
    app.post(path, (req, res) => proxyToOptimizer(req, res));
  }

  // Also proxy GET /health for optimizer health checks (note: only matches
  // when there is no existing /health route — registered before 404 handler)
  app.get("/optimizer/health", (req, res) => {
    // Rewrite path to /health for the upstream
    const origUrl = req.originalUrl;
    req.originalUrl = "/health";
    proxyToOptimizer(req, res).finally(() => {
      req.originalUrl = origUrl;
    });
  });
}
