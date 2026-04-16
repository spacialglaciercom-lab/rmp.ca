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
  /** When set, route-logger middleware POSTs JSON logs (input, output, extracted) here. No latency added (fire-and-forget). */
  routeLogUploadUrl: (process.env.ROUTE_LOG_UPLOAD_URL ?? "").trim(),
  /** When "true", route logger uses a smaller model to extract GPX coords, distance estimates, route errors. */
  routeLogAnalyze: process.env.ROUTE_LOG_ANALYZE === "true",
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
  /** OSM OAuth2 client secret — server-side only, never sent to the client.
   *  Pair with EXPO_PUBLIC_OSM_OAUTH_CLIENT_ID in .env.
   *  Register your app at https://www.openstreetmap.org/oauth2/applications */
  osmOAuthClientSecret: (process.env.OSM_OAUTH_CLIENT_SECRET ?? "").trim(),
  /** OSRM routing base URL (e.g. http://osrm:5000 in k8s, or https://osrm.yourdomain.com). When set, exposed via GET /api/config so the app uses backend OSRM instead of public router.project-osrm.org. */
  osrmUrl: (process.env.OSRM_URL ?? "").trim().replace(/\/$/, ""),
  /** Optimizer backend URL (Python FastAPI). Prefer Railway/GKE env; then Expo public env; then divine-harmony fallback. */
  optimizerBackendUrl: (() => {
    const raw =
      process.env.OPTIMIZER_BACKEND_URL ||
      process.env.EXPO_PUBLIC_OPTIMIZER_URL ||
      "https://divine-harmony-optimizer.up.railway.app";
    return raw.startsWith("http://") || raw.startsWith("https://")
      ? raw.replace(/\/$/, "")
      : `https://${raw.replace(/\/$/, "")}`;
  })(),
  resendApiKey: (process.env.RESEND_API_KEY ?? "").trim(),
  emailFrom: (process.env.EMAIL_FROM ?? "RouteMaster Pro <contact@routemasterpro.ca>").trim(),
  appBaseUrl: (process.env.APP_BASE_URL ?? "https://rmpca-production.up.railway.app").trim().replace(/\/$/, ""),
};
