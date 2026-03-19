# AI Gateway & Mobile Setup — Security, Compatibility, Connectivity, Errors, Performance

Audit of: API key abstraction, React/Expo/AI SDK compatibility, ngrok and backend URL resolution, 429/504 handling, and route-logger latency.

---

## 1. Security: API key abstraction and leak risk

**Vercel AI Gateway key (and OpenRouter) are not exposed to the frontend.**

- **Where keys live**
  - `AI_GATEWAY_API_KEY` and `OPENROUTER_API_KEY` are read only in server code: [server/_core/env.ts](server/_core/env.ts) (from `process.env`), and used in [server/aiProxy.ts](server/aiProxy.ts) and [server/genkit/coPilot.ts](server/genkit/coPilot.ts). They are never sent in API responses or bundled for the client.
- **Client behaviour**
  - The app calls your backend only: `POST /api/voice/chat`, `POST /api/ai/chat`, `POST /api/analyze-route`. It never receives or stores the gateway key.
  - CoPilot can optionally send a **user-provided** key in the body as `clientGatewayApiKey` (from Settings / OpenRouter). That is a “bring your own key” path; the server uses it only for that request and does not log it. Your **server** gateway key is still never sent to the client.
- **Recommendation**
  - Keep `AI_GATEWAY_API_KEY` and `OPENROUTER_API_KEY` only in server env (e.g. `.env.server`, Vercel/Railway env). Do not add any `EXPO_PUBLIC_*` or client-visible env for these. No change required for security.

---

## 2. Compatibility: React 19.1.0, Expo 54, AI SDK

**Current setup**

- **ai** (Vercel AI SDK): only peer is `zod` (^3.25.76 || ^4.1.8). No React/Expo peer. Safe with React 19 and Expo 54.
- **@ai-sdk/react**: peer is `"react": "^18 || ~19.0.1 || ~19.1.2 || ^19.2.1"`. You have **react 19.1.0**. That does **not** match `~19.1.2` (which is 19.1.2 only). So you may see a peer dependency warning; runtime is usually fine, but EAS/build can be strict.

**Recommendation**

- If you see a peer dependency warning for `@ai-sdk/react` and React, bump React (and react-dom) to **19.1.2** (or a version that matches the peer, e.g. `~19.1.2`) so the declared range is satisfied and production builds are consistent.
- Run a production-like build once to confirm: `pnpm run build` (or your EAS build) and fix any peer/engine warnings before release.

---

## 3. Connectivity: ngrok and .env — backend URL in dev and preview

**How the app resolves the backend**

- [shared/oauth.ts](shared/oauth.ts) `getApiBaseUrl()`:
  - If `EXPO_PUBLIC_API_BASE_URL` is set and non-empty → that value (trimmed, no trailing slash).
  - **Web:** if not set, same-origin (current `window.location`); for common dev ports (19007, 19008, 8081, 8080) it returns `http://<host>:3000` so the Node server is used.
  - **Native:** if not set, falls back to `http://localhost:3000`.

**Development (local)**

- **Same machine / same Wi‑Fi:** set `EXPO_PUBLIC_API_BASE_URL=http://localhost:3000` (or `http://<your-machine-ip>:3000` if the device hits the PC). Works with Expo without tunnel.
- **Tunnel (e.g. `pnpm run mobile:tunnel`):** the tunnel is for **Metro** (app bundle). The **API** is still whatever `EXPO_PUBLIC_API_BASE_URL` points to. A physical device cannot reach `localhost:3000` on your PC unless:
  - You point `EXPO_PUBLIC_API_BASE_URL` to a **public** backend (e.g. Cloud Run, Railway), or
  - You expose the Node server via a **second** ngrok (or similar) and set `EXPO_PUBLIC_API_BASE_URL` to that URL (e.g. `https://abc123.ngrok-free.app`).
- **.env.example** already documents local vs production; it does not spell out “for tunnel on a physical device, API must be a public URL or a second tunnel.” Worth adding that note so preview/tunnel behaviour is clear.

**Production / preview (EAS)**

