/**
 * AI service — route analysis via the backend proxy (secure pattern).
 *
 * The mobile app never sees an AI key. It sends GPX data + your app's user token
 * to POST /api/analyze-route; the backend holds the Vercel AI Gateway key and
 * returns only the cleaned analysis string.
 */
import { getApiBaseUrl } from "@/shared/oauth";

/**
 * Get route analysis from the backend (proxy pattern). Requires the app's user
 * session token so the server can authenticate and rate-limit.
 *
 * @param gpxString - Raw GPX (or route data) to analyze.
 * @param userToken - Your app's auth token (e.g. from SESSION_TOKEN_KEY / auth context). Sent as Authorization: Bearer.
 * @returns The analysis text returned by the server.
 * @throws On non-2xx or network error (error message is server's user-friendly message when possible).
 */
export async function getRouteAnalysis(
  gpxString: string,
  userToken: string,
): Promise<string> {
  const base = getApiBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/api/analyze-route`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      gpxData: gpxString,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as { analysis?: string; error?: string };

  if (!res.ok) {
    const message =
      typeof data?.error === "string" ? data.error : res.statusText || "Analysis failed";
    throw new Error(message);
  }

  if (typeof data?.analysis !== "string") {
    throw new Error("Invalid response from analysis service");
  }

  return data.analysis;
}

/**
 * Legacy: analyze route via generic chat endpoint (no auth). Prefer getRouteAnalysis
 * for the secure proxy pattern (backend holds the key, auth required).
 *
 * @param gpxData - Raw route data (GPX string or short description).
 * @returns The AI reply text, or undefined if the request failed.
 */
export async function analyzeRoute(gpxData: string): Promise<string | undefined> {
  try {
    const base = getApiBaseUrl().replace(/\/$/, "");
    const res = await fetch(`${base}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "user" as const,
            content: `Analyze this route data for collection efficiency: ${gpxData}`,
          },
        ],
        systemPrompt:
          "You are a logistics expert specializing in the Chinese Postman Problem and vehicle routing. Be concise and actionable.",
        max_tokens: 512,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      console.error("AI route analysis failed:", res.status, err.error ?? res.statusText);
      return undefined;
    }

    const data = (await res.json()) as { reply?: string };
    return typeof data.reply === "string" ? data.reply : undefined;
  } catch (error) {
    console.error("AI analysis failed:", error);
    return undefined;
  }
}
