use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(rmp_handlers::system::health, rmp_handlers::system::config),
    components(schemas(
        rmp_shared::types::HealthResponse,
        rmp_shared::types::ConfigResponse,
    )),
    info(
        title = "RouteMaster Pro API",
        version = "0.1.0",
        description = "RouteMaster Pro backend API — route optimization, spatial operations, and fleet management.",
    ),
    servers(
        (url = "/api", description = "API base"),
    ),
)]
pub struct ApiDoc;