- **Production:** set `EXPO_PUBLIC_API_BASE_URL` in EAS (or your CI) to the production API (e.g. Cloud Run, Vercel serverless backend). The value is baked in at build time.
- **Preview builds:** same idea: set the same env in EAS for the preview profile so the app points at the correct backend (staging or production). If unset, native falls back to `http://localhost:3000`, which is wrong on a real device.

**Summary**

- Backend URL will resolve correctly in dev and production **if** `EXPO_PUBLIC_API_BASE_URL` is set appropriately for each environment (local IP or public URL for device/tunnel; public URL for EAS builds). Add a short note in `.env.example` that for tunnel + physical device, the API URL must be reachable from the internet (public host or second tunnel).

---

## 4. Error handling: 429 and 504 during GPX analysis

**Backend**

- **POST /api/analyze-route** [server/aiProxy.ts](server/aiProxy.ts): on gateway errors it maps:
  - Rate limit (429, “rate”, “limit”) → **429** and body `{ error: "Analysis service is busy. Try again in a few minutes." }`.
  - Timeout/504 (“timeout”, “504”, “gateway”) → **504** and the same user-facing message.
  - Other/500 → **500** and a safe message. No stack traces or raw gateway keys in the response.
- **POST /api/ai/chat**: stream errors use the stream’s status when available (so 429 can be returned as 429). The outer `catch` maps “429”/“rate” to the message “AI Gateway rate limit. Try again shortly.” but always uses **500** for that path. So for chat, rate limits are user-friendly in message text; status code for the outer catch is 500.

**Frontend**

- **getRouteAnalysis** [services/aiService.ts](services/aiService.ts): it **throws** with the server’s `error` string (or a fallback). It does not crash the process; the **caller** must `try/catch` and show the message (e.g. toast or inline error). If callers do not catch, you get an unhandled rejection and a red box / broken UX, but not a hard app crash.
- **analyzeRoute** (legacy): returns `undefined` on failure and logs; no throw. Safer for uncritical callers but they must check the return value.

**Recommendation**

- Ensure every caller of `getRouteAnalysis` uses try/catch and displays the error (e.g. “Analysis service is busy. Try again in a few minutes.” for 429/504). Then 429/504 are handled gracefully without crashing the app.
- Optionally: in POST /api/ai/chat’s outer catch, return **429** when the message indicates rate limit (and 504 for timeout) so the client can distinguish and show the same user-friendly copy as analyze-route.

---

## 5. Performance: Route logger and “Time to First Token”

**No `waitUntil` on Express**

- There is no `context.waitUntil()` in Node/Express. The route logger uses a **fire-and-forget** pattern so that logging does not block the response.

**What the middleware does**

- [server/middleware/routeLogger.ts](server/middleware/routeLogger.ts):
  - **wrapGenerate:** awaits `doGenerate()`, then returns the **result** to the SDK immediately. Only after that does it call `setImmediate(() => { ... uploadLog(...) })` (and optional extraction). The HTTP response is sent when the handler returns, so the upload runs **after** the response.
  - **wrapStream:** returns the stream to the client immediately; a `TransformStream` captures chunks for the log. The actual **upload** is scheduled in the transform’s `flush()` (when the stream ends), again without awaiting in the request path. So the client gets the first token and the full stream as if the logger were not there.

**Conclusion**

- Logging (and optional entity extraction) does **not** add latency to the user request and does **not** delay Time to First Token. Behaviour is equivalent to “waitUntil” in spirit: work is done after the response is on the wire.

---

## Summary table

| Area            | Status | Action |
|-----------------|--------|--------|
| Security        | Good   | Keep gateway keys server-only; no change required. |
| Compatibility   | Minor  | Align React to @ai-sdk/react peer (e.g. 19.1.2) if you see warnings; run a prod build once. |
| Connectivity    | Good   | Set `EXPO_PUBLIC_API_BASE_URL` per environment; document tunnel + device in .env.example. |
| 429/504 handling| Good   | Backend returns safe messages; ensure all `getRouteAnalysis` callers catch and show errors. |
| Logger latency  | Good   | Fire-and-forget; no impact on TTFB or Time to First Token. |
