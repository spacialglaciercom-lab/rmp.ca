import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { gpxTrainingRouter } from "./gpxTrainingRouter";
import { navigationRouter } from "./navigationRouter";
import { ragRouter } from "./rag/ragRouter";
import { voiceRouter } from "./voiceRouter";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  gpxTraining: gpxTrainingRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Turn-by-turn navigation from Hierholzer output
  navigation: navigationRouter,

  // AI Co-Pilot voice/chat features
  voice: voiceRouter,

  // RAG knowledge base
  rag: ragRouter,
});

export type AppRouter = typeof appRouter;
