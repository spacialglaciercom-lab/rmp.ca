"""
Tests for app.route_metrics — the geometric/topological route quality
checks that replace manual visual inspection of Chinese-Postman circuits.

Two layers:

1. **Unit tests** for each metric on tiny synthetic graphs, exercising the
   edge cases (perfect Eulerian, drunken walk, null deadhead loop, immediate
   reversal patterns).
2. **Snapshot / invariant tests** that run ``_solve_cpp`` on a small set of
   canonical graphs (triangle, 4x4 grid, dead-end spike, disconnected pair,
   square-with-tail) and assert the quality budget holds.  A regression that
   makes a route "loopy" will trip these without anyone needing to plot it.
"""
from __future__ import annotations

import json
from pathlib import Path

import networkx as nx
import pytest

from app.optimize import _solve_cpp
from app.route_metrics import (
    RouteMetrics,
    assert_route_quality,
    compute_route_metrics,
    coverage_fraction,
    deadhead_distance_ratio,
    edge_repeat_ratio,
    immediate_reversal_count,
    null_deadhead_cycle_count,
)


SNAPSHOT_DIR = Path(__file__).parent / "snapshots"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mg(*edges: tuple, directed: bool = False) -> nx.MultiGraph | nx.MultiDiGraph:
    """Build a MultiGraph; each edge tuple is (u, v) or (u, v, length_km)."""
    G: nx.MultiGraph | nx.MultiDiGraph = nx.MultiDiGraph() if directed else nx.MultiGraph()
    for e in edges:
        if len(e) == 2:
            G.add_edge(e[0], e[1], length_km=1.0)
        else:
            G.add_edge(e[0], e[1], length_km=float(e[2]))
    return G


# ===========================================================================
# §1  Unit tests — coverage_fraction
# ===========================================================================


def test_coverage_perfect_triangle() -> None:
    G = _mg((1, 2), (2, 3), (3, 1))
    route = [1, 2, 3, 1]
    assert coverage_fraction(route, G) == 1.0


def test_coverage_misses_edge() -> None:
    G = _mg((1, 2), (2, 3), (3, 1))
    route = [1, 2, 1]  # only uses 1-2
    assert coverage_fraction(route, G) == pytest.approx(1 / 3)


def test_coverage_empty_graph() -> None:
    G = _mg()
    assert coverage_fraction([], G) == 1.0


# ===========================================================================
# §2  Unit tests — edge_repeat_ratio
# ===========================================================================


def test_repeat_ratio_perfect_eulerian() -> None:
    G = _mg((1, 2), (2, 3), (3, 1))
    route = [1, 2, 3, 1]
    assert edge_repeat_ratio(route, G) == 1.0


def test_repeat_ratio_drunken_walk() -> None:
    G = _mg((1, 2), (2, 3), (3, 1))
    # 6 hops over 3 edges = ratio 2.0 — should fail the default budget
    route = [1, 2, 3, 1, 2, 3, 1]
    assert edge_repeat_ratio(route, G) == 2.0


# ===========================================================================
# §3  Unit tests — immediate_reversal_count
# ===========================================================================


def test_reversal_zero_clean_circuit() -> None:
    assert immediate_reversal_count([1, 2, 3, 1]) == 0


def test_reversal_single_aba() -> None:
    assert immediate_reversal_count([1, 2, 1]) == 1


def test_reversal_multiple() -> None:
    # 1->2->1 and 3->4->3 — 2 patterns
    assert immediate_reversal_count([1, 2, 1, 3, 4, 3]) == 2


def test_reversal_aaa_not_counted() -> None:
    # A->A->A is not a reversal (middle equals neighbours)
    assert immediate_reversal_count([1, 1, 1]) == 0


def test_reversal_short_route() -> None:
    assert immediate_reversal_count([1, 2]) == 0


# ===========================================================================
# §4  Unit tests — null_deadhead_cycle_count
# ===========================================================================


