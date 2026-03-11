export const ENV = {
  appId:
    process.env.VITE_APP_ID ?? process.env.EXPO_PUBLIC_APP_ID ?? "trashroute",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  mongodbUri: (process.env.MONGODB_URI ?? "")
    .trim()
    .replace(/^["']|["']$/g, ""),
  /** Path to GPX training folder (e.g. D:\\gpx_training\\raw_gpx_files). When set, app can list/load GPX files from here. */
  gpxTrainingPath: process.env.GPX_TRAINING_PATH ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
  mistralApiKey: process.env.MISTRAL_API_KEY ?? "",
  /** AI Gateway (Vercel) — single key for CoPilot + Chat. Trimmed so whitespace is not treated as set. */
  aiGatewayApiKey: (process.env.AI_GATEWAY_API_KEY ?? "").trim(),
  /** OpenRouter — alternative gateway; when set, CoPilot uses OpenRouter. Server-only. */
  openRouterApiKey: (process.env.OPENROUTER_API_KEY ?? "").trim(),
  /** ElevenLabs TTS — set on Railway so the app can use TTS without storing the key on the client. */
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
  /** Firebase Admin SDK service account JSON (for verifying Firebase Auth ID tokens) */
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT ?? "",
  /** Moonshine Voice sidecar URL for server-side STT (e.g. dedicated Railway service). Set to the sidecar's public URL (no trailing slash). */
  moonshineSidecarUrl: (() => {
    const raw = (process.env.MOONSHINE_SIDECAR_URL ?? "")
      .trim()
      .replace(/\/$/, "");
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    return `https://${raw}`;
  })(),
  /** Use Moonshine for STT when URL is set. Set to "false" to disable. Defaults to true when MOONSHINE_SIDECAR_URL is set. */
  moonshineSttEnabled: process.env.MOONSHINE_STT_ENABLED !== "false",
};
