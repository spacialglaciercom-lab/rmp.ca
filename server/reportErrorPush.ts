import { createLogger } from "./logger";

const log = createLogger("reportErrorPush");

/**
 * Send a push notification via Expo Push API when the app reports an error.
 * Tokens from: (1) EXPO_ERROR_PUSH_TOKENS env, (2) app registration via POST /api/register-push-token.
 * Optional: EXPO_ACCESS_TOKEN for push security (EAS dashboard).
 */

const EXPO_ERROR_PUSH_TOKENS = (process.env.EXPO_ERROR_PUSH_TOKENS ?? "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN ?? undefined;

/** Tokens registered by the app (in-memory; add DB if you need persistence across restarts). */
const registeredPushTokens = new Set<string>();
/** Optional: token -> userId for future "notify by user" support. */
const tokenToUserId = new Map<string, string>();

export function registerPushToken(token: string, userId?: string): void {
  const t = token.trim();
  if (t) {
    registeredPushTokens.add(t);
    if (userId != null) tokenToUserId.set(t, userId);
  }
}

export function getErrorPushTokens(): string[] {
  const fromEnv = [...EXPO_ERROR_PUSH_TOKENS];
  const fromApp = [...registeredPushTokens];
  return [...new Set([...fromEnv, ...fromApp])];
}

export interface ErrorReportPayload {
  message: string;
  stack?: string;
  appVersion?: string;
  platform?: string;
}

export async function sendErrorPushNotification(payload: ErrorReportPayload): Promise<void> {
  const tokens = getErrorPushTokens();
  if (tokens.length === 0) return;

  try {
    const { Expo } = await import("expo-server-sdk");
    const expo = new Expo({ accessToken: EXPO_ACCESS_TOKEN });

    const title = "RouteMasterPro Error";
    const body =
      payload.message.length > 120
        ? payload.message.slice(0, 117) + "..."
        : payload.message;
    const data: Record<string, string> = {
      message: payload.message,
      ...(payload.appVersion && { appVersion: payload.appVersion }),
      ...(payload.platform && { platform: payload.platform }),
    };
    if (payload.stack) data.stack = payload.stack.slice(0, 2000);

    const messages = tokens.filter((token) => Expo.isExpoPushToken(token)).map(
      (to) => ({
        to,
        sound: "default" as const,
        title,
        body,
        data,
        priority: "high" as const,
      })
    );

    if (messages.length === 0) return;

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (err) {
    log.error("Failed to send push", err instanceof Error ? err : new Error(String(err)));
  }
}