def test_no_deadheads_no_cycles() -> None:
    G = _mg((1, 2), (2, 3), (3, 1))
    assert null_deadhead_cycle_count([1, 2, 3, 1], G) == 0


def test_null_deadhead_loop_detected() -> None:
    # Required graph: only 1-2.  Route adds a deadhead loop 2 -> 4 -> 5 -> 2.
    G = _mg((1, 2))
    route = [1, 2, 4, 5, 2]
    assert null_deadhead_cycle_count(route, G) == 1


def test_deadhead_run_without_revisit_ok() -> None:
    # Required: 1-2 and 5-6.  Bridge 2->3->4->5 (no revisit) is fine.
    G = _mg((1, 2), (5, 6))
    route = [1, 2, 3, 4, 5, 6]
    assert null_deadhead_cycle_count(route, G) == 0


# ===========================================================================
# §5  Unit tests — deadhead_distance_ratio
# ===========================================================================


def test_deadhead_ratio_zero_when_perfect() -> None:
    G = _mg((1, 2, 1.0), (2, 3, 1.0), (3, 1, 1.0))
    assert deadhead_distance_ratio([1, 2, 3, 1], G) == 0.0


def test_deadhead_ratio_counts_repeats() -> None:
    # Each edge is 1km; route reuses 1-2, so 1 of 4 km is deadhead
    G = _mg((1, 2, 1.0), (2, 3, 1.0), (3, 1, 1.0))
    route = [1, 2, 1, 2, 3, 1]  # 5 hops, 1->2 used 2x, 2->1 used 2x
    ratio = deadhead_distance_ratio(route, G)
    # Required: {(1,2), (2,3), (1,3)}.  Hops: 1-2 (req,1st), 2-1 (req,2nd → dh),
    # 1-2 (req,3rd → dh), 2-3 (req,1st), 3-1 (req,1st).  total=5km, dh=2km.
    assert ratio == pytest.approx(0.4)


# ===========================================================================
# §6  compute_route_metrics composite
# ===========================================================================


def test_compute_route_metrics_shape() -> None:
    G = _mg((1, 2), (2, 3), (3, 1))
    m = compute_route_metrics([1, 2, 3, 1], G)
    assert isinstance(m, RouteMetrics)
    assert m.coverage == 1.0
    assert m.edge_repeat_ratio == 1.0
    assert m.immediate_reversals == 0
    assert m.null_deadhead_cycles == 0
    assert m.deadhead_distance_ratio == 0.0
    assert m.edges_in_graph == 3
    assert m.total_hops == 3


# ===========================================================================
# §7  assert_route_quality — fail loud
# ===========================================================================


def test_assert_quality_passes_on_good_route() -> None:
    G = _mg((1, 2), (2, 3), (3, 1))
    assert_route_quality([1, 2, 3, 1], G)


def test_assert_quality_rejects_drunken_walk() -> None:
    G = _mg((1, 2), (2, 3), (3, 1))
    with pytest.raises(AssertionError, match="edge_repeat_ratio"):
        assert_route_quality([1, 2, 3, 1, 2, 3, 1], G, max_repeat_ratio=1.5)


def test_assert_quality_rejects_missing_edge() -> None:
    G = _mg((1, 2), (2, 3), (3, 1))
    with pytest.raises(AssertionError, match="coverage"):
        assert_route_quality([1, 2, 1], G)


def test_assert_quality_rejects_null_deadhead() -> None:
    G = _mg((1, 2))
    # Loosen repeat-ratio so null_deadhead is the assertion that fires
    with pytest.raises(AssertionError, match="null_deadhead_cycles"):
        assert_route_quality([1, 2, 4, 5, 2], G, max_repeat_ratio=10.0)


# ===========================================================================
# §8  Integration — _solve_cpp on canonical graphs must satisfy quality budget
# ===========================================================================

