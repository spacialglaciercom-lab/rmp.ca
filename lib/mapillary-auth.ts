/**
 * Mapillary OAuth 2.0 authentication service.
 * Handles login (authorization code flow), token storage, and logout.
 * Uses expo-secure-store for native and falls back for web.
 *
 * Mapillary's developer dashboard only accepts http/https redirect URLs (no custom schemes).
 * Configure your app at https://www.mapillary.com/developer/applications and add:
 *   - https://routemasterpro.ca/mapillary-callback  (for both web and native iOS/Android)
 * Set EXPO_PUBLIC_MAPILLARY_REDIRECT_URI to that URL so the native app uses it; the in-app
 * browser will receive the redirect and return the code to the app.
 */

import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { Platform } from "react-native";

/** App URL scheme from app.config (e.g. "trashroute" or "routemasterpro"). */
const APP_SCHEME =
  (typeof Constants.expoConfig?.scheme === "string" && Constants.expoConfig.scheme) || "trashroute";

const MAPILLARY_ACCESS_TOKEN_KEY = "mapillary_access_token";
const MAPILLARY_TOKEN_EXPIRY_KEY = "mapillary_token_expiry";
const MAPILLARY_REFRESH_TOKEN_KEY = "mapillary_refresh_token";

const AUTH_BASE = "https://www.mapillary.com/connect";
const TOKEN_URL = "https://graph.mapillary.com/token";

/** Client ID from Mapillary Developer Dashboard. Set in app.config or env. */
export const MAPILLARY_CLIENT_ID =
  (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_MAPILLARY_CLIENT_ID) ||
  "33877043798608580";

/** Client Secret from Mapillary Developer Dashboard. Required for token exchange. */
function getClientSecret(): string {
  const secret =
    (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_MAPILLARY_CLIENT_SECRET) || "";
  return secret;
}

/** Redirect URI must match the one registered in your Mapillary app (they only accept http/https). */
function getRedirectUri(): string {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.location?.origin) {
      return `${window.location.origin}/mapillary-callback`;
    }
    return "https://localhost/mapillary-callback";
  }
  // Mapillary dashboard only accepts https (and http) — use your website URL when set.
  const base =
    typeof process !== "undefined" && process.env?.EXPO_PUBLIC_MAPILLARY_REDIRECT_URI?.trim();
  if (base) {
    const url = base.replace(/\/$/, "");
    return url.endsWith("/mapillary-callback") ? url : `${url}/mapillary-callback`;
  }
  // Fallback: Expo Go uses exp:// so redirect returns to the app; add that exact URI in Mapillary.
  const isExpoGo = Constants.appOwnership === "expo";
  if (isExpoGo) {
    return Linking.createURL("mapillary-callback");
  }
  // Native build without EXPO_PUBLIC_MAPILLARY_REDIRECT_URI: custom scheme won't be accepted by Mapillary;
  // set EXPO_PUBLIC_MAPILLARY_REDIRECT_URI=https://routemasterpro.ca so the app uses the HTTPS callback.
  return Linking.createURL("mapillary-callback", { scheme: APP_SCHEME });
}

export interface MapillaryTokenResult {
  accessToken: string;
  expiresIn: number;
  expiresAt: number;
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    } catch {
      // ignore
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      if (typeof localStorage !== "undefined") return localStorage.getItem(key);
    } catch {
      // ignore
    }
    return null;
  }
  return SecureStore.getItemAsync(key);
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/**
 * Build the authorization URL and open it in the browser.
 * Returns the redirect URL with the authorization code (or error).
 */
