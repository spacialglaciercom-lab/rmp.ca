use std::env;

/// Server configuration loaded from environment variables.
/// Mirrors the Node.js ENV object from server/_core/env.ts.
#[derive(Debug, Clone)]
pub struct Config {
    pub app_id: String,
    pub cookie_secret: String,
    pub database_url: String,
    pub mongodb_uri: String,
    pub gpx_training_path: String,
    pub oauth_server_url: String,
    pub owner_open_id: String,
    pub is_production: bool,
    pub forge_api_url: String,
    pub forge_api_key: String,
    pub google_maps_api_key: String,
    pub mistral_api_key: String,
    pub ai_gateway_api_key: String,
    pub open_router_api_key: String,
    pub route_log_upload_url: String,
    pub route_log_analyze: bool,
    pub elevenlabs_api_key: String,
    pub firebase_service_account: String,
    pub moonshine_sidecar_url: String,
    pub moonshine_stt_enabled: bool,
    pub osm_oauth_client_secret: String,
    pub osrm_url: String,
    pub optimizer_backend_url: String,
    pub resend_api_key: String,
    pub email_from: String,
    pub app_base_url: String,
    pub port: u16,
    pub host: String,
}

impl Config {
    /// Load configuration from environment variables.
    /// Call this after dotenvy has loaded .env files.
    pub fn from_env() -> Self {
        Self {
            app_id: env_or("VITE_APP_ID", "trashroute"),
            cookie_secret: env_or_empty("JWT_SECRET"),
            database_url: env_or_empty("DATABASE_URL"),
            mongodb_uri: env_or_empty("MONGODB_URI"),
            gpx_training_path: env_or_empty("GPX_TRAINING_PATH"),
            oauth_server_url: env_or_empty("OAUTH_SERVER_URL"),
            owner_open_id: env_or_empty("OWNER_OPEN_ID"),
            is_production: env::var("NODE_ENV").unwrap_or_default() == "production",
            forge_api_url: env_or_empty("BUILT_IN_FORGE_API_URL"),
            forge_api_key: env_or_empty("BUILT_IN_FORGE_API_KEY"),
            google_maps_api_key: env_or_empty("GOOGLE_MAPS_API_KEY"),
            mistral_api_key: env_or_empty("MISTRAL_API_KEY"),
            ai_gateway_api_key: env_or_empty("AI_GATEWAY_API_KEY"),
            open_router_api_key: env_or_empty("OPENROUTER_API_KEY"),
            route_log_upload_url: env_or_empty("ROUTE_LOG_UPLOAD_URL"),
            route_log_analyze: env::var("ROUTE_LOG_ANALYZE").unwrap_or_default() == "true",
            elevenlabs_api_key: env_or_empty("ELEVENLABS_API_KEY"),
            firebase_service_account: env_or_empty("FIREBASE_SERVICE_ACCOUNT"),
            moonshine_sidecar_url: {
                let raw = env_or_empty("MOONSHINE_SIDECAR_URL");
                if raw.is_empty() {
                    String::new()
                } else if raw.starts_with("http://") || raw.starts_with("https://") {
                    raw.trim_end_matches('/').to_string()
                } else {
                    format!("https://{}", raw.trim_end_matches('/'))
                }
            },
            moonshine_stt_enabled: env::var("MOONSHINE_STT_ENABLED").unwrap_or_default() != "false",
            osm_oauth_client_secret: env_or_empty("OSM_OAUTH_CLIENT_SECRET"),
            osrm_url: env_or_empty("OSRM_URL").trim_end_matches('/').to_string(),
            optimizer_backend_url: {
                let raw = env::var("OPTIMIZER_BACKEND_URL")
                    .or_else(|_| env::var("EXPO_PUBLIC_OPTIMIZER_URL"))
                    .unwrap_or_else(|_| "https://divine-harmony-optimizer.up.railway.app".to_string());
                if raw.starts_with("http://") || raw.starts_with("https://") {
                    raw.trim_end_matches('/').to_string()
                } else {
                    format!("https://{}", raw.trim_end_matches('/'))
                }
            },
            resend_api_key: env_or_empty("RESEND_API_KEY"),
            email_from: env_or("EMAIL_FROM", "RouteMaster Pro <contact@routemasterpro.ca>"),
            app_base_url: env_or("APP_BASE_URL", "https://rmpca-production.up.railway.app")
                .trim_end_matches('/')
                .to_string(),
            port: env::var("PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(3000),
            host: env_or("HOST", "0.0.0.0"),
        }
    }
}

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_or_empty(key: &str) -> String {
    env::var(key).unwrap_or_default().trim().to_string()
}
