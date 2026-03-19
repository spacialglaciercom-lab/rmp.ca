/**
 * OSRM proxy: forwards /api/osrm/* to the in-cluster OSRM service (OSRM_URL).
 * The client cannot reach cluster-internal URLs (e.g. osrm.rmpca.svc.cluster.local),
 * so the backend exposes this proxy and returns the proxy URL in GET /api/config.
 */

import type { Express, Request, Response } from "express";
import { ENV } from "./_core/env";
import { createLogger } from "./logger";

const log = createLogger("osrm-proxy");

const PROXY_PREFIX = "/api/osrm";

export function registerOsrmProxyRoutes(app: Express): void {
  if (!ENV.osrmUrl) return;

  app.use(PROXY_PREFIX, async (req: Request, res: Response) => {
    const suffix = req.originalUrl.startsWith(PROXY_PREFIX)
      ? req.originalUrl.slice(PROXY_PREFIX.length) || "/"
      : req.url;
    const target = `${ENV.osrmUrl.replace(/\/$/, "")}${suffix}`;

    try {
      const fwd = await fetch(target, {
        method: req.method,
        headers: {
          accept: req.headers.accept ?? "application/json",
        },
      });
      const body = await fwd.text();
      res.status(fwd.status);
      const ct = fwd.headers.get("content-type");
      if (ct) res.setHeader("content-type", ct);
      res.send(body);
    } catch (err) {
      log.error("OSRM proxy error", err instanceof Error ? err : new Error(String(err)));
      res.status(502).json({ code: "ProxyError", message: "OSRM proxy request failed" });
    }
  });
}
