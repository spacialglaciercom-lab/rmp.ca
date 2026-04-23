use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

/// Unified API error type for all handlers.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Internal server error: {0}")]
    Internal(String),

    #[error("Bad gateway: {0}")]
    BadGateway(String),

    #[error("Gateway timeout")]
    GatewayTimeout,

    #[error("Validation error: {0}")]
    Validation(String),
}

#[derive(Serialize)]
struct ErrorResponse {
    ok: bool,
    error: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "Unauthorized".to_string()),
            ApiError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg.clone()),
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            ApiError::Internal(msg) => {
                tracing::error!("Internal error: {msg}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".to_string())
            }
            ApiError::BadGateway(msg) => (StatusCode::BAD_GATEWAY, msg.clone()),
            ApiError::GatewayTimeout => (StatusCode::GATEWAY_TIMEOUT, "Gateway timeout".to_string()),
            ApiError::Validation(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
        };

        let body = ErrorResponse {
            ok: false,
            error: message,
        };

        (status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        ApiError::Internal(err.to_string())
    }
}
