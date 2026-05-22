// UniFFI proc-macro scaffolding — must be at crate root.
uniffi::setup_scaffolding!("rmp_routing");

use std::time::{SystemTime, UNIX_EPOCH};

// ─── Types exposed to Swift / Kotlin via UniFFI ───────────────────────────────

/// A geographic coordinate in WGS-84.
#[derive(Debug, Clone, uniffi::Record)]
pub struct Coord {
    pub lat: f64,
    pub lon: f64,
}

/// A stop that the solver visits.  All fields that are optional in JS map to
/// `Option<T>` so the FFI layer can pass `null` / `nil` safely.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SolverPoint {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
    /// Cargo demand (e.g. bin-lift count) — used for capacity checks upstream.
    pub demand: Option<f64>,
    /// Fixed service time at the stop in seconds (default 120 s).
    pub service_time: Option<f64>,
}

/// Which local heuristic to apply.
#[derive(Debug, Clone, uniffi::Enum)]
pub enum SolverAlgorithm {
    /// O(n²) greedy construction only — fastest, lowest quality.
    NearestNeighbor,
    /// Nearest-neighbor seed + 2-opt + or-opt — best quality for mobile use.
    TwoOpt,
}

/// Options forwarded from the Swift call site.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SolverOptions {
    pub algorithm: SolverAlgorithm,
    /// Whether to close the tour back to the depot.
    pub return_to_depot: bool,
    /// Cap on improvement iterations (2-opt and or-opt).  `None` → 100.
    pub max_iterations: Option<u32>,
}

/// One directed segment of the solved route.
#[derive(Debug, Clone, uniffi::Record)]
pub struct RouteSegment {
    pub from_id: String,
    pub to_id: String,
    /// Great-circle distance in metres.
    pub distance_m: f64,
    /// Estimated travel time in seconds (assumes 30 km/h average speed).
    pub duration_s: f64,
}

/// Full result returned to the Swift caller.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SolverResult {
    /// Stop IDs in visitation order.
    pub ordered_ids: Vec<String>,
    pub total_distance_m: f64,
    pub total_duration_s: f64,
    pub segments: Vec<RouteSegment>,
    /// Name of the algorithm that produced this result.
    pub algorithm: String,
    pub solve_time_ms: u64,
}

// ─── Errors ───────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum RoutingError {
    #[error("points list is empty")]
    EmptyInput,
    #[error("depot index {0} is out of range")]
    InvalidDepot(u32),
}

// ─── Public FFI entry point ───────────────────────────────────────────────────

/// Solve a Travelling-Salesman-style route over `points`.
///
/// If `depot` is `Some`, its index into `points` is treated as the starting
/// (and, when `options.return_to_depot` is true, ending) location.
///
/// Safe to call from a Swift background task — all state is local to the call.
#[uniffi::export]
pub fn solve_route(
    points: Vec<SolverPoint>,
    depot: Option<u32>,
    options: SolverOptions,
) -> Result<SolverResult, RoutingError> {
    if points.is_empty() {
        return Err(RoutingError::EmptyInput);
    }

    let depot_idx = depot.unwrap_or(0) as usize;
    if depot_idx >= points.len() {
        return Err(RoutingError::InvalidDepot(depot_idx as u32));
    }

    let start_ms = unix_ms();

    if points.len() == 1 {
        return Ok(SolverResult {
            ordered_ids: vec![points[0].id.clone()],
            total_distance_m: 0.0,
            total_duration_s: points[0].service_time.unwrap_or(120.0),
            segments: vec![],
            algorithm: "trivial".into(),
            solve_time_ms: unix_ms() - start_ms,
        });
    }

    let matrix = build_distance_matrix(&points);
    let max_iter = options.max_iterations.unwrap_or(100) as usize;

    let order = match options.algorithm {
        SolverAlgorithm::NearestNeighbor => nearest_neighbor(&matrix, depot_idx),
        SolverAlgorithm::TwoOpt => {
            let seed = nearest_neighbor(&matrix, depot_idx);
            let improved = two_opt_improve(seed, &matrix, max_iter);
            or_opt_improve(improved, &matrix, max_iter / 2)
        }
    };

    let mut order = order;
    if options.return_to_depot {
        order.push(depot_idx);
    }

    let (segments, total_distance_m, total_duration_s) = build_segments(&order, &points, &matrix);

    Ok(SolverResult {
        ordered_ids: order.iter().map(|&i| points[i].id.clone()).collect(),
        total_distance_m,
        total_duration_s,
        segments,
        algorithm: algorithm_name(&options.algorithm),
        solve_time_ms: unix_ms() - start_ms,
    })
}

