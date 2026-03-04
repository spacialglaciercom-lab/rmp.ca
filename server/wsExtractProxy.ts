/**
 * WebSocket proxy for /ws/extract — forwards to the Overture extract backend.
 * Used so the web app can connect same-origin (avoids browser CORS/Origin issues).
 * Set EXTRACT_WS_UPSTREAM or OPTIMIZER_WS_UPSTREAM to override the extract backend URL.
 */
import type { Server } from "http";
import httpProxy from "http-proxy";
import { createLogger } from "./logger";

const log = createLogger("ws-extract-proxy");

/** Public web extractor backend (Railway). Override with EXTRACT_WS_UPSTREAM if your service URL differs (e.g. typo). */
const DEFAULT_EXTRACT_UPSTREAM = "https://webovertureextract-webovertureextract.up.railway.app";
const UPSTREAM_HTTP =
  process.env.EXTRACT_WS_UPSTREAM ||
  process.env.OPTIMIZER_WS_UPSTREAM ||
  process.env.EXPO_PUBLIC_OVERTURE_EXTRACT_URL ||
  DEFAULT_EXTRACT_UPSTREAM;
const UPSTREAM_WS = UPSTREAM_HTTP.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");

export function registerWsExtractProxy(server: Server): void {
  const proxy = httpProxy.createProxyServer({ ws: true });

  proxy.on("error", (err: NodeJS.ErrnoException, req, _res) => {
    const code = err.code ?? "";
    const msg = (err.message || String(err) || code || "Unknown WebSocket proxy error").trim() || "Unknown WebSocket proxy error";
    log.warn("WebSocket proxy error", {
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
    // target = origin only; http-proxy forwards req.url (e.g. /ws/extract) to that origin
    log.info("Proxying WebSocket /ws/extract to upstream", { target: UPSTREAM_WS, path: req.url });
    proxy.ws(req, socket, head, { target: UPSTREAM_WS });
  });
}
