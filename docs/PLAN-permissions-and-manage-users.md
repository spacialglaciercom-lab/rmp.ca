# Plan: PermissionGate, Seeded Permissions/Roles, and Manage Users

## Overview

Implement role-based permission checks so UI can show/hide features by permission (e.g. `<PermissionGate permission="can_manage_users"><ManageUsersButton /></PermissionGate>`). Backend will use seeded permission keys and system roles; frontend will get the current user’s permissions and gate components accordingly.

**Security:** Store the database password only in environment variables (e.g. `DATABASE_URL` in `.env`). Never commit it to the repo.

---

## 1. Seeded data (reference)

### Permission keys

| Key | Description |
|-----|-------------|
| `can_view_routes` | View route list |
| `can_edit_routes` | Create/edit routes |
| `can_manage_fleet` | Add/remove vehicles |
| `can_view_fleet` | View fleet only |
| `can_manage_users` | Invite/remove users in tenant |
| `can_view_analytics` | View reports |
| `can_manage_roles` | Assign roles to users |
| `can_manage_billing` | Billing (super admin) |

### System roles and permissions

| Role | Permissions |
|------|-------------|
| `driver` | `can_view_routes` |
| `dispatcher` | `can_view_routes`, `can_edit_routes`, `can_view_fleet` |
| `fleet_manager` | All except `can_manage_users`, `can_manage_roles`, `can_manage_billing` |
| `admin` | All except `can_manage_billing` |
| `owner` | All |

---

## 2. Database schema changes

**Location:** `drizzle/schema.ts`

- **Option A (recommended):** Add permission/role tables and keep existing `role` enum for a transition period, then migrate.
- **Option B:** Replace `users.role` with `users.roleId` FK and drop the old enum after migration.

### New tables

1. **`permissions`**  
   - `key` (varchar, PK), e.g. `can_manage_users`  
   - `description` (text, optional)

2. **`roles`**  
   - `id` (serial, PK)  
   - `name` (varchar, unique), e.g. `driver`, `dispatcher`, `fleet_manager`, `admin`, `owner`

3. **`role_permissions`**  
   - `roleId` (FK → `roles.id`)  
   - `permissionKey` (FK → `permissions.key`)  
   - Primary key: `(roleId, permissionKey)`

4. **`users`**  
   - Add `roleId` (integer, nullable, FK → `roles.id`).  
   - Keep existing `role` enum column until migration is done; then either remove it or keep only for backward compatibility (e.g. map `user` → driver, `admin` → admin in code until data is migrated).

### Migration strategy

- Generate migration with `pnpm db:push` (or `drizzle-kit generate` + `drizzle-kit migrate`).
- Seed script: insert into `permissions`, then `roles`, then `role_permissions`.
- Data migration: set `users.roleId` from current `users.role` (e.g. `user` → role id for `driver`, `admin` → role id for `admin`). Run once, then you can deprecate `role` enum if desired.

---

## 3. Backend implementation

### 3.1 Seed script

**New file:** `server/scripts/seed-permissions.ts` (or `drizzle/seed-permissions.ts`)

- Insert 8 rows into `permissions`.
- Insert 5 rows into `roles`.
- Insert all `role_permissions` rows per the table above (driver: 1; dispatcher: 3; fleet_manager: 5; admin: 7; owner: 8).
- Idempotent: use `ON CONFLICT DO NOTHING` or check existence before insert so it’s safe to run multiple times.

### 3.2 DB helpers

**Location:** `server/db.ts` (and/or a small `server/permissions.ts`)

- `getPermissionsForRole(roleId: number): Promise<string[]>` — returns list of permission keys for a role.
- `getPermissionsForUser(userId: number): Promise<string[]>` — get user’s `roleId`, then return permissions for that role (or empty if no role).
- Optional: `getRoleByName(name: string)` for seeding and mapping.

### 3.3 Auth response includes permissions

**Location:** `server/_core/oauth.ts`

- In `buildUserResponse`, accept full user (with `roleId`).  
- Either:
  - Include `permissions: string[]` in the response (load via `getPermissionsForUser(user.id)`), or  
  - Include `role: string` (role name) and have the frontend derive permissions from a static map (simpler but duplicates logic).
- Prefer **including `permissions`** in the response so the backend is the single source of truth and the frontend only checks `permissions.includes('can_manage_users')`.