/// Haversine great-circle distance between two WGS-84 points, in metres.
/// Exported so Swift can call it directly for display / UI purposes.
#[uniffi::export]
pub fn haversine_meters(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    haversine(lat1, lon1, lat2, lon2)
}

// ─── Internal algorithms ──────────────────────────────────────────────────────

fn haversine(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6_371_000.0;
    let d_lat = (lat2 - lat1).to_radians();
    let d_lon = (lon2 - lon1).to_radians();
    let sin_lat = (d_lat / 2.0).sin();
    let sin_lon = (d_lon / 2.0).sin();
    let a =
        sin_lat * sin_lat + lat1.to_radians().cos() * lat2.to_radians().cos() * sin_lon * sin_lon;
    R * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())
}

fn build_distance_matrix(points: &[SolverPoint]) -> Vec<Vec<f64>> {
    let n = points.len();
    (0..n)
        .map(|i| {
            (0..n)
                .map(|j| {
                    if i == j {
                        0.0
                    } else {
                        haversine(points[i].lat, points[i].lon, points[j].lat, points[j].lon)
                    }
                })
                .collect()
        })
        .collect()
}

/// Greedy nearest-neighbor construction.  O(n²).
fn nearest_neighbor(matrix: &[Vec<f64>], depot: usize) -> Vec<usize> {
    let n = matrix.len();
    let mut visited = vec![false; n];
    let mut order = Vec::with_capacity(n);

    visited[depot] = true;
    order.push(depot);

    while order.len() < n {
        let last = *order.last().unwrap();
        let next = (0..n)
            .filter(|&i| !visited[i])
            .min_by(|&a, &b| matrix[last][a].partial_cmp(&matrix[last][b]).unwrap())
            .unwrap();
        visited[next] = true;
        order.push(next);
    }

    order
}

/// 2-opt edge-swap improvement.  Faithfully ported from routeSolverLocal.ts.
fn two_opt_improve(mut order: Vec<usize>, matrix: &[Vec<f64>], max_iter: usize) -> Vec<usize> {
    let n = order.len();
    for _ in 0..max_iter {
        let mut improved = false;
        for i in 1..n.saturating_sub(1) {
            for j in (i + 1)..n {
                let cur = matrix[order[i - 1]][order[i]] + matrix[order[j]][order[(j + 1) % n]];
                let candidate =
                    matrix[order[i - 1]][order[j]] + matrix[order[i]][order[(j + 1) % n]];
                if candidate < cur {
                    order[i..=j].reverse();
                    improved = true;
                }
            }
        }
        if !improved {
            break;
        }
    }
    order
}

/// Or-opt single-node relocation.  Faithfully ported from routeSolverLocal.ts.
fn or_opt_improve(mut order: Vec<usize>, matrix: &[Vec<f64>], max_iter: usize) -> Vec<usize> {
    let n = order.len();
    for _ in 0..max_iter {
        let mut improved = false;
        'outer: for i in 1..n {
            for j in 0..n {
                if j == i || j + 1 == i {
                    continue;
                }
                let mut candidate = order.clone();
                let node = candidate.remove(i);
                let insert_at = if j > i { j - 1 } else { j };
                candidate.insert(insert_at, node);

                if route_distance(&candidate, matrix) < route_distance(&order, matrix) {
                    order = candidate;
                    improved = true;
                    break 'outer;
                }
            }
        }
        if !improved {
            break;
        }
    }
    order
}

fn route_distance(order: &[usize], matrix: &[Vec<f64>]) -> f64 {
    order.windows(2).map(|w| matrix[w[0]][w[1]]).sum()
}

fn build_segments(
    order: &[usize],
    points: &[SolverPoint],
    matrix: &[Vec<f64>],
) -> (Vec<RouteSegment>, f64, f64) {
    // 30 km/h in m/s
    const SPEED_M_S: f64 = 30.0 * 1000.0 / 3600.0;

    let mut segments = Vec::with_capacity(order.len().saturating_sub(1));
    let mut total_dist = 0.0f64;
    let mut total_dur = 0.0f64;

    for w in order.windows(2) {
        let (from, to) = (w[0], w[1]);
        let dist = matrix[from][to];
        let travel = dist / SPEED_M_S;
        let service = points[to].service_time.unwrap_or(120.0);

        total_dist += dist;
        total_dur += travel + service;

        segments.push(RouteSegment {
            from_id: points[from].id.clone(),
            to_id: points[to].id.clone(),
            distance_m: dist,
            duration_s: travel + service,
        });
    }

    (segments, total_dist, total_dur)
}

