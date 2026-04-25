use axum::Json;
use axum::http::StatusCode;
use rmp_optimizer::dto::{EulerianCircuit, OptimizeError, RoutingGraph};

/// Solve the Chinese Postman / MC-CARP variant on `graph` and return an
/// Eulerian circuit. Honors `enforce_right_side` for kerb-side pickup.
#[utoipa::path(
    post,
    path = "/api/optimize/eulerian",
    tag = "optimizer",
    request_body = RoutingGraph,
    responses(
        (status = 200, description = "Eulerian circuit found", body = EulerianCircuit),
        (status = 422, description = "Graph not solvable", body = OptimizeError),
    ),
)]
pub async fn eulerian(
    Json(_graph): Json<RoutingGraph>,
) -> Result<Json<EulerianCircuit>, (StatusCode, Json<OptimizeError>)> {
    Err((
        StatusCode::NOT_IMPLEMENTED,
        Json(OptimizeError {
            code: "not_implemented".into(),
            message: "Eulerian solver lands in Phase 4; see backend/app/hierholzer.py".into(),
        }),
    ))
}
