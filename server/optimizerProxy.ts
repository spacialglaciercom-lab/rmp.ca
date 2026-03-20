/**
 * Optimizer proxy — forwards requests to the Python FastAPI optimizer backend.
 *
 * ## Architecture (post-async refactor)
 *
 * Endpoints that run OR-Tools or the Chinese Postman solver are now ASYNC on the
 * Python side: they return HTTP 202 + { task_id } immediately and do the heavy
 * work in a Celery worker.  This proxy transparently handles the submit-and-poll
 * loop so existing callers see an unchanged synchronous interface.
 *
 *   Client ──► Node BFF ──► POST /api/optimize       (Python → 202 + task_id)
 *                       ─── GET  /api/optimize/status/{id}  (poll with backoff)
 *                       ◄── 200 + full result when done
 *
 * GPX export paths (Accept: application/gpx+xml) are forwarded directly to the
 * /sync variants, which block in the Python process, because GPX payloads are
 * typically small and the GPX conversion needs the in-memory graph.
 *
 * All other optimizer paths (geojson/*, zones/*, overture/*) are simple
 * pass-through proxies — they are fast enough to run synchronously.
 */

import type { Express, Request, Response } from "express";
import { createLogger } from "./logger";

const log = createLogger("optimizer-proxy");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROXY_MAX_RETRIES = 2;
const PROXY_RETRY_DELAY_MS = 500;

/**
 * Maximum time (ms) the Node BFF will spend polling a single async job before
 * giving up with 504.  10 minutes — well beyond the Python worker's hard
 * 10-minute task_time_limit so the worker always finishes first.
 */
const ASYNC_POLL_TIMEOUT_MS = 10 * 60 * 1_000;

/**
 * Exponential backoff configuration for the polling loop.
 *
 *   attempt 0 → 1 s
 *   attempt 1 → 2 s
 *   attempt 2 → 4 s
 *   …
 *   cap       → 30 s
 */
const POLL_INITIAL_DELAY_MS = 1_000;
const POLL_BACKOFF_FACTOR = 2;
const POLL_MAX_DELAY_MS = 30_000;

// ---------------------------------------------------------------------------
// URL normalisation
// ---------------------------------------------------------------------------

const rawOptimizerUrl =
  process.env.OPTIMIZER_BACKEND_URL ||
  process.env.EXPO_PUBLIC_OPTIMIZER_URL ||
  "";

const OPTIMIZER_BACKEND_URL = rawOptimizerUrl
  ? rawOptimizerUrl.startsWith("http://") ||
    rawOptimizerUrl.startsWith("https://")
    ? rawOptimizerUrl.replace(/\/$/, "")
    : `https://${rawOptimizerUrl.replace(/\/$/, "")}`
  : "";

const rawVroomUrl = process.env.VROOM_BACKEND_URL ?? "";
const VROOM_BACKEND_URL = rawVroomUrl
  ? rawVroomUrl.startsWith("http://") || rawVroomUrl.startsWith("https://")
    ? rawVroomUrl.replace(/\/$/, "")
    : `http://${rawVroomUrl.replace(/\/$/, "")}`
  : "";

// ---------------------------------------------------------------------------
// Simple pass-through paths (fast, synchronous on Python side)
// ---------------------------------------------------------------------------

