use axum::extract::State;
use axum::Json;
use rmp_shared::config::Config;
use rmp_shared::types::{ConfigResponse, HealthResponse};

/// GET /api/health
#[utoipa::path(
    get,
    path = "/api/health",
    responses(
        (status = 200, description = "Health check", body = HealthResponse)
    )
)]
pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        timestamp: chrono::Utc::now().timestamp_millis(),
    })
}

/// GET /api/config
#[utoipa::path(
    get,
    path = "/api/config",
    responses(
        (status = 200, description = "Public config", body = ConfigResponse)
    )
)]
pub async fn config(State(cfg): State<Config>) -> Json<ConfigResponse> {
    Json(ConfigResponse {
        google_maps_api_key: if cfg.google_maps_api_key.is_empty() {
            None
        } else {
            Some(cfg.google_maps_api_key)
        },
        osrm_url: if cfg.osrm_url.is_empty() {
            None
        } else {
            Some(cfg.osrm_url)
        },
    })
}