# Each entry: (name, edges, expected_node_count). The tests below run
# _solve_cpp and assert the route satisfies the default quality budget.
CANONICAL_GRAPHS: list[tuple[str, list[tuple]]] = [
    ("triangle", [("a", "b"), ("b", "c"), ("c", "a")]),
    ("square", [("a", "b"), ("b", "c"), ("c", "d"), ("d", "a")]),
    ("square_with_diagonal",
        [("a", "b"), ("b", "c"), ("c", "d"), ("d", "a"), ("a", "c"), ("b", "d")]),
    ("dead_end_spike",
        [("a", "b"), ("b", "c"), ("c", "a"), ("c", "d")]),  # d is a dead-end
    ("4x4_grid",
        [
            # horizontal rungs
            ("00", "01"), ("01", "02"), ("02", "03"),
            ("10", "11"), ("11", "12"), ("12", "13"),
            ("20", "21"), ("21", "22"), ("22", "23"),
            ("30", "31"), ("31", "32"), ("32", "33"),
            # vertical rungs
            ("00", "10"), ("10", "20"), ("20", "30"),
            ("01", "11"), ("11", "21"), ("21", "31"),
            ("02", "12"), ("12", "22"), ("22", "32"),
            ("03", "13"), ("13", "23"), ("23", "33"),
        ]),
]


@pytest.mark.parametrize("name,edges", CANONICAL_GRAPHS, ids=[g[0] for g in CANONICAL_GRAPHS])
def test_solve_cpp_quality_budget(name: str, edges: list[tuple]) -> None:
    """``_solve_cpp`` output on each canonical graph must satisfy the budget."""
    G = _mg(*edges)
    route = _solve_cpp(G)
    assert route, f"_solve_cpp returned empty route for {name}"
    metrics = assert_route_quality(
        route, G,
        # Loose enough for a reasonable CPP solver; tight enough to flag
        # the drunken-walk / null-cycle regressions we previously caught
        # only by visual inspection.
        max_repeat_ratio=1.6,
        max_reversals_per_odd_pair=4,
        max_null_cycles=0,
        max_deadhead_ratio=0.5,
    )
    # Print on success too — useful when ratcheting budgets.
    print(f"\n{name}: {metrics}")


# ===========================================================================
# §9  Snapshot tests — record route topology for canonical graphs
# ===========================================================================


def _snapshot_path(name: str) -> Path:
    return SNAPSHOT_DIR / f"{name}.json"


@pytest.mark.parametrize("name,edges", CANONICAL_GRAPHS, ids=[g[0] for g in CANONICAL_GRAPHS])
def test_route_metrics_snapshot(name: str, edges: list[tuple]) -> None:
    """Lock in the metrics shape per canonical graph.

    Compares only the *structural* metrics (coverage, repeat ratio, reversals,
    null cycles, edge counts) — not the exact node ordering, which is allowed
    to differ across solver implementations as long as quality is preserved.

    To re-bless the snapshot after an intentional algorithm change:
        UPDATE_SNAPSHOTS=1 pytest backend/tests/test_route_metrics.py
    """
    import os

    G = _mg(*edges)
    route = _solve_cpp(G)
    metrics = compute_route_metrics(route, G)
    actual = {
        "edges_in_graph": metrics.edges_in_graph,
        "coverage": round(metrics.coverage, 4),
        "edge_repeat_ratio": round(metrics.edge_repeat_ratio, 4),
        "immediate_reversals": metrics.immediate_reversals,
        "null_deadhead_cycles": metrics.null_deadhead_cycles,
    }

    snap_path = _snapshot_path(name)
    if os.environ.get("UPDATE_SNAPSHOTS") == "1" or not snap_path.exists():
        snap_path.parent.mkdir(parents=True, exist_ok=True)
        snap_path.write_text(json.dumps(actual, indent=2, sort_keys=True) + "\n")
        return

    expected = json.loads(snap_path.read_text())
    assert actual == expected, (
        f"Route metrics changed for {name}.\n"
        f"  expected: {expected}\n"
        f"  actual:   {actual}\n"
        f"If intentional, re-run with UPDATE_SNAPSHOTS=1 to bless."
    )
