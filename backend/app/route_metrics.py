"""
Route quality metrics — automated geometric/topological invariants.

These metrics close the gap between "tests pass" and "route looks right when
plotted on a map".  They give CI fail-loud signals for the kinds of regressions
that previously required visual inspection: drunken-walk loops, null deadhead
cycles ("bow-ties"), excessive immediate reversals, and edge over-repetition.

All functions are pure and operate on the canonical ``route_nodes: list[str]``
output of ``_solve_cpp`` plus the graph(s) it was run against.  No imports
from FastAPI / heavy deps so the metrics can be reused by tests, batch
benchmarks, and the streamlit dashboard.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

import networkx as nx


__all__ = [
    "RouteMetrics",
    "compute_route_metrics",
    "edge_repeat_ratio",
    "immediate_reversal_count",
    "null_deadhead_cycle_count",
    "deadhead_distance_ratio",
    "coverage_fraction",
    "assert_route_quality",
]


@dataclass(frozen=True)
class RouteMetrics:
    """Geometric/topological summary of a CPP route.

    Attributes
    ----------
    total_hops:
        Number of (u, v) transitions in ``route_nodes`` (i.e. ``len(route)-1``).
    unique_required_edges:
        Distinct edges of the original graph ``G`` traversed at least once.
    edges_in_graph:
        ``G.number_of_edges()``.
    coverage:
        ``unique_required_edges / edges_in_graph``.  Should be 1.0 for a valid
        Chinese-Postman solution.
    edge_repeat_ratio:
        ``total_hops / edges_in_graph``.  1.0 = perfect Eulerian; 1.1–1.3 is
        normal for urban CPP; >1.5 typically indicates a drunken-walk bug.
    immediate_reversals:
        Count of ``A -> B -> A`` patterns in the raw route (before cleanup).
    null_deadhead_cycles:
        Count of closed loops formed entirely by deadhead / bridge transitions
        (transitions whose (u,v) does not correspond to any edge of ``G``).
        These traverse no required edge — pure waste.
    deadhead_distance_ratio:
        Fraction of total route distance spent on deadhead/bridge transitions
        (only computed when an augmented graph and a length lookup is provided).
    """

    total_hops: int
    unique_required_edges: int
    edges_in_graph: int
    coverage: float
    edge_repeat_ratio: float
    immediate_reversals: int
    null_deadhead_cycles: int
    deadhead_distance_ratio: float


# ---------------------------------------------------------------------------
# Individual metric helpers
# ---------------------------------------------------------------------------


def _canon(u: str, v: str, directed: bool) -> tuple[str, str]:
    return (u, v) if directed else (min(u, v), max(u, v))


def coverage_fraction(route_nodes: list[str], G: nx.MultiGraph | nx.MultiDiGraph) -> float:
    """Fraction of required edges traversed at least once."""
    total = G.number_of_edges()
    if total == 0:
        return 1.0
    directed = G.is_directed()
    required: set[tuple[str, str]] = {_canon(u, v, directed) for u, v in G.edges()}
    seen: set[tuple[str, str]] = set()
    for i in range(len(route_nodes) - 1):
        pair = _canon(route_nodes[i], route_nodes[i + 1], directed)
        if pair in required:
            seen.add(pair)
    return len(seen) / total


def edge_repeat_ratio(route_nodes: list[str], G: nx.MultiGraph | nx.MultiDiGraph) -> float:
    """``total_hops / |E(G)|``.  1.0 = each edge traversed exactly once."""
    total = G.number_of_edges()
    if total == 0:
        return 0.0
    return max(0, len(route_nodes) - 1) / total


def immediate_reversal_count(route_nodes: list[str]) -> int:
    """Count of ``A -> B -> A`` patterns where A != B."""
    if len(route_nodes) < 3:
        return 0
    return sum(
        1
        for i in range(len(route_nodes) - 2)
        if route_nodes[i] == route_nodes[i + 2] and route_nodes[i] != route_nodes[i + 1]
    )


def null_deadhead_cycle_count(
    route_nodes: list[str], G: nx.MultiGraph | nx.MultiDiGraph
) -> int:
    """Count closed loops made *entirely* of deadhead/bridge transitions.

    A "deadhead transition" here is a (u, v) pair in ``route_nodes`` that is
    NOT an edge of the original required graph ``G`` — i.e. a CPP augmentation
    or component bridge.  When a contiguous run of such transitions returns
    to a node it already visited, the vehicle has gone in a circle covering
    no required edge.  This is the "bow-tie" pattern.

    We scan for runs of consecutive deadhead transitions and report how many
    of those runs revisit any node within the run.  Each run is counted once.
    """
    if len(route_nodes) < 3 or G.number_of_edges() == 0:
        return 0

    directed = G.is_directed()
    required: set[tuple[str, str]] = {_canon(u, v, directed) for u, v in G.edges()}

    cycles = 0
    run_nodes: list[str] = []  # nodes visited within current deadhead run
    in_run = False

    for i in range(len(route_nodes) - 1):
        u, v = route_nodes[i], route_nodes[i + 1]
        is_deadhead = _canon(u, v, directed) not in required

        if is_deadhead:
            if not in_run:
                run_nodes = [u]
                in_run = True
            run_nodes.append(v)
        else:
            if in_run:
                if len(set(run_nodes)) < len(run_nodes):
                    cycles += 1
                run_nodes = []
                in_run = False

    if in_run and len(set(run_nodes)) < len(run_nodes):
        cycles += 1

    return cycles


def deadhead_distance_ratio(
    route_nodes: list[str],
    G: nx.MultiGraph | nx.MultiDiGraph,
    length_attr: str = "length_km",
) -> float:
    """Fraction of total route distance spent on deadhead/bridge transitions.

    Uses the shortest available edge in ``G`` for required transitions; falls
    back to the straight-line node-coordinate distance for transitions with
    no edge in ``G`` (component bridges).  When neither is available the
    transition contributes 0 distance and the ratio is undefined → returns 0.0.
    """
    if len(route_nodes) < 2:
        return 0.0

    directed = G.is_directed()
    required: set[tuple[str, str]] = {_canon(u, v, directed) for u, v in G.edges()}

    total = 0.0
    deadhead = 0.0
    seen_required: Counter[tuple[str, str]] = Counter()

    for i in range(len(route_nodes) - 1):
        u, v = route_nodes[i], route_nodes[i + 1]
        canon = _canon(u, v, directed)
        edge_data = G.get_edge_data(u, v) or G.get_edge_data(v, u)

        if edge_data:
            length = min(d.get(length_attr, 0.0) for d in edge_data.values())
        else:
            length = _node_chord_km(G, u, v)

        total += length
        if canon not in required:
            deadhead += length
        else:
            seen_required[canon] += 1
            if seen_required[canon] > 1:
                deadhead += length

    if total <= 0:
        return 0.0
    return deadhead / total


# ---------------------------------------------------------------------------
# Composite + assertion
# ---------------------------------------------------------------------------


def compute_route_metrics(
    route_nodes: list[str],
    G: nx.MultiGraph | nx.MultiDiGraph,
    length_attr: str = "length_km",
) -> RouteMetrics:
    """Compute all metrics for a single route in one pass."""
    directed = G.is_directed()
    required: set[tuple[str, str]] = {_canon(u, v, directed) for u, v in G.edges()}
    seen: set[tuple[str, str]] = set()
    for i in range(len(route_nodes) - 1):
        pair = _canon(route_nodes[i], route_nodes[i + 1], directed)
        if pair in required:
            seen.add(pair)

    edges_in_graph = G.number_of_edges()
    total_hops = max(0, len(route_nodes) - 1)
    coverage = (len(seen) / edges_in_graph) if edges_in_graph else 1.0
    repeat = (total_hops / edges_in_graph) if edges_in_graph else 0.0

    return RouteMetrics(
        total_hops=total_hops,
        unique_required_edges=len(seen),
        edges_in_graph=edges_in_graph,
        coverage=coverage,
        edge_repeat_ratio=repeat,
        immediate_reversals=immediate_reversal_count(route_nodes),
        null_deadhead_cycles=null_deadhead_cycle_count(route_nodes, G),
        deadhead_distance_ratio=deadhead_distance_ratio(route_nodes, G, length_attr),
    )


def assert_route_quality(
    route_nodes: list[str],
    G: nx.MultiGraph | nx.MultiDiGraph,
    *,
    min_coverage: float = 1.0,
    max_repeat_ratio: float = 1.5,
    max_reversals_per_odd_pair: int = 3,
    max_null_cycles: int = 0,
    max_deadhead_ratio: float = 0.5,
    length_attr: str = "length_km",
) -> RouteMetrics:
    """Raise ``AssertionError`` on any quality regression.

    Defaults are chosen to be loose enough not to fail on legitimate CPP
    solutions but tight enough to catch the drunken-walk regressions that
    previously required visual inspection.

    Returns the computed metrics so callers can also log / inspect them.
    """
    m = compute_route_metrics(route_nodes, G, length_attr=length_attr)

    odd_count = sum(
        1 for n in G.nodes() if (G.in_degree(n) + G.out_degree(n)) % 2 != 0
    ) if G.is_directed() else sum(1 for n in G.nodes() if G.degree(n) % 2 != 0)
    reversal_budget = max(odd_count // 2 * max_reversals_per_odd_pair, max_reversals_per_odd_pair)

    assert m.coverage >= min_coverage, (
        f"coverage {m.coverage:.3f} < {min_coverage}: "
        f"{m.unique_required_edges}/{m.edges_in_graph} edges traversed"
    )
    assert m.edge_repeat_ratio <= max_repeat_ratio, (
        f"edge_repeat_ratio {m.edge_repeat_ratio:.3f} > {max_repeat_ratio}: "
        f"{m.total_hops} hops for {m.edges_in_graph} edges (drunken walk)"
    )
    assert m.immediate_reversals <= reversal_budget, (
        f"immediate_reversals {m.immediate_reversals} > budget {reversal_budget} "
        f"({odd_count} odd-degree nodes)"
    )
    assert m.null_deadhead_cycles <= max_null_cycles, (
        f"null_deadhead_cycles {m.null_deadhead_cycles} > {max_null_cycles}: "
        "route contains a closed deadhead loop covering no required edge"
    )
    assert m.deadhead_distance_ratio <= max_deadhead_ratio, (
        f"deadhead_distance_ratio {m.deadhead_distance_ratio:.3f} > {max_deadhead_ratio}: "
        "more than half the distance is wasted traversal"
    )
    return m


# ---------------------------------------------------------------------------
# Geometry helper
# ---------------------------------------------------------------------------


def _node_chord_km(G: nx.MultiGraph | nx.MultiDiGraph, u: str, v: str) -> float:
    """Straight-line haversine distance between two graph nodes in km.

    Returns 0.0 when either node lacks lat/lon data (e.g. synthetic test
    graphs).  Used as the distance for component-bridge transitions that
    have no backing edge in ``G``.
    """
    if u not in G.nodes or v not in G.nodes:
        return 0.0
    nu, nv = G.nodes[u], G.nodes[v]
    try:
        lat1 = float(nu["lat"]); lon1 = float(nu["lon"])
        lat2 = float(nv["lat"]); lon2 = float(nv["lon"])
    except (KeyError, TypeError, ValueError):
        return 0.0
    from math import radians, sin, cos, asin, sqrt
    R = 6371.0088
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * R * asin(sqrt(a))
