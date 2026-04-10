"""
Tests for infinite-loop termination guards added to the route optimizer.

Each test verifies that the algorithm terminates (within a timeout) and
either returns a valid result or raises a clear error — never hangs.
"""

import networkx as nx
import pytest

from app.hierholzer import eulerian_circuit_nx
from app.optimize import (
    _build_graph,
    _clip_line_to_bbox,
    _detect_loop_pattern,
    _dijkstra_with_transition_costs,
    _remove_immediate_reversals,
    _solve_cpp,
)
from app.geojson_ops import GeoJSONFeature


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_line_feature(coords, *, oneway=None, name="test"):
    """Create a minimal GeoJSONFeature from a coordinate list."""
    props = {"name": name}
    if oneway is not None:
        props["oneway"] = oneway
    return GeoJSONFeature(
        type="Feature",
        geometry={"type": "LineString", "coordinates": coords},
        properties=props,
    )


def _simple_eulerian_graph():
    """Return a small undirected Eulerian graph (all degrees even)."""
    G = nx.MultiGraph()
    for n in ("A", "B", "C"):
        G.add_node(n, lon=0.0, lat=0.0)
    G.add_edge("A", "B", key=0, length_km=1.0, coords=[[0, 0], [1, 0]])
    G.add_edge("B", "C", key=1, length_km=1.0, coords=[[1, 0], [2, 0]])
    G.add_edge("C", "A", key=2, length_km=1.0, coords=[[2, 0], [0, 0]])
    return G


# ---------------------------------------------------------------------------
# Hierholzer termination
# ---------------------------------------------------------------------------

class TestHierholzerTermination:
    def test_simple_eulerian(self):
        G = _simple_eulerian_graph()
        circuit = eulerian_circuit_nx(G)
        assert len(circuit) == 3
        nodes = [circuit[0][0]] + [e[1] for e in circuit]
        assert nodes[0] == nodes[-1], "circuit should be closed"

    def test_single_node_no_edges(self):
        G = nx.MultiGraph()
        G.add_node("X")
        circuit = eulerian_circuit_nx(G)
        assert circuit == []

    def test_empty_graph_raises(self):
        G = nx.MultiGraph()
        with pytest.raises(nx.NetworkXError):
            eulerian_circuit_nx(G)

    def test_non_eulerian_terminates(self):
        """A non-Eulerian graph should still terminate (partial circuit)."""
        G = nx.MultiGraph()
        for n in ("A", "B", "C", "D"):
            G.add_node(n, lon=0.0, lat=0.0)
        G.add_edge("A", "B", key=0, length_km=1.0, coords=[[0, 0], [1, 0]])
        G.add_edge("B", "C", key=1, length_km=1.0, coords=[[1, 0], [2, 0]])
        G.add_edge("C", "D", key=2, length_km=1.0, coords=[[2, 0], [3, 0]])
        # Degrees: A=1, B=2, C=2, D=1 — not Eulerian
        circuit = eulerian_circuit_nx(G)
        assert isinstance(circuit, list)

    def test_directed_eulerian(self):
        G = nx.MultiDiGraph()
        for n in ("A", "B", "C"):
            G.add_node(n, lon=0.0, lat=0.0)
        G.add_edge("A", "B", key=0, length_km=1.0, coords=[[0, 0], [1, 0]])
        G.add_edge("B", "C", key=1, length_km=1.0, coords=[[1, 0], [2, 0]])
        G.add_edge("C", "A", key=2, length_km=1.0, coords=[[2, 0], [0, 0]])
        circuit = eulerian_circuit_nx(G)
        assert len(circuit) == 3


# ---------------------------------------------------------------------------
# Dijkstra termination
# ---------------------------------------------------------------------------

class TestDijkstraTermination:
    def test_disconnected_graph_terminates(self):
        """Dijkstra on a disconnected graph should return partial results."""
        G = nx.MultiGraph()
        G.add_node("A", lon=0.0, lat=0.0)
        G.add_node("B", lon=1.0, lat=0.0)
        G.add_node("C", lon=2.0, lat=0.0)  # isolated
        G.add_edge("A", "B", key=0, length_km=1.0)
        lengths, paths = _dijkstra_with_transition_costs(G, "A", [])
        assert "A" in lengths
        assert "B" in lengths
        assert "C" not in lengths  # unreachable

    def test_single_node_terminates(self):
        G = nx.MultiGraph()
        G.add_node("X", lon=0.0, lat=0.0)
        lengths, paths = _dijkstra_with_transition_costs(G, "X", [])
        assert lengths == {"X": 0.0}


