/**
 * RBAC tRPC router.
 *
 * Endpoints split into two tiers:
 *  - protectedProcedure  — any authenticated user (e.g. myPermissions, listPermissions)
 *  - permissionProcedure("can_manage_roles") — org members with role-management rights
 *  - adminProcedure      — global admins only (e.g. seedOrg)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  adminProcedure,
  permissionProcedure,
  protectedProcedure,
  router,
} from "../_core/trpc";
import {
  PERMISSION_KEYS,
  type PermissionKey,
} from "../../drizzle/schema";
import {
  assignRoleToUser,
  createRole,
  getRoleById,
  getUserById,
  getUserByOpenId,
  listRolesForOrg,
  removeRoleFromUser,
  seedSystemRoles,
  setRolePermissions,
} from "../db";

const permissionKeySchema = z.enum(
  PERMISSION_KEYS as unknown as [PermissionKey, ...PermissionKey[]],
);

export const rbacRouter = router({
  /**
   * Returns the caller's own roles and permissions within their org.
   * Used by the frontend usePermissions() hook.
   */
  myPermissions: protectedProcedure.query(({ ctx }) => ({
    permissions: ctx.permissions,
    roles: ctx.roles,
  })),

  /**
   * Returns the full list of available permission keys (static — no DB query).
   */
  listPermissions: protectedProcedure.query(() => ({
    permissions: [...PERMISSION_KEYS],
  })),

  /**
   * Lists all roles (with their permissions) for the caller's organization.
   */
  listRoles: permissionProcedure("can_manage_roles").query(async ({ ctx }) => {
    // ctx.org is guaranteed non-null by orgProcedure (parent of permissionProcedure)
    return listRolesForOrg(ctx.org!.id);
  }),

  /**
   * Creates a custom (non-system) role within the caller's organization.
   */
  createRole: permissionProcedure("can_manage_roles")
    .input(
      z.object({
        name: z.string().min(1).max(64),
        description: z.string().max(256).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return createRole(ctx.org!.id, input.name, input.description);
    }),

  /**
   * Replaces all permissions on a role with the provided set.
   * Guards against modifying roles from other orgs.
   */
  setPermissions: permissionProcedure("can_manage_roles")
    .input(
      z.object({
        roleId: z.number().int().positive(),
        permissions: z.array(permissionKeySchema),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const role = await getRoleById(input.roleId);
      if (!role || role.orgId !== ctx.org!.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found." });
      }
      await setRolePermissions(input.roleId, input.permissions);
      return { ok: true };
    }),

  /**
   * Assigns a role (by id) to a user (by their numeric id) within the caller's org.
   */
  assignRole: permissionProcedure("can_manage_roles")
    .input(
      z.object({
        userId: z.number().int().positive(),
        roleId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [targetUser, role] = await Promise.all([
        getUserById(input.userId),
        getRoleById(input.roleId),
      ]);
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      }
      if (!role || role.orgId !== ctx.org!.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found." });
      }
      await assignRoleToUser(input.userId, input.roleId, ctx.org!.id);
      return { ok: true };
    }),

  /**
   * Removes a role from a user within the caller's org.
   */
  removeRole: permissionProcedure("can_manage_roles")
    .input(
      z.object({
        userId: z.number().int().positive(),
        roleId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const role = await getRoleById(input.roleId);
      if (!role || role.orgId !== ctx.org!.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found." });
      }
      await removeRoleFromUser(input.userId, input.roleId, ctx.org!.id);
      return { ok: true };
    }),

  /**
   * (Global admin only) Seeds the 5 system roles for an org.
   * Idempotent — safe to call multiple times.
   */
  seedOrg: adminProcedure
    .input(z.object({ orgId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await seedSystemRoles(input.orgId);
      return { ok: true };
    }),
});
