import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/shared/oauth";
import * as Auth from "@/lib/_core/auth";

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): The `transformer` must be inside `httpBatchLink`,
 * NOT at the root createClient level. This ensures client and server
 * use the same serialization format (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

const trpcUrl = () => `${getApiBaseUrl()}/api/trpc`;

/**
 * Creates the tRPC client with proper configuration.
 * Call this once in your app's root layout.
 *
 * Voice procedures (voice.chat, voice.transcribe) use a link that does NOT
 * send credentials, so they never trigger auth errors and work without login.
 */
export function createTRPCClient() {
  return trpc.createClient({
    links: [
      splitLink({
        condition(op) {
          return op.path.startsWith("voice.");
        },
        true: httpBatchLink({
          url: trpcUrl(),
          transformer: superjson,
          headers: () => ({}),
          fetch(url, options) {
            return fetch(url, { ...options, credentials: "include" });
          },
        }),
        false: httpBatchLink({
          url: trpcUrl(),
          transformer: superjson,
          async headers() {
            const token = await Auth.getSessionToken();
            return token ? { Authorization: `Bearer ${token}` } : {};
          },
          fetch(url, options) {
            return fetch(url, { ...options, credentials: "include" });
          },
        }),
      }),
    ],
  });
}
