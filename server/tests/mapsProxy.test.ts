/**
 * Unit tests for mapsProxy.ts
 * Covers: missing API key → 503, missing required params → 400, successful
 * proxy passthrough for directions, snap-to-roads, places autocomplete,
 * places nearby, and place details endpoints.
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
    _body: null as unknown,
    status(code: number) { res._status = code; return res; },
    json(body: unknown) { res._body = body; return res; },
    send(body: unknown) { res._body = body; return res; },
    setHeader() { return res; },
  };
  return res as typeof res & { _status: number; _body: unknown };
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

// ── Tests: API key missing → 503 ─────────────────────────────────────────────

describe("mapsProxy — no API key", () => {
  beforeEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.resetModules();
  });
  afterEach(() => {
    vi.resetModules();
  });

  const endpoints = [
    { method: "POST" as const, path: "/api/maps/directions", body: { origin: "A", destination: "B" } },
    { method: "POST" as const, path: "/api/maps/snap-to-roads", body: { path: "45,−73" } },
    { method: "POST" as const, path: "/api/maps/places/autocomplete", body: { input: "Mont" } },
    { method: "POST" as const, path: "/api/maps/places/nearby", body: { lat: 45, lon: -73 } },
  ];

  for (const ep of endpoints) {
    it(`${ep.method} ${ep.path} → 503 when GOOGLE_MAPS_API_KEY not set`, async () => {
      // ENV is built at module load from process.env — clear it before importing
      vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "" } }));
      const { registerMapsProxyRoutes } = await import("../mapsProxy");
      const app = express();
      app.use(express.json());
      registerMapsProxyRoutes(app);

      const req = mockReq(ep.path, ep.method, { body: ep.body });
      const res = mockRes();
      const handlers = getHandlers(app, ep.path, ep.method.toLowerCase());
      await handlers[0]!(req, res);

      expect(res._status).toBe(503);
    });
  }
});

// ── Tests: missing required params → 400 ─────────────────────────────────────

describe("mapsProxy — validation", () => {
  let fetchMock: MockFetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../_core/env", () => ({
      ENV: { googleMapsApiKey: "test-key-123" },
    }));
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("POST /api/maps/directions → 400 when origin missing", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "key" } }));
    const { registerMapsProxyRoutes } = await import("../mapsProxy");
    const app = express();
    app.use(express.json());
    registerMapsProxyRoutes(app);

    const req = mockReq("/api/maps/directions", "POST", {
      body: { destination: "B" }, // no origin
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/maps/directions");
    await handlers[0]!(req, res);

    expect(res._status).toBe(400);
  });

  it("POST /api/maps/directions → 400 when destination missing", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "key" } }));
    const { registerMapsProxyRoutes } = await import("../mapsProxy");
    const app = express();
    app.use(express.json());
    registerMapsProxyRoutes(app);

    const req = mockReq("/api/maps/directions", "POST", {
      body: { origin: "A" }, // no destination
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/maps/directions");
    await handlers[0]!(req, res);

    expect(res._status).toBe(400);
  });

  it("POST /api/maps/snap-to-roads → 400 when path missing", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "key" } }));
    const { registerMapsProxyRoutes } = await import("../mapsProxy");
    const app = express();
    app.use(express.json());
    registerMapsProxyRoutes(app);

    const req = mockReq("/api/maps/snap-to-roads", "POST", { body: {} });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/maps/snap-to-roads");
    await handlers[0]!(req, res);

    expect(res._status).toBe(400);
  });

  it("POST /api/maps/places/autocomplete → 400 when input missing", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "key" } }));
    const { registerMapsProxyRoutes } = await import("../mapsProxy");
    const app = express();
    app.use(express.json());
    registerMapsProxyRoutes(app);

    const req = mockReq("/api/maps/places/autocomplete", "POST", {
      body: { input: "" },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/maps/places/autocomplete");
    await handlers[0]!(req, res);

    expect(res._status).toBe(400);
  });

  it("POST /api/maps/places/nearby → 400 when lat/lon missing", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "key" } }));
    const { registerMapsProxyRoutes } = await import("../mapsProxy");
    const app = express();
    app.use(express.json());
    registerMapsProxyRoutes(app);

    const req = mockReq("/api/maps/places/nearby", "POST", { body: {} });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/maps/places/nearby");
    await handlers[0]!(req, res);

    expect(res._status).toBe(400);
  });
});

// ── Tests: successful proxy passthrough ──────────────────────────────────────

describe("mapsProxy — successful proxy", () => {
  let fetchMock: MockFetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("POST /api/maps/directions proxies and returns Google response", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "key" } }));
    const { registerMapsProxyRoutes } = await import("../mapsProxy");
    const app = express();
    app.use(express.json());
    registerMapsProxyRoutes(app);

    const googleResponse = { routes: [{ legs: [] }], status: "OK" };
    fetchMock.mockResolvedValueOnce(mockJsonResponse(googleResponse));

    const req = mockReq("/api/maps/directions", "POST", {
      body: { origin: "Montreal, QC", destination: "Quebec City, QC" },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/maps/directions");
    await handlers[0]!(req, res);

    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("maps.googleapis.com");
    expect(calledUrl).toContain("Montreal");
    expect(calledUrl).toContain("key=key");
    expect(res._body).toEqual(googleResponse);
  });

  it("POST /api/maps/directions includes waypoints in URL when provided", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "key" } }));
    const { registerMapsProxyRoutes } = await import("../mapsProxy");
    const app = express();
    app.use(express.json());
    registerMapsProxyRoutes(app);

    fetchMock.mockResolvedValueOnce(mockJsonResponse({ routes: [], status: "OK" }));

    const req = mockReq("/api/maps/directions", "POST", {
      body: {
        origin: "A",
        destination: "B",
        waypoints: "via:C|via:D",
        avoid: ["tolls", "highways"],
      },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/maps/directions");
    await handlers[0]!(req, res);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("waypoints=");
    expect(calledUrl).toContain("avoid=tolls");
  });

  it("POST /api/maps/snap-to-roads proxies and returns snapped points", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "key" } }));
    const { registerMapsProxyRoutes } = await import("../mapsProxy");
    const app = express();
    app.use(express.json());
    registerMapsProxyRoutes(app);

    const snappedResponse = { snappedPoints: [{ location: { latitude: 45, longitude: -73 } }] };
    fetchMock.mockResolvedValueOnce(mockJsonResponse(snappedResponse));

    const req = mockReq("/api/maps/snap-to-roads", "POST", {
      body: { path: "45.0,-73.0|45.001,-73.001", interpolate: true },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/maps/snap-to-roads");
    await handlers[0]!(req, res);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("roads.googleapis.com");
    expect(calledUrl).toContain("interpolate=true");
    expect(res._body).toEqual(snappedResponse);
  });

  it("POST /api/maps/places/autocomplete passes X-Goog-Api-Key header", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "my-key" } }));
    const { registerMapsProxyRoutes } = await import("../mapsProxy");
    const app = express();
    app.use(express.json());
    registerMapsProxyRoutes(app);

    const autocompleteResponse = { suggestions: [] };
    fetchMock.mockResolvedValueOnce(mockJsonResponse(autocompleteResponse));

    const req = mockReq("/api/maps/places/autocomplete", "POST", {
      body: { input: "Mont", sessionToken: "tok-123" },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/maps/places/autocomplete");
    await handlers[0]!(req, res);

    const calledHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(calledHeaders["X-Goog-Api-Key"]).toBe("my-key");
    expect(res._body).toEqual(autocompleteResponse);
  });

  it("POST /api/maps/places/autocomplete forwards upstream error status", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "key" } }));
    const { registerMapsProxyRoutes } = await import("../mapsProxy");
    const app = express();
    app.use(express.json());
    registerMapsProxyRoutes(app);

    fetchMock.mockResolvedValueOnce(mockJsonResponse({ error: "PERMISSION_DENIED" }, 403));

    const req = mockReq("/api/maps/places/autocomplete", "POST", {
      body: { input: "Test" },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/maps/places/autocomplete");
    await handlers[0]!(req, res);

    expect(res._status).toBe(403);
  });

  it("POST /api/maps/places/nearby clamps radius to [50, 50000]", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "key" } }));
    const { registerMapsProxyRoutes } = await import("../mapsProxy");
    const app = express();
    app.use(express.json());
    registerMapsProxyRoutes(app);

    fetchMock.mockResolvedValueOnce(mockJsonResponse({ places: [] }));

    const req = mockReq("/api/maps/places/nearby", "POST", {
      body: { lat: 45.5, lon: -73.5, radiusMeters: 99999999 }, // exceeds max
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/maps/places/nearby");
    await handlers[0]!(req, res);

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
      locationRestriction: { circle: { radius: number } };
    };
    expect(sentBody.locationRestriction.circle.radius).toBe(50000);
  });

  it("GET /api/maps/places/details/:placeId calls Places Details API", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { googleMapsApiKey: "key" } }));
    const { registerMapsProxyRoutes } = await import("../mapsProxy");
    const app = express();
    app.use(express.json());
    registerMapsProxyRoutes(app);

    const placeDetails = { id: "ChIJ123", displayName: { text: "Café" } };
    fetchMock.mockResolvedValueOnce(mockJsonResponse(placeDetails));

    const req = mockReq("/api/maps/places/details/ChIJ123", "GET", {
      params: { placeId: "ChIJ123" },
      query: { fields: "id,displayName" },
    });
    const res = mockRes();

    // GET handler
    const getHandlersList: Array<(req: unknown, res: unknown) => void> = [];
    app._router.stack.forEach((layer: {
      route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (r: unknown, s: unknown) => void }> }
    }) => {
      if (
        layer.route?.path === "/api/maps/places/details/:placeId" &&
        layer.route.methods.get
      ) {
        layer.route.stack.forEach((s) => getHandlersList.push(s.handle));
      }
    });

    await getHandlersList[0]!(req, res);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("places.googleapis.com");
    expect(calledUrl).toContain("ChIJ123");
    const sentHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(sentHeaders["X-Goog-FieldMask"]).toBe("id,displayName");
    expect(res._body).toEqual(placeDetails);
  });
});
