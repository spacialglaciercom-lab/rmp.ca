use chrono::NaiveDateTime;
use rmp_shared::types::{PermissionRequestStatus, UserRole};
use sqlx::PgPool;

use crate::schema::{Organization, PermissionRequest, Role, User};

// ── User queries ──────────────────────────────────────────────────────────

/// Upsert a user: insert if not exists (by open_id), update if exists.
/// Matches Node.js upsertUser() semantics:
///   - Text fields set to NULL when None (not ignored).
///   - Role defaults to "admin" when open_id matches OWNER_OPEN_ID.
///   - last_signed_in always updated.
pub async fn upsert_user(
    pool: &PgPool,
    open_id: &str,
    name: Option<&str>,
    email: Option<&str>,
    login_method: Option<&str>,
    role: Option<UserRole>,
    owner_open_id: &str,
) -> Result<User, sqlx::Error> {
    let resolved_role = role.unwrap_or_else(|| {
        if open_id == owner_open_id {
            UserRole::Admin
        } else {
            UserRole::User
        }
    });

    sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users ("openId", name, email, "loginMethod", role, "createdAt", "updatedAt", "lastSignedIn")
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
        ON CONFLICT ("openId") DO UPDATE SET
            name = $2,
            email = $3,
            "loginMethod" = $4,
            role = $5,
            "lastSignedIn" = NOW(),
            "updatedAt" = NOW()
        RETURNING *
        "#,
    )
    .bind(open_id)
    .bind(name)
    .bind(email)
    .bind(login_method)
    .bind(&resolved_role)
    .fetch_one(pool)
    .await
}

