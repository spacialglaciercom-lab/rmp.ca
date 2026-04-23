use chrono::NaiveDateTime;
use rmp_shared::types::{OrgTier, PermissionRequestStatus, UserRole};
use serde::{Deserialize, Serialize};

/// User row from the `users` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct User {
    pub id: i32,
    pub open_id: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub login_method: Option<String>,
    pub role: UserRole,
    pub org_id: Option<i32>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub last_signed_in: NaiveDateTime,
}

/// Organization row from the `organizations` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct Organization {
    pub id: i32,
    pub name: String,
    pub city: Option<String>,
    pub tier: OrgTier,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// Role row from the `roles` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct Role {
    pub id: i32,
    pub org_id: i32,
    pub name: String,
    pub description: Option<String>,
    pub is_system: bool,
    pub created_at: NaiveDateTime,
}

/// Role permission row from the `role_permissions` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct RolePermission {
    pub role_id: i32,
    pub permission_key: String,
}

/// User role row from the `user_roles` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct UserRoleAssignment {
    pub user_id: i32,
    pub role_id: i32,
    pub org_id: i32,
}

/// Permission request row from the `permission_requests` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub id: i32,
    pub org_id: i32,
    pub requester_id: i32,
    pub reason: String,
    pub requested_permissions: Vec<String>,
    pub status: PermissionRequestStatus,
    pub approved_permissions: Option<Vec<String>>,
    pub token: String,
    pub expires_at: NaiveDateTime,
    pub created_at: NaiveDateTime,
    pub resolved_at: Option<NaiveDateTime>,
    pub resolved_by: Option<i32>,
}

/// Collection point row from the `collection_points` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CollectionPoint {
    pub id: i32,
    pub address: Option<String>,
    pub location: Option<String>, // PostGIS geography - handled as raw WKT
    pub is_collected: Option<bool>,
    #[sqlx(rename = "qrCodeToken")]
    pub qr_code_token: Option<String>,
    pub created_at: Option<NaiveDateTime>,
}

/// Optimized route row from the `optimized_routes` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct OptimizedRoute {
    pub id: i32,
    pub route_name: Option<String>,
    pub path: Option<String>, // PostGIS geography LineString
    pub total_distance_meters: Option<f64>,
    pub created_at: Option<NaiveDateTime>,
}

/// Waste point row from the `waste_points` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WastePoint {
    pub id: String,
    pub org_id: Option<i32>,
    pub user_id: Option<i32>,
    pub external_id: Option<String>,
    pub latitude: f64,
    pub longitude: f64,
    #[sqlx(rename = "type")]
    pub type_: String,
    pub condition: Option<String>,
    pub address: Option<String>,
    pub location_name: Option<String>,
    pub notes: Option<String>,
    pub photo_uri: Option<String>,
    pub last_collection_date: Option<NaiveDateTime>,
    pub collection_count: Option<i32>,
    pub is_active: Option<bool>,
    pub deleted_at: Option<NaiveDateTime>,
    pub synced_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// Route row from the `routes` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Route {
    pub id: String,
    pub org_id: Option<i32>,
    pub user_id: Option<i32>,
    pub external_id: Option<String>,
    pub name: Option<String>,
    pub date: Option<NaiveDateTime>,
    pub driver_id: Option<i32>,
    pub vehicle_id: Option<String>,
    pub status: Option<String>,
    pub total_points: Option<i32>,
    pub completed_points: Option<i32>,
    pub estimated_duration_minutes: Option<i32>,
    pub actual_duration_minutes: Option<i32>,
    pub total_distance_meters: Option<f64>,
    pub route_source: Option<String>,
    pub deleted_at: Option<NaiveDateTime>,
    pub synced_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// Route stop row from the `route_stops` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RouteStop {
    pub id: String,
    pub route_id: String,
    pub waste_point_id: Option<String>,
    pub sequence: i32,
    pub address: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub collection_type: Option<String>,
    pub status: Option<String>,
    pub special_instructions: Option<String>,
    pub notes: Option<String>,
    pub photo_uri: Option<String>,
    pub completed_at: Option<NaiveDateTime>,
    pub skipped_reason: Option<String>,
    pub deleted_at: Option<NaiveDateTime>,
    pub synced_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// Zone row from the `zones` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Zone {
    pub id: String,
    pub org_id: Option<i32>,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub boundary: Option<String>, // PostGIS geography Polygon
    pub is_active: Option<bool>,
    pub deleted_at: Option<NaiveDateTime>,
    pub synced_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// Favorite row from the `favorites` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Favorite {
    pub id: String,
    pub org_id: Option<i32>,
    pub user_id: i32,
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub address: Option<String>,
    pub category: Option<String>,
    pub notes: Option<String>,
    pub photo_uri: Option<String>,
    pub deleted_at: Option<NaiveDateTime>,
    pub synced_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// Sync status row from the `sync_status` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct SyncStatus {
    pub id: i32,
    pub user_id: i32,
    pub table_name: String,
    pub last_sync_token: Option<String>,
    pub last_sync_at: Option<NaiveDateTime>,
    pub pending_count: Option<i32>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// DEM elevation row from the `dem_elevation` table.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DemElevation {
    pub rid: i32,
    pub source_file: Option<String>,
    pub imported_at: Option<NaiveDateTime>,
}
