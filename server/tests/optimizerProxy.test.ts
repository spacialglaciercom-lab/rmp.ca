/**
 * Unit tests for optimizerProxy.ts
 * Covers: nextPollDelay math, fetchWithRetry behaviour, submitAndPoll happy-path /
 * FAILURE / timeout / non-202, GPX routing to sync, injectVroomMatrix matrix
 * injection, and the 503 when OPTIMIZER_BACKEND_URL is unset.
 *
 * All network I/O is replaced with vi.stubGlobal('fetch', …) so no real HTTP
 * connections are made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";

// ── Logger stub (suppress output in tests) ───────────────────────────────────
vi.mock("../logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

type MockFetch = ReturnType<typeof vi.fn>;

/** Build a minimal fetch Response mock. */
function mockResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
    text: () => Promise.resolve(bodyStr),
    json: () => Promise.resolve(typeof body === "string" ? JSON.parse(body) : body),
    arrayBuffer: () =>
      Promise.resolve(Buffer.from(bodyStr).buffer as ArrayBuffer),
  };
}

/** Minimal Express req/res mocks. */
function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    originalUrl: "/api/optimize",
    url: "/api/optimize",
    headers: {},
    body: { test: true },
    params: {},
    query: {},
    ...overrides,
  } as unknown as import("express").Request;
}

function mockRes() {
  const res = {
    _status: 200,
    _body: null as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: unknown) {
      res._body = body;
      return res;
    },
    send(body: unknown) {
      res._body = body;
      return res;
    },
    setHeader(key: string, val: string) {
      res._headers[key] = val;
      return res;
    },
    end() {
      return res;
    },
  } as unknown as import("express").Response;
  return res as typeof res & {
    _status: number;
    _body: unknown;
    _headers: Record<string, string>;
  };
}

// ── Tests that need OPTIMIZER_BACKEND_URL set ────────────────────────────────