async function openAuthSession(): Promise<{ url: string } | null> {
  const redirectUri = getRedirectUri();
  const scope = "upload";
  const state = `mly_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const url = `${AUTH_BASE}?client_id=${encodeURIComponent(MAPILLARY_CLIENT_ID)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;

  const result = await WebBrowser.openAuthSessionAsync(url, redirectUri, {
    showInRecents: true,
  });

  if (result.type === "success" && result.url) {
    return { url: result.url };
  }
  return null;
}

/**
 * Exchange authorization code for access token.
 * Mapillary expects: POST with Authorization: OAuth CLIENT_SECRET and body with grant_type, code, client_id, redirect_uri.
 */
async function exchangeCodeForToken(code: string): Promise<MapillaryTokenResult> {
  const clientSecret = getClientSecret();
  const redirectUri = getRedirectUri();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: MAPILLARY_CLIENT_ID,
    redirect_uri: redirectUri,
  }).toString();

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `OAuth ${clientSecret}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mapillary token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    token_type?: string;
  };

  const expiresIn = Number(data.expires_in) || 9000;
  const expiresAt = Date.now() + expiresIn * 1000;

  await secureSet(MAPILLARY_ACCESS_TOKEN_KEY, data.access_token);
  await secureSet(MAPILLARY_TOKEN_EXPIRY_KEY, String(expiresAt));
  await secureSet(MAPILLARY_REFRESH_TOKEN_KEY, data.access_token);

  return {
    accessToken: data.access_token,
    expiresIn,
    expiresAt,
  };
}

/**
 * Refresh the access token using the current token as refresh token.
 * Mapillary: grant_type=refresh_token, refresh_token=<current access token>, client_id=...
 */
async function refreshAccessToken(): Promise<MapillaryTokenResult | null> {
  const currentToken = await secureGet(MAPILLARY_REFRESH_TOKEN_KEY);
  if (!currentToken) return null;

  const clientSecret = getClientSecret();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: currentToken,
    client_id: MAPILLARY_CLIENT_ID,
  }).toString();

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `OAuth ${clientSecret}`,
    },
    body,
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  const expiresIn = Number(data.expires_in) || 9000;
  const expiresAt = Date.now() + expiresIn * 1000;

  await secureSet(MAPILLARY_ACCESS_TOKEN_KEY, data.access_token);
  await secureSet(MAPILLARY_TOKEN_EXPIRY_KEY, String(expiresAt));
  await secureSet(MAPILLARY_REFRESH_TOKEN_KEY, data.access_token);

  return {
    accessToken: data.access_token,
    expiresIn,
    expiresAt,
  };
}

export const MapillaryAuthService = {
  /**
   * Redirect URI used for OAuth. In Expo Go this is an exp:// URL — add it in Mapillary developer settings.
   */
  getRedirectUri,

  /**
   * Open browser for Mapillary login. On success, exchanges the code for an access token
   * and stores it securely. Returns the access token or null if user cancelled or error.
   */
  async login(): Promise<string | null> {
    const result = await openAuthSession();
    if (!result) return null;

    const parsed = Linking.parse(result.url);
    const params = parsed.queryParams as Record<string, string> | undefined;
    const error = params?.error;
    if (error) {
      if (error === "user_denied") {
        console.log("[MapillaryAuth] User denied authorization");
        return null;
      }
      throw new Error(`Mapillary auth error: ${error}`);
    }

    const code = params?.code;
    if (!code) {
      console.warn("[MapillaryAuth] No code in redirect");
      return null;
    }

    const tokenResult = await exchangeCodeForToken(code);
    return tokenResult.accessToken;
  },

  /**
   * Get the stored access token. Refreshes if expired (when client secret is available).
   */
  async getAccessToken(): Promise<string | null> {
    const token = await secureGet(MAPILLARY_ACCESS_TOKEN_KEY);
    const expiryStr = await secureGet(MAPILLARY_TOKEN_EXPIRY_KEY);
    const expiresAt = expiryStr ? Number(expiryStr) : 0;

    if (token && expiresAt > Date.now() + 60 * 1000) {
      return token;
    }

    const refreshed = await refreshAccessToken();
    return refreshed?.accessToken ?? token;
  },

  /**
   * Clear stored token and optionally revoke on the server.
   * Mapillary does not document a revoke endpoint; we clear local storage only.
   */
  async logout(): Promise<void> {
    await secureDelete(MAPILLARY_ACCESS_TOKEN_KEY);
    await secureDelete(MAPILLARY_TOKEN_EXPIRY_KEY);
    await secureDelete(MAPILLARY_REFRESH_TOKEN_KEY);
  },

  /** Check if we have a valid (or refreshable) token. */
  async isLoggedIn(): Promise<boolean> {
    const token = await this.getAccessToken();
    return !!token;
  },
};
