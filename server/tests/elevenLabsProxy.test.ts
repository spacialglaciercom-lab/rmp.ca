/**
 * Unit tests for elevenLabsProxy.ts
 * Covers: status endpoint, missing API key → 503, missing body params → 400,
 * TTS happy-path (audio buffer returned), STT happy-path, upstream error
 * forwarding, and voices aggregation logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";

// ── Logger stub ───────────────────────────────────────────────────────────────
vi.mock("../logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k === "content-type" ? "application/json" : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  };
}

function mockAudioResponse(status = 200) {
  const buf = Buffer.from("fake-audio");
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k === "content-type" ? "audio/mpeg" : null) },
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(""),
    arrayBuffer: () => Promise.resolve(buf.buffer as ArrayBuffer),
  };
}

function mockReq(path: string, method: "GET" | "POST" = "GET", overrides: Record<string, unknown> = {}) {
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
    _headers: {} as Record<string, string>,
    status(code: number) { res._status = code; return res; },
    json(body: unknown) { res._body = body; return res; },
    send(body: unknown) { res._body = body; return res; },
    setHeader(k: string, v: string) { res._headers[k] = v; return res; },
    end() { return res; },
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

// ── Status endpoint ───────────────────────────────────────────────────────────

describe("GET /api/elevenlabs/status", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("returns configured: true when ELEVENLABS_API_KEY is set", async () => {
    vi.doMock("../_core/env", () => ({
      ENV: { elevenLabsApiKey: "el-secret-key" },
    }));
    const { registerElevenLabsProxyRoutes } = await import("../elevenLabsProxy");
    const app = express();
    registerElevenLabsProxyRoutes(app);

    const req = mockReq("/api/elevenlabs/status");
    const res = mockRes();
    const handlers = getHandlers(app, "/api/elevenlabs/status");
    handlers[0]!(req, res);

    expect(res._body).toEqual({ configured: true });
  });

  it("returns configured: false when key not set", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { elevenLabsApiKey: "" } }));
    const { registerElevenLabsProxyRoutes } = await import("../elevenLabsProxy");
    const app = express();
    registerElevenLabsProxyRoutes(app);

    const req = mockReq("/api/elevenlabs/status");
    const res = mockRes();
    const handlers = getHandlers(app, "/api/elevenlabs/status");
    handlers[0]!(req, res);

    expect(res._body).toEqual({ configured: false });
  });
});

// ── Missing key → 503 ────────────────────────────────────────────────────────

describe("ElevenLabs proxy — no API key → 503", () => {
  afterEach(() => { vi.resetModules(); });

  const cases: Array<{ path: string; method: "GET" | "POST" }> = [
    { path: "/api/elevenlabs/voices", method: "GET" },
    { path: "/api/elevenlabs/tts", method: "POST" },
    { path: "/api/elevenlabs/stt", method: "POST" },
  ];

  for (const { path, method } of cases) {
    it(`${method} ${path} → 503 when no key`, async () => {
      vi.doMock("../_core/env", () => ({ ENV: { elevenLabsApiKey: "" } }));
      const { registerElevenLabsProxyRoutes } = await import("../elevenLabsProxy");
      const app = express();
      app.use(express.json());
      registerElevenLabsProxyRoutes(app);

      const req = mockReq(path, method, {
        body: { text: "hello", audioBase64: "abc" },
      });
      const res = mockRes();
      const handlers = getHandlers(app, path, method.toLowerCase());
      await handlers[0]!(req, res);

      expect(res._status).toBe(503);
    });
  }
});

// ── Validation ────────────────────────────────────────────────────────────────

describe("ElevenLabs proxy — validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("POST /api/elevenlabs/tts → 400 when text is missing", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { elevenLabsApiKey: "key" } }));
    const { registerElevenLabsProxyRoutes } = await import("../elevenLabsProxy");
    const app = express();
    app.use(express.json());
    registerElevenLabsProxyRoutes(app);

    const req = mockReq("/api/elevenlabs/tts", "POST", { body: {} });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/elevenlabs/tts", "post");
    await handlers[0]!(req, res);

    expect(res._status).toBe(400);
    const body = res._body as { error: string };
    expect(body.error).toContain("text");
  });

  it("POST /api/elevenlabs/stt → 400 when audioBase64 is missing", async () => {
    vi.doMock("../_core/env", () => ({ ENV: { elevenLabsApiKey: "key" } }));
    const { registerElevenLabsProxyRoutes } = await import("../elevenLabsProxy");
    const app = express();
    app.use(express.json());
    registerElevenLabsProxyRoutes(app);

    const req = mockReq("/api/elevenlabs/stt", "POST", { body: {} });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/elevenlabs/stt", "post");
    await handlers[0]!(req, res);

    expect(res._status).toBe(400);
    const body = res._body as { error: string };
    expect(body.error).toContain("audioBase64");
  });
});

// ── TTS happy path ────────────────────────────────────────────────────────────

describe("POST /api/elevenlabs/tts — happy path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("proxies to ElevenLabs TTS and returns audio buffer", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockAudioResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../_core/env", () => ({ ENV: { elevenLabsApiKey: "el-key" } }));
    const { registerElevenLabsProxyRoutes } = await import("../elevenLabsProxy");
    const app = express();
    app.use(express.json());
    registerElevenLabsProxyRoutes(app);

    const req = mockReq("/api/elevenlabs/tts", "POST", {
      body: { text: "Hello, route complete!", voice_id: "voice-abc" },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/elevenlabs/tts", "post");
    await handlers[0]!(req, res);

    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("elevenlabs.io");
    expect(calledUrl).toContain("voice-abc");
    const calledHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(calledHeaders["xi-api-key"]).toBe("el-key");
    expect(calledHeaders["Accept"]).toBe("audio/mpeg");
    expect(res._headers["Content-Type"]).toBe("audio/mpeg");
  });

  it("uses default voice when voice_id not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockAudioResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../_core/env", () => ({ ENV: { elevenLabsApiKey: "el-key" } }));
    const { registerElevenLabsProxyRoutes } = await import("../elevenLabsProxy");
    const app = express();
    app.use(express.json());
    registerElevenLabsProxyRoutes(app);

    const req = mockReq("/api/elevenlabs/tts", "POST", {
      body: { text: "Turn left" },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/elevenlabs/tts", "post");
    await handlers[0]!(req, res);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    // Default voice ID "21m00Tcm4TlvDq8ikWAM"
    expect(calledUrl).toContain("21m00Tcm4TlvDq8ikWAM");
  });

  it("forwards upstream error status from TTS", async () => {
    const errText = "quota exceeded";
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: { get: () => null },
      text: () => Promise.resolve(errText),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../_core/env", () => ({ ENV: { elevenLabsApiKey: "el-key" } }));
    const { registerElevenLabsProxyRoutes } = await import("../elevenLabsProxy");
    const app = express();
    app.use(express.json());
    registerElevenLabsProxyRoutes(app);

    const req = mockReq("/api/elevenlabs/tts", "POST", {
      body: { text: "hello" },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/elevenlabs/tts", "post");
    await handlers[0]!(req, res);

    expect(res._status).toBe(429);
  });
});

// ── STT happy path ────────────────────────────────────────────────────────────

describe("POST /api/elevenlabs/stt — happy path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("proxies audio to ElevenLabs STT and returns transcription", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockJsonResponse({ text: "Turn right on Main Street", language_code: "en" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../_core/env", () => ({ ENV: { elevenLabsApiKey: "el-key" } }));
    const { registerElevenLabsProxyRoutes } = await import("../elevenLabsProxy");
    const app = express();
    app.use(express.json());
    registerElevenLabsProxyRoutes(app);

    const fakeAudio = Buffer.from("fake audio data").toString("base64");
    const req = mockReq("/api/elevenlabs/stt", "POST", {
      body: { audioBase64: fakeAudio, mimeType: "audio/webm" },
    });
    const res = mockRes();
    const handlers = getHandlers(app, "/api/elevenlabs/stt", "post");
    await handlers[0]!(req, res);

    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("speech-to-text");
    const calledHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(calledHeaders["xi-api-key"]).toBe("el-key");
    expect(calledHeaders["Content-Type"]).toContain("multipart/form-data");

    const body = res._body as { text: string; language_code: string };
    expect(body.text).toBe("Turn right on Main Street");
    expect(body.language_code).toBe("en");
  });
});

// ── Voices aggregation ────────────────────────────────────────────────────────

describe("GET /api/elevenlabs/voices — aggregation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("combines personal and shared voices, deduplicating by voice_id", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          voices: [
            { voice_id: "v1", name: "Alice", category: "premade", labels: {}, preview_url: null },
            { voice_id: "v2", name: "Bob", category: "premade", labels: {}, preview_url: null },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          voices: [
            // v2 duplicate — should be deduplicated
            { voice_id: "v2", name: "Bob", category: "shared", labels: {}, preview_url: null },
            { voice_id: "v3", name: "Clara", category: "professional", labels: {}, preview_url: "https://example.com/preview.mp3" },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../_core/env", () => ({ ENV: { elevenLabsApiKey: "el-key" } }));
    const { registerElevenLabsProxyRoutes } = await import("../elevenLabsProxy");
    const app = express();
    registerElevenLabsProxyRoutes(app);

    const req = mockReq("/api/elevenlabs/voices");
    const res = mockRes();
    const handlers = getHandlers(app, "/api/elevenlabs/voices");
    await handlers[0]!(req, res);

    const body = res._body as { voices: Array<{ voice_id: string; name: string }> };
    expect(body.voices).toHaveLength(3); // v1, v2, v3 (v2 not duplicated)
    const ids = body.voices.map((v) => v.voice_id);
    expect(ids).toContain("v1");
    expect(ids).toContain("v2");
    expect(ids).toContain("v3");
  });

  it("returns personal voices only when shared fetch fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          voices: [
            { voice_id: "v1", name: "Alice", category: "premade", labels: {}, preview_url: null },
          ],
        }),
      )
      .mockRejectedValueOnce(new Error("shared endpoint unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../_core/env", () => ({ ENV: { elevenLabsApiKey: "el-key" } }));
    const { registerElevenLabsProxyRoutes } = await import("../elevenLabsProxy");
    const app = express();
    registerElevenLabsProxyRoutes(app);

    const req = mockReq("/api/elevenlabs/voices");
    const res = mockRes();
    const handlers = getHandlers(app, "/api/elevenlabs/voices");
    await handlers[0]!(req, res);

    const body = res._body as { voices: Array<{ voice_id: string }> };
    expect(body.voices).toHaveLength(1);
    expect(body.voices[0].voice_id).toBe("v1");
  });
});
