/**
 * Admin-only tRPC router for managing organizations (municipalities / companies).
 *
 * All procedures require `adminProcedure` — only users with role="admin" can call these.
 * Use this router to onboard new city contracts:
 *   1. org.create     — create the organization record
 *   2. org.assignUser — assign each driver/admin user to it
 *
 * After assignment, users will have ctx.org populated and can access orgProcedure routes
 * (cost history, GPX files, etc.) scoped to their organization.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "./_core/trpc";
import {
  assignUserToOrg,
  getOrgById,
  listOrgs,
  upsertOrg,
} from "./db";

const orgTierSchema = z.enum(["trial", "standard", "enterprise"]);

export const orgRouter = router({
  /** Create a new organization. Returns the created record including its generated id. */
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        city: z.string().optional(),
        tier: orgTierSchema.optional().default("trial"),
      }),
    )
    .mutation(async ({ input }) => {
      const org = await upsertOrg({
        name: input.name,
        city: input.city ?? null,
        tier: input.tier,
      });
      if (!org) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create organization — database unavailable.",
        });
      }
      return org;
    }),

  /** List all organizations. */
  list: adminProcedure.query(async () => {
    return listOrgs();
  }),

  /** Get a single organization by id. */
  get: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const org = await getOrgById(input.id);
      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Organization ${input.id} not found.`,
        });
      }
      return org;
    }),

  /**
   * Assign a user (by openId) to an organization.
   * Pass orgId: null to remove a user from their current org (make them solo again).
   */
  assignUser: adminProcedure
    .input(
      z.object({
        openId: z.string().min(1),
        orgId: z.number().int().positive().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.orgId !== null) {
        const org = await getOrgById(input.orgId);
        if (!org) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Organization ${input.orgId} not found.`,
          });
        }
      }
      await assignUserToOrg(input.openId, input.orgId);
      return { ok: true };
    }),
});
