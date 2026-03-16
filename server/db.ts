import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertOrganization,
  InsertUser,
  Organization,
  Role,
  SYSTEM_ROLES,
  User,
  organizations,
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

// TODO: add feature queries here as your schema grows.

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

export async function getUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

// ── RBAC queries ──────────────────────────────────────────────────────────

/**
 * Returns the flattened set of role names and permission keys held by a user
 * within a specific organization. Returns empty arrays when user has no roles.
 */
export async function getUserRolesAndPermissions(
  userId: number,
  orgId: number,
): Promise<{ roles: string[]; permissions: string[] }> {
  const db = await getDb();
  if (!db) return { roles: [], permissions: [] };

  // Fetch all roleIds assigned to this user within this org
  const assignments = await db
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.orgId, orgId)));

  if (assignments.length === 0) return { roles: [], permissions: [] };

  const roleIds = assignments.map((a) => a.roleId);

  // Fetch role names
  const roleRows = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(inArray(roles.id, roleIds));

  const roleNames = roleRows.map((r) => r.name);

  // Fetch all permission keys for these roles
  const permRows = await db
    .select({ permissionKey: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds));

  const permissions = [...new Set(permRows.map((p) => p.permissionKey))];

  return { roles: roleNames, permissions };
}

/**
 * Seeds the 5 system roles (driver, dispatcher, fleet_manager, admin, owner)
 * for the given org. Idempotent — safe to call multiple times.
 */
export async function seedSystemRoles(orgId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot seed system roles: database not available");
    return;
  }

  for (const [roleName, perms] of Object.entries(SYSTEM_ROLES)) {
    // Insert role if it doesn't already exist for this org
    const existing = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.orgId, orgId), eq(roles.name, roleName)))
      .limit(1);

    let roleId: number;
    if (existing.length > 0) {
      roleId = existing[0].id;
    } else {
      const inserted = await db
        .insert(roles)
        .values({ orgId, name: roleName, isSystem: true })
        .returning({ id: roles.id });
      roleId = inserted[0].id;
    }

    // Insert permissions with ON CONFLICT DO NOTHING (idempotent)
    if (perms.length > 0) {
      await db
        .insert(rolePermissions)
        .values(perms.map((key) => ({ roleId, permissionKey: key })))
        .onConflictDoNothing();
    }
  }
}

export async function assignRoleToUser(
  userId: number,
  roleId: number,
  orgId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
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
  if (!db) return;
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

export async function createRole(
  orgId: number,
  name: string,
  description?: string,
): Promise<Role> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .insert(roles)
    .values({ orgId, name, description: description ?? null, isSystem: false })
    .returning();
  return result[0];
}

export async function getRoleById(id: number): Promise<Role | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  return result[0];
}

/**
 * Replaces all permissions on a role with the provided set.
 */
export async function setRolePermissions(
  roleId: number,
  permissionKeys: string[],
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete existing, then insert new
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (permissionKeys.length > 0) {
    await db
      .insert(rolePermissions)
      .values(permissionKeys.map((key) => ({ roleId, permissionKey: key })));
  }
}

/**
 * Lists all roles for an org, each with their current permission keys.
 */
export async function listRolesForOrg(
  orgId: number,
): Promise<(Role & { permissions: string[] })[]> {
  const db = await getDb();
  if (!db) return [];

  const orgRoles = await db
    .select()
    .from(roles)
    .where(eq(roles.orgId, orgId));

  if (orgRoles.length === 0) return [];

  const roleIds = orgRoles.map((r) => r.id);
  const permRows = await db
    .select()
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds));

  return orgRoles.map((role) => ({
    ...role,
    permissions: permRows
      .filter((p) => p.roleId === role.id)
      .map((p) => p.permissionKey),
  }));
}

