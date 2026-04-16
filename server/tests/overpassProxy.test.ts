/**
 * Unit tests for overpassProxy.ts
 * Covers: missing query → 400, successful proxy passthrough
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockFetch = ReturnType<typeof vi.fn>;

function mockJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function mockReq(path: string, method: "GET" | "POST" = "POST", overrides: Record<string, unknown> = {}) {
  return {
    method,
    originalUrl: path,
    url: path,
    headers: {},
    body: {},
    params: {},
    query: {},
    ...overrides,
  } as unknown as import("express").Request;
}

function mockRes() {
  const res = {
    _status: 200,
    _json: null as unknown,
    status(code: number) { res._status = code; return res; },
    json(body: unknown) { res._json = body; return res; },
    send(body: unknown) { res._json = body; return res; },
    setHeader() { return res; },
  };
  return res as typeof res & { _status: number; _json: unknown };
}

/** Find all route handlers for a given method + path combo. */
function getHandlers(
  app: express.Express,
  path: string,
  method = "post",
) {
  const handlers: Array<(req: unknown, res: unknown) => void> = [];
  app._router.stack.forEach((layer: {
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (r: unknown, s: unknown) => void }> }
  }) => {
    if (layer.route?.path === path && layer.route.methods[method]) {
      layer.route.stack.forEach((s) => handlers.push(s.handle));
    }
  });
  return handlers;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("overpassProxy", () => {
  let app: express.Express;
  let fetchMock: MockFetch;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 400 when query is missing", async () => {
    const { registerOverpassProxyRoutes } = await import("../overpassProxy");
    registerOverpassProxyRoutes(app);

    const req = mockReq("/api/overpass/query", "POST", {
      body: {}, // missing query
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/overpass/query");
    await handlers[0]!(req, res);

    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: "query is required" });
  });

  it("should proxy query to Overpass API and return response", async () => {
    const { registerOverpassProxyRoutes } = await import("../overpassProxy");
    registerOverpassProxyRoutes(app);

    const mockResponse = {
      elements: [
        { type: "node", id: 123, lat: 40.7, lon: -74.0, tags: { highway: "residential" } },
      ],
    };

    fetchMock.mockResolvedValue(mockJsonResponse(mockResponse));

    const req = mockReq("/api/overpass/query", "POST", {
      body: { query: "[out:json];node(40.7,-74.0,40.8,-73.9);out;" },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/overpass/query");
    await handlers[0]!(req, res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual(mockResponse);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("should handle Overpass API errors", async () => {
    const { registerOverpassProxyRoutes } = await import("../overpassProxy");
    registerOverpassProxyRoutes(app);

    fetchMock.mockResolvedValue(
      mockJsonResponse({ error: "timeout" }, 504),
    );

    const req = mockReq("/api/overpass/query", "POST", {
      body: { query: "[out:json];node(40.7,-74.0,40.8,-73.9);out;" },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/overpass/query");
    await handlers[0]!(req, res);

    expect(res._status).toBe(500);
    expect(res._json).toHaveProperty("error");
  });
});
