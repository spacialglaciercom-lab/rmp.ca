/**
 * Unit tests for wsExtractProxy.ts
 * Covers: stripHeaders (keeps only WS-essential headers, drops the rest),
 * registerExtractHttpProxyRoutes (successful proxy, upstream error → 502),
 * and WebSocket upgrade routing (non-/ws/extract paths are rejected).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { IncomingMessage, IncomingHttpHeaders } from "http";
import express from "express";
import { EventEmitter } from "events";

// ── Logger stub ───────────────────────────────────────────────────────────────
vi.mock("../logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── http-proxy stub (we don't want real proxying in unit tests) ───────────────
const proxyWsMock = vi.fn();
const proxyOnMock = vi.fn();
vi.mock("http-proxy", () => ({
  default: {
    createProxyServer: () => ({
      ws: proxyWsMock,
      on: proxyOnMock,
    }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockJsonResponse(body: unknown, status = 200) {
  const bodyStr = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => {
        if (k === "content-type") return "application/json";
        if (k === "content-disposition") return null;
        return null;
      },
    },
    text: () => Promise.resolve(bodyStr),
    arrayBuffer: () =>
      Promise.resolve(Buffer.from(bodyStr).buffer as ArrayBuffer),
  };
}

function mockReq(path: string, overrides: Record<string, unknown> = {}) {
  return {
    method: "GET",
    originalUrl: path,
    url: path,
    headers: {},
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
    status(code: number) { res._status = code; return res; },
    json(body: unknown) { res._body = body; return res; },
    send(body: unknown) { res._body = body; return res; },
    setHeader(k: string, v: string) { res._headers[k] = v; return res; },
  };
  return res as typeof res & { _status: number; _body: unknown; _headers: Record<string, string> };
}

function getHandlers(app: express.Express, path: string, method = "get") {
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

// ── stripHeaders ──────────────────────────────────────────────────────────────

describe("stripHeaders", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("keeps only WebSocket-essential headers", async () => {
    // We access the internal stripHeaders through a module-level test by importing
    // and using the side-effecting registerWsExtractProxy. Instead we verify
    // behaviour by triggering an upgrade event and inspecting what was passed to proxy.ws.
    vi.resetModules();
    proxyWsMock.mockReset();

    const { registerWsExtractProxy } = await import("../wsExtractProxy");

    const server = new EventEmitter() as import("http").Server;
    registerWsExtractProxy(server);

    const socket = { destroy: vi.fn() };
    const head = Buffer.alloc(0);

    const incomingReq = {
      url: "/ws/extract?token=abc",
      headers: {
        host: "example.com",
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        // Should be stripped:
        "x-forwarded-for": "1.2.3.4",
        "x-vercel-id": "iad1::abcdef",
        authorization: "Bearer token123",
        cookie: "session=abc",
      } as IncomingHttpHeaders,
    } as IncomingMessage;

    server.emit("upgrade", incomingReq, socket, head);

    expect(proxyWsMock).toHaveBeenCalledOnce();
    // After stripHeaders, the req.headers should only contain allowed keys
    const strippedHeaders = incomingReq.headers;
    expect(strippedHeaders["host"]).toBe("example.com");
    expect(strippedHeaders["upgrade"]).toBe("websocket");
    expect(strippedHeaders["sec-websocket-key"]).toBe("dGhlIHNhbXBsZSBub25jZQ==");
    // Sensitive headers stripped
    expect(strippedHeaders["x-forwarded-for"]).toBeUndefined();
    expect(strippedHeaders["authorization"]).toBeUndefined();
    expect(strippedHeaders["cookie"]).toBeUndefined();
    expect(strippedHeaders["x-vercel-id"]).toBeUndefined();
  });

  it("destroys socket for non-/ws/extract upgrade URLs", async () => {
    vi.resetModules();
    proxyWsMock.mockReset();

    const { registerWsExtractProxy } = await import("../wsExtractProxy");

    const server = new EventEmitter() as import("http").Server;
    registerWsExtractProxy(server);

    const socket = { destroy: vi.fn() };
    const head = Buffer.alloc(0);

    const incomingReq = {
      url: "/ws/other-service",
      headers: {} as IncomingHttpHeaders,
    } as IncomingMessage;

    server.emit("upgrade", incomingReq, socket, head);

    expect(socket.destroy).toHaveBeenCalled();
    expect(proxyWsMock).not.toHaveBeenCalled();
  });
});

// ── registerExtractHttpProxyRoutes ────────────────────────────────────────────

describe("registerExtractHttpProxyRoutes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("GET /geojson/:hash proxies to extract upstream and returns response", async () => {
    const geojsonData = { type: "FeatureCollection", features: [] };
    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(geojsonData),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { registerExtractHttpProxyRoutes } = await import("../wsExtractProxy");
    const app = express();
    registerExtractHttpProxyRoutes(app);

    const req = mockReq("/geojson/abc123", {
      params: { hash: "abc123" },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/geojson/:hash");
    await handlers[0]!(req, res);

    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/geojson/abc123");
    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toBe("application/json");
  });

  it("GET /geojson/:hash returns 502 when upstream is unreachable", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const { registerExtractHttpProxyRoutes } = await import("../wsExtractProxy");
    const app = express();
    registerExtractHttpProxyRoutes(app);

    const req = mockReq("/geojson/deadhash");
    const res = mockRes();
    const handlers = getHandlers(app, "/geojson/:hash");
    await handlers[0]!(req, res);

    expect(res._status).toBe(502);
    const body = res._body as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("unreachable");
  });

  it("GET /download/:hash proxies to extract upstream", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: (k: string) => {
          if (k === "content-type") return "application/gpx+xml";
          if (k === "content-disposition") return "attachment; filename=route.gpx";
          return null;
        },
      },
      arrayBuffer: () => Promise.resolve(Buffer.from("<gpx/>").buffer as ArrayBuffer),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerExtractHttpProxyRoutes } = await import("../wsExtractProxy");
    const app = express();
    registerExtractHttpProxyRoutes(app);

    const req = mockReq("/download/xyz789", {
      params: { hash: "xyz789" },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/download/:hash");
    await handlers[0]!(req, res);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/download/xyz789");
    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toBe("application/gpx+xml");
    expect(res._headers["Content-Disposition"]).toBe("attachment; filename=route.gpx");
  });
});

// ── EXTRACT_WS_UPSTREAM env override ─────────────────────────────────────────

describe("EXTRACT_WS_UPSTREAM environment variable", () => {
  afterEach(() => {
    delete process.env.EXTRACT_WS_UPSTREAM;
    vi.resetModules();
    proxyWsMock.mockReset();
  });

  it("uses EXTRACT_WS_UPSTREAM when set", async () => {
    process.env.EXTRACT_WS_UPSTREAM = "http://extract.railway.internal:9000";
    vi.resetModules();

    const { registerWsExtractProxy } = await import("../wsExtractProxy");
    const server = new EventEmitter() as import("http").Server;
    registerWsExtractProxy(server);

    const socket = { destroy: vi.fn() };
    const head = Buffer.alloc(0);
    const incomingReq = {
      url: "/ws/extract",
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "key",
        "sec-websocket-version": "13",
      } as IncomingHttpHeaders,
    } as IncomingMessage;

    server.emit("upgrade", incomingReq, socket, head);

    expect(proxyWsMock).toHaveBeenCalledOnce();
    const proxyOptions = proxyWsMock.mock.calls[0][3] as { target: string };
    // Should use ws:// scheme (converted from http://)
    expect(proxyOptions.target).toContain("ws://");
    expect(proxyOptions.target).toContain("extract.railway.internal");
  });
});
