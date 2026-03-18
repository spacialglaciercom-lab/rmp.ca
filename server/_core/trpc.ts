import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * Procedure that requires both an authenticated user AND org membership.
 * Throws FORBIDDEN if the user has no org assigned.
 *
 * Use this on any route where data must be scoped to an organization
 * (e.g. cost history, GPX files, route results).
 *
 * ctx.user and ctx.org are both guaranteed non-null inside these procedures.
 */
export const orgProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }

    if (!ctx.org) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "You must be a member of an organization to access this resource. Ask an admin to assign you to an organization.",
      });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        org: ctx.org,
      },
    });
  }),
);

/**
 * Factory that returns a procedure requiring both org membership AND a specific
 * permission key. Builds on orgProcedure — ctx.user and ctx.org are non-null.
 *
 * @example
 * permissionProcedure("can_manage_fleet").query(({ ctx }) => { ... })
 */
export const permissionProcedure = (permission: string) =>
  orgProcedure.use(
    t.middleware(async ({ ctx, next }) => {
      if (!ctx.permissions.includes(permission)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Missing permission: ${permission} (10003)`,
        });
      }
      return next({ ctx });
    }),
  );
