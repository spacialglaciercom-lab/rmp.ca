// Load .env.server first (server secrets; doesn't override vars already set by Docker/Railway).
// Then load .env (shared/public vars). dotenv never overrides already-set env vars by default.
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.server" });
dotenvConfig({ path: ".env" });
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { connectAndPing } from "../mongodb";
import { initRagIndex } from "../rag/ragService";
import {
  sendErrorPushNotification,
  registerPushToken,
} from "../reportErrorPush";
import { handleEasBuildWebhook } from "../easBuildWebhook";
import { registerMapsProxyRoutes } from "../mapsProxy";
import { registerOsrmProxyRoutes } from "../osrmProxy";
import { registerAiProxyRoutes } from "../aiProxy";
import { registerElevenLabsProxyRoutes } from "../elevenLabsProxy";
import {
  registerWsExtractProxy,
  registerExtractHttpProxyRoutes,
} from "../wsExtractProxy";
import { registerOptimizerProxyRoutes } from "../optimizerProxy";
import { registerRateLimits } from "./rateLimits";
import { createLogger } from "../logger";
import { ENV } from "./env";
import { transcribeBase64WithFallback } from "./moonshineTranscription";
import { chatWithCoPilot } from "../genkit/coPilot";

const log = createLogger("api");

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

const DEFAULT_FALLBACK_PORTS = [8082, 8083, 8084, 3001, 3002, 5000, 5001];

async function findAvailablePort(
  preferredPort: number = 3000,
): Promise<number> {
  const envFallback = process.env.PORT_FALLBACK;
  const extraPorts = envFallback
    ? envFallback
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n))
    : [];

  const portsToTry = [
    preferredPort,
    ...DEFAULT_FALLBACK_PORTS.filter((p) => p !== preferredPort),
    ...extraPorts.filter(
      (p) => p !== preferredPort && !DEFAULT_FALLBACK_PORTS.includes(p),
    ),
  ];

  for (const port of portsToTry) {
    if (port < 1024 || port > 65535) continue;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(
    `No available port found. Tried: ${[...new Set(portsToTry)].join(", ")}`,
  );
}

