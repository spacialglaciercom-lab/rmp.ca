import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const roleEnum = pgEnum("role", ["user", "admin"]);

/**
 * Tier of service for an organization (municipality or company).
 * Used for feature gating — checked via ctx.org.tier in orgProcedure.
 */
export const orgTierEnum = pgEnum("org_tier", [
  "trial",
  "standard",
  "enterprise",
]);

export const permissionRequestStatusEnum = pgEnum("permission_request_status", [
  "pending",
  "approved",
  "denied",
]);

/**
 * Organizations table — one row per municipality, company, or team.
 * Users are assigned to an org via the orgId FK on the users table.
 * A user with orgId = NULL is a solo/unscoped user (existing behaviour preserved).
 */
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  city: text("city"),
  tier: orgTierEnum("tier").default("trial").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;

export const users = pgTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: serial("id").primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  /**
   * FK to the organizations table. NULL = solo user (existing behaviour preserved).
   * Set this via the admin orgRouter.assignUser procedure.
   */
  orgId: integer("orgId").references(() => organizations.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── Relations (for Drizzle relational queries) ────────────────────────────
export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
}));

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, {
    fields: [users.orgId],
    references: [organizations.id],
  }),
}));

// ── RBAC ─────────────────────────────────────────────────────────────────

/**
 * All available permission keys. Defined as a const array (no DB table needed)
 * so callers can import the list at compile time.
 */
export const PERMISSION_KEYS = [
  "can_view_routes",
  "can_edit_routes",
  "can_manage_fleet",
  "can_view_fleet",
  "can_manage_users",
  "can_view_analytics",
  "can_manage_roles",
  "can_manage_billing",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/**
 * Seeded system role → permission mappings.
 * These roles are created per-org by seedSystemRoles() in db.ts.
 */
export const SYSTEM_ROLES = {
  driver: ["can_view_routes"],
  dispatcher: ["can_view_routes", "can_edit_routes", "can_view_fleet"],
  fleet_manager: [
    "can_view_routes",
    "can_edit_routes",
    "can_manage_fleet",
    "can_view_fleet",
    "can_view_analytics",
  ],
  admin: [
    "can_view_routes",
    "can_edit_routes",
    "can_manage_fleet",
    "can_view_fleet",
    "can_manage_users",
    "can_view_analytics",
    "can_manage_roles",
  ],
  owner: [...PERMISSION_KEYS],
} as const satisfies Record<string, readonly PermissionKey[]>;

/**
 * Roles table — one row per named role within an organization.
 * System roles (driver, dispatcher, etc.) are seeded per-org via seedSystemRoles().
 * Custom roles can be created by org admins via the rbac router.
 */
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  orgId: integer("orgId")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("isSystem").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Role = typeof roles.$inferSelect;
export type InsertRole = typeof roles.$inferInsert;

/**
 * Many-to-many: which permission keys a role grants.
 * permissionKey is a free-text reference to PERMISSION_KEYS (no FK — keys are static).
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: integer("roleId")
      .references(() => roles.id, { onDelete: "cascade" })
      .notNull(),
    permissionKey: text("permissionKey").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export type RolePermission = typeof rolePermissions.$inferSelect;

/**
 * Many-to-many: which roles a user holds within an organization.
 * A user can hold multiple roles; roles are always org-scoped.
 */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: integer("userId")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    roleId: integer("roleId")
      .references(() => roles.id, { onDelete: "cascade" })
      .notNull(),
    orgId: integer("orgId")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId, t.orgId] })],
);

export type UserRole = typeof userRoles.$inferSelect;

export const permissionRequests = pgTable("permission_requests", {
  id: serial("id").primaryKey(),
  orgId: integer("orgId")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  requesterId: integer("requesterId")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  reason: text("reason").notNull(),
  requestedPermissions: text("requestedPermissions")
    .array()
    .$type<PermissionKey[]>()
    .notNull(),
  status: permissionRequestStatusEnum("status").default("pending").notNull(),
  approvedPermissions: text("approvedPermissions")
    .array()
    .$type<PermissionKey[]>(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
  resolvedBy: integer("resolvedBy").references(() => users.id, {
    onDelete: "set null",
  }),
});

export type PermissionRequest = typeof permissionRequests.$inferSelect;
export type InsertPermissionRequest = typeof permissionRequests.$inferInsert;

// ── RBAC Relations ────────────────────────────────────────────────────────
export const rolesRelations = relations(roles, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [roles.orgId],
    references: [organizations.id],
  }),
  rolePermissions: many(rolePermissions),
  userRoles: many(userRoles),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
  organization: one(organizations, {
    fields: [userRoles.orgId],
    references: [organizations.id],
  }),
}));

export const permissionRequestsRelations = relations(
  permissionRequests,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [permissionRequests.orgId],
      references: [organizations.id],
    }),
    requester: one(users, {
      fields: [permissionRequests.requesterId],
      references: [users.id],
    }),
    resolver: one(users, {
      fields: [permissionRequests.resolvedBy],
      references: [users.id],
    }),
  }),
);