const PASS_THROUGH_PATHS = [
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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Retry a fetch call up to maxRetries times on hard connection errors only.
 *  HTTP 4xx/5xx responses from upstream are NOT retried. */
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
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      const name = (err as { name?: string }).name;
      if (name === "AbortError" || name === "TimeoutError") throw err;
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Compute next poll delay with exponential backoff, capped at POLL_MAX_DELAY_MS. */
export function nextPollDelay(attempt: number): number {
  const delay = POLL_INITIAL_DELAY_MS * Math.pow(POLL_BACKOFF_FACTOR, attempt);
  return Math.min(delay, POLL_MAX_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Pass-through proxy (synchronous endpoints)
// ---------------------------------------------------------------------------

async function proxyToOptimizer(req: Request, res: Response): Promise<void> {
  if (!OPTIMIZER_BACKEND_URL) {
    res.status(503).json({
      ok: false,
      error: "Optimizer backend not configured",
      hint: "Set OPTIMIZER_BACKEND_URL environment variable",
    });
    return;
  }

  const targetUrl = `${OPTIMIZER_BACKEND_URL}${req.originalUrl}`;
  log.info("Proxying optimizer request", {
    method: req.method,
    path: req.originalUrl,
    target: targetUrl,
  });

  const t0 = Date.now();

  try {
    const headers: Record<string, string> = {
      "Content-Type": req.headers["content-type"] || "application/json",
    };
    // Forward Accept so GPX dual-path works on /sync routes
    if (req.headers["accept"]) {
      headers["Accept"] = req.headers["accept"] as string;
    }

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(120_000),
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const upstream = await fetchWithRetry(targetUrl, fetchOptions);
    const body = await upstream.text();
    const elapsedMs = Date.now() - t0;
    const kb = (Buffer.byteLength(body, "utf8") / 1024).toFixed(1);

    if (upstream.status >= 200 && upstream.status < 300) {
      const banner =
        `\n${"═".repeat(60)}\n` +
        `✅  OPTIMIZER  ${req.method} ${req.originalUrl}  →  ${upstream.status} OK  (${elapsedMs} ms, ${kb} KB)\n` +
        `${"═".repeat(60)}`;
      console.log(banner);
    } else {
      log.warn("Optimizer upstream non-2xx", {
        status: upstream.status,
        path: req.originalUrl,
        elapsedMs,
      });
    }

    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.send(body);
  } catch (err) {
    const elapsedMs = Date.now() - t0;
    const message = err instanceof Error ? err.message : "Unknown proxy error";
    console.error(
      `\n${"─".repeat(60)}\n` +
        `❌  OPTIMIZER FAILED  ${req.method} ${req.originalUrl}  (${elapsedMs} ms)\n` +
        `   ${message}\n` +
        `${"─".repeat(60)}`,
    );
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

// ---------------------------------------------------------------------------
// Async submit-and-poll proxy (heavy endpoints: /api/optimize, /api/vrp/solve)
// ---------------------------------------------------------------------------

interface TaskAcceptedBody {
  task_id: string;
  status: "PENDING";
}

interface TaskStatusBody {
  task_id: string;
  status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILURE" | string;
  result?: unknown;
  error?: string;
}

/**
 * Submit a job to a Python async endpoint and poll the status endpoint until
 * the task reaches SUCCESS or FAILURE.
 *
 * The submit URL and status URL are independent to support both the optimize
 * (/api/optimize/status/{id}) and VRP (/api/vrp/status/{id}) namespaces.
 *
 * @param submitUrl   Full URL of the POST endpoint that returns 202 + task_id
 * @param statusBase  Full URL prefix for the status endpoint (task_id is appended)
 * @param body        Request body (already parsed by Express)
 * @param label       Short label for log lines (e.g. "optimize", "vrp/solve")
 */
export async function submitAndPoll(
  submitUrl: string,
  statusBase: string,
  body: unknown,
  label: string,
): Promise<{ status: number; contentType: string; body: string }> {
  const t0 = Date.now();

  // ── 1. Submit ─────────────────────────────────────────────────────────────
  log.info(`[${label}] Submitting async job`, { url: submitUrl });

  const submitRes = await fetchWithRetry(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Submit call is fast (just enqueues); 30 s is generous
    signal: AbortSignal.timeout(30_000),
  });

  if (submitRes.status !== 202) {
    // Unexpected — forward the error as-is
    const errorBody = await submitRes.text();
    log.warn(`[${label}] Unexpected submit status ${submitRes.status}`);
    return {
      status: submitRes.status,
      contentType: submitRes.headers.get("content-type") ?? "application/json",
      body: errorBody,
    };
  }

  const accepted = (await submitRes.json()) as TaskAcceptedBody;
  const taskId = accepted.task_id;
  log.info(`[${label}] Job accepted`, { taskId });

  // ── 2. Poll ───────────────────────────────────────────────────────────────
  const deadline = t0 + ASYNC_POLL_TIMEOUT_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    await sleep(nextPollDelay(attempt));
    attempt++;

    const statusUrl = `${statusBase}/${taskId}`;
    let statusRes: globalThis.Response;

    try {
      statusRes = await fetch(statusUrl, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000), // Each poll is a cheap Redis lookup
      });
    } catch (pollErr) {
      // Transient network hiccup — log and keep trying
      const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
      log.warn(`[${label}] Poll attempt ${attempt} failed (${msg}), retrying…`);
      continue;
    }

    const taskBody = (await statusRes.json()) as TaskStatusBody;
    const taskStatus = taskBody.status;

    log.info(`[${label}] Poll attempt ${attempt}`, {
      taskId,
      status: taskStatus,
      elapsedMs: Date.now() - t0,
    });

    if (taskStatus === "SUCCESS") {
      const elapsedMs = Date.now() - t0;
      const resultStr = JSON.stringify(taskBody.result ?? {});
      const kb = (Buffer.byteLength(resultStr, "utf8") / 1024).toFixed(1);
      console.log(
        `\n${"═".repeat(60)}\n` +
          `✅  ASYNC ${label.toUpperCase()}  task ${taskId}  →  SUCCESS  (${elapsedMs} ms, ${kb} KB)\n` +
          `${"═".repeat(60)}`,
      );
      return {
        status: 200,
        contentType: "application/json",
        body: resultStr,
      };
    }

    if (taskStatus === "FAILURE") {
      const elapsedMs = Date.now() - t0;
      const errorMsg = taskBody.error ?? "Task failed with no error message";
      console.error(
        `\n${"─".repeat(60)}\n` +
          `❌  ASYNC ${label.toUpperCase()}  task ${taskId}  →  FAILURE  (${elapsedMs} ms)\n` +
          `   ${errorMsg}\n` +
          `${"─".repeat(60)}`,
      );
      return {
        status: statusRes.status >= 400 ? statusRes.status : 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: errorMsg, task_id: taskId }),
      };
    }

    // PENDING or PROCESSING — keep polling
  }

  // Deadline exceeded
  const totalMs = Date.now() - t0;
  log.error(`[${label}] Polling timed out after ${totalMs} ms`, { taskId });
  return {
    status: 504,
    contentType: "application/json",
    body: JSON.stringify({
      ok: false,
      error: "Optimizer timed out. The job may still be running.",
      task_id: taskId,
    }),
  };
}

