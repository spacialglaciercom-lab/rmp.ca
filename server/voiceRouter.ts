/**
 * Voice router — tRPC endpoints for AI Co-Pilot voice features.
 *
 * Provides:
 * - voice.transcribe — Speech-to-text (Moonshine sidecar with Whisper fallback)
 * - voice.chat — Genkit-powered co-pilot chat (text in, text out)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, publicProcedure } from "./_core/trpc";
import { transcribeAudio, transcribeAudioFromBase64 } from "./_core/voiceTranscription";
import { transcribeWithFallback, transcribeBase64WithFallback } from "./_core/moonshineTranscription";
import { chatWithCoPilot, NavContextSchema, ChatMessageSchema } from "./genkit/coPilot";

export const voiceRouter = router({
  /**
   * Transcribe audio to text.
   *
   * Provider priority:
   *  1. Moonshine Python sidecar (if MOONSHINE_STT_ENABLED=true and sidecar URL configured)
   *  2. Whisper API via Forge (fallback)
   */
  transcribe: protectedProcedure
    .input(
      z.object({
        audioUrl: z.string().optional(),
        audioBase64: z.string().optional(),
        mimeType: z.string().optional(),
        language: z.string().optional(),
        prompt: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Support base64 audio upload (for native iOS/Android where local file:// URIs can't be fetched by server)
      if (input.audioBase64) {
        const result = await transcribeBase64WithFallback(
          input.audioBase64,
          input.mimeType || "audio/m4a",
          input.language,
          input.prompt,
        );
        if ("error" in result) {
          throw new TRPCError({ code: "BAD_REQUEST", message: result.error, cause: result });
        }
        return result;
      }

      if (!input.audioUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Either audioUrl or audioBase64 is required" });
      }

      const result = await transcribeWithFallback({ audioUrl: input.audioUrl, language: input.language, prompt: input.prompt });
      if ("error" in result) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error, cause: result });
      }
      return result;
    }),

  /** Chat with the AI co-pilot. Accepts text (pre-transcribed or typed). */
  chat: publicProcedure
    .input(
      z.object({
        message: z.string().min(1),
        history: z.array(ChatMessageSchema).optional(),
        navContext: NavContextSchema.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const reply = await chatWithCoPilot(
        input.message,
        input.history ?? undefined,
        input.navContext ?? undefined,
      );

      return { reply };
    }),
});