/// Get a user by their OAuth openId.
pub async fn get_user_by_open_id(pool: &PgPool, open_id: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(r#"SELECT * FROM users WHERE "openId" = $1"#)
        .bind(open_id)
        .fetch_optional(pool)
        .await
}

/// Get a user by ID.
pub async fn get_user_by_id(pool: &PgPool, id: i32) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// Get all users in an organization.
pub async fn get_users_by_org_id(pool: &PgPool, org_id: i32) -> Result<Vec<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(r#"SELECT * FROM users WHERE "orgId" = $1 ORDER BY name"#)
        .bind(org_id)
        .fetch_all(pool)
        .await
}

/// Update a user's system role.
pub async fn set_user_role(pool: &PgPool, open_id: &str, role: UserRole) -> Result<(), sqlx::Error> {
    sqlx::query(r#"UPDATE users SET role = $1, "updatedAt" = NOW() WHERE "openId" = $2"#)
        .bind(&role)
        .bind(open_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Assign a user to an organization by openId.
pub async fn assign_user_to_org(pool: &PgPool, open_id: &str, org_id: Option<i32>) -> Result<(), sqlx::Error> {
    sqlx::query(r#"UPDATE users SET "orgId" = $1, "updatedAt" = NOW() WHERE "openId" = $2"#)
        .bind(org_id)
        .bind(open_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Organization queries ──────────────────────────────────────────────────

/// Get an organization by ID.
pub async fn get_org_by_id(pool: &PgPool, id: i32) -> Result<Option<Organization>, sqlx::Error> {
    sqlx::query_as::<_, Organization>("SELECT * FROM organizations WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// List all organizations.
pub async fn list_orgs(pool: &PgPool) -> Result<Vec<Organization>, sqlx::Error> {
    sqlx::query_as::<_, Organization>("SELECT * FROM organizations ORDER BY name")
        .fetch_all(pool)
        .await
}

/// Upsert an organization. Seeds system roles for the org on insert or update.
pub async fn upsert_org(
    pool: &PgPool,
    id: Option<i32>,
    name: &str,
    city: Option<&str>,
    tier: rmp_shared::types::OrgTier,
) -> Result<Organization, sqlx::Error> {
    let org = if let Some(id) = id {
        sqlx::query_as::<_, Organization>(
            r#"
            INSERT INTO organizations (id, name, city, tier, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = $2,
                city = $3,
                tier = $4,
                "updatedAt" = NOW()
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(name)
        .bind(city)
        .bind(&tier)
        .fetch_one(pool)
        .await?
    } else {
        sqlx::query_as::<_, Organization>(
            r#"
            INSERT INTO organizations (name, city, tier, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, NOW(), NOW())
            RETURNING *
            "#,
        )
        .bind(name)
        .bind(city)
        .bind(&tier)
        .fetch_one(pool)
        .await?
    };

    // Seed system roles (idempotent)
    seed_system_roles(pool, org.id).await?;

    Ok(org)
}

// ── RBAC queries ──────────────────────────────────────────────────────────

/// Result of loading a user's roles and permissions within an org.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RolesAndPermissions {
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
}

/// Get a user's role names and permission keys within an org.
/// Joins user_roles → roles → role_permissions.
pub async fn get_user_roles_and_permissions(
    pool: &PgPool,
    user_id: i32,
    org_id: i32,
) -> Result<RolesAndPermissions, sqlx::Error> {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"
        SELECT r.name AS role_name, rp."permissionKey"
        FROM user_roles ur
        INNER JOIN roles r ON ur."roleId" = r.id
        LEFT JOIN role_permissions rp ON r.id = rp."roleId"
        WHERE ur."userId" = $1 AND ur."orgId" = $2
        "#,
    )
    .bind(user_id)
    .bind(org_id)
    .fetch_all(pool)
    .await?;

    let mut role_names: Vec<String> = Vec::new();
    let mut permissions: Vec<String> = Vec::new();
    for (role_name, perm) in &rows {
        if !role_names.contains(role_name) {
            role_names.push(role_name.clone());
        }
        if let Some(p) = perm {
            if !permissions.contains(p) {
                permissions.push(p.clone());
            }
        }
    }

    Ok(RolesAndPermissions {
        roles: role_names,
        permissions,
    })
}

/// Get a role by ID.
pub async fn get_role_by_id(pool: &PgPool, id: i32) -> Result<Option<Role>, sqlx::Error> {
    sqlx::query_as::<_, Role>("SELECT * FROM roles WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// List all roles for an org.
pub async fn list_roles_for_org(pool: &PgPool, org_id: i32) -> Result<Vec<Role>, sqlx::Error> {
    sqlx::query_as::<_, Role>(r#"SELECT * FROM roles WHERE "orgId" = $1 ORDER BY name"#)
        .bind(org_id)
        .fetch_all(pool)
        .await
}

/// Create a new role.
pub async fn create_role(
    pool: &PgPool,
    org_id: i32,
    name: &str,
    description: Option<&str>,
    is_system: bool,
) -> Result<Role, sqlx::Error> {
    sqlx::query_as::<_, Role>(
        r#"
        INSERT INTO roles ("orgId", name, description, "isSystem", "createdAt")
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
        "#,
    )
    .bind(org_id)
    .bind(name)
    .bind(description)
    .bind(is_system)
    .fetch_one(pool)
    .await
}

/// Replace all permissions for a role (delete-then-insert).
pub async fn set_role_permissions(
    pool: &PgPool,
    role_id: i32,
    permission_keys: &[String],
) -> Result<(), sqlx::Error> {
    sqlx::query(r#"DELETE FROM role_permissions WHERE "roleId" = $1"#)
        .bind(role_id)
        .execute(pool)
        .await?;

    for key in permission_keys {
        sqlx::query(r#"INSERT INTO role_permissions ("roleId", "permissionKey") VALUES ($1, $2)"#)
            .bind(role_id)
            .bind(key)
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// Assign a role to a user within an org. No-op if already assigned.
pub async fn assign_role_to_user(
    pool: &PgPool,
    user_id: i32,
    role_id: i32,
    org_id: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO user_roles ("userId", "roleId", "orgId")
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(role_id)
    .bind(org_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Remove a role from a user within an org.
pub async fn remove_role_from_user(
    pool: &PgPool,
    user_id: i32,
    role_id: i32,
    org_id: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"DELETE FROM user_roles WHERE "userId" = $1 AND "roleId" = $2 AND "orgId" = $3"#,
    )
    .bind(user_id)
    .bind(role_id)
    .bind(org_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// System role → permission mapping, matching the Node.js SYSTEM_ROLES constant.
const SYSTEM_ROLE_PERMISSIONS: &[(&str, &[&str])] = &[
    ("driver", &["can_view_routes"]),
    (
        "dispatcher",
        &["can_view_routes", "can_edit_routes", "can_view_fleet"],
    ),
    (
        "fleet_manager",
        &[
            "can_view_routes",
            "can_edit_routes",
            "can_manage_fleet",
            "can_view_fleet",
            "can_view_analytics",
        ],
    ),
    (
        "admin",
        &[
            "can_view_routes",
            "can_edit_routes",
            "can_manage_fleet",
            "can_view_fleet",
            "can_manage_users",
            "can_view_analytics",
            "can_manage_roles",
        ],
    ),
    (
        "owner",
        &[
            "can_view_routes",
            "can_edit_routes",
            "can_manage_fleet",
            "can_view_fleet",
            "can_manage_users",
            "can_view_analytics",
            "can_manage_roles",
            "can_manage_billing",
        ],
    ),
];

/// Seed system roles for a new org. Idempotent — upserts each role and its permissions.
pub async fn seed_system_roles(pool: &PgPool, org_id: i32) -> Result<(), sqlx::Error> {
    for &(name, perms) in SYSTEM_ROLE_PERMISSIONS {
        // Try to insert; ON CONFLICT DO NOTHING won't return a row
        let role = sqlx::query_as::<_, Role>(
            r#"
            INSERT INTO roles ("orgId", name, "isSystem", "createdAt")
            VALUES ($1, $2, true, NOW())
            ON CONFLICT DO NOTHING
            RETURNING *
            "#,
        )
        .bind(org_id)
        .bind(name)
        .fetch_optional(pool)
        .await?;

        let role_id = if let Some(r) = role {
            r.id
        } else {
            // Role already existed, fetch it
            let existing: Role = sqlx::query_as(
                r#"SELECT * FROM roles WHERE "orgId" = $1 AND name = $2 LIMIT 1"#,
            )
            .bind(org_id)
            .bind(name)
            .fetch_one(pool)
            .await?;
            existing.id
        };

        let perm_keys: Vec<String> = perms.iter().map(|s| s.to_string()).collect();
        set_role_permissions(pool, role_id, &perm_keys).await?;
    }

    Ok(())
}

// ── Permission request queries ────────────────────────────────────────────

/// Create a new permission request.
pub async fn create_permission_request(
    pool: &PgPool,
    org_id: i32,
    requester_id: i32,
    reason: &str,
    requested_permissions: &[String],
    token: &str,
    expires_at: NaiveDateTime,
) -> Result<PermissionRequest, sqlx::Error> {
    sqlx::query_as::<_, PermissionRequest>(
        r#"
        INSERT INTO permission_requests (
            "orgId", "requesterId", reason, "requestedPermissions",
            status, token, "expiresAt", "createdAt"
        )
        VALUES ($1, $2, $3, $4, 'pending', $5, $6, NOW())
        RETURNING *
        "#,
    )
    .bind(org_id)
    .bind(requester_id)
    .bind(reason)
    .bind(requested_permissions)
    .bind(token)
    .bind(expires_at)
    .fetch_one(pool)
    .await
}

/// Get a permission request by its token.
pub async fn get_permission_request_by_token(
    pool: &PgPool,
    token: &str,
) -> Result<Option<PermissionRequest>, sqlx::Error> {
    sqlx::query_as::<_, PermissionRequest>(
        "SELECT * FROM permission_requests WHERE token = $1",
    )
    .bind(token)
    .fetch_optional(pool)
    .await
}

/// Find all org admins: users with system role "admin" or who hold can_manage_roles/can_manage_users.
pub async fn find_org_admins(pool: &PgPool, org_id: i32) -> Result<Vec<User>, sqlx::Error> {
    let org_users = get_users_by_org_id(pool, org_id).await?;
    let mut admins = Vec::new();
    for u in &org_users {
        if u.email.as_ref().map_or(true, |e| e.trim().is_empty()) {
            continue;
        }
        if u.role == UserRole::Admin {
            admins.push(u.clone());
            continue;
        }
        let rbac = get_user_roles_and_permissions(pool, u.id, org_id).await?;
        if rbac.permissions.contains(&"can_manage_roles".to_string())
            || rbac.permissions.contains(&"can_manage_users".to_string())
        {
            admins.push(u.clone());
        }
    }
    Ok(admins)
}

/// Find a role within an org that has exactly the given set of permissions.
async fn find_role_with_exact_permissions(
    pool: &PgPool,
    org_id: i32,
    permission_keys: &[String],
) -> Result<Option<Role>, sqlx::Error> {
    let mut sorted_target: Vec<String> = permission_keys.to_vec();
    sorted_target.sort();

    let org_roles = list_roles_for_org(pool, org_id).await?;
    for role in &org_roles {
        let perms: Vec<(String,)> = sqlx::query_as(
            r#"SELECT "permissionKey" FROM role_permissions WHERE "roleId" = $1"#,
        )
        .bind(role.id)
        .fetch_all(pool)
        .await?;

        let mut sorted_current: Vec<String> = perms.into_iter().map(|(p,)| p).collect();
        sorted_current.sort();

        if sorted_current == sorted_target {
            return Ok(Some(role.clone()));
        }
    }
    Ok(None)
}

/// Create or reuse a role matching the approved permission set.
pub async fn create_or_reuse_requested_role(
    pool: &PgPool,
    org_id: i32,
    requester_id: i32,
    approved_permissions: &[String],
    request_id: i32,
) -> Result<Option<Role>, sqlx::Error> {
    if approved_permissions.is_empty() {
        return Ok(None);
    }

    if let Some(existing) =
        find_role_with_exact_permissions(pool, org_id, approved_permissions).await?
    {
        return Ok(Some(existing));
    }

    let role_name = format!("access_request_{}", request_id);
    let description = format!(
        "Auto-generated role for IAM request #{} (user {})",
        request_id, requester_id
    );
    let role = create_role(pool, org_id, &role_name, Some(&description), false).await?;
    set_role_permissions(pool, role.id, approved_permissions).await?;
    Ok(Some(role))
}

/// Result of resolving a permission request.
#[derive(Debug)]
pub struct ResolveResult {
    pub request: PermissionRequest,
    pub status: PermissionRequestStatus,
    pub assigned_role_id: Option<i32>,
}

/// Resolve a permission request: approve or deny with atomic update.
pub async fn resolve_permission_request(
    pool: &PgPool,
    token: &str,
    status: PermissionRequestStatus,
    approved_permissions: &[String],
    resolver_user_id: i32,
    expected_org_id: i32,
) -> Result<ResolveResult, sqlx::Error> {
    let request = get_permission_request_by_token(pool, token)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;

    if request.org_id != expected_org_id {
        return Err(sqlx::Error::RowNotFound);
    }

    let now = chrono::Utc::now().naive_utc();
    if request.expires_at < now {
        return Err(sqlx::Error::RowNotFound);
    }

    // If already resolved, return idempotently
    if request.status != PermissionRequestStatus::Pending {
        let current_status = request.status.clone();
        let assigned_role_id =
            if current_status == PermissionRequestStatus::Approved {
                if let Some(ref ap) = request.approved_permissions {
                    find_role_with_exact_permissions(pool, request.org_id, ap)
                        .await?
                        .map(|r| r.id)
                } else {
                    None
                }
            } else {
                None
            };
        return Ok(ResolveResult {
            request,
            status: current_status,
            assigned_role_id,
        });
    }

    let mut deduped: Vec<String> = approved_permissions.to_vec();
    deduped.sort();
    deduped.dedup();

    let final_perms: &[String] = if status == PermissionRequestStatus::Approved {
        &deduped
    } else {
        &[]
    };

    // Atomic conditional update
    let resolved: Option<PermissionRequest> = sqlx::query_as(
        r#"
        UPDATE permission_requests
        SET status = $1, "approvedPermissions" = $2, "resolvedAt" = NOW(), "resolvedBy" = $3
        WHERE id = $4 AND status = 'pending'
        RETURNING *
        "#,
    )
    .bind(&status)
    .bind(final_perms)
    .bind(resolver_user_id)
    .bind(request.id)
    .fetch_optional(pool)
    .await?;

    let request = if let Some(r) = resolved {
        r
    } else {
        let latest = get_permission_request_by_token(pool, token).await?;
        latest.ok_or(sqlx::Error::RowNotFound)?
    };

    let mut assigned_role_id = None;
    if status == PermissionRequestStatus::Approved && !final_perms.is_empty() {
        if let Some(role) = create_or_reuse_requested_role(
            pool,
            request.org_id,
            request.requester_id,
            final_perms,
            request.id,
        )
        .await?
        {
            assign_role_to_user(pool, request.requester_id, role.id, request.org_id).await?;
            assigned_role_id = Some(role.id);
        }
    }

    Ok(ResolveResult {
        request,
        status,
        assigned_role_id,
    })
}