fn algorithm_name(alg: &SolverAlgorithm) -> String {
    match alg {
        SolverAlgorithm::NearestNeighbor => "nearest-neighbor".into(),
        SolverAlgorithm::TwoOpt => "2-opt+or-opt".into(),
    }
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_square() -> Vec<SolverPoint> {
        // Four corners of a ~1 km square near Ottawa
        vec![
            SolverPoint {
                id: "A".into(),
                lat: 45.4215,
                lon: -75.6972,
                demand: None,
                service_time: None,
            },
            SolverPoint {
                id: "B".into(),
                lat: 45.4215,
                lon: -75.6872,
                demand: None,
                service_time: None,
            },
            SolverPoint {
                id: "C".into(),
                lat: 45.4115,
                lon: -75.6872,
                demand: None,
                service_time: None,
            },
            SolverPoint {
                id: "D".into(),
                lat: 45.4115,
                lon: -75.6972,
                demand: None,
                service_time: None,
            },
        ]
    }

    #[test]
    fn haversine_sanity() {
        // Ottawa → Montréal ≈ 158 km
        let d = haversine(45.4215, -75.6972, 45.5017, -73.5673);
        assert!((150_000.0..170_000.0).contains(&d), "got {d}");
    }

    #[test]
    fn nearest_neighbor_visits_all() {
        let pts = make_square();
        let matrix = build_distance_matrix(&pts);
        let order = nearest_neighbor(&matrix, 0);
        assert_eq!(order.len(), 4);
        let mut sorted = order.clone();
        sorted.sort();
        assert_eq!(sorted, vec![0, 1, 2, 3]);
    }

    #[test]
    fn two_opt_does_not_increase_distance() {
        let pts = make_square();
        let matrix = build_distance_matrix(&pts);
        let seed = nearest_neighbor(&matrix, 0);
        let seed_dist = route_distance(&seed, &matrix);
        let improved = two_opt_improve(seed, &matrix, 50);
        let improved_dist = route_distance(&improved, &matrix);
        assert!(improved_dist <= seed_dist + 1e-9);
    }

    #[test]
    fn solve_route_returns_all_ids() {
        let pts = make_square();
        let opts = SolverOptions {
            algorithm: SolverAlgorithm::TwoOpt,
            return_to_depot: false,
            max_iterations: None,
        };
        let result = solve_route(pts.clone(), None, opts).unwrap();
        assert_eq!(result.ordered_ids.len(), 4);
        let mut sorted = result.ordered_ids.clone();
        sorted.sort();
        assert_eq!(sorted, vec!["A", "B", "C", "D"]);
    }

    #[test]
    fn solve_route_return_to_depot_has_extra_leg() {
        let pts = make_square();
        let opts = SolverOptions {
            algorithm: SolverAlgorithm::TwoOpt,
            return_to_depot: true,
            max_iterations: None,
        };
        let result = solve_route(pts, None, opts).unwrap();
        assert_eq!(result.ordered_ids.len(), 5);
        assert_eq!(result.ordered_ids[0], result.ordered_ids[4]);
        assert_eq!(result.segments.len(), 4);
    }

    #[test]
    fn solve_route_empty_returns_error() {
        let opts = SolverOptions {
            algorithm: SolverAlgorithm::NearestNeighbor,
            return_to_depot: false,
            max_iterations: None,
        };
        assert!(matches!(
            solve_route(vec![], None, opts),
            Err(RoutingError::EmptyInput)
        ));
    }
}

#[derive(serde::Serialize)]
pub struct TraceNode {
    pub id: String,
}

#[derive(serde::Serialize)]
pub struct TraceEdge {
    pub u: String,
    pub v: String,
    pub id: String,
}

#[derive(serde::Serialize)]
pub struct TraceGraph {
    pub nodes: Vec<TraceNode>,
    pub edges: Vec<TraceEdge>,
}

#[derive(serde::Serialize)]
pub struct Trace {
    pub original_graph: TraceGraph,
    pub circuit: Vec<String>,
}

#[uniffi::export]
pub fn export_trace_to_json(result: SolverResult, points: Vec<SolverPoint>) -> String {
    let nodes: Vec<TraceNode> = points
        .iter()
        .map(|p| TraceNode { id: p.id.clone() })
        .collect();
    let mut edges = Vec::new();
    let mut circuit = Vec::new();

    for (i, segment) in result.segments.iter().enumerate() {
        let edge_id = format!("e{}", i);
        edges.push(TraceEdge {
            u: segment.from_id.clone(),
            v: segment.to_id.clone(),
            id: edge_id.clone(),
        });
        circuit.push(edge_id);
    }

    let trace = Trace {
        original_graph: TraceGraph { nodes, edges },
        circuit,
    };

    serde_json::to_string(&trace).unwrap_or_default()
}
