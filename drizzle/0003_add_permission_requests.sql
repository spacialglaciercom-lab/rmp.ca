-- Migration: add_permission_requests
-- Adds request/approval records for IAM permission escalation flow.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'permission_request_status'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "permission_request_status" AS ENUM ('pending', 'approved', 'denied');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "permission_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "orgId" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "requesterId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "requestedPermissions" text[] NOT NULL,
  "status" "permission_request_status" DEFAULT 'pending' NOT NULL,
  "approvedPermissions" text[],
  "token" varchar(128) NOT NULL UNIQUE,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "resolvedAt" timestamp,
  "resolvedBy" integer REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "permission_requests_orgId_idx" ON "permission_requests" ("orgId");
CREATE INDEX IF NOT EXISTS "permission_requests_requesterId_idx" ON "permission_requests" ("requesterId");
CREATE INDEX IF NOT EXISTS "permission_requests_token_idx" ON "permission_requests" ("token");
CREATE INDEX IF NOT EXISTS "permission_requests_status_idx" ON "permission_requests" ("status");
