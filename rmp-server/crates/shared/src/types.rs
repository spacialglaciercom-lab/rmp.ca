use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// All available permission keys for RBAC.
pub const PERMISSION_KEYS: &[&str] = &[
    "can_view_routes",
    "can_edit_routes",
    "can_manage_fleet",
    "can_view_fleet",
    "can_manage_users",
    "can_view_analytics",
    "can_manage_roles",
    "can_manage_billing",
];

/// Seeded system role names.
pub const SYSTEM_ROLES: &[&str] = &["driver", "dispatcher", "fleet_manager", "admin", "owner"];

/// User role enum matching the PostgreSQL `role` enum.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, ToSchema)]
#[sqlx(type_name = "role", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    User,
    Admin,
}

impl Default for UserRole {
    fn default() -> Self {
        UserRole::User
    }
}

/// Organization tier enum matching the PostgreSQL `org_tier` enum.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, ToSchema)]
#[sqlx(type_name = "org_tier", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum OrgTier {
    Trial,
    Standard,
    Enterprise,
}

impl Default for OrgTier {
    fn default() -> Self {
        OrgTier::Trial
    }
}

/// Permission request status enum matching PostgreSQL.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, ToSchema)]
#[sqlx(type_name = "permission_request_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PermissionRequestStatus {
    Pending,
    Approved,
    Denied,
}

impl Default for PermissionRequestStatus {
    fn default() -> Self {
        PermissionRequestStatus::Pending
    }
}

/// Standard API response wrapper.
#[derive(Debug, Serialize, ToSchema)]
pub struct ApiResponse<T: Serialize> {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }
}

/// Health check response.
#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    pub ok: bool,
    pub timestamp: i64,
}

/// Public config response (GET /api/config).
#[derive(Debug, Serialize, ToSchema)]
pub struct ConfigResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub google_maps_api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub osrm_url: Option<String>,
}
