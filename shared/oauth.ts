import * as Linking from "expo-linking";
import * as ReactNative from "react-native";

// Extract scheme from bundle ID (last segment timestamp, prefixed with "manus")
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const bundleId = "space.manus.trashroute.mobile.t20260120004301";
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;

/** Fallback for native only; web uses same-origin in getApiBaseUrl(). */
const DEFAULT_API_BASE_URL = "https://rmpca-production.up.railway.app";

const rawApiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
const env = {
  portal: process.env.EXPO_PUBLIC_OAUTH_PORTAL_URL ?? "",
  server: process.env.EXPO_PUBLIC_OAUTH_SERVER_URL ?? "",
  appId: process.env.EXPO_PUBLIC_APP_ID ?? "",
  ownerId: process.env.EXPO_PUBLIC_OWNER_OPEN_ID ?? "",
  ownerName: process.env.EXPO_PUBLIC_OWNER_NAME ?? "",
  apiBaseUrl:
    typeof rawApiBase === "string" && rawApiBase.trim()
      ? rawApiBase
      : DEFAULT_API_BASE_URL,
  deepLinkScheme: schemeFromBundleId,
};

export const OAUTH_PORTAL_URL = env.portal;
export const OAUTH_SERVER_URL = env.server;
export const APP_ID = env.appId;

/** Whether OAuth is configured (portal URL and app ID must be set). */
export const isOAuthConfigured = Boolean(OAUTH_PORTAL_URL && APP_ID);
export const OWNER_OPEN_ID = env.ownerId;
export const OWNER_NAME = env.ownerName;
export const API_BASE_URL = env.apiBaseUrl;

/**
 * Get the API base URL.
 * - Web: uses same-origin (current site) so deployed app calls rmpca-production.up.railway.app instead of hardcoded backend.
 *   Local dev: Metro on 19007 → API server on 3000.
 *   Override with EXPO_PUBLIC_API_BASE_URL (e.g. http://localhost:3000) to point to your local backend.
 * - Native: uses EXPO_PUBLIC_API_BASE_URL or production default (set for EAS builds).
 */
export function getApiBaseUrl(): string {
  // Explicit override (local backend or custom deployment)
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  // Web: same-origin so deployed app does not hit hardcoded Railway backend if URLs differ.
  // Local dev: Expo/Metro often runs on 8081 or 19007; API/optimizer proxy lives on Node server :3000.
  if (
    ReactNative.Platform.OS === "web" &&
    typeof window !== "undefined" &&
    window.location
  ) {
    const { protocol, hostname, port } = window.location;
    const devPortsUsingBackend3000 = ["19007", "19008", "8081", "8080"];
    if (port && devPortsUsingBackend3000.includes(port)) {
      return `${protocol}//${hostname}:3000`;
    }
    return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
  }

  return DEFAULT_API_BASE_URL.replace(/\/$/, "");
}

export const SESSION_TOKEN_KEY = "app_session_token";
export const USER_INFO_KEY = "manus-runtime-user-info";

const encodeState = (value: string) => {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(value);
  }
  const BufferImpl = (globalThis as Record<string, unknown>).Buffer as
    | {
        from: (v: string, enc: string) => { toString: (enc: string) => string };
      }
    | undefined;
  if (BufferImpl) {
    return BufferImpl.from(value, "utf-8").toString("base64");
  }
  return value;
};

/**
 * Get the redirect URI for OAuth callback.
 * - Web: uses API server callback endpoint
 * - Native: uses deep link scheme
 */
export const getRedirectUri = () => {
  if (ReactNative.Platform.OS === "web") {
    return `${getApiBaseUrl()}/api/oauth/callback`;
  } else {
    return Linking.createURL("/oauth/callback", {
      scheme: env.deepLinkScheme,
    });
  }
};

export const getLoginUrl = () => {
  const redirectUri = getRedirectUri();
  const state = encodeState(redirectUri);

  const url = new URL(`${OAUTH_PORTAL_URL}/app-auth`);
  url.searchParams.set("appId", APP_ID);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};

/**
 * Start OAuth login flow.
 *
 * On native platforms (iOS/Android), open the system browser directly so
 * the OAuth callback returns via deep link to the app.
 *
 * On web, this simply redirects to the login URL.
 *
 * @returns Always null, the callback is handled via deep link.
 */
export async function startOAuthLogin(): Promise<string | null> {
  const loginUrl = getLoginUrl();

  if (ReactNative.Platform.OS === "web") {
    // On web, just redirect
    if (typeof window !== "undefined") {
      window.location.href = loginUrl;
    }
    return null;
  }

  const supported = await Linking.canOpenURL(loginUrl);
  if (!supported) {
    console.warn("[OAuth] Cannot open login URL: URL scheme not supported");
    return null;
  }

  try {
    await Linking.openURL(loginUrl);
  } catch (error) {
    console.error("[OAuth] Failed to open login URL:", error);
  }

  // The OAuth callback will reopen the app via deep link.
  return null;
}