# ---------------------------------------------------------------------------
# Reversal removal termination
# ---------------------------------------------------------------------------

class TestReversalRemovalTermination:
    def test_no_reversals(self):
        route = ["A", "B", "C", "D"]
        result = _remove_immediate_reversals(route)
        assert result == ["A", "B", "C", "D"]

    def test_simple_reversal(self):
        route = ["A", "B", "A", "C"]
        result = _remove_immediate_reversals(route)
        # A->B->A reversal should be removed
        assert "B" not in result or result.count("A") <= 2

    def test_deeply_nested_reversals(self):
        """Many nested reversals should still terminate quickly."""
        # Build a route with 200 nested A->B->A patterns
        route = []
        for _ in range(200):
            route.extend(["A", "B", "A"])
        route.append("C")
        result = _remove_immediate_reversals(route)
        assert isinstance(result, list)
        assert len(result) <= len(route)

    def test_empty_route(self):
        assert _remove_immediate_reversals([]) == []

    def test_short_route(self):
        assert _remove_immediate_reversals(["A"]) == ["A"]
        assert _remove_immediate_reversals(["A", "B"]) == ["A", "B"]


# ---------------------------------------------------------------------------
# Loop pattern detection
# ---------------------------------------------------------------------------

class TestLoopDetection:
    def test_no_loop(self):
        assert _detect_loop_pattern(["A", "B", "C", "D"]) is False

    def test_obvious_loop(self):
        route = ["A", "B", "A", "C", "A"]
        assert _detect_loop_pattern(route) is True

    def test_repeated_sequence(self):
        route = ["A", "B", "C", "A", "B", "C"]
        assert _detect_loop_pattern(route) is True

    def test_large_route_terminates(self):
        """O(n) detection should handle 50k nodes without hanging."""
        route = [str(i) for i in range(50_000)]
        result = _detect_loop_pattern(route)
        assert result is False  # all unique

    def test_short_route(self):
        assert _detect_loop_pattern([]) is False
        assert _detect_loop_pattern(["A"]) is False
        assert _detect_loop_pattern(["A", "B"]) is False


# ---------------------------------------------------------------------------
# Self-loop filtering in _build_graph
# ---------------------------------------------------------------------------

class TestSelfLoopFiltering:
    def test_self_loop_filtered_undirected(self):
        """A segment whose start == end should be dropped."""
        # Create a feature where start and end round to the same node ID
        feat = _make_line_feature([[0.0, 0.0], [0.00001, 0.00001], [0.0, 0.0]])
        G = _build_graph([feat], oneway_mode="ignore")
        # Should have no self-loops
        for u, v, _ in G.edges(keys=True):
            assert u != v, f"Self-loop found: {u} -> {v}"

    def test_self_loop_filtered_directed(self):
        feat = _make_line_feature(
            [[0.0, 0.0], [0.00001, 0.00001], [0.0, 0.0]],
            oneway="yes",
        )
        G = _build_graph([feat], oneway_mode="respect")
        for u, v, _ in G.edges(keys=True):
            assert u != v, f"Self-loop found: {u} -> {v}"


# ---------------------------------------------------------------------------
# Greedy fallback termination
# ---------------------------------------------------------------------------

class TestGreedyFallbackTermination:
    def test_disconnected_graph_terminates(self):
        """_solve_cpp with disconnected components should terminate."""
        G = nx.MultiGraph()
        # Component 1
        G.add_node("A", lon=0.0, lat=0.0)
        G.add_node("B", lon=1.0, lat=0.0)
        G.add_edge("A", "B", key=0, length_km=1.0,
                    coords=[[0, 0], [1, 0]], feature_idx=0, road_class="residential",
                    name="Road 1", osm_id=1, dual_carriageway=False)
        # Component 2
        G.add_node("C", lon=5.0, lat=0.0)
        G.add_node("D", lon=6.0, lat=0.0)
        G.add_edge("C", "D", key=1, length_km=1.0,
                    coords=[[5, 0], [6, 0]], feature_idx=1, road_class="residential",
                    name="Road 2", osm_id=2, dual_carriageway=False)

        route = _solve_cpp(G)
        assert isinstance(route, list)
        assert len(route) > 0

    def test_single_edge_terminates(self):
        G = nx.MultiGraph()
        G.add_node("A", lon=0.0, lat=0.0)
        G.add_node("B", lon=1.0, lat=0.0)
        G.add_edge("A", "B", key=0, length_km=1.0,
                    coords=[[0, 0], [1, 0]], feature_idx=0, road_class="residential",
                    name="Road", osm_id=1, dual_carriageway=False)
        route = _solve_cpp(G)
        assert isinstance(route, list)

    def test_empty_graph(self):
        G = nx.MultiGraph()
        route = _solve_cpp(G)
        assert route == []


