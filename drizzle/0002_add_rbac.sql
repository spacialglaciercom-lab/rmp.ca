-- Migration: add_rbac
-- Adds fine-grained role-based access control:
--   1. roles table (per-org named roles)
--   2. role_permissions join table (role → permission keys)
--   3. user_roles join table (user → role within org)
--
-- Apply with:
--   psql $DATABASE_URL -f drizzle/0002_add_rbac.sql

-- 1. roles table
CREATE TABLE IF NOT EXISTS "roles" (
  "id"          serial      PRIMARY KEY NOT NULL,
  "orgId"       integer     NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"        text        NOT NULL,
  "description" text,
  "isSystem"    boolean     DEFAULT false NOT NULL,
  "createdAt"   timestamp   DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "roles_orgId_idx" ON "roles" ("orgId");

-- 2. role_permissions join table
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "roleId"        integer  NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "permissionKey" text     NOT NULL,
  PRIMARY KEY ("roleId", "permissionKey")
);

-- 3. user_roles join table
CREATE TABLE IF NOT EXISTS "user_roles" (
  "userId" integer  NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "roleId" integer  NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "orgId"  integer  NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  PRIMARY KEY ("userId", "roleId", "orgId")
);
CREATE INDEX IF NOT EXISTS "user_roles_userId_idx" ON "user_roles" ("userId");
CREATE INDEX IF NOT EXISTS "user_roles_orgId_idx"  ON "user_roles" ("orgId");
