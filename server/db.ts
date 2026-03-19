import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertOrganization,
  PermissionKey,
  PermissionRequest,
  Role,
  SYSTEM_ROLES,
  InsertUser,
  Organization,
  User,
  organizations,
  permissionRequests,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
// Always retries on failure so transient errors don't permanently disable the DB.
export async function getDb() {
  if (_db) return _db;
  if (!process.env.DATABASE_URL) return null;
  try {
    const client = postgres(process.env.DATABASE_URL);
    _db = drizzle(client);
  } catch (error) {
    console.warn("[Database] Failed to connect:", error);
    // Do NOT cache the failure — leave _db as null so the next call retries.
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUsersByOrgId(orgId: number): Promise<User[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.orgId, orgId));
}

// ── Organization queries ──────────────────────────────────────────────────

export async function getOrgById(
  id: number,
): Promise<Organization | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  return result[0];
}

export async function listOrgs(): Promise<Organization[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(organizations);
}

export async function upsertOrg(
  org: InsertOrganization,
): Promise<Organization | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert org: database not available");
    return undefined;
  }
  const result = await db
    .insert(organizations)
    .values(org)
    .onConflictDoUpdate({
      target: organizations.id,
      set: {
        name: org.name,
        city: org.city ?? null,
        tier: org.tier ?? "trial",
        updatedAt: new Date(),
      },
    })
    .returning();
  const saved = result[0];
  if (saved) {
    // Idempotent — safe for both inserts and updates
    await seedSystemRoles(saved.id);
  }
  return saved;
}

export async function assignUserToOrg(
  openId: string,
  orgId: number | null,
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot assign user to org: database not available");
    return;
  }
  await db
    .update(users)
    .set({ orgId, updatedAt: new Date() })
    .where(eq(users.openId, openId));
}

export async function setUserRole(
  openId: string,
  role: "user" | "admin",
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot set user role: database not available");
    return;
  }
  await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.openId, openId));
}

// ── RBAC ──────────────────────────────────────────────────────────────────────

export async function getUserRolesAndPermissions(
  userId: number,
  orgId: number,
): Promise<{ roles: string[]; permissions: string[] }> {
  const db = await getDb();
  if (!db) return { roles: [], permissions: [] };
  const rows = await db
    .select({
      roleName: roles.name,
      permissionKey: rolePermissions.permissionKey,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .leftJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.orgId, orgId)));
  const roleNames = [...new Set(rows.map((r) => r.roleName))];
  const permissions = [
    ...new Set(rows.map((r) => r.permissionKey).filter(Boolean) as string[]),
  ];
  return { roles: roleNames, permissions };
}

export async function getUserById(id: number): Promise<User | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getRoleById(id: number): Promise<Role | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listRolesForOrg(orgId: number): Promise<Role[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(roles).where(eq(roles.orgId, orgId));
}

export async function createRole(
  orgId: number,
  name: string,
  description?: string,
): Promise<Role> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .insert(roles)
    .values({ orgId, name, description, isSystem: false })
    .returning();
  return rows[0];
}

export async function setRolePermissions(
  roleId: number,
  permissionKeys: string[],
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (permissionKeys.length > 0) {
    await db
      .insert(rolePermissions)
      .values(permissionKeys.map((permissionKey) => ({ roleId, permissionKey })));
  }
}

export async function assignRoleToUser(
  userId: number,
  roleId: number,
  orgId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .insert(userRoles)
    .values({ userId, roleId, orgId })
    .onConflictDoNothing();
}

export async function removeRoleFromUser(
  userId: number,
  roleId: number,
  orgId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.roleId, roleId),
        eq(userRoles.orgId, orgId),
      ),
    );
}

export async function seedSystemRoles(orgId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (const [name, perms] of Object.entries(SYSTEM_ROLES)) {
    const existing = await db
      .select()
      .from(roles)
      .where(and(eq(roles.orgId, orgId), eq(roles.name, name)))
      .limit(1);
    let roleId: number;
    if (existing.length === 0) {
      const inserted = await db
        .insert(roles)
        .values({ orgId, name, isSystem: true })
        .returning();
      roleId = inserted[0].id;
    } else {
      roleId = existing[0].id;
    }
    await setRolePermissions(roleId, [...perms]);
  }
}

const ACCESS_REQUEST_ROLE_PREFIX = "access_request_";

export async function createPermissionRequest(params: {
  orgId: number;
  requesterId: number;
  reason: string;
  requestedPermissions: PermissionKey[];
  token: string;
  expiresAt: Date;
}): Promise<PermissionRequest> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .insert(permissionRequests)
    .values({
      orgId: params.orgId,
      requesterId: params.requesterId,
      reason: params.reason,
      requestedPermissions: params.requestedPermissions,
      token: params.token,
      expiresAt: params.expiresAt,
    })
    .returning();
  return rows[0];
}

