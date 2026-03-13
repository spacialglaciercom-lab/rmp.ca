/**
 * WebSocket proxy for /ws/extract — forwards to the Overture extract backend.
 * Used so the web app can connect same-origin (avoids browser CORS/Origin issues).
 * Set EXTRACT_WS_UPSTREAM or OPTIMIZER_WS_UPSTREAM to override the extract backend URL.
 *
 * Why extraction works on mobile but not web:
 * - Mobile connects directly from the device to the extract service (webovertureextract).
 * - Web connects to this backend (/ws/extract), which then proxies to the extract service.
 * - ECONNREFUSED means the backend cannot reach the upstream (e.g. Railway networking,
 *   or IPv6 vs IPv4). We force IPv4 for the upstream connection to avoid IPv6 issues.
 * - If both apps are in the same Railway project, set EXTRACT_WS_UPSTREAM to the
 *   internal URL: http://webovertureextract.railway.internal:PORT (replace PORT with the service port).
 */
import type { Server, IncomingMessage, IncomingHttpHeaders } from "http";
import https from "https";
import httpProxy from "http-proxy";
import type { Express, Request, Response } from "express";
import { createLogger } from "./logger";

const log = createLogger("ws-extract-proxy");

/** Default extract upstream. Override with EXTRACT_WS_UPSTREAM env var. */
const DEFAULT_EXTRACT_UPSTREAM = "http://127.0.0.1:9000";
const UPSTREAM_HTTP =
  process.env.EXTRACT_WS_UPSTREAM ||
  process.env.OPTIMIZER_WS_UPSTREAM ||
  process.env.EXPO_PUBLIC_OVERTURE_EXTRACT_URL ||
  DEFAULT_EXTRACT_UPSTREAM;
const UPSTREAM_WS = UPSTREAM_HTTP.replace(/^https:\/\//i, "wss://").replace(
  /^http:\/\//i,
  "ws://",
);

/** Force IPv4 for upstream connection; avoids ECONNREFUSED when upstream only listens on IPv4 (e.g. some Railway setups). */
const UPSTREAM_IS_WSS = /^wss:\/\//i.test(UPSTREAM_WS);
const upstreamAgent = UPSTREAM_IS_WSS
  ? new https.Agent({ family: 4 })
  : undefined;

/** Headers essential for WebSocket upgrade — everything else is stripped to avoid HPE_HEADER_OVERFLOW on the upstream. */
const WS_PASSTHROUGH_HEADERS = new Set([
  "host",
  "upgrade",
  "connection",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
  "origin",
]);

/** Build a minimal header object for the upstream WebSocket handshake. */
function stripHeaders(req: IncomingMessage): IncomingHttpHeaders {
  const out: IncomingHttpHeaders = {};
  for (const key of Object.keys(req.headers)) {
    if (WS_PASSTHROUGH_HEADERS.has(key)) {
      out[key] = req.headers[key];
    }
  }
  return out;
}

/**
 * Proxy GET /geojson/:hash and GET /download/:hash to the extract upstream.
 * After a successful WebSocket extraction the client fetches these HTTP endpoints
 * to retrieve the result — they must be forwarded to the same extract service.
 */
export function registerExtractHttpProxyRoutes(app: Express): void {
  async function proxyToExtract(req: Request, res: Response): Promise<void> {
    const targetUrl = `${UPSTREAM_HTTP.replace(/\/$/, "")}${req.originalUrl}`;
    log.info("Proxying extract HTTP request", {
      method: req.method,
      path: req.originalUrl,
      target: targetUrl,
    });
    try {
      const upstream = await fetch(targetUrl, {
        signal: AbortSignal.timeout(60_000),
      });
      res.status(upstream.status);
      const ct = upstream.headers.get("content-type");
      if (ct) res.setHeader("Content-Type", ct);
      const cd = upstream.headers.get("content-disposition");
      if (cd) res.setHeader("Content-Disposition", cd);
      const body = await upstream.arrayBuffer();
      res.send(Buffer.from(body));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown proxy error";
      log.error(
        "Extract HTTP proxy failed",
        err instanceof Error ? err : new Error(message),
      );
      res.status(502).json({
        ok: false,
        error: "Extract backend unreachable",
        details: message,
        target: targetUrl,
      });
    }
  }

  app.get("/geojson/:hash", (req, res) => proxyToExtract(req, res));
  app.get("/download/:hash", (req, res) => proxyToExtract(req, res));
}

export function registerWsExtractProxy(server: Server): void {
  log.info("WebSocket /ws/extract proxy will forward to upstream", {
    target: UPSTREAM_WS,
  });

  const proxy = httpProxy.createProxyServer({ ws: true });

  proxy.on("error", (err: NodeJS.ErrnoException, req, _res) => {
    const code = err.code ?? "";
    const msg =
      (
        err.message ||
        String(err) ||
        code ||
        "Unknown WebSocket proxy error"
      ).trim() || "Unknown WebSocket proxy error";
    const hint =
      code === "ECONNREFUSED"
        ? " Upstream extract service is not running or unreachable. Start it on Railway or set EXTRACT_WS_UPSTREAM (use Railway internal URL if same project: http://servicename.railway.internal:PORT)."
        : code === "HPE_HEADER_OVERFLOW"
          ? " Request headers too large for upstream. Check that header stripping is working."
          : "";
    log.warn("WebSocket proxy error" + hint, {
      error: msg,
      code: code || undefined,
      target: UPSTREAM_WS,
      url: req?.url,
    });
  });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws/extract")) {
      socket.destroy();
      return;
    }
    // Replace incoming headers with a minimal set to avoid HPE_HEADER_OVERFLOW
    // on the upstream (Vercel/Cloud Run add many proxy headers that accumulate).
    req.headers = stripHeaders(req);

    const proxyOptions: Record<string, unknown> = { target: UPSTREAM_WS };
    if (upstreamAgent) proxyOptions.agent = upstreamAgent;
    log.info("Proxying WebSocket /ws/extract to upstream", {
      target: UPSTREAM_WS,
      path: req.url,
    });
    proxy.ws(req, socket, head, proxyOptions);
  });
}
