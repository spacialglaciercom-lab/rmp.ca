use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "RouteMaster Pro API",
        version = "0.1.0",
        description = "RouteMaster Pro backend API — route optimization, spatial operations, and fleet management.",
    ),
    servers(
        (url = "/", description = "Same-origin"),
    ),
    tags(
        (name = "system",    description = "Health, config, readiness"),
        (name = "optimizer", description = "CPP / MC-CARP / Eulerian solving"),
    ),
    nest(
        (path = "/", api = rmp_handlers::SystemApi),
        (path = "/", api = rmp_handlers::OptimizerApi),
    ),
)]
pub struct ApiDoc;
