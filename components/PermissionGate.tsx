import React from "react";
import { usePermissions } from "@/hooks/use-permissions";

type Props = {
  /** The permission key required to render children (e.g. "can_manage_users"). */
  permission: string;
  /** Optional content to render when the user lacks the permission. Defaults to null. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Renders children only when the authenticated user holds the given permission
 * within their organization. Renders `fallback` (default: nothing) otherwise.
 *
 * @example
 * <PermissionGate permission="can_manage_users">
 *   <ManageUsersButton />
 * </PermissionGate>
 *
 * <PermissionGate permission="can_manage_billing" fallback={<UpgradePrompt />}>
 *   <BillingSettings />
 * </PermissionGate>
 */
export function PermissionGate({ permission, fallback = null, children }: Props) {
  const { can } = usePermissions();
  return can(permission) ? <>{children}</> : <>{fallback}</>;
}
