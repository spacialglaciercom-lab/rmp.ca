use sqlx::PgPool;

use crate::config::Config;

/// Shared application state passed to all Axum handlers.
/// Contains both the config and database pool.
#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub pool: PgPool,
}

impl AppState {
    pub fn new(config: Config, pool: PgPool) -> Self {
        Self { config, pool }
    }
}
