import { trpc } from "@/lib/trpc";

/**
 * Returns the authenticated user's roles and permissions within their organization.
 * Results are cached for 5 minutes to avoid hammering the server on every render.
 *
 * @example
 * const { can, hasRole } = usePermissions();
 * if (can("can_edit_routes")) { ... }
 * if (hasRole("dispatcher")) { ... }
 */
export function usePermissions() {
  const { data, isLoading } = trpc.rbac.myPermissions.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    // Don't throw — just return empty arrays when unauthenticated
    retry: false,
  });

  const can = (permission: string): boolean =>
    data?.permissions.includes(permission) ?? false;

  const hasRole = (role: string): boolean =>
    data?.roles.includes(role) ?? false;

  return {
    can,
    hasRole,
    permissions: data?.permissions ?? [],
    roles: data?.roles ?? [],
    isLoading,
  };
}
