import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Organization, User } from "../../drizzle/schema";
import { getOrgById, getUserRolesAndPermissions } from "../db";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** Populated when the authenticated user belongs to an organization. */
  org: Organization | null;
  /** Flattened permission keys the user holds within their org. Empty when unauthenticated or no org. */
  permissions: string[];
  /** Role names the user holds within their org. Empty when unauthenticated or no org. */
  roles: string[];
};

export async function createContext(
  opts: CreateExpressContextOptions,
): Promise<TrpcContext> {
  try {
    let user: User | null = null;
    let org: Organization | null = null;
    let permissions: string[] = [];
    let roles: string[] = [];
    try {
      user = await sdk.authenticateRequest(opts.req);
      if (user?.orgId != null) {
        org = (await getOrgById(user.orgId)) ?? null;
      }
      if (user && org) {
        const rbac = await getUserRolesAndPermissions(user.id, org.id);
        permissions = rbac.permissions;
        roles = rbac.roles;
      }
    } catch {
      // Authentication is optional for public procedures (e.g. voice.transcribe, voice.chat).
      user = null;
    }
    return {
      req: opts.req,
      res: opts.res,
      user,
      org,
      permissions,
      roles,
    };
  } catch (error) {
    // Ensure we never throw: public procedures must work without login.
    return {
      req: opts.req,
      res: opts.res,
      user: null,
      org: null,
      permissions: [],
      roles: [],
    };
  }
}