// ---------------------------------------------------------------------------
// Async proxy handler — wraps submitAndPoll for Express
// ---------------------------------------------------------------------------

/**
 * Handles POST requests that should use the async task queue.
 *
 * GPX exception: if the caller requests ``Accept: application/gpx+xml``, we
 * forward to the /sync endpoint instead, which has the in-memory graph
 * available for GPX conversion.
 */
async function proxyAsyncOptimizer(
  req: Request,
  res: Response,
  asyncPath: string,
  syncPath: string,
  statusBase: string,
  label: string,
): Promise<void> {
  if (!OPTIMIZER_BACKEND_URL) {
    res.status(503).json({
      ok: false,
      error: "Optimizer backend not configured",
      hint: "Set OPTIMIZER_BACKEND_URL environment variable",
    });
    return;
  }

  // GPX requests must go to the sync endpoint (needs in-process graph)
  const acceptHeader = (req.headers["accept"] as string | undefined) ?? "";
  if (acceptHeader.includes("application/gpx+xml")) {
    log.info(`[${label}] GPX request — routing to sync endpoint`);
    req.url = syncPath;
    req.originalUrl = syncPath;
    return proxyToOptimizer(req, res);
  }

  try {
    const submitUrl = `${OPTIMIZER_BACKEND_URL}${asyncPath}`;
    const statusBaseUrl = `${OPTIMIZER_BACKEND_URL}${statusBase}`;

    const result = await submitAndPoll(
      submitUrl,
      statusBaseUrl,
      req.body,
      label,
    );

    res.status(result.status);
    res.setHeader("Content-Type", result.contentType);
    res.send(result.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error(`[${label}] Async proxy error: ${message}`);
    res.status(502).json({
      ok: false,
      error: "Optimizer backend unreachable",
      details: message,
    });
  }
}

// ---------------------------------------------------------------------------
// VROOM proxy (unchanged — VROOM is already fast enough to run sync)
// ---------------------------------------------------------------------------

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function injectVroomMatrix(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (body.matrices) return body;

  type Coord = [number, number];
  const vehicles = (body.vehicles as Record<string, unknown>[]) ?? [];
  const jobs = (body.jobs as Record<string, unknown>[]) ?? [];
  const locations: Coord[] = [];
  const locationIndex = new Map<string, number>();

  const addLocation = (coord: Coord): number => {
    const key = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
    if (!locationIndex.has(key)) {
      locationIndex.set(key, locations.length);
      locations.push(coord);
    }
    return locationIndex.get(key)!;
  };

  const newVehicles = vehicles.map((v) => {
    const nv: Record<string, unknown> = { ...v };
    if (Array.isArray(v.start)) {
      nv.start_index = addLocation(v.start as Coord);
      delete nv.start;
    }
    if (Array.isArray(v.end)) {
      nv.end_index = addLocation(v.end as Coord);
      delete nv.end;
    }
    return nv;
  });

  const newJobs = jobs.map((j) => {
    const nj: Record<string, unknown> = { ...j };
    if (Array.isArray(j.location)) {
      nj.location_index = addLocation(j.location as Coord);
      delete nj.location;
    }
    return nj;
  });

  const n = locations.length;
  const AVG_SPEED_MS = 40_000 / 3600;
  const durations: number[][] = [];
  const distances: number[][] = [];
  for (let i = 0; i < n; i++) {
    durations[i] = [];
    distances[i] = [];
    for (let j = 0; j < n; j++) {
      const dist = haversineMeters(
        locations[i][1], locations[i][0],
        locations[j][1], locations[j][0],
      );
      distances[i][j] = Math.round(dist);
      durations[i][j] = Math.round(dist / AVG_SPEED_MS);
    }
  }

  return {
    ...body,
    vehicles: newVehicles,
    jobs: newJobs,
    matrices: { car: { durations, distances } },
  };
}

async function proxyToVroom(req: Request, res: Response): Promise<void> {
  if (!VROOM_BACKEND_URL) {
    res.status(503).json({
      ok: false,
      error: "VROOM backend not configured",
      hint: "Set VROOM_BACKEND_URL environment variable (e.g. http://vroom:3000)",
    });
    return;
  }

  const targetUrl = `${VROOM_BACKEND_URL}/`;
  log.info("Proxying VROOM request", { method: req.method, target: targetUrl });

  try {
    const upstream = await fetchWithRetry(
      targetUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          injectVroomMatrix(req.body as Record<string, unknown>),
        ),
        signal: AbortSignal.timeout(30_000),
      },
      1,
    );
    const body = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.send(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown proxy error";
    log.error("VROOM proxy failed", err instanceof Error ? err : new Error(message));
    res.status(502).json({
      ok: false,
      error: "VROOM backend unreachable",
      details: message,
      target: targetUrl,
    });
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerOptimizerProxyRoutes(app: Express): void {
  if (!OPTIMIZER_BACKEND_URL) {
    log.info("Optimizer proxy: not configured (set OPTIMIZER_BACKEND_URL)");
  } else {
    log.info(`Optimizer proxy: proxying to ${OPTIMIZER_BACKEND_URL}`);
  }

  // ── Async endpoints (submit-and-poll) ────────────────────────────────────

  // Chinese Postman route optimizer — can take 30 s–2 min on large GeoJSON
  app.post("/api/optimize", (req, res) =>
    proxyAsyncOptimizer(
      req, res,
      "/api/optimize",          // async submit path on Python
      "/api/optimize/sync",     // sync fallback for GPX requests
      "/api/optimize/status",   // status poll base (id appended by submitAndPoll)
      "optimize",
    ),
  );

  // OR-Tools VRP solver — can hit the 10 s internal time limit + overhead
  app.post("/api/vrp/solve", (req, res) =>
    proxyAsyncOptimizer(
      req, res,
      "/api/vrp/solve",         // async submit path
      "/api/vrp/solve/sync",    // sync fallback for GPX
      "/api/vrp/status",        // status poll base
      "vrp/solve",
    ),
  );

  // ── Sync pass-through endpoints ──────────────────────────────────────────
  for (const path of PASS_THROUGH_PATHS) {
    app.post(path, (req, res) => proxyToOptimizer(req, res));
  }

  // Optimizer health check (internal path rewrite)
  app.get("/optimizer/health", (req, res) => {
    const origUrl = req.originalUrl;
    req.originalUrl = "/health";
    proxyToOptimizer(req, res).finally(() => {
      req.originalUrl = origUrl;
    });
  });

  // ── VROOM solver (separate docker service) ───────────────────────────────
  if (!VROOM_BACKEND_URL) {
    log.info("VROOM proxy: not configured (set VROOM_BACKEND_URL)");
  } else {
    log.info(`VROOM proxy: proxying to ${VROOM_BACKEND_URL}`);
  }
  app.post("/api/vroom/optimize", (req, res) => proxyToVroom(req, res));
}
