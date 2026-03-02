/**
 * ElevenLabs proxy — TTS and voices via server so the API key stays on Railway (env ELEVENLABS_API_KEY).
 * Same pattern as AI Gateway: client calls our API, server adds the key and proxies to ElevenLabs.
 */
import type { Express, Request, Response } from "express";
import { ENV } from "./_core/env";
import { createLogger } from "./logger";

const log = createLogger("elevenlabs-proxy");

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

function getApiKey(): string | null {
  const key = ENV.elevenLabsApiKey?.trim();
  return key || null;
}

export function registerElevenLabsProxyRoutes(app: Express) {
  const hasKey = Boolean(getApiKey());
  log.warn("API key", { status: hasKey ? "set" : "not set" });

  /** GET /api/elevenlabs/status — whether server has ElevenLabs key (client can use proxy without own key). */
  app.get("/api/elevenlabs/status", (_req: Request, res: Response) => {
    res.json({ configured: hasKey });
  });

  /** GET /api/elevenlabs/voices — list voices (combines personal + shared). */
  app.get("/api/elevenlabs/voices", async (_req: Request, res: Response) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(503).json({ error: "ELEVENLABS_API_KEY not set on server." });
      return;
    }
    try {
      const [personalResp, sharedResp] = await Promise.all([
        fetch(`${ELEVENLABS_BASE}/voices`, { headers: { "xi-api-key": apiKey } }),
        fetch(`${ELEVENLABS_BASE}/shared-voices?page_size=100&sort=trending&category=professional`, {
          headers: { "xi-api-key": apiKey },
        }).catch(() => null),
      ]);
      const allVoices: Array<{ voice_id: string; name: string; category: string; labels: Record<string, string>; preview_url: string | null }> = [];
      const seenIds = new Set<string>();

      if (personalResp.ok) {
        const data = (await personalResp.json()) as { voices?: Array<{ voice_id: string; name: string; category?: string; labels?: Record<string, string>; preview_url?: string | null }> };
        for (const v of data.voices ?? []) {
          if (!seenIds.has(v.voice_id)) {
            seenIds.add(v.voice_id);
            allVoices.push({
              voice_id: v.voice_id,
              name: v.name,
              category: v.category ?? "premade",
              labels: v.labels ?? {},
              preview_url: v.preview_url ?? null,
            });
          }
        }
      }
      if (sharedResp?.ok) {
        const sharedData = (await sharedResp.json()) as { voices?: Array<{ voice_id?: string; public_owner_id?: string; name: string; category?: string; labels?: Record<string, string>; preview_url?: string | null }> };
        for (const v of sharedData.voices ?? []) {
          const id = v.voice_id ?? v.public_owner_id;
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            allVoices.push({
              voice_id: id,
              name: v.name,
              category: v.category ?? "shared",
              labels: v.labels ?? {},
              preview_url: v.preview_url ?? null,
            });
          }
        }
      }
      res.json({ voices: allVoices });
    } catch (err) {
      log.error("voices error", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to fetch voices" });
    }
  });

  /** POST /api/elevenlabs/stt — speech-to-text. Body: { audioBase64, mimeType? }. Returns { text, language_code? }. */
  app.post("/api/elevenlabs/stt", async (req: Request, res: Response) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(503).json({ error: "ELEVENLABS_API_KEY not set on server." });
      return;
    }
    const { audioBase64, mimeType } = req.body as { audioBase64?: string; mimeType?: string };
    if (!audioBase64 || typeof audioBase64 !== "string") {
      res.status(400).json({ error: "audioBase64 is required" });
      return;
    }
    try {
      // Convert base64 to Buffer
      const audioBuffer = Buffer.from(audioBase64, "base64");
      const mime = mimeType || "audio/m4a";
      const ext = mime.split("/")[1] || "m4a";
      const filename = `recording.${ext}`;

      // Build multipart form data manually
      const boundary = "----ElevenLabsSTT" + Date.now().toString(16);
      const parts: Buffer[] = [];

      // File part
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`
      ));
      parts.push(audioBuffer);
      parts.push(Buffer.from("\r\n"));

      // model_id part
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model_id"\r\n\r\n` +
        `scribe_v1\r\n`
      ));

      // End boundary
      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const body = Buffer.concat(parts);

      const resp = await fetch(`${ELEVENLABS_BASE}/speech-to-text`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        log.warn("STT failed", { status: resp.status, body: errText.slice(0, 200) });
        res.status(resp.status).json({ error: "ElevenLabs STT failed" });
        return;
      }

      const data = await resp.json() as { text?: string; language_code?: string };
      res.json({ text: data.text || "", language_code: data.language_code });
    } catch (err) {
      log.error("STT error", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "STT request failed" });
    }
  });

  /** POST /api/elevenlabs/tts — text-to-speech. Body: { text, voice_id?, model_id? }. Returns audio/mpeg. */
  app.post("/api/elevenlabs/tts", async (req: Request, res: Response) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(503).json({ error: "ELEVENLABS_API_KEY not set on server." });
      return;
    }
    const { text, voice_id: voiceId, model_id: modelId } = req.body as { text?: string; voice_id?: string; model_id?: string };
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "text is required" });
      return;
    }
    const voice = voiceId?.trim() || "21m00Tcm4TlvDq8ikWAM";
    const model = modelId?.trim() || "eleven_turbo_v2_5";
    try {
      const resp = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voice}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        log.warn("TTS failed", { status: resp.status, body: errText.slice(0, 200) });
        res.status(resp.status).json({ error: "ElevenLabs TTS failed" });
        return;
      }
      const contentType = resp.headers.get("content-type") || "audio/mpeg";
      res.setHeader("Content-Type", contentType);
      const buffer = await resp.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (err) {
      log.error("TTS error", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "TTS request failed" });
    }
  });
}
