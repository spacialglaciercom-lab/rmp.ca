import {
  boolean,
  customType,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  index,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Custom PostGIS geography type for Drizzle.
 */
const geography = customType<{
  data: string;
  driverData: string;
  config: { type: string; srid: number };
}>({
  dataType: (config) => `geography(${config?.type}, ${config?.srid})`,
});

/**
 * Custom PostGIS raster type for Drizzle.
 * Used for DEM (Digital Elevation Model) data.
 */
const raster = customType<{
  data: string;
  driverData: string;
  config: Record<string, never>;
}>({
  dataType: () => "raster",
});

/**
 * DEM elevation table for terrain data.
 * Populated by raster2pgsql from GeoTIFF files.
 * Used by FuelAwarePostGISPlugin for fuel-aware routing.
 */
export const demElevation = pgTable("dem_elevation", {
  rid: serial("rid").primaryKey(),
  rast: raster("rast"),
  sourceFile: text("source_file"),
  importedAt: timestamp("imported_at").defaultNow(),
});

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

// ── GIS Tables ────────────────────────────────────────────────────────────

export const collectionPoints = pgTable("collection_points", {
  id: serial("id").primaryKey(),
  address: text("address"),
  /** Standard PostGIS geography point using SRID 4326 (WGS 84 standard lat/lng) */
  location: geography("location", { type: "Point", srid: 4326 }),
  isCollected: boolean("is_collected").default(false),
  qrCodeToken: text("qr_code_token"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("collection_points_location_idx").using("gist", table.location),
]);

export type CollectionPoint = typeof collectionPoints.$inferSelect;
export type InsertCollectionPoint = typeof collectionPoints.$inferInsert;

export const optimizedRoutes = pgTable("optimized_routes", {
  id: serial("id").primaryKey(),
  routeName: text("route_name"),
  /** A LineString representing the generated path */
  path: geography("path", { type: "LineString", srid: 4326 }),
  totalDistanceMeters: doublePrecision("total_distance_meters"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("optimized_routes_path_idx").using("gist", table.path),
]);

export type OptimizedRoute = typeof optimizedRoutes.$inferSelect;
export type InsertOptimizedRoute = typeof optimizedRoutes.$inferInsert;

// ── Offline Sync Tables (WatermelonDB ↔ PostgreSQL) ───────────────────────

/**
 * Waste points table — bins, dumpsters, and collection points.
 * Synced to mobile devices for offline access.
 */
export const wastePoints = pgTable("waste_points", {
  id: text("id").primaryKey(), // UUID from mobile
  orgId: integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  externalId: text("external_id"), // Reference to external system
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  type: varchar("type", { length: 50 }).notNull(), // bin, dumpster, recycling, etc.
  condition: varchar("condition", { length: 50 }), // good, fair, poor, unknown
  address: text("address"),
  locationName: text("location_name"),
  notes: text("notes"),
  photoUri: text("photo_uri"),
  lastCollectionDate: timestamp("last_collection_date"),
  collectionCount: integer("collection_count").default(0),
  isActive: boolean("is_active").default(true),
  deletedAt: timestamp("deleted_at"),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type WastePoint = typeof wastePoints.$inferSelect;
export type InsertWastePoint = typeof wastePoints.$inferInsert;

/**
 * Routes table — collection routes for drivers.
 * Synced to mobile devices for offline navigation.
 */
export const routes = pgTable("routes", {
  id: text("id").primaryKey(), // UUID from mobile
  orgId: integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  externalId: text("external_id"),
  name: text("name"),
  date: timestamp("date"),
  driverId: integer("driver_id"),
  vehicleId: text("vehicle_id"),
  status: varchar("status", { length: 50 }).default("pending"), // pending, active, completed, cancelled
  totalPoints: integer("total_points").default(0),
  completedPoints: integer("completed_points").default(0),
  estimatedDurationMinutes: integer("estimated_duration_minutes"),
  actualDurationMinutes: integer("actual_duration_minutes"),
  totalDistanceMeters: doublePrecision("total_distance_meters"),
  routeSource: varchar("route_source", { length: 50 }), // manual, vrp, imported
  deletedAt: timestamp("deleted_at"),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Route = typeof routes.$inferSelect;
export type InsertRoute = typeof routes.$inferInsert;

/**
 * Route stops — individual collection points within a route.
 */
export const routeStops = pgTable("route_stops", {
  id: text("id").primaryKey(), // UUID from mobile
  routeId: text("route_id").references(() => routes.id, { onDelete: "cascade" }).notNull(),
  wastePointId: text("waste_point_id").references(() => wastePoints.id, { onDelete: "set null" }),
  sequence: integer("sequence").notNull(),
  address: text("address"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  collectionType: varchar("collection_type", { length: 50 }),
  status: varchar("status", { length: 50 }).default("pending"), // pending, completed, skipped, issue
  specialInstructions: text("special_instructions"),
  notes: text("notes"),
  photoUri: text("photo_uri"),
  completedAt: timestamp("completed_at"),
  skippedReason: text("skipped_reason"),
  deletedAt: timestamp("deleted_at"),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RouteStop = typeof routeStops.$inferSelect;
export type InsertRouteStop = typeof routeStops.$inferInsert;

/**
 * Zones table — geographic partitions for route planning.
 */
export const zones = pgTable("zones", {
  id: text("id").primaryKey(), // UUID from mobile
  orgId: integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  color: varchar("color", { length: 7 }), // Hex color
  boundary: geography("boundary", { type: "Polygon", srid: 4326 }),
  isActive: boolean("is_active").default(true),
  deletedAt: timestamp("deleted_at"),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("zones_boundary_idx").using("gist", table.boundary),
]);

export type Zone = typeof zones.$inferSelect;
export type InsertZone = typeof zones.$inferInsert;

/**
 * Favorites table — user saved places.
 */
export const favorites = pgTable("favorites", {
  id: text("id").primaryKey(), // UUID from mobile
  orgId: integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  address: text("address"),
  category: varchar("category", { length: 50 }), // waypoint, bin, depot, other
  notes: text("notes"),
  photoUri: text("photo_uri"),
  deletedAt: timestamp("deleted_at"),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Favorite = typeof favorites.$inferSelect;
export type InsertFavorite = typeof favorites.$inferInsert;

/**
 * Sync status table — tracks last sync state per table.
 */
export const syncStatus = pgTable("sync_status", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tableName: varchar("table_name", { length: 100 }).notNull(),
  lastSyncToken: text("last_sync_token"),
  lastSyncAt: timestamp("last_sync_at"),
  pendingCount: integer("pending_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sync_status_user_table_unique").on(table.userId, table.tableName),
]);

export type SyncStatusRecord = typeof syncStatus.$inferSelect;
export type InsertSyncStatus = typeof syncStatus.$inferInsert;
