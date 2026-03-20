import type { PermissionKey } from "../drizzle/schema";
import { ENV } from "./_core/env";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  can_view_routes: "View routes",
  can_edit_routes: "Edit routes",
  can_manage_fleet: "Manage fleet",
  can_view_fleet: "View fleet",
  can_manage_users: "Manage users",
  can_view_analytics: "View analytics",
  can_manage_roles: "Manage roles",
  can_manage_billing: "Manage billing",
};

async function sendEmail(params: {
  to: string[];
  subject: string;
  html: string;
}): Promise<void> {
  if (!ENV.resendApiKey) {
    console.warn(
      "[IAM Approval] RESEND_API_KEY not configured, skipping email",
    );
    return;
  }
  if (params.to.length === 0) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.resendApiKey}`,
    },
    body: JSON.stringify({
      from: ENV.emailFrom,
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to send IAM approval email: ${err}`);
  }
}

export async function sendPermissionRequestEmailToAdmins(params: {
  adminEmails: string[];
  requesterName: string;
  requesterEmail?: string | null;
  orgName: string;
  reason: string;
  requestedPermissions: PermissionKey[];
  token: string;
  expiresAt: Date;
}) {
  const approveUrl = `${ENV.appBaseUrl}/iam/approve?token=${encodeURIComponent(params.token)}`;
  const permissionList = params.requestedPermissions
    .map(
      (key) =>
        `<li><code>${escapeHtml(key)}</code> - ${escapeHtml(PERMISSION_LABELS[key])}</li>`,
    )
    .join("");
  const escapedRequesterName = escapeHtml(params.requesterName);
  const escapedOrgName = escapeHtml(params.orgName);
  const escapedReason = escapeHtml(params.reason).replace(/\n/g, "<br>");
  const escapedRequesterEmail = params.requesterEmail
    ? escapeHtml(params.requesterEmail)
    : null;
  await sendEmail({
    to: params.adminEmails,
    subject: `[IAM Request] ${escapedRequesterName} requested access`,
    html: `
      <h2>Permission access request</h2>
      <p><strong>Organization:</strong> ${escapedOrgName}</p>
      <p><strong>Requester:</strong> ${escapedRequesterName}${escapedRequesterEmail ? ` (${escapedRequesterEmail})` : ""}</p>
      <p><strong>Reason:</strong><br>${escapedReason}</p>
      <p><strong>Requested permissions:</strong></p>
      <ul>${permissionList}</ul>
      <p><strong>Expires:</strong> ${params.expiresAt.toISOString()}</p>
      <p><a href="${approveUrl}">Review and approve request</a></p>
    `,
  });
}

export async function sendPermissionRequestResolvedEmailToRequester(params: {
  requesterEmail: string;
  requesterName: string;
  status: "approved" | "denied";
  approvedPermissions: PermissionKey[];
}) {
  const permissionList =
    params.approvedPermissions.length > 0
      ? `<ul>${params.approvedPermissions
          .map(
            (key) =>
              `<li><code>${escapeHtml(key)}</code> - ${escapeHtml(PERMISSION_LABELS[key])}</li>`,
          )
          .join("")}</ul>`
      : "<p>No permissions were granted.</p>";
  const escapedRequesterName = escapeHtml(params.requesterName);
  await sendEmail({
    to: [params.requesterEmail],
    subject: `[IAM Request] Your access request was ${params.status}`,
    html: `
      <h2>Access request ${params.status}</h2>
      <p>Hello ${escapedRequesterName},</p>
      ${
        params.status === "approved"
          ? "<p>Your access request has been approved with the following permissions:</p>"
          : "<p>Your access request was denied.</p>"
      }
      ${permissionList}
    `,
  });
}