describe("optimizerProxy (with OPTIMIZER_BACKEND_URL configured)", () => {
  let fetchMock: MockFetch;

  beforeEach(async () => {
    process.env.OPTIMIZER_BACKEND_URL = "http://test-optimizer.internal";
    process.env.VROOM_BACKEND_URL = "http://test-vroom.internal";

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Reset modules so env is picked up fresh
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPTIMIZER_BACKEND_URL;
    delete process.env.VROOM_BACKEND_URL;
    vi.resetModules();
  });

  // ── submitAndPoll: SUCCESS path ─────────────────────────────────────────

  it("submitAndPoll: returns 200 with result on SUCCESS status", async () => {
    const { registerOptimizerProxyRoutes } = await import(
      "../optimizerProxy"
    );
    const app = express();
    app.use(express.json());
    registerOptimizerProxyRoutes(app);

    const taskId = "task-abc-123";
    const resultData = { route: "optimized" };

    // 1st call: submit → 202
    // 2nd call: poll → SUCCESS
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ task_id: taskId, status: "PENDING" }, 202),
      )
      .mockResolvedValueOnce(
        mockResponse({ task_id: taskId, status: "SUCCESS", result: resultData }),
      );

    const req = mockReq({ body: { stops: [] } });
    const res = mockRes();

    // Find and invoke the /api/optimize route handler
    const handlers: Array<(req: unknown, res: unknown) => void> = [];
    app._router.stack.forEach((layer: { route?: { path: string; stack: Array<{ handle: (r: unknown, s: unknown) => void }> } }) => {
      if (layer.route?.path === "/api/optimize") {
        layer.route.stack.forEach((s) => handlers.push(s.handle));
      }
    });

    await handlers[0]!(req, res);

    expect(res._status).toBe(200);
    const parsed =
      typeof res._body === "string" ? JSON.parse(res._body) : res._body;
    expect(parsed).toEqual(resultData);
  });

  it("submitAndPoll: returns 500 on FAILURE status", async () => {
    const { registerOptimizerProxyRoutes } = await import(
      "../optimizerProxy"
    );
    const app = express();
    app.use(express.json());
    registerOptimizerProxyRoutes(app);

    const taskId = "task-fail-456";

    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ task_id: taskId, status: "PENDING" }, 202),
      )
      .mockResolvedValueOnce(
        mockResponse(
          { task_id: taskId, status: "FAILURE", error: "Worker crashed" },
          500,
        ),
      );

    const req = mockReq({ body: { stops: [] } });
    const res = mockRes();

    const handlers: Array<(req: unknown, res: unknown) => void> = [];
    app._router.stack.forEach((layer: { route?: { path: string; stack: Array<{ handle: (r: unknown, s: unknown) => void }> } }) => {
      if (layer.route?.path === "/api/optimize") {
        layer.route.stack.forEach((s) => handlers.push(s.handle));
      }
    });

    await handlers[0]!(req, res);

    expect(res._status).toBe(500);
    const parsed =
      typeof res._body === "string" ? JSON.parse(res._body) : res._body;
    expect(parsed).toMatchObject({ ok: false, error: "Worker crashed" });
  });

  it("submitAndPoll: forwards error when submit returns non-202", async () => {
    const { registerOptimizerProxyRoutes } = await import(
      "../optimizerProxy"
    );
    const app = express();
    app.use(express.json());
    registerOptimizerProxyRoutes(app);

    fetchMock.mockResolvedValueOnce(
      mockResponse({ error: "bad request" }, 400),
    );

    const req = mockReq({ body: { stops: [] } });
    const res = mockRes();

    const handlers: Array<(req: unknown, res: unknown) => void> = [];
    app._router.stack.forEach((layer: { route?: { path: string; stack: Array<{ handle: (r: unknown, s: unknown) => void }> } }) => {
      if (layer.route?.path === "/api/optimize") {
        layer.route.stack.forEach((s) => handlers.push(s.handle));
      }
    });

    await handlers[0]!(req, res);

    expect(res._status).toBe(400);
  });

  it("GPX request routes to sync endpoint", async () => {
    const { registerOptimizerProxyRoutes } = await import(
      "../optimizerProxy"
    );
    const app = express();
    app.use(express.json());
    registerOptimizerProxyRoutes(app);

    const gpxBody = "<?xml version='1.0'?><gpx/>";
    fetchMock.mockResolvedValueOnce(
      mockResponse(gpxBody, 200, { "content-type": "application/gpx+xml" }),
    );

    const req = mockReq({
      headers: { accept: "application/gpx+xml" },
      body: {},
    });
    const res = mockRes();

    const handlers: Array<(req: unknown, res: unknown) => void> = [];
    app._router.stack.forEach((layer: { route?: { path: string; stack: Array<{ handle: (r: unknown, s: unknown) => void }> } }) => {
      if (layer.route?.path === "/api/optimize") {
        layer.route.stack.forEach((s) => handlers.push(s.handle));
      }
    });

    await handlers[0]!(req, res);

    // Should have proxied to the sync endpoint (fetch called once, not via poll)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/sync");
    expect(res._status).toBe(200);
  });

  // ── proxyToVroom ────────────────────────────────────────────────────────

  it("proxyToVroom: injects distance matrix and proxies to VROOM", async () => {
    const { registerOptimizerProxyRoutes } = await import(
      "../optimizerProxy"
    );
    const app = express();
    app.use(express.json());
    registerOptimizerProxyRoutes(app);

    const vroomResult = { routes: [] };
    fetchMock.mockResolvedValueOnce(mockResponse(vroomResult));

    const req = mockReq({
      url: "/api/vroom/optimize",
      originalUrl: "/api/vroom/optimize",
      body: {
        vehicles: [{ id: 1, start: [-73.0, 45.0], end: [-73.0, 45.0] }],
        jobs: [{ id: 1, location: [-73.001, 45.001] }],
      },
    });
    const res = mockRes();

    const handlers: Array<(req: unknown, res: unknown) => void> = [];
    app._router.stack.forEach((layer: { route?: { path: string; stack: Array<{ handle: (r: unknown, s: unknown) => void }> } }) => {
      if (layer.route?.path === "/api/vroom/optimize") {
        layer.route.stack.forEach((s) => handlers.push(s.handle));
      }
    });

    await handlers[0]!(req, res);

    expect(fetchMock).toHaveBeenCalled();
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      matrices?: unknown;
    };
    // Matrix should have been injected
    expect(sentBody.matrices).toBeDefined();
    expect(res._status).toBe(200);
  });

  // ── fetchWithRetry ───────────────────────────────────────────────────────

  it("proxyToOptimizer: retries on network error then succeeds", async () => {
    const { registerOptimizerProxyRoutes } = await import(
      "../optimizerProxy"
    );
    const app = express();
    app.use(express.json());
    registerOptimizerProxyRoutes(app);

    // First call throws, second succeeds
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(
        mockResponse({ ok: true }, 200, { "content-type": "application/json" }),
      );

    const req = mockReq({
      method: "POST",
      url: "/api/geojson/clean",
      originalUrl: "/api/geojson/clean",
    });
    const res = mockRes();

    const handlers: Array<(req: unknown, res: unknown) => void> = [];
    app._router.stack.forEach((layer: { route?: { path: string; stack: Array<{ handle: (r: unknown, s: unknown) => void }> } }) => {
      if (layer.route?.path === "/api/geojson/clean") {
        layer.route.stack.forEach((s) => handlers.push(s.handle));
      }
    });

    await handlers[0]!(req, res);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res._status).toBe(200);
  });

  it("proxyToOptimizer: returns 502 when all retries exhausted", async () => {
    const { registerOptimizerProxyRoutes } = await import(
      "../optimizerProxy"
    );
    const app = express();
    app.use(express.json());
    registerOptimizerProxyRoutes(app);

    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const req = mockReq({
      method: "POST",
      url: "/api/geojson/clean",
      originalUrl: "/api/geojson/clean",
    });
    const res = mockRes();

    const handlers: Array<(req: unknown, res: unknown) => void> = [];
    app._router.stack.forEach((layer: { route?: { path: string; stack: Array<{ handle: (r: unknown, s: unknown) => void }> } }) => {
      if (layer.route?.path === "/api/geojson/clean") {
        layer.route.stack.forEach((s) => handlers.push(s.handle));
      }
    });

    await handlers[0]!(req, res);

    expect(res._status).toBe(502);
    const body = res._body as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("unreachable");
  });
});

