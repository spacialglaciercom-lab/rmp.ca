use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GraphNode {
    #[schema(example = 1234567890_u64)]
    pub id: u64,
    #[schema(example = 45.5017)]
    pub lat: f64,
    #[schema(example = -73.5673)]
    pub lon: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PickupSide {
    Right,
    Left,
    #[default]
    Either,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GraphEdge {
    pub from: u64,
    pub to: u64,
    /// Travel cost in seconds unless the caller specifies otherwise.
    pub cost: f64,
    #[serde(default)]
    pub oneway: bool,
    #[serde(default)]
    pub side: PickupSide,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RoutingGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// Require every required edge to be entered from the side that puts the
    /// stop on the driver's right kerb (mirrors `backend/app/optimize.py`).
    #[serde(default)]
    pub enforce_right_side: bool,
    /// Optional start/end node id; if absent the solver picks the lowest-id
    /// vertex with non-zero degree.
    #[serde(default)]
    pub start_node: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EulerianCircuit {
    /// Ordered node ids forming the closed walk; first == last.
    pub nodes: Vec<u64>,
    /// Edge sequence aligned to consecutive `nodes` pairs.
    pub edges: Vec<GraphEdge>,
    pub total_cost: f64,
    /// Edges duplicated by the matching step to make the graph Eulerian.
    pub augmenting_edges: usize,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct OptimizeError {
    pub code: String,
    pub message: String,
}
