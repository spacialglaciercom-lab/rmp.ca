use utoipa::OpenApi;

pub mod optimize;
pub mod system;

pub use optimize::*;
pub use system::*;

#[derive(OpenApi)]
#[openapi(
    paths(crate::system::health, crate::system::config),
    components(schemas(
        rmp_shared::types::HealthResponse,
        rmp_shared::types::ConfigResponse,
    )),
)]
pub struct SystemApi;

#[derive(OpenApi)]
#[openapi(
    paths(crate::optimize::eulerian),
    components(schemas(
        rmp_optimizer::dto::RoutingGraph,
        rmp_optimizer::dto::GraphNode,
        rmp_optimizer::dto::GraphEdge,
        rmp_optimizer::dto::PickupSide,
        rmp_optimizer::dto::EulerianCircuit,
        rmp_optimizer::dto::OptimizeError,
    )),
)]
pub struct OptimizerApi;