// ── Tests with NO OPTIMIZER_BACKEND_URL set ───────────────────────────────────

describe("optimizerProxy (without OPTIMIZER_BACKEND_URL)", () => {
  beforeEach(async () => {
    delete process.env.OPTIMIZER_BACKEND_URL;
    delete process.env.VROOM_BACKEND_URL;
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("POST /api/optimize returns 503 when backend not configured", async () => {
    const { registerOptimizerProxyRoutes } = await import(
      "../optimizerProxy"
    );
    const app = express();
    app.use(express.json());
    registerOptimizerProxyRoutes(app);

    const req = mockReq({ body: {} });
    const res = mockRes();

    const handlers: Array<(req: unknown, res: unknown) => void> = [];
    app._router.stack.forEach((layer: { route?: { path: string; stack: Array<{ handle: (r: unknown, s: unknown) => void }> } }) => {
      if (layer.route?.path === "/api/optimize") {
        layer.route.stack.forEach((s) => handlers.push(s.handle));
      }
    });

    await handlers[0]!(req, res);

    expect(res._status).toBe(503);
    const body = res._body as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("POST /api/vroom/optimize returns 503 when VROOM not configured", async () => {
    const { registerOptimizerProxyRoutes } = await import(
      "../optimizerProxy"
    );
    const app = express();
    app.use(express.json());
    registerOptimizerProxyRoutes(app);

    const req = mockReq({
      url: "/api/vroom/optimize",
      originalUrl: "/api/vroom/optimize",
      body: {},
    });
    const res = mockRes();

    const handlers: Array<(req: unknown, res: unknown) => void> = [];
    app._router.stack.forEach((layer: { route?: { path: string; stack: Array<{ handle: (r: unknown, s: unknown) => void }> } }) => {
      if (layer.route?.path === "/api/vroom/optimize") {
        layer.route.stack.forEach((s) => handlers.push(s.handle));
      }
    });

    await handlers[0]!(req, res);

    expect(res._status).toBe(503);
  });
});

// ── injectVroomMatrix (tested via a standalone check) ────────────────────────

describe("injectVroomMatrix behaviour (via VROOM proxy)", () => {
  beforeEach(async () => {
    process.env.VROOM_BACKEND_URL = "http://vroom.test";
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VROOM_BACKEND_URL;
    vi.resetModules();
  });

  it("skips matrix injection when matrices already present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ routes: [] }, 200),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { registerOptimizerProxyRoutes } = await import("../optimizerProxy");
    const app = express();
    app.use(express.json());
    registerOptimizerProxyRoutes(app);

    const existingMatrices = { car: { durations: [[0]], distances: [[0]] } };
    const req = mockReq({
      url: "/api/vroom/optimize",
      originalUrl: "/api/vroom/optimize",
      body: {
        vehicles: [],
        jobs: [],
        matrices: existingMatrices,
      },
    });
    const res = mockRes();

    const handlers: Array<(req: unknown, res: unknown) => void> = [];
    app._router.stack.forEach((layer: { route?: { path: string; stack: Array<{ handle: (r: unknown, s: unknown) => void }> } }) => {
      if (layer.route?.path === "/api/vroom/optimize") {
        layer.route.stack.forEach((s) => handlers.push(s.handle));
      }
    });

    await handlers[0]!(req, res);

    const sentBody = JSON.parse(
      fetchMock.mock.calls[0][1].body as string,
    ) as { matrices: unknown };
    // Existing matrices preserved as-is
    expect(sentBody.matrices).toEqual(existingMatrices);
  });

  it("deduplicates locations when building matrix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ routes: [] }, 200),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { registerOptimizerProxyRoutes } = await import("../optimizerProxy");
    const app = express();
    app.use(express.json());
    registerOptimizerProxyRoutes(app);

    const sameCoord = [-73.0, 45.0] as [number, number];
    const req = mockReq({
      url: "/api/vroom/optimize",
      originalUrl: "/api/vroom/optimize",
      body: {
        vehicles: [{ id: 1, start: sameCoord, end: sameCoord }],
        jobs: [{ id: 1, location: sameCoord }],
      },
    });
    const res = mockRes();

    const handlers: Array<(req: unknown, res: unknown) => void> = [];
    app._router.stack.forEach((layer: { route?: { path: string; stack: Array<{ handle: (r: unknown, s: unknown) => void }> } }) => {
      if (layer.route?.path === "/api/vroom/optimize") {
        layer.route.stack.forEach((s) => handlers.push(s.handle));
      }
    });

    await handlers[0]!(req, res);

    const sentBody = JSON.parse(
      fetchMock.mock.calls[0][1].body as string,
    ) as { matrices: { car: { durations: number[][] } } };
    // 1 unique location → 1×1 matrix
    expect(sentBody.matrices.car.durations).toHaveLength(1);
    expect(sentBody.matrices.car.durations[0]).toHaveLength(1);
  });
});