export async function getPermissionRequestByToken(
  token: string,
): Promise<PermissionRequest | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(permissionRequests)
    .where(eq(permissionRequests.token, token))
    .limit(1);
  return rows[0] ?? null;
}

export async function findOrgAdmins(orgId: number): Promise<User[]> {
  const db = await getDb();
  if (!db) return [];
  const orgUsers = await db.select().from(users).where(eq(users.orgId, orgId));
  const withEmails = orgUsers.filter((u) => Boolean(u.email?.trim()));
  const privilegedUsers: User[] = [];
  for (const candidate of withEmails) {
    if (candidate.role === "admin") {
      privilegedUsers.push(candidate);
      continue;
    }
    const rbac = await getUserRolesAndPermissions(candidate.id, orgId);
    const canManage =
      rbac.permissions.includes("can_manage_roles") ||
      rbac.permissions.includes("can_manage_users");
    if (canManage) privilegedUsers.push(candidate);
  }
  return privilegedUsers;
}

async function findRoleWithExactPermissions(
  orgId: number,
  permissionKeys: PermissionKey[],
): Promise<Role | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const sortedTarget = [...new Set(permissionKeys)].sort();
  const orgRoles = await db.select().from(roles).where(eq(roles.orgId, orgId));
  for (const role of orgRoles) {
    const perms = await db
      .select({ permissionKey: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, role.id));
    const sortedCurrent = perms.map((p) => p.permissionKey).sort();
    if (sortedCurrent.length !== sortedTarget.length) continue;
    const isSame = sortedCurrent.every((perm, idx) => perm === sortedTarget[idx]);
    if (isSame) return role;
  }
  return null;
}

export async function createOrReuseRequestedRole(
  orgId: number,
  requesterId: number,
  approvedPermissions: PermissionKey[],
  requestId: number,
): Promise<Role | null> {
  if (approvedPermissions.length === 0) return null;
  const existing = await findRoleWithExactPermissions(orgId, approvedPermissions);
  if (existing) return existing;

  const role = await createRole(
    orgId,
    `${ACCESS_REQUEST_ROLE_PREFIX}${requestId}`,
    `Auto-generated role for IAM request #${requestId} (user ${requesterId})`,
  );
  await setRolePermissions(role.id, approvedPermissions);
  return role;
}

export async function resolvePermissionRequest(params: {
  token: string;
  status: "approved" | "denied";
  approvedPermissions: PermissionKey[];
  resolverUserId: number;
  expectedOrgId: number;
}): Promise<{
  request: PermissionRequest;
  status: "approved" | "denied";
  assignedRoleId: number | null;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const request = await getPermissionRequestByToken(params.token);
  if (!request) throw new Error("Permission request not found");
  if (request.orgId !== params.expectedOrgId) {
    throw new Error("Permission request does not belong to your organization");
  }
  if (request.expiresAt.getTime() < Date.now()) {
    throw new Error("Permission request token has expired");
  }

  if (request.status !== "pending") {
    const existingRoleId =
      request.status === "approved" && request.approvedPermissions?.length
        ? (
            await findRoleWithExactPermissions(
              request.orgId,
              request.approvedPermissions as PermissionKey[],
            )
          )?.id ?? null
        : null;
    return {
      request,
      status: request.status as "approved" | "denied",
      assignedRoleId: existingRoleId,
    };
  }

  const approvedPermissions =
    params.status === "approved"
      ? [...new Set(params.approvedPermissions)]
      : ([] as PermissionKey[]);
  let assignedRoleId: number | null = null;
  if (params.status === "approved" && approvedPermissions.length > 0) {
    const role = await createOrReuseRequestedRole(
      request.orgId,
      request.requesterId,
      approvedPermissions,
      request.id,
    );
    if (role) {
      assignedRoleId = role.id;
      await assignRoleToUser(request.requesterId, role.id, request.orgId);
    }
  }

  const resolvedRows = await db
    .update(permissionRequests)
    .set({
      status: params.status,
      approvedPermissions,
      resolvedAt: new Date(),
      resolvedBy: params.resolverUserId,
    })
    .where(
      and(
        eq(permissionRequests.id, request.id),
        eq(permissionRequests.status, "pending"),
      ),
    )
    .returning();

  // If another approver won the race, return final state idempotently.
  if (resolvedRows.length === 0) {
    const latest = await getPermissionRequestByToken(params.token);
    if (!latest) throw new Error("Permission request not found");
    return {
      request: latest,
      status: latest.status as "approved" | "denied",
      assignedRoleId,
    };
  }

  return {
    request: resolvedRows[0],
    status: params.status,
    assignedRoleId,
  };
}

