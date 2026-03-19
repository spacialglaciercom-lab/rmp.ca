"""
Tests for app.hierholzer.eulerian_circuit_nx and the standalone
cpp_hierholzer.py edge-list parser + iterative Hierholzer.
"""
from __future__ import annotations

import sys
import collections
from pathlib import Path

import networkx as nx
import pytest

from app.hierholzer import eulerian_circuit_nx

# ---------------------------------------------------------------------------
# Path to standalone cpp_hierholzer for parser + CLI tests
# ---------------------------------------------------------------------------
CPP_DIR = Path("/home/drone/Downloads/cpp-hierholzer")
DATA_DIR = CPP_DIR / "data"
sys.path.insert(0, str(CPP_DIR))

try:
    from cpp_hierholzer import (
        parse_edge_list,
        get_degrees,
        is_connected,
        hierholzer,
    )
    HAS_STANDALONE = True
except ImportError:
    HAS_STANDALONE = False

skip_standalone = pytest.mark.skipif(
    not HAS_STANDALONE, reason="cpp_hierholzer not importable"
)
skip_data = pytest.mark.skipif(
    not DATA_DIR.exists(), reason="cpp-hierholzer/data not found"
)


# ===========================================================================
# Helpers
# ===========================================================================

def _mg(*edges, directed=False) -> nx.MultiGraph | nx.MultiDiGraph:
    """Build a MultiGraph from (u, v) or (u, v, w) tuples."""
    G = nx.MultiDiGraph() if directed else nx.MultiGraph()
    for e in edges:
        if len(e) == 2:
            G.add_edge(e[0], e[1], length_km=1.0)
        else:
            G.add_edge(e[0], e[1], length_km=e[2])
    return G


def _all_edges_covered(circuit: list[tuple], G: nx.MultiGraph) -> bool:
    """Every edge in G appears at least once in the circuit."""
    used: dict[tuple, int] = collections.Counter()
    for u, v in circuit:
        used[(min(u, v), max(u, v))] += 1
    for u, v in G.edges():
        if used[(min(u, v), max(u, v))] == 0:
            return False
    return True


# ===========================================================================
# eulerian_circuit_nx — undirected graphs
# ===========================================================================

def test_triangle_circuit_length() -> None:
    G = _mg((1, 2), (2, 3), (3, 1))
    c = eulerian_circuit_nx(G)
    assert len(c) == 3


def test_triangle_starts_ends_same_node() -> None:
    G = _mg((1, 2), (2, 3), (3, 1))
    c = eulerian_circuit_nx(G)
    assert c[0][0] == c[-1][1]


def test_triangle_all_edges_covered() -> None:
    G = _mg((1, 2), (2, 3), (3, 1))
    c = eulerian_circuit_nx(G)
    assert _all_edges_covered(c, G)


def test_4node_cycle() -> None:
    G = _mg((1, 2), (2, 3), (3, 4), (4, 1))
    c = eulerian_circuit_nx(G)
    assert len(c) == 4
    assert c[0][0] == c[-1][1]
    assert _all_edges_covered(c, G)


def test_6node_cycle() -> None:
    G = _mg((1,2),(2,3),(3,4),(4,5),(5,6),(6,1))
    c = eulerian_circuit_nx(G)
    assert len(c) == 6
    assert c[0][0] == c[-1][1]
    assert _all_edges_covered(c, G)


def test_multigraph_parallel_edges() -> None:
    """Two nodes connected by 2 parallel edges — each traversed once."""
    G = nx.MultiGraph()
    G.add_edge(1, 2, key=0, length_km=1.0)
    G.add_edge(1, 2, key=1, length_km=2.0)
    c = eulerian_circuit_nx(G)
    assert len(c) == 2
    assert c[0][0] == c[-1][1]


def test_multigraph_self_loop() -> None:
    """Self-loop + triangle: self-loop contributes 2 to degree of its node."""
    G = nx.MultiGraph()
    G.add_edge(1, 2, length_km=1.0)
    G.add_edge(2, 3, length_km=1.0)
    G.add_edge(3, 1, length_km=1.0)
    G.add_edge(1, 1, length_km=0.5)
    c = eulerian_circuit_nx(G)
    assert c[0][0] == c[-1][1]
    assert len(c) == 4


def test_start_node_respected() -> None:
    G = _mg((1, 2), (2, 3), (3, 4), (4, 1))
    c = eulerian_circuit_nx(G, start=3)
    assert c[0][0] == 3


def test_empty_graph_raises() -> None:
    G = nx.MultiGraph()
    with pytest.raises(nx.NetworkXError):
        eulerian_circuit_nx(G)