async function startServer() {
  // Optional: verify MongoDB connection when MONGODB_URI is set
  await connectAndPing();
  await initRagIndex();

  const app = express();
  const server = createServer(app);

  // WebSocket proxy for /ws/extract (web same-origin; forwards to optimizer backend)
  registerWsExtractProxy(server);

  // CORS: reflect request origin for credentials; in dev also allow when no Origin (e.g. same-origin)
  const isDev = process.env.NODE_ENV !== "production";
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    } else if (isDev && req.headers.host) {
      const host = req.headers.host;
      if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
        res.header("Access-Control-Allow-Origin", `http://${host}`);
      }
    }
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // EAS Build webhook must get raw body for signature verification (register before express.json)
  app.post(
    "/api/eas-build-webhook",
    express.raw({ type: "application/json" }),
    (req, res) => handleEasBuildWebhook(req, res),
  );

  // Rate limiting — applied before route registration so every path is covered.
  // Per-route tighter limits are also registered here (see rateLimits.ts).
  registerRateLimits(app);

  // Large-payload body parsers MUST run before the global 1mb parser so GeoJSON
  // imports (e.g. Planner) don't hit "request entity too large". Register them first.
  const optimizerJsonParser = express.json({ limit: "22mb" });
  for (const path of [
    "/api/optimize",
    "/api/vrp/solve",
    "/api/zones/partition",
    "/api/zones/partition-by-polygon",
    "/api/zones/partition-from-geojson",
    "/api/zones/partition-from-points",
    "/overture/optimize",
    "/api/vroom/optimize",
  ]) {
    app.use(path, optimizerJsonParser);
  }
  app.use("/api/geojson", express.json({ limit: "22mb" }));
  app.use("/api/voice/transcribe", express.json({ limit: "8mb" }));
  app.use("/api/maps", express.json({ limit: "512kb" }));
  app.use("/api/elevenlabs/tts", express.json({ limit: "64kb" }));
  app.use("/api/report-error", express.json({ limit: "64kb" }));
  app.use("/api/register-push-token", express.json({ limit: "4kb" }));

  // Global body parser (1 MB) for all other routes. Skip if body already parsed by a path above.
  app.use((req, res, next) => {
    if (req.body !== undefined) return next();
    return express.json({ limit: "1mb" })(req, res, next);
  });
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

  registerOAuthRoutes(app);
  registerMapsProxyRoutes(app);
  registerOsrmProxyRoutes(app);
  registerAiProxyRoutes(app);
  registerElevenLabsProxyRoutes(app);
  registerOptimizerProxyRoutes(app);
  registerExtractHttpProxyRoutes(app);

  // PMTiles: serve files from data/pmtiles so style editors can use e.g. /tiles/planet_....pmtiles
  const pmtilesDir = path.join(process.cwd(), "data", "pmtiles");
  app.use("/tiles", express.static(pmtilesDir, { maxAge: "1d" }));

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "trashroute-mobile API",
      endpoints: {
        health: "/api/health",
        trpc: "/api/trpc",
        voiceTranscribe: "POST /api/voice/transcribe",
        voiceChat: "POST /api/voice/chat",
        mapsDirections: "POST /api/maps/directions",
        mapsSnapToRoads: "POST /api/maps/snap-to-roads",
        aiChat: "POST /api/ai/chat",
        analyzeRoute: "POST /api/analyze-route (auth required, returns { analysis })",
        elevenLabsStatus: "GET /api/elevenlabs/status",
        elevenLabsVoices: "GET /api/elevenlabs/voices",
        elevenLabsTts: "POST /api/elevenlabs/tts",
        elevenLabsStt: "POST /api/elevenlabs/stt",
        config: "GET /api/config (Google Maps key, OSRM URL from server env)",
        osrmProxy: "GET /api/osrm/* (proxy to in-cluster OSRM when OSRM_URL set)",
        reportError: "POST /api/report-error",
        registerPushToken: "POST /api/register-push-token",
        easBuildWebhook: "POST /api/eas-build-webhook (EAS Build events)",
        wsExtract:
          "WebSocket /ws/extract (proxy to optimizer backend for web same-origin)",
        extractGeojson: "GET /geojson/:hash (proxy to extract backend)",
        extractDownload: "GET /download/:hash (proxy to extract backend)",
        optimizerOptimize: "POST /api/optimize (proxy to Python optimizer)",
        optimizerGeojson: "POST /api/geojson/* (proxy to Python optimizer)",
        optimizerZones: "POST /api/zones/partition (proxy to Python optimizer)",
        optimizerOverture:
          "POST /overture/optimize (proxy to Python optimizer)",
        optimizerHealth:
          "GET /optimizer/health (proxy to Python optimizer /health)",
        vroomOptimize:
          "POST /api/vroom/optimize (proxy to VROOM VRP solver)",
        osmTokenExchange: "POST /api/osm/token-exchange (OSM OAuth2 code→token)",
      },
      timestamp: Date.now(),
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  /** OSM OAuth2 token exchange — keeps client_secret server-side.
   *  Client sends { code, redirect_uri }; server exchanges with OSM and returns access_token. */
  app.post("/api/osm/token-exchange", async (req, res) => {
    const clientSecret = ENV.osmOAuthClientSecret;
    const clientId = process.env.EXPO_PUBLIC_OSM_OAUTH_CLIENT_ID ?? "";
    if (!clientSecret || !clientId) {
      res.status(503).json({ error: "OSM OAuth not configured on server (OSM_OAUTH_CLIENT_SECRET / EXPO_PUBLIC_OSM_OAUTH_CLIENT_ID missing)" });
      return;
    }
    const body = req.body as { code?: string; redirect_uri?: string };
    if (!body?.code) {
      res.status(400).json({ error: "code required" });
      return;
    }
    try {
      const params = new URLSearchParams({
        grant_type: "authorization_code",
        code: body.code,
        redirect_uri: body.redirect_uri ?? "",
        client_id: clientId,
        client_secret: clientSecret,
      });
      const osmRes = await fetch("https://www.openstreetmap.org/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const data = await osmRes.json() as Record<string, unknown>;
      if (!osmRes.ok) {
        res.status(502).json({ error: data.error_description ?? data.error ?? "OSM token exchange failed" });
        return;
      }
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  /** Public config for the app (e.g. Google Maps key, OSRM URL from server env). App calls this at the public API URL, not .railway.internal. When OSRM_URL is set (e.g. in-cluster), we return the proxy URL so the client uses /api/osrm instead of the internal hostname. */
  app.get("/api/config", (req, res) => {
    const osrmUrl =
      ENV.osrmUrl &&
      (ENV.osrmUrl.includes("svc.cluster.local") || ENV.osrmUrl.includes("localhost")
        ? `${req.protocol}://${req.get("host")}/api/osrm`
        : ENV.osrmUrl);
    res.json({
      googleMapsApiKey: ENV.googleMapsApiKey || undefined,
      osrmUrl: osrmUrl || undefined,
    });
  });

  app.get("/api/ai/chat", (_req, res) => {
    res.json({
      ok: true,
      message:
        "AI chat: use POST with body { messages, systemPrompt?, model?, max_tokens?, temperature? }",
      configured: Boolean(
        (process.env.AI_GATEWAY_API_KEY ?? "").trim() ||
        (process.env.OPENROUTER_API_KEY ?? "").trim(),
      ),
    });
  });

  app.post("/api/register-push-token", (req, res) => {
    const body = req.body as {
      expoPushToken?: string;
      token?: string;
      userId?: string;
    };
    const token =
      typeof body?.expoPushToken === "string"
        ? body.expoPushToken
        : body?.token;
    if (typeof token !== "string" || !token.trim()) {
      res.status(400).json({ ok: false, error: "expoPushToken required" });
      return;
    }
    const userId = typeof body?.userId === "string" ? body.userId : undefined;
    registerPushToken(token, userId);
    res.status(200).json({ ok: true });
  });

  app.post("/api/report-error", (req, res) => {
    const payload = req.body as {
      message?: string;
      stack?: string;
      appVersion?: string;
      platform?: string;
    };
    const message =
      typeof payload?.message === "string" ? payload.message : "Unknown error";
    sendErrorPushNotification({
      message,
      stack: typeof payload?.stack === "string" ? payload.stack : undefined,
      appVersion:
        typeof payload?.appVersion === "string"
          ? payload.appVersion
          : undefined,
      platform:
        typeof payload?.platform === "string" ? payload.platform : undefined,
    })
      .then(() => {
        res.status(200).json({ ok: true });
      })
      .catch((err) => {
        log.error(
          "report-error",
          err instanceof Error ? err : new Error(String(err)),
        );
        res.status(500).json({ ok: false, error: "Failed to process report" });
      });
  });

  /** Voice: public REST endpoints (no tRPC, no auth) so AI chat always works. */
  app.post("/api/voice/transcribe", async (req, res) => {
    try {
      const body = req.body as { audioBase64?: string; mimeType?: string };
      const audioBase64 =
        typeof body?.audioBase64 === "string" ? body.audioBase64 : undefined;
      if (!audioBase64) {
        res.status(400).json({ ok: false, error: "audioBase64 required" });
        return;
      }
      const result = await transcribeBase64WithFallback(
        audioBase64,
        typeof body?.mimeType === "string" ? body.mimeType : "audio/m4a",
        undefined,
        undefined,
      );
      if ("error" in result) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.status(200).json({
        ok: true,
        text: result.text,
        language: result.language,
        segments: result.segments,
      });
    } catch (err) {
      log.error(
        "voice/transcribe",
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Transcription failed",
      });
    }
  });

  app.post("/api/voice/chat", async (req, res) => {
    try {
      const body = req.body as {
        message?: string;
        history?: Array<{ role: string; content: string }>;
        clientGatewayApiKey?: string | null;
      };
      const message =
        typeof body?.message === "string" ? body.message.trim() : "";
      if (!message) {
        res.status(400).json({ ok: false, error: "message required" });
        return;
      }
      const history = Array.isArray(body?.history) ? body.history : undefined;
      const clientGatewayApiKey =
        typeof body?.clientGatewayApiKey === "string"
          ? body.clientGatewayApiKey
          : undefined;
      const reply = await chatWithCoPilot(
        message,
        history,
        undefined,
        clientGatewayApiKey ?? undefined,
      );
      res.status(200).json({ ok: true, reply });
    } catch (err) {
      log.error(
        "voice/chat",
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Chat failed",
      });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  // 404 for unknown routes (so callers get JSON, not Express default HTML)
  app.use((_req, res) => {
    res.status(404).json({
      ok: false,
      error: "Not found",
      hint: "API routes: GET /, GET /api/health, POST /api/trpc/*, POST /api/vrp/solve (proxy to optimizer), etc. Web app runs on port 19007 (npm run dev). If OR-Tools 404s, point the app at this server (EXPO_PUBLIC_API_BASE_URL) and set OPTIMIZER_BACKEND_URL to the Python backend (e.g. http://localhost:8000).",
    });
  });

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    log.warn("Port busy, using fallback", {
      preferred: preferredPort,
      using: port,
    });
    log.warn(
      `If using .env, set EXPO_PUBLIC_API_BASE_URL=http://localhost:${port}`,
    );
  }

  const host = process.env.HOST ?? "0.0.0.0";
  server.listen(port, host, () => {
    log.warn(`Server listening on http://${host}:${port}`);
    log.warn(
      'Web app (Expo): run "pnpm run dev" then open http://localhost:19007',
    );
    if (ENV.moonshineSidecarUrl) {
      log.warn("Voice STT: Moonshine sidecar configured");
    } else if (ENV.forgeApiUrl) {
      log.warn("Voice STT: Whisper (Forge) configured");
    } else {
      log.warn(
        "Voice STT: not configured — set MOONSHINE_SIDECAR_URL on this service (main API), or BUILT_IN_FORGE_*",
      );
    }
  });
}

startServer().catch((err) =>
  log.error(
    "startup failed",
    err instanceof Error ? err : new Error(String(err)),
  ),
);