Ensure `/api/auth/me` and any other endpoint that returns the current user uses this extended `buildUserResponse` so the client always has the permission list.

### 3.4 tRPC context and procedures

**Location:** `server/_core/context.ts`

- When building context, if `user` is loaded, also load permissions (e.g. `getPermissionsForUser(user.id)`) and set `ctx.user.permissions = string[]` (or attach to a type that extends the DB user).

**Location:** `server/_core/trpc.ts`

- Add `permissionProcedure(permission: string)` (or `permissionProcedure.input(z.object({ permission: z.string() }))`):  
  - Requires authenticated user.  
  - Checks `ctx.user.permissions.includes(permission)`.  
  - Throws `FORBIDDEN` if not allowed.  
- Use this on any procedure that should be restricted by permission (e.g. “manage users” mutation).

### 3.5 Manage-users API (for ManageUsersButton)

- New router or extend `orgRouter`: e.g. `users.list` (org-scoped), `users.invite`, `users.remove`, `users.updateRole` (if you have per-user role in org).
- Protect with `permissionProcedure('can_manage_users')` (or equivalent).  
- Scope all queries/mutations by `ctx.org.id` so tenants only see their own users.

---

## 4. Frontend implementation

### 4.1 Auth state with permissions

- Ensure the client stores the current user including `permissions: string[]` (from `/api/auth/me` or tRPC `auth.me`).
- If you use a hook like `useAuth()` or `useUser()`, extend it to expose `user?.permissions` (and optionally a helper `hasPermission(key: string)`).

### 4.2 PermissionGate component

**New file:** e.g. `components/auth/PermissionGate.tsx`

- Props: `permission: string`, `children: ReactNode`, optional `fallback?: ReactNode`.
- Use current user’s `permissions` (from context/hook). If `permissions` includes `permission`, render `children`; otherwise render `fallback` or `null`.

Example usage:

```tsx
<PermissionGate permission="can_manage_users">
  <ManageUsersButton />
</PermissionGate>
```

### 4.3 ManageUsersButton component

**New file:** e.g. `components/settings/ManageUsersButton.tsx` (or `components/auth/ManageUsersButton.tsx`)

- Renders a button/link that navigates to a “Manage users” screen (e.g. `/manage-users` or a modal/sheet).
- Optionally use `PermissionGate` around it in the parent, or render the button only when `hasPermission('can_manage_users')` so the screen itself can also enforce the same permission.

### 4.4 Manage users screen (optional but recommended)

- New route/screen that lists users in the current org, invite flow, remove, and optionally assign role.
- Calls the new tRPC procedures (list, invite, remove, updateRole) and is only reachable when the user has `can_manage_users` (and the API enforces it).

### 4.5 Where to put the button

- In **Settings:** add a “Team” or “Manage users” section and render:

  ```tsx
  <PermissionGate permission="can_manage_users">
    <ManageUsersButton />
  </PermissionGate>
  ```

- Alternatively, add it to a sidebar or admin area if one exists.

---

## 5. Implementation order

1. **Schema:** Add `permissions`, `roles`, `role_permissions`, and `users.roleId` in `drizzle/schema.ts`; generate and run migration.
2. **Seed:** Implement and run seed script for permissions and roles; run data migration for existing users’ `roleId`.
3. **Backend auth:** Add `getPermissionsForUser`, attach permissions to context user, extend `buildUserResponse` and `/api/auth/me` to return `permissions`.
4. **Backend procedures:** Add `permissionProcedure` and protect manage-users procedures with `can_manage_users`.
5. **Frontend:** Add `PermissionGate`, `ManageUsersButton`, and optional manage-users screen; wire auth state to include permissions; add Manage Users to Settings behind `PermissionGate permission="can_manage_users"`.

---

## 6. Testing

- Unit: Seed script produces expected rows; `getPermissionsForUser` returns correct list for each role.
- Integration: Call `/api/auth/me` (or tRPC `auth.me`) and assert `permissions` is present and correct for a given role.
- E2E/UI: Log in as a user with `can_manage_users` and confirm Manage Users appears in Settings; log in as driver and confirm it does not.

---

## 7. Database password

Store the database password only in environment variables (e.g. in `.env` as part of `DATABASE_URL`). Do not commit it to the repository or document it in code.
