use axum::Router;
use axum::routing::get;
use rmp_handlers::system;
use rmp_shared::config::Config;
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::{CorsLayer, Any};
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod openapi;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env files (server secrets first, then shared)
    dotenvy::from_filename(".env.server").ok();
    dotenvy::from_filename(".env").ok();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rmp_server=debug,tower_http=debug".into()),
        )
        .json()
        .init();

    let config = Config::from_env();
    let port = config.port;
    let host = config.host.clone();

    // Database connection pool
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await?;

    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await?;

    tracing::info!("Database connected and migrations applied");

    // CORS: reflect request origin for credentials
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build the Axum router
    let app = Router::new()
        // Health & config
        .route("/api/health", get(system::health))
        .route("/api/config", get(system::config))
        .route("/", get(root_index))
        .route("/health", get(system::health))
        // OpenAPI / Swagger
        .merge(
            SwaggerUi::new("/api/docs/swagger-ui")
                .url("/api/docs/openapi.json", openapi::ApiDoc::openapi()),
        )
        // Middleware
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        // State
        .with_state(config);

    // Start server
    let addr = format!("{host}:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("RMP server listening on http://{addr}");
    axum::serve(listener, app).await?;

    Ok(())
}

/// GET / — API index listing available endpoints
async fn root_index() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "ok": true,
        "service": "rmp-server (Rust)",
        "endpoints": {
            "health": "GET /api/health",
            "config": "GET /api/config",
            "docs": "GET /api/docs/swagger-ui",
        },
        "timestamp": chrono::Utc::now().timestamp_millis(),
    }))
}
