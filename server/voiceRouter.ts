/**
 * Voice router — tRPC endpoints for AI Co-Pilot voice features.
 *
 * Provides:
 * - voice.transcribe — Whisper speech-to-text via existing voiceTranscription service
 * - voice.chat — Genkit-powered co-pilot chat (text in, text out)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, publicProcedure } from "./_core/trpc";
import { transcribeAudio, transcribeAudioFromBase64 } from "./_core/voiceTranscription";
import { chatWithCoPilot, NavContextSchema, ChatMessageSchema } from "./genkit/coPilot";

export const voiceRouter = router({
  /** Transcribe audio to text using Whisper (speech-to-text). */
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
        const result = await transcribeAudioFromBase64(
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

      const result = await transcribeAudio({ audioUrl: input.audioUrl, language: input.language, prompt: input.prompt });
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
