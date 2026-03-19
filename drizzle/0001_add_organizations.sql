-- Migration: add_organizations
-- Adds multi-tenancy support:
--   1. org_tier enum
--   2. organizations table
--   3. orgId FK column on users (nullable — solo users unaffected)
--
-- Apply with:
--   DATABASE_URL=<url> npx drizzle-kit migrate
-- Or directly:
--   psql $DATABASE_URL -f drizzle/0001_add_organizations.sql

-- 1. Create org_tier enum
DO $$ BEGIN
  CREATE TYPE "org_tier" AS ENUM('trial', 'standard', 'enterprise');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Create organizations table
CREATE TABLE IF NOT EXISTS "organizations" (
  "id"        serial        PRIMARY KEY NOT NULL,
  "name"      text          NOT NULL,
  "city"      text,
  "tier"      "org_tier"    DEFAULT 'trial' NOT NULL,
  "createdAt" timestamp     DEFAULT now() NOT NULL,
  "updatedAt" timestamp     DEFAULT now() NOT NULL
);

-- 3. Add nullable orgId FK to users
--    ON DELETE SET NULL: deleting an org removes the link, not the user.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "orgId" integer
    REFERENCES "organizations"("id")
    ON DELETE SET NULL;

-- 4. Index for fast "give me all users in org X" lookups
CREATE INDEX IF NOT EXISTS "users_orgId_idx" ON "users" ("orgId");
