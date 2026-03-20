/**
 * Route logger middleware — captures prompt + generated text, optional entity extraction, async upload.
 *
 * Use with wrapLanguageModel so all generate/stream calls are logged without adding latency.
 * Upload runs in the background (fire-and-forget). Set ROUTE_LOG_UPLOAD_URL or Vercel Blob token to enable.
 */
import type { LanguageModelV3Middleware } from "@ai-sdk/provider";

/** Extract plain text from LanguageModelV3GenerateResult.content */
function textFromContent(
  content: Array<{ type: string; text?: string; delta?: string }>,
): string {
  return content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}

/** Serialize prompt for logging (avoid huge payloads) */
function serializePrompt(
  prompt: Array<{ role: string; content: unknown }>,
): string | object {
  try {
    return prompt.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content.slice(0, 10_000)
          : Array.isArray(m.content)
            ? m.content.map((p: unknown) => {
                const part = p as { type?: string; text?: string };
                if (part?.type === "text" && typeof part.text === "string") {
                  return { type: "text", text: part.text.slice(0, 5000) };
                }
                return part;
              })
            : m.content,
    }));
  } catch {
    return "[unserializable]";
  }
}

export type RouteLoggerOptions = {
  /** Upload URL (POST JSON). When set, logs are sent here in the background. */
  uploadUrl?: string;
  /** When true, use a smaller model to extract GPX coords, distance estimates, route errors from the conversation. */
  analyze?: boolean;
  /** Called to run optional entity extraction (e.g. gpt-4o-mini). Return extracted JSON or null. */
  extractEntities?: (inputSummary: string, outputText: string) => Promise<Record<string, unknown> | null>;
};

/**
 * Builds a LanguageModelV3Middleware that:
 * - Captures full prompt (input) and final generated text (output).
 * - If analyze: true, runs optional entity extraction (smaller model).
 * - Uploads a JSON log (input, output, extracted) in the background so the user request is not delayed.
 */
export function routeLoggerMiddleware(options: RouteLoggerOptions): LanguageModelV3Middleware {
  const { uploadUrl, analyze = false, extractEntities } = options;
  const hasUpload = typeof uploadUrl === "string" && uploadUrl.trim().length > 0;

  const uploadLog = (payload: Record<string, unknown>) => {
    if (!hasUpload) return;
    setImmediate(() => {
      fetch(uploadUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        // Fire-and-forget; avoid unhandled rejection
      });
    });
  };

  return {
    specificationVersion: "v3",

    wrapGenerate: async ({ doGenerate, params }) => {
      const result = await doGenerate();
      const outputText = textFromContent(result.content as Array<{ type: string; text?: string }>);
      const inputSummary = serializePrompt(params.prompt as Array<{ role: string; content: unknown }>);

      if (hasUpload) {
        setImmediate(() => {
          (async () => {
            let extracted: Record<string, unknown> | null = null;
            if (analyze && extractEntities) {
              try {
                extracted = await extractEntities(
                  typeof inputSummary === "string" ? inputSummary : JSON.stringify(inputSummary),
                  outputText,
                );
              } catch {
                // ignore
              }
            }
            uploadLog({
              ts: new Date().toISOString(),
              type: "generate",
              input: inputSummary,
              output: outputText.slice(0, 50_000),
              ...(extracted ? { extracted } : {}),
            });
          })().catch(() => {});
        });
      }

      return result;
    },

    wrapStream: async ({ doStream, params }) => {
      const { stream, ...rest } = await doStream();
      const inputSummary = serializePrompt(params.prompt as Array<{ role: string; content: unknown }>);

      let buffer = "";
      const captureStream = new TransformStream({
        transform(chunk: { type: string; delta?: string; text?: string }, controller: TransformStreamDefaultController<unknown>) {
          if (chunk.type === "text-delta" && typeof chunk.delta === "string") buffer += chunk.delta;
          if (chunk.type === "text" && typeof chunk.text === "string") buffer += chunk.text;
          controller.enqueue(chunk);
        },
        flush() {
          if (!hasUpload || buffer.length === 0) return;
          const outputText = buffer;
          setImmediate(() => {
            (async () => {
              let extracted: Record<string, unknown> | null = null;
              if (analyze && extractEntities) {
                try {
                  extracted = await extractEntities(
                    typeof inputSummary === "string" ? inputSummary : JSON.stringify(inputSummary),
                    outputText,
                  );
                } catch {
                  // ignore
                }
              }
              uploadLog({
                ts: new Date().toISOString(),
                type: "stream",
                input: inputSummary,
                output: outputText.slice(0, 50_000),
                ...(extracted ? { extracted } : {}),
              });
            })().catch(() => {});
          });
        },
      });

      return {
        ...rest,
        stream: stream.pipeThrough(captureStream) as typeof stream,
      };
    },
  };
}
