/**
 * OpenStreetMap OAuth 2.0 authentication for the OSM Editing plugin.
 * Handles login (authorization code flow), token storage, and logout.
 *
 * Configure your app at https://www.openstreetmap.org/oauth2/applications
 * Redirect URI (native): <scheme>://oauth-callback (e.g. routemasterpro://oauth-callback)
 * Redirect URI (web): <origin>/osm-callback (e.g. https://routemasterpro.ca/osm-callback)
 * Scope: read_prefs (read user preferences).
 */

import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { Platform } from "react-native";

const APP_SCHEME =
  (typeof Constants.expoConfig?.scheme === "string" &&
    Constants.expoConfig?.scheme) ||
  "trashroute";

const OSM_ACCESS_TOKEN_KEY = "osm_access_token";
const OSM_TOKEN_EXPIRY_KEY = "osm_token_expiry";
const OSM_USER_DISPLAY_NAME_KEY = "osm_user_display_name";

const AUTH_BASE = "https://www.openstreetmap.org/oauth2/authorize";
const TOKEN_URL = "https://www.openstreetmap.org/oauth2/token";
const USER_DETAILS_URL = "https://api.openstreetmap.org/api/0.6/user/details";

/** Client ID from OSM OAuth2 application. Set in .env (create app at https://www.openstreetmap.org/oauth2/applications). */
export const OSM_CLIENT_ID =
  (typeof process !== "undefined" &&
    process.env?.EXPO_PUBLIC_OSM_OAUTH_CLIENT_ID) ||
  "";

function getClientSecret(): string {
  // SECURITY: OAuth client secrets must NEVER be exposed to the client.
  // Token exchange MUST be performed server-side only.
  // For now, return empty string - implement backend proxy for token exchange.
  return "";
}

function getRedirectUri(): string {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.location?.origin) {
      return `${window.location.origin}/osm-callback`;
    }
    return "https://localhost/osm-callback";
  }
  // Native: use oauth-callback to match OSM app registration (e.g. routemasterpro://oauth-callback)
  const isExpoGo = Constants.appOwnership === "expo";
  if (isExpoGo) {
    return Linking.createURL("oauth-callback");
  }
  return Linking.createURL("oauth-callback", { scheme: APP_SCHEME });
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

async function openAuthSession(): Promise<{ url: string } | null> {
  const redirectUri = getRedirectUri();
  const scope = "read_prefs";
  const state = `osm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const url = `${AUTH_BASE}?client_id=${encodeURIComponent(OSM_CLIENT_ID)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;

  const result = await WebBrowser.openAuthSessionAsync(url, redirectUri, {
    showInRecents: true,
  });

  if (result.type === "success" && result.url) {
    return { url: result.url };
  }
  return null;
}

async function exchangeCodeForToken(
  code: string,
): Promise<{ access_token: string; expires_in?: number }> {
  // SECURITY: Token exchange must be done through backend to avoid exposing client secret.
  // The backend endpoint at /api/osm/token-exchange handles the actual token exchange.
  const redirectUri = getRedirectUri();

  const res = await fetch("/api/osm/token-exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OSM token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  const expiresIn = Number(data.expires_in) ?? 86400;
  const expiresAt = Date.now() + expiresIn * 1000;

  await secureSet(OSM_ACCESS_TOKEN_KEY, data.access_token);
  await secureSet(OSM_TOKEN_EXPIRY_KEY, String(expiresAt));

  return data;
}

/** Fetch display name from OSM API and cache it. */
async function fetchAndCacheDisplayName(accessToken: string): Promise<string> {
  const res = await fetch(USER_DETAILS_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "RouteMasterPro/1.0 (OSM Editing)",
    },
  });
  if (!res.ok) return "OpenStreetMap user";
  const text = await res.text();
  const match = text.match(/<user[^>]*display_name="([^"]+)"/);
  const name = match?.[1] ?? "OpenStreetMap user";
  await secureSet(OSM_USER_DISPLAY_NAME_KEY, name);
  return name;
}

export const OsmAuthService = {
  getRedirectUri,

  isConfigured(): boolean {
    return Boolean(OSM_CLIENT_ID && getClientSecret());
  },

  async getAccessToken(): Promise<string | null> {
    if (!OSM_CLIENT_ID) return null;
    const token = await secureGet(OSM_ACCESS_TOKEN_KEY);
    if (!token) return null;
    const expiry = await secureGet(OSM_TOKEN_EXPIRY_KEY);
    if (expiry && Date.now() >= Number(expiry)) {
      await this.logout();
      return null;
    }
    return token;
  },

  async getDisplayName(): Promise<string | null> {
    const name = await secureGet(OSM_USER_DISPLAY_NAME_KEY);
    if (name) return name;
    const token = await this.getAccessToken();
    if (!token) return null;
    return fetchAndCacheDisplayName(token);
  },

  async login(): Promise<string> {
    if (!OSM_CLIENT_ID) {
      throw new Error(
        "OSM OAuth is not configured (EXPO_PUBLIC_OSM_OAUTH_CLIENT_ID missing).",
      );
    }
    const result = await openAuthSession();
    if (!result?.url) {
      throw new Error("OSM sign-in was cancelled or failed.");
    }
    const url = result.url;
    const parsed = new URL(url);
    const code = parsed.searchParams.get("code");
    const error = parsed.searchParams.get("error");
    if (error) {
      throw new Error(parsed.searchParams.get("error_description") || error);
    }
    if (!code) {
      throw new Error("OSM did not return an authorization code.");
    }
    await exchangeCodeForToken(code);
    const name = await this.getDisplayName();
    return name ?? "OpenStreetMap user";
  },

  async logout(): Promise<void> {
    await secureDelete(OSM_ACCESS_TOKEN_KEY);
    await secureDelete(OSM_TOKEN_EXPIRY_KEY);
    await secureDelete(OSM_USER_DISPLAY_NAME_KEY);
  },
};
