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
  createPermissionRequest,
  createRole,
  findOrgAdmins,
  getPermissionRequestByToken,
  getRoleById,
  getUserById,
  listRolesForOrg,
  removeRoleFromUser,
  resolvePermissionRequest,
  seedSystemRoles,
  setRolePermissions,
} from "../db";
import {
  sendPermissionRequestEmailToAdmins,
  sendPermissionRequestResolvedEmailToRequester,
} from "../iamApprovalEmail";

const permissionKeySchema = z.enum(
  PERMISSION_KEYS as unknown as [PermissionKey, ...PermissionKey[]],
);

const requestAccessInputSchema = z.object({
  permissions: z.array(permissionKeySchema).min(1),
  reason: z.string().trim().min(4).max(2000),
});

function canResolveRequests(ctx: {
  user: { role: "user" | "admin" } | null;
  permissions: string[];
}) {
  return (
    ctx.user?.role === "admin" ||
    ctx.permissions.includes("can_manage_roles") ||
    ctx.permissions.includes("can_manage_users")
  );
}

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

  requestAccess: protectedProcedure
    .input(requestAccessInputSchema)
    .mutation(async ({ input, ctx }) => {
      if (!ctx.org) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You must belong to an organization to request permissions.",
        });
      }
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 72);
      const request = await createPermissionRequest({
        orgId: ctx.org.id,
        requesterId: ctx.user.id,
        reason: input.reason,
        requestedPermissions: [...new Set(input.permissions)],
        token,
        expiresAt,
      });

      const admins = await findOrgAdmins(ctx.org.id);
      const adminEmails = admins
        .map((admin) => admin.email?.trim())
        .filter((email): email is string => Boolean(email));

      try {
        await sendPermissionRequestEmailToAdmins({
          adminEmails,
          requesterName: ctx.user.name ?? `User #${ctx.user.id}`,
          requesterEmail: ctx.user.email ?? null,
          orgName: ctx.org.name,
          reason: request.reason,
          requestedPermissions: request.requestedPermissions as PermissionKey[],
          token: request.token,
          expiresAt: request.expiresAt,
        });
      } catch (error) {
        console.error("[RBAC] Failed to send request-access email:", error);
      }

      return {
        ok: true,
        requestId: request.id,
        expiresAt: request.expiresAt,
      };
    }),

  getApprovalRequestByToken: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.org) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No organization." });
      }
      if (!canResolveRequests(ctx)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not allowed to resolve access requests.",
        });
      }
      const request = await getPermissionRequestByToken(input.token);
      if (!request || request.orgId !== ctx.org.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Request not found." });
      }
      const requester = await getUserById(request.requesterId);
      return {
        id: request.id,
        status: request.status,
        reason: request.reason,
        expiresAt: request.expiresAt,
        createdAt: request.createdAt,
        requestedPermissions: request.requestedPermissions as PermissionKey[],
        approvedPermissions:
          (request.approvedPermissions as PermissionKey[] | null) ?? [],
        requester: requester
          ? {
              id: requester.id,
              name: requester.name,
              email: requester.email,
            }
          : null,
      };
    }),

  approveAccess: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1),
        action: z.enum(["approve", "deny"]),
        approvedPermissions: z.array(permissionKeySchema).default([]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.org) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No organization." });
      }
      if (!canResolveRequests(ctx)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not allowed to resolve access requests.",
        });
      }

      const existing = await getPermissionRequestByToken(input.token);
      if (!existing || existing.orgId !== ctx.org.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Request not found." });
      }
      const requestedSet = new Set(
        (existing.requestedPermissions as PermissionKey[]) ?? [],
      );
      const approvedSubset = [...new Set(input.approvedPermissions)].filter((key) =>
        requestedSet.has(key),
      );
      const status = input.action === "approve" ? "approved" : "denied";
      const result = await resolvePermissionRequest({
        token: input.token,
        status,
        approvedPermissions: approvedSubset,
        resolverUserId: ctx.user.id,
        expectedOrgId: ctx.org.id,
      });

      const requester = await getUserById(existing.requesterId);
      const shouldNotifyRequester =
        existing.status === "pending" &&
        requester?.email &&
        result.status !== "pending";
      if (shouldNotifyRequester) {
        try {
          await sendPermissionRequestResolvedEmailToRequester({
            requesterEmail: requester.email!,
            requesterName: requester.name ?? `User #${requester.id}`,
            status: result.status,
            approvedPermissions:
              (result.request.approvedPermissions as PermissionKey[] | null) ?? [],
          });
        } catch (error) {
          console.error("[RBAC] Failed to send resolved email:", error);
        }
      }

      return {
        ok: true,
        status: result.status,
        assignedRoleId: result.assignedRoleId,
      };
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
