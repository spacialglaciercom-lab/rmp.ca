import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { aiRouteAnalysisRouter } from "./aiRouteAnalysisRouter";
import { costHistoryRouter } from "./costHistoryRouter";
import { gpxTrainingRouter } from "./gpxTrainingRouter";
import { navigationRouter } from "./navigationRouter";
import { optimizerRouter } from "./optimizerRouter";
import { orgRouter } from "./orgRouter";
import { ragRouter } from "./rag/ragRouter";
import { rbacRouter } from "./rbac/rbacRouter";
import { voiceRouter } from "./voiceRouter";
import { spatialRouter } from "./spatialRouter";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  spatial: spatialRouter,
  gpxTraining: gpxTrainingRouter,
  /** CPP optimization and zone partitioning (proxies to Python FastAPI backend). */
  optimizer: optimizerRouter,
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

  // Organization management (admin only) — create orgs, assign users, manage tiers
  org: orgRouter,

  // Cost history for ML cost-correction model — scoped per organization
  costHistory: costHistoryRouter,

  // RBAC — role/permission management and per-user permission queries
  rbac: rbacRouter,

  // AI-powered route analysis — PostGIS + Vercel AI Gateway
  aiRouteAnalysis: aiRouteAnalysisRouter,
});

export type AppRouter = typeof appRouter;