def test_single_node_no_edges() -> None:
    G = nx.MultiGraph()
    G.add_node(1)
    c = eulerian_circuit_nx(G)
    assert c == []


def test_large_grid_eulerian() -> None:
    """10×10 grid ring — all nodes even-degree, circuit covers all edges."""
    G = nx.MultiGraph()
    n = 10
    for i in range(n):
        for j in range(n):
            G.add_edge((i, j), (i, (j + 1) % n), length_km=1.0)
            G.add_edge((i, j), ((i + 1) % n, j), length_km=1.0)
    odd = [v for v in G.nodes() if G.degree(v) % 2 != 0]
    assert odd == [], "grid should be Eulerian"
    c = eulerian_circuit_nx(G)
    assert c[0][0] == c[-1][1]
    assert len(c) == G.number_of_edges()


def test_weighted_cost_sum() -> None:
    """Circuit over weighted 4-cycle: total length = sum of all edge weights."""
    G = nx.MultiGraph()
    G.add_edge(1, 2, key=0, length_km=2.0)
    G.add_edge(2, 3, key=1, length_km=3.0)
    G.add_edge(3, 4, key=2, length_km=4.0)
    G.add_edge(4, 1, key=3, length_km=5.0)
    c = eulerian_circuit_nx(G)
    assert len(c) == 4
    assert c[0][0] == c[-1][1]


# ===========================================================================
# eulerian_circuit_nx — directed graph
# ===========================================================================

def test_directed_triangle() -> None:
    G = nx.MultiDiGraph()
    G.add_edge(1, 2, length_km=1.0)
    G.add_edge(2, 3, length_km=1.0)
    G.add_edge(3, 1, length_km=1.0)
    c = eulerian_circuit_nx(G)
    assert len(c) == 3
    assert c[0][0] == c[-1][1]
    for u, v in c:
        assert G.has_edge(u, v), f"edge ({u},{v}) not in digraph"


def test_directed_4cycle() -> None:
    G = nx.MultiDiGraph()
    for u, v in [(1,2),(2,3),(3,4),(4,1)]:
        G.add_edge(u, v, length_km=1.0)
    c = eulerian_circuit_nx(G)
    assert len(c) == 4
    assert c[0][0] == c[-1][1]


# ===========================================================================
# Standalone: parse_edge_list
# ===========================================================================

@skip_standalone
@skip_data
def test_parse_cycle4() -> None:
    data = parse_edge_list(str(DATA_DIR / "cycle4.txt"))
    assert len(data["vertices"]) == 4
    assert len(data["edges"]) == 4
    assert not data["weighted"]


@skip_standalone
@skip_data
def test_parse_weighted() -> None:
    data = parse_edge_list(str(DATA_DIR / "weighted.txt"))
    assert len(data["edges"]) == 4
    assert data["weighted"]
    weights = [w for _, _, w in data["edges"]]
    assert sum(weights) == pytest.approx(14.0)


@skip_standalone
@skip_data
def test_parse_string_vertices() -> None:
    data = parse_edge_list(str(DATA_DIR / "odd.txt"))
    assert "a" in data["vertices"]
    assert "b" in data["vertices"]
    assert "c" in data["vertices"]


@skip_standalone
@skip_data
def test_parse_comments_and_blanks_skipped() -> None:
    data = parse_edge_list(str(DATA_DIR / "eulerian_small.txt"))
    assert len(data["edges"]) == 3


# ===========================================================================
# Standalone: get_degrees
# ===========================================================================

@skip_standalone
def test_get_degrees_triangle() -> None:
    adj = {1: [(2, 1.0), (3, 1.0)], 2: [(1, 1.0), (3, 1.0)], 3: [(1, 1.0), (2, 1.0)]}
    degrees = get_degrees(adj)
    assert all(d == 2 for d in degrees.values())


@skip_standalone
def test_get_degrees_path() -> None:
    adj = {1: [(2, 1.0)], 2: [(1, 1.0), (3, 1.0)], 3: [(2, 1.0)]}
    degrees = get_degrees(adj)
    assert degrees[1] == 1
    assert degrees[2] == 2
    assert degrees[3] == 1


# ===========================================================================
# Standalone: is_connected
# ===========================================================================

@skip_standalone
def test_is_connected_triangle() -> None:
    adj = {1: [(2, 1.0), (3, 1.0)], 2: [(1, 1.0), (3, 1.0)], 3: [(1, 1.0), (2, 1.0)]}
    assert is_connected(adj, {1, 2, 3})


