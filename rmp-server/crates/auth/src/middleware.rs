use axum::extract::{FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::middleware::Next;
use axum::response::Response;
use rmp_db::models::get_user_roles_and_permissions;
use rmp_db::schema::{Organization, User};
use rmp_shared::error::ApiError;
use rmp_shared::state::AppState;
use rmp_shared::types::UserRole;

// ── Auth extractors ───────────────────────────────────────────────────────

/// Authenticated user extracted from request extensions.
/// Set by the `auth_middleware` layer.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user: User,
    pub org: Option<Organization>,
    pub permissions: Vec<String>,
    pub roles: Vec<String>,
}

impl<S: Send + Sync> FromRequestParts<S> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthUser>()
            .cloned()
            .ok_or(ApiError::Unauthorized)
    }
}

/// Extractor that requires the user to be an admin (system role).
pub struct RequireAdmin(pub AuthUser);

impl<S: Send + Sync> FromRequestParts<S> for RequireAdmin {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let auth = AuthUser::from_request_parts(parts, state).await?;
        if auth.user.role != UserRole::Admin {
            return Err(ApiError::Forbidden(
                "You do not have required permission (10002)".to_string(),
            ));
        }
        Ok(RequireAdmin(auth))
    }
}

/// Extractor that requires the user to have an organization.
pub struct RequireOrg(pub AuthUser);

impl<S: Send + Sync> FromRequestParts<S> for RequireOrg {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let auth = AuthUser::from_request_parts(parts, state).await?;
        if auth.org.is_none() {
            return Err(ApiError::Forbidden(
                "You must be a member of an organization to access this resource. Ask an admin to assign you to an organization.".to_string(),
            ));
        }
        Ok(RequireOrg(auth))
    }
}

/// Extractor that requires a specific permission key.
/// Use `RequirePermission::new("can_manage_fleet")` in handler signatures.
pub struct RequirePermission {
    pub auth: AuthUser,
    pub permission: String,
}

impl RequirePermission {
    /// Create a deferred permission check. Used as an extractor.
    /// The actual permission key is checked at extraction time.
    pub fn with(permission: &'static str) -> RequirePermissionExtractor {
        RequirePermissionExtractor { permission }
    }
}

pub struct RequirePermissionExtractor {
    permission: &'static str,
}

/// Check that an authenticated user has a specific permission.
pub fn check_permission(auth: &AuthUser, permission: &str) -> Result<(), ApiError> {
    if auth.permissions.contains(&permission.to_string()) {
        Ok(())
    } else {
        Err(ApiError::Forbidden(format!(
            "Missing permission: {} (10003)",
            permission
        )))
    }
}

// ── Auth middleware ───────────────────────────────────────────────────────

/// Authentication middleware that:
/// 1. Extracts session token from cookie or Authorization header
/// 2. Verifies JWT
/// 3. Authenticates the user (loads from DB, syncs from OAuth if needed)
/// 4. Loads org and RBAC permissions
/// 5. Sets AuthUser in request extensions
///
/// This runs on every request. If no valid session is found, the request
/// continues without AuthUser (handlers decide if auth is required).
pub async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let cookie_header = req
        .headers()
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let auth_header = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    match crate::oauth::authenticate_request(
        &state.pool,
        &state.config,
        cookie_header.as_deref(),
        auth_header.as_deref(),
    )
    .await
    {
        Ok(user) => {
            // Load org if user has one
            let org = if let Some(org_id) = user.org_id {
                rmp_db::models::get_org_by_id(&state.pool, org_id)
                    .await
                    .ok()
                    .flatten()
            } else {
                None
            };

            // Load RBAC permissions if user has an org
            let (permissions, roles) = if let Some(ref org) = org {
                let rbac = get_user_roles_and_permissions(&state.pool, user.id, org.id)
                    .await
                    .unwrap_or(rmp_db::models::RolesAndPermissions {
                        roles: vec![],
                        permissions: vec![],
                    });
                (rbac.permissions, rbac.roles)
            } else {
                (vec![], vec![])
            };

            let auth_user = AuthUser {
                user,
                org,
                permissions,
                roles,
            };
            req.extensions_mut().insert(auth_user);
        }
        Err(_) => {
            // No valid auth — continue without AuthUser
            // Handlers that require auth will use AuthUser extractor and get Unauthorized
        }
    }

    Ok(next.run(req).await)
}
