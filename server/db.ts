import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertOrganization,
  InsertUser,
  Organization,
  User,
  organizations,
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
  return result[0];
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