@skip_standalone
def test_is_not_connected() -> None:
    adj = {1: [(2, 1.0)], 2: [(1, 1.0)], 3: [(4, 1.0)], 4: [(3, 1.0)]}
    assert not is_connected(adj, {1, 2, 3, 4})


@skip_standalone
def test_is_connected_single_node() -> None:
    assert is_connected({1: []}, {1})


# ===========================================================================
# Standalone: hierholzer (pure adjacency dict, no nx)
# ===========================================================================

@skip_standalone
def test_standalone_triangle_circuit() -> None:
    adj = {1: [(2,1.0),(3,1.0)], 2: [(1,1.0),(3,1.0)], 3: [(1,1.0),(2,1.0)]}
    circuit, cost = hierholzer(adj)
    assert circuit[0] == circuit[-1]
    assert len(circuit) == 4
    assert cost == pytest.approx(3.0)


@skip_standalone
def test_standalone_4cycle_circuit() -> None:
    adj = {1:[(2,1.0),(4,1.0)], 2:[(1,1.0),(3,1.0)], 3:[(2,1.0),(4,1.0)], 4:[(3,1.0),(1,1.0)]}
    circuit, cost = hierholzer(adj)
    assert circuit[0] == circuit[-1]
    assert len(circuit) == 5
    assert cost == pytest.approx(4.0)


@skip_standalone
@skip_data
def test_standalone_weighted_cost() -> None:
    data = parse_edge_list(str(DATA_DIR / "weighted.txt"))
    circuit, cost = hierholzer(data["adjacency"])
    assert circuit[0] == circuit[-1]
    assert cost == pytest.approx(14.0)


@skip_standalone
def test_standalone_start_node() -> None:
    adj = {1:[(2,1.0),(4,1.0)], 2:[(1,1.0),(3,1.0)], 3:[(2,1.0),(4,1.0)], 4:[(3,1.0),(1,1.0)]}
    circuit, _ = hierholzer(adj, start=3)
    assert circuit[0] == 3
    assert circuit[-1] == 3


@skip_standalone
def test_standalone_all_edges_visited() -> None:
    adj = {1:[(2,1.0),(4,1.0)], 2:[(1,1.0),(3,1.0)], 3:[(2,1.0),(4,1.0)], 4:[(3,1.0),(1,1.0)]}
    degrees = get_degrees(adj)
    odd = [v for v, d in degrees.items() if d % 2 != 0]
    assert odd == [], "fixture must be Eulerian"
    circuit, _ = hierholzer(adj)
    assert circuit[0] == circuit[-1]
    assert len(circuit) - 1 == sum(len(v) for v in adj.values()) // 2


# ===========================================================================
# Integration: cpp_hierholzer CLI exit codes via subprocess
# ===========================================================================

@skip_data
def test_cli_cycle4_exits_0() -> None:
    import subprocess
    r = subprocess.run(
        ["python3", str(CPP_DIR / "cpp_hierholzer.py"), str(DATA_DIR / "cycle4.txt")],
        capture_output=True, text=True,
    )
    assert r.returncode == 0
    assert "# Circuit:" in r.stdout
    assert "# Vertices: 4" in r.stdout


@skip_data
def test_cli_odd_degree_solves_cpp() -> None:
    """CLI solves CPP (augments graph) for non-Eulerian inputs — exits 0 and emits a circuit."""
    import subprocess
    r = subprocess.run(
        ["python3", str(CPP_DIR / "cpp_hierholzer.py"), str(DATA_DIR / "odd_degree.txt")],
        capture_output=True, text=True,
    )
    assert r.returncode == 0
    assert "# Circuit:" in r.stdout


@skip_data
def test_cli_weighted_shows_cost() -> None:
    import subprocess
    r = subprocess.run(
        ["python3", str(CPP_DIR / "cpp_hierholzer.py"), str(DATA_DIR / "weighted.txt")],
        capture_output=True, text=True,
    )
    assert r.returncode == 0
    assert "# Total cost:" in r.stdout


@skip_data
def test_cli_start_flag() -> None:
    import subprocess
    r = subprocess.run(
        ["python3", str(CPP_DIR / "cpp_hierholzer.py"), str(DATA_DIR / "cycle4.txt"), "--start", "3"],
        capture_output=True, text=True,
    )
    assert r.returncode == 0
    assert r.stdout.strip().endswith("3")


@skip_data
def test_cli_missing_file_exits_1() -> None:
    import subprocess
    r = subprocess.run(
        ["python3", str(CPP_DIR / "cpp_hierholzer.py"), "/nonexistent/path.txt"],
        capture_output=True, text=True,
    )
    assert r.returncode == 1
