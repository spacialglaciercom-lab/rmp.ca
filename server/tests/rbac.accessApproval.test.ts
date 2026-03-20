import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { rbacRouter } from "../rbac/rbacRouter";
import type { TrpcContext } from "../_core/context";
import type { PermissionKey } from "../../drizzle/schema";

vi.mock("../db", () => ({
  assignRoleToUser: vi.fn(),
  createPermissionRequest: vi.fn(),
  createRole: vi.fn(),
  findOrgAdmins: vi.fn(),
  getPermissionRequestByToken: vi.fn(),
  getRoleById: vi.fn(),
  getUserById: vi.fn(),
  getUserByOpenId: vi.fn(),
  listRolesForOrg: vi.fn(),
  removeRoleFromUser: vi.fn(),
  resolvePermissionRequest: vi.fn(),
  seedSystemRoles: vi.fn(),
  setRolePermissions: vi.fn(),
}));

vi.mock("../iamApprovalEmail", () => ({
  sendPermissionRequestEmailToAdmins: vi.fn(),
  sendPermissionRequestResolvedEmailToRequester: vi.fn(),
}));

type MockedDb = typeof import("../db");
type MockedEmail = typeof import("../iamApprovalEmail");

function createCtx(overrides: Partial<TrpcContext> = {}): TrpcContext {
  return {
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: {
      id: 7,
      openId: "user-7",
      email: "requester@example.com",
      name: "Requester",
      loginMethod: "manus",
      role: "user",
      orgId: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    org: {
      id: 2,
      name: "City Ops",
      city: null,
      tier: "standard",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    permissions: ["can_manage_roles"],
    roles: ["dispatcher"],
    ...overrides,
  };
}

describe("rbac IAM approval flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requestAccess creates pending request and emails admins", async () => {
    const db = (await import("../db")) as MockedDb;
    const email = (await import("../iamApprovalEmail")) as MockedEmail;
    vi.mocked(db.createPermissionRequest).mockResolvedValue({
      id: 11,
      orgId: 2,
      requesterId: 7,
      reason: "Need limited role for route updates",
      requestedPermissions: ["can_edit_routes"],
      status: "pending",
      approvedPermissions: null,
      token: "tok_123",
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
    });
    vi.mocked(db.findOrgAdmins).mockResolvedValue([
      {
        id: 1,
        openId: "admin-1",
        email: "admin1@example.com",
        name: "Admin One",
        loginMethod: "manus",
        role: "admin",
        orgId: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
    ]);

    const caller = rbacRouter.createCaller(createCtx());
    const result = await caller.requestAccess({
      permissions: ["can_edit_routes"],
      reason: "Need limited role for route updates",
    });

    expect(result.ok).toBe(true);
    expect(db.createPermissionRequest).toHaveBeenCalledTimes(1);
    expect(email.sendPermissionRequestEmailToAdmins).toHaveBeenCalledTimes(1);
  });

  it("getApprovalRequestByToken returns request details for authorized resolver", async () => {
    const db = (await import("../db")) as MockedDb;
    vi.mocked(db.getPermissionRequestByToken).mockResolvedValue({
      id: 12,
      orgId: 2,
      requesterId: 7,
      reason: "Need analytics access",
      requestedPermissions: ["can_view_analytics"],
      status: "pending",
      approvedPermissions: null,
      token: "tok_abc",
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
    });
    vi.mocked(db.getUserById).mockResolvedValue({
      id: 7,
      openId: "user-7",
      email: "requester@example.com",
      name: "Requester",
      loginMethod: "manus",
      role: "user",
      orgId: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    const caller = rbacRouter.createCaller(createCtx());
    const result = await caller.getApprovalRequestByToken({ token: "tok_abc" });

    expect(result.id).toBe(12);
    expect(result.requestedPermissions).toEqual(["can_view_analytics"]);
  });

  it("approveAccess grants subset and emails requester", async () => {
    const db = (await import("../db")) as MockedDb;
    const email = (await import("../iamApprovalEmail")) as MockedEmail;
    const existingRequested: PermissionKey[] = [
      "can_view_analytics",
      "can_edit_routes",
    ];
    vi.mocked(db.getPermissionRequestByToken).mockResolvedValue({
      id: 13,
      orgId: 2,
      requesterId: 7,
      reason: "Need approvals",
      requestedPermissions: existingRequested,
      status: "pending",
      approvedPermissions: null,
      token: "tok_ok",
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
    });
    vi.mocked(db.resolvePermissionRequest).mockResolvedValue({
      request: {
        id: 13,
        orgId: 2,
        requesterId: 7,
        reason: "Need approvals",
        requestedPermissions: existingRequested,
        status: "approved",
        approvedPermissions: ["can_view_analytics"],
        token: "tok_ok",
        expiresAt: new Date(Date.now() + 3600_000),
        createdAt: new Date(),
        resolvedAt: new Date(),
        resolvedBy: 1,
      },
      status: "approved",
      assignedRoleId: 90,
    });
    vi.mocked(db.getUserById).mockResolvedValue({
      id: 7,
      openId: "user-7",
      email: "requester@example.com",
      name: "Requester",
      loginMethod: "manus",
      role: "user",
      orgId: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    const caller = rbacRouter.createCaller(createCtx());
    const result = await caller.approveAccess({
      token: "tok_ok",
      action: "approve",
      approvedPermissions: ["can_view_analytics", "can_manage_billing"],
    });

    expect(result.status).toBe("approved");
    expect(db.resolvePermissionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedPermissions: ["can_view_analytics"],
      }),
    );
    expect(email.sendPermissionRequestResolvedEmailToRequester).toHaveBeenCalled();
  });

  it("approveAccess supports explicit deny path", async () => {
    const db = (await import("../db")) as MockedDb;
    vi.mocked(db.getPermissionRequestByToken).mockResolvedValue({
      id: 14,
      orgId: 2,
      requesterId: 7,
      reason: "Need perms",
      requestedPermissions: ["can_manage_users"],
      status: "pending",
      approvedPermissions: null,
      token: "tok_deny",
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
    });
    vi.mocked(db.resolvePermissionRequest).mockResolvedValue({
      request: {
        id: 14,
        orgId: 2,
        requesterId: 7,
        reason: "Need perms",
        requestedPermissions: ["can_manage_users"],
        status: "denied",
        approvedPermissions: [],
        token: "tok_deny",
        expiresAt: new Date(Date.now() + 3600_000),
        createdAt: new Date(),
        resolvedAt: new Date(),
        resolvedBy: 1,
      },
      status: "denied",
      assignedRoleId: null,
    });
    vi.mocked(db.getUserById).mockResolvedValue({
      id: 7,
      openId: "user-7",
      email: "requester@example.com",
      name: "Requester",
      loginMethod: "manus",
      role: "user",
      orgId: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    const caller = rbacRouter.createCaller(createCtx());
    const result = await caller.approveAccess({
      token: "tok_deny",
      action: "deny",
      approvedPermissions: ["can_manage_users"],
    });

    expect(result.status).toBe("denied");
  });

  it("approveAccess is idempotent when request already resolved", async () => {
    const db = (await import("../db")) as MockedDb;
    const email = (await import("../iamApprovalEmail")) as MockedEmail;
    vi.mocked(db.getPermissionRequestByToken).mockResolvedValue({
      id: 15,
      orgId: 2,
      requesterId: 7,
      reason: "Need role",
      requestedPermissions: ["can_edit_routes"],
      status: "approved",
      approvedPermissions: ["can_edit_routes"],
      token: "tok_done",
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      resolvedAt: new Date(),
      resolvedBy: 1,
    });
    vi.mocked(db.resolvePermissionRequest).mockResolvedValue({
      request: {
        id: 15,
        orgId: 2,
        requesterId: 7,
        reason: "Need role",
        requestedPermissions: ["can_edit_routes"],
        status: "approved",
        approvedPermissions: ["can_edit_routes"],
        token: "tok_done",
        expiresAt: new Date(Date.now() + 3600_000),
        createdAt: new Date(),
        resolvedAt: new Date(),
        resolvedBy: 1,
      },
      status: "approved",
      assignedRoleId: 44,
    });
    vi.mocked(db.getUserById).mockResolvedValue({
      id: 7,
      openId: "user-7",
      email: "requester@example.com",
      name: "Requester",
      loginMethod: "manus",
      role: "user",
      orgId: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    const caller = rbacRouter.createCaller(createCtx());
    const result = await caller.approveAccess({
      token: "tok_done",
      action: "approve",
      approvedPermissions: ["can_edit_routes"],
    });

    expect(result.status).toBe("approved");
    expect(email.sendPermissionRequestResolvedEmailToRequester).not.toHaveBeenCalled();
  });

  it("getApprovalRequestByToken blocks unauthorized users", async () => {
    const caller = rbacRouter.createCaller(
      createCtx({
        user: {
          id: 7,
          openId: "user-7",
          email: "requester@example.com",
          name: "Requester",
          loginMethod: "manus",
          role: "user",
          orgId: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
        },
        permissions: ["can_view_routes"],
      }),
    );

    await expect(
      caller.getApprovalRequestByToken({ token: "tok_forbidden" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