# ---------------------------------------------------------------------------
# Cohen-Sutherland clip termination
# ---------------------------------------------------------------------------

class TestClipLineToBbox:
    def test_fully_inside(self):
        coords = [[1.0, 1.0], [2.0, 2.0]]
        bbox = (0.0, 0.0, 3.0, 3.0)
        result = _clip_line_to_bbox(coords, bbox)
        assert result == coords

    def test_fully_outside(self):
        coords = [[10.0, 10.0], [11.0, 11.0]]
        bbox = (0.0, 0.0, 3.0, 3.0)
        result = _clip_line_to_bbox(coords, bbox)
        assert result == []

    def test_crossing_clip(self):
        """Line from outside to inside should be clipped."""
        coords = [[-1.0, 1.5], [1.5, 1.5]]
        bbox = (0.0, 0.0, 3.0, 3.0)
        result = _clip_line_to_bbox(coords, bbox)
        assert len(result) == 2
        # Clipped x0 should be at min_lon=0.0
        assert abs(result[0][0] - 0.0) < 1e-9

    def test_corner_grazing_terminates(self):
        """Line passing infinitesimally close to a corner should not hang."""
        # Deliberately crafted to provoke float truncation near (0,0) corner
        eps = 1e-15
        coords = [[-eps, -eps], [eps, eps]]
        bbox = (0.0, 0.0, 1.0, 1.0)
        result = _clip_line_to_bbox(coords, bbox)
        # Should terminate — either clipped or rejected
        assert isinstance(result, list)

    def test_diagonal_through_corner_terminates(self):
        """Diagonal line through exact corner — classic ping-pong trigger."""
        coords = [[-1.0, -1.0], [1.0, 1.0]]
        bbox = (0.0, 0.0, 2.0, 2.0)
        result = _clip_line_to_bbox(coords, bbox)
        assert isinstance(result, list)
        if result:
            assert len(result) == 2

    def test_single_point(self):
        result = _clip_line_to_bbox([[1.0, 1.0]], (0.0, 0.0, 2.0, 2.0))
        assert result == [[1.0, 1.0]]


# ---------------------------------------------------------------------------
# Dijkstra state-based relaxation
# ---------------------------------------------------------------------------

class TestDijkstraStateRelaxation:
    def test_different_predecessors_explored(self):
        """Paths via different predecessors should be explored even if
        one is slightly longer, because transitions may differ."""
        G = nx.MultiGraph()
        # Diamond: S -> A -> D (direct, short)
        #          S -> B -> D (longer, but may have better transitions)
        for n in ("S", "A", "B", "D"):
            G.add_node(n, lon=0.0, lat=0.0)
        G.add_edge("S", "A", key=0, length_km=1.0)
        G.add_edge("S", "B", key=1, length_km=1.5)
        G.add_edge("A", "D", key=2, length_km=1.0)
        G.add_edge("B", "D", key=3, length_km=0.5)

        lengths, paths = _dijkstra_with_transition_costs(G, "S", [])
        assert "D" in lengths
        # Without plugins, shortest path is S->A->D (2.0) vs S->B->D (2.0)
        assert lengths["D"] == pytest.approx(2.0)

    def test_unreachable_node_not_in_lengths(self):
        G = nx.MultiGraph()
        G.add_node("A", lon=0.0, lat=0.0)
        G.add_node("B", lon=1.0, lat=0.0)
        G.add_node("Z", lon=99.0, lat=99.0)  # isolated
        G.add_edge("A", "B", key=0, length_km=1.0)
        lengths, paths = _dijkstra_with_transition_costs(G, "A", [])
        assert "Z" not in lengths
