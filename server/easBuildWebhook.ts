/**
 * EAS Build webhook: receive build completion events and send a push when build fails.
 * Set EAS_WEBHOOK_SECRET (same as when running `eas webhook:create`) to verify requests.
 */

import crypto from "crypto";
import type { Request, Response } from "express";
import { sendErrorPushNotification } from "./reportErrorPush";

const EAS_WEBHOOK_SECRET = (process.env.EAS_WEBHOOK_SECRET ?? "").trim();

function verifyExpoSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!EAS_WEBHOOK_SECRET || signature == null) return false;
  const hmac = crypto.createHmac("sha1", EAS_WEBHOOK_SECRET);
  hmac.update(rawBody);
  const hash = `sha1=${hmac.digest("hex")}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(hash, "utf8"));
  } catch {
    return false;
  }
}

/** Call this with req.body as the raw Buffer (before express.json()). */
export function handleEasBuildWebhook(req: Request, res: Response): void {
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    res.status(400).json({ ok: false, error: "Raw body required" });
    return;
  }

  const signature = req.headers["expo-signature"] as string | undefined;
  if (!verifyExpoSignature(rawBody, signature)) {
    res.status(401).json({ ok: false, error: "Invalid signature" });
    return;
  }

  let payload: {
    status?: string;
    platform?: string;
    buildDetailsPageUrl?: string;
    error?: { message?: string; errorCode?: string };
    metadata?: { buildProfile?: string; appVersion?: string };
  };
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ ok: false, error: "Invalid JSON" });
    return;
  }

  const status = payload.status;
  const platform = payload.platform ?? "unknown";
  const buildUrl = payload.buildDetailsPageUrl ?? "";
  const errorMsg = payload.error?.message ?? payload.error?.errorCode ?? "Unknown error";
  const profile = payload.metadata?.buildProfile ?? "";
  const appVersion = payload.metadata?.appVersion ?? "";

  if (status === "errored") {
    const message = [platform, profile && `(${profile})`, errorMsg].filter(Boolean).join(" ");
    sendErrorPushNotification({
      message: `EAS Build failed: ${message}`,
      appVersion: appVersion || undefined,
      platform: `build-${platform}`,
    }).then(() => {
      res.status(200).json({ ok: true, notified: true });
    }).catch((err) => {
      console.error("[easBuildWebhook] send push failed:", err);
      res.status(200).json({ ok: true, notified: false });
    });
    return;
  }

  if (status === "canceled") {
    sendErrorPushNotification({
      message: `EAS Build canceled: ${platform} ${profile}`.trim(),
      platform: `build-${platform}`,
    }).then(() => {
      res.status(200).json({ ok: true, notified: true });
    }).catch(() => {
      res.status(200).json({ ok: true, notified: false });
    });
    return;
  }

  res.status(200).json({ ok: true, notified: false });
}
