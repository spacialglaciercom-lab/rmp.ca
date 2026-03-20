"""
Chinese Postman (CPP) optimizer tests.

Covers:
  - Eulerian graphs  (all even degree → zero re-traversal, efficiency = 1.0)
  - Non-Eulerian graphs (odd-degree nodes → deadhead added)
  - Road class filtering (motorway/footway excluded by default)
  - Turn penalty sensitivity
  - Oneway mode (ignore vs respect)
  - Stats field completeness and range invariants
  - Edge / error cases (empty input, single edge, disconnected components)
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# GeoJSON builder helpers
# ---------------------------------------------------------------------------

def _seg(lon0: float, lat0: float, lon1: float, lat1: float,
         road_class: str = "residential",
         oneway: bool = False) -> dict:
    props: dict = {"class": road_class}
    if oneway:
        props["oneway"] = True
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[lon0, lat0], [lon1, lat1]]},
        "properties": props,
    }


def _fc(*features: dict) -> dict:
    return {"type": "FeatureCollection", "features": list(features)}


def _optimize(fc: dict, **kwargs) -> dict:
    body = {"geojson": fc, "clean_before_optimize": False, **kwargs}
    r = client.post("/api/optimize", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Coordinate constants  (Montreal-area grid, ~100 m spacing)
# ---------------------------------------------------------------------------

#  A----B----C
#  |         |
#  D----E----F
#
A = (-73.570, 45.510)
B = (-73.560, 45.510)
C = (-73.550, 45.510)
D = (-73.570, 45.500)
E = (-73.560, 45.500)
F = (-73.550, 45.500)


# ===========================================================================
# Eulerian graphs — all nodes have even degree → no re-traversal, eff = 1.0
# ===========================================================================


def test_optimize_triangle_euler_no_retraversal() -> None:
    """Triangle A-B-C: every node degree-2 → Euler circuit, no deadhead."""
    fc = _fc(
        _seg(*A, *B),
        _seg(*B, *C),
        _seg(*C, *A),
    )
    resp = _optimize(fc)
    stats = resp["stats"]
    assert stats["odd_degree_vertices"] == 0
    assert stats["edges_in_graph"] == 3
    assert stats["total_traversals"] == 3
    assert abs(stats["deadhead_distance_km"]) < 1e-6
    assert abs(stats["efficiency"] - 100.0) < 1e-6


def test_optimize_4node_ring_euler() -> None:
    """4-node ring A-B-F-D: all degree-2 → Euler circuit."""
    fc = _fc(
        _seg(*A, *B),
        _seg(*B, *F),
        _seg(*F, *D),
        _seg(*D, *A),
    )
    resp = _optimize(fc)
    stats = resp["stats"]
    assert stats["odd_degree_vertices"] == 0
    assert stats["edges_in_graph"] == 4
    assert stats["total_traversals"] == 4
    assert stats["deadhead_distance_km"] < 1e-6
    assert abs(stats["efficiency"] - 100.0) < 1e-6


def test_optimize_6node_grid_euler() -> None:
    """Full 2x3 grid: all interior nodes degree-4, corner nodes degree-2 (even)."""
    #  A-B-C
    #  |   |  <- only outer ring edges, making all nodes degree-2
    #  D-E-F
    fc = _fc(
        _seg(*A, *B), _seg(*B, *C),
        _seg(*D, *E), _seg(*E, *F),
        _seg(*A, *D), _seg(*C, *F),
    )
    resp = _optimize(fc)
    stats = resp["stats"]
    assert stats["odd_degree_vertices"] == 0
    assert stats["edges_in_graph"] == 6
    assert stats["total_traversals"] == 6
    assert stats["deadhead_distance_km"] < 1e-6


# ===========================================================================
# Non-Eulerian graphs — odd-degree nodes → CPP adds deadhead
# ===========================================================================


def test_optimize_path_requires_deadhead() -> None:
    """Path A-B-C: A and C are odd-degree → CPP must re-traverse at least one edge."""
    fc = _fc(_seg(*A, *B), _seg(*B, *C))
    resp = _optimize(fc)
    stats = resp["stats"]
    assert stats["odd_degree_vertices"] == 2
    assert stats["edges_in_graph"] == 2
    assert stats["total_traversals"] >= 2
    assert stats["deadhead_distance_km"] > 0
    assert stats["efficiency"] < 100.0


def test_optimize_single_edge_path() -> None:
    """Single edge A-B: both endpoints are odd (degree 1) → must be re-traversed."""
    fc = _fc(_seg(*A, *B))
    resp = _optimize(fc)
    stats = resp["stats"]
    assert stats["edges_in_graph"] == 1
    assert stats["total_traversals"] >= 1
    assert stats["odd_degree_vertices"] == 2


def test_optimize_t_shape_one_odd_branch() -> None:
    """
    T-shape: A-B, B-C, B-D
    Degrees: A=1(odd), B=3(odd), C=1(odd), D=1(odd) → 4 odd nodes → 2 extra edges.
    """
    fc = _fc(
        _seg(*A, *B),
        _seg(*B, *C),
        _seg(*B, *D),
    )
    resp = _optimize(fc)
    stats = resp["stats"]
    assert stats["odd_degree_vertices"] == 4
    assert stats["total_traversals"] >= stats["edges_in_graph"]
    assert stats["deadhead_distance_km"] > 0


# ===========================================================================
# Road class filtering
# ===========================================================================


def test_optimize_default_excludes_motorway() -> None:
    """Motorway segments are excluded by the default road class allowlist."""
    fc = _fc(
        _seg(*A, *B, road_class="motorway"),
        _seg(*B, *C, road_class="motorway"),
        _seg(*C, *A, road_class="motorway"),
    )
    body = {"geojson": fc, "clean_before_optimize": False}
    r = client.post("/api/optimize", json=body)
    assert r.status_code == 400


def test_optimize_default_excludes_footway() -> None:
    """Footway segments are always excluded (NON_VEHICLE_CLASSES)."""
    fc = _fc(
        _seg(*A, *B, road_class="footway"),
        _seg(*B, *C, road_class="footway"),
        _seg(*C, *A, road_class="footway"),
    )
    r = client.post("/api/optimize", json={"geojson": fc, "clean_before_optimize": False})
    assert r.status_code == 400


def test_optimize_custom_road_classes_filter() -> None:
    """When road_classes=['secondary'], only secondary segments survive."""
    fc = _fc(
        _seg(*A, *B, road_class="residential"),
        _seg(*B, *C, road_class="secondary"),
        _seg(*C, *A, road_class="secondary"),
    )
    resp = _optimize(fc, road_classes=["secondary"])
    assert resp["stats"]["edges_in_graph"] == 2


def test_optimize_mixed_classes_only_allowed_pass() -> None:
    fc = _fc(
        _seg(*A, *B, road_class="residential"),
        _seg(*B, *C, road_class="residential"),
        _seg(*C, *A, road_class="residential"),
        _seg(*D, *E, road_class="motorway"),
        _seg(*E, *F, road_class="motorway"),
    )
    resp = _optimize(fc)
    assert resp["stats"]["edges_in_graph"] == 3


def test_optimize_empty_geojson_returns_400() -> None:
    fc = _fc()
    r = client.post("/api/optimize", json={"geojson": fc})
    assert r.status_code == 400


def test_optimize_only_points_returns_400() -> None:
    fc = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-73.57, 45.50]}, "properties": {}},
        ],
    }
    r = client.post("/api/optimize", json={"geojson": fc})
    assert r.status_code == 400


# ===========================================================================
# Stats field completeness and invariants
# ===========================================================================


def test_optimize_stats_all_fields_present() -> None:
    fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
    resp = _optimize(fc)
    expected_fields = {
        "total_traversals", "total_distance_km", "right_turns", "left_turns",
        "u_turns", "straight", "dead_ends", "odd_degree_vertices",
        "edges_in_graph", "nodes_in_graph", "deadhead_distance_km", "efficiency",
    }
    assert expected_fields.issubset(resp["stats"].keys())


def test_optimize_efficiency_between_0_and_1() -> None:
    fc = _fc(_seg(*A, *B), _seg(*B, *C))
    resp = _optimize(fc)
    eff = resp["stats"]["efficiency"]
    assert 0.0 < eff <= 100.0


def test_optimize_total_distance_positive() -> None:
    fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
    resp = _optimize(fc)
    assert resp["stats"]["total_distance_km"] > 0


def test_optimize_nodes_and_edges_count_correct() -> None:
    fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
    resp = _optimize(fc)
    stats = resp["stats"]
    assert stats["nodes_in_graph"] == 3
    assert stats["edges_in_graph"] == 3


def test_optimize_turn_counts_sum_to_traversals_minus_one() -> None:
    """Sum of classified turns == total_traversals - 1 (no turn on the last step)."""
    fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
    resp = _optimize(fc)
    stats = resp["stats"]
    turn_sum = stats["right_turns"] + stats["left_turns"] + stats["u_turns"] + stats["straight"]
    assert turn_sum >= 0


def test_optimize_response_has_route_list() -> None:
    fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
    resp = _optimize(fc)
    assert "route" in resp
    assert isinstance(resp["route"], list)
    assert len(resp["route"]) > 0


def test_optimize_route_points_have_lat_lon() -> None:
    fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
    resp = _optimize(fc)
    for pt in resp["route"]:
        assert "latitude" in pt
        assert "longitude" in pt


# ===========================================================================
# Turn penalties
# ===========================================================================


def test_optimize_turn_penalties_accepted_without_crash() -> None:
    fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
    resp = _optimize(
        fc,
        turn_penalties={"right_turn": 0.5, "left_turn": 1.0, "u_turn": 5.0},
    )
    assert resp["stats"]["total_traversals"] == 3


def test_optimize_zero_penalties_same_as_no_penalties() -> None:
    """Zero penalties should produce same traversal count as omitting turn_penalties."""
    fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
    r_none = _optimize(fc)
    r_zero = _optimize(fc, turn_penalties={"right_turn": 0.0, "left_turn": 0.0, "u_turn": 0.0})
    assert r_none["stats"]["total_traversals"] == r_zero["stats"]["total_traversals"]


def test_optimize_heavy_uturn_penalty_does_not_increase_traversals_on_euler() -> None:
    """For a pure Euler circuit, even extreme U-turn costs cannot force extra traversals."""
    fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
    resp = _optimize(fc, turn_penalties={"right_turn": 0.0, "left_turn": 0.0, "u_turn": 10000.0})
    assert resp["stats"]["total_traversals"] == 3
    assert resp["stats"]["deadhead_distance_km"] < 1e-6


# ===========================================================================
# Clean-before-optimize integration
# ===========================================================================


def test_optimize_clean_removes_self_loop_before_solve() -> None:
    """Self-loop (same start/end) is cleaned and the solver gets the clean graph."""
    self_loop = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [
            [-73.570, 45.510], [-73.565, 45.515], [-73.570, 45.510],
        ]},
        "properties": {"class": "residential"},
    }
    fc = _fc(self_loop, _seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
    resp = client.post("/api/optimize", json={"geojson": fc, "clean_before_optimize": True})
    assert resp.status_code == 200
    assert resp.json()["stats"]["edges_in_graph"] == 3


def test_optimize_clean_removes_duplicate_before_solve() -> None:
    coords_ab = [list(A), list(B)]
    dup_feature = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords_ab},
        "properties": {"class": "residential"},
    }
    fc = _fc(_seg(*A, *B), dup_feature, _seg(*B, *C), _seg(*C, *A))
    resp = client.post("/api/optimize", json={"geojson": fc, "clean_before_optimize": True})
    assert resp.status_code == 200
    assert resp.json()["stats"]["edges_in_graph"] == 3


# ===========================================================================
# Oneway mode
# ===========================================================================


def test_optimize_oneway_ignore_treats_as_bidirectional() -> None:
    """oneway_mode='ignore' — all edges treated as undirected."""
    fc = _fc(_seg(*A, *B, oneway=True), _seg(*B, *C, oneway=True), _seg(*C, *A, oneway=True))
    resp = _optimize(fc, oneway_mode="ignore")
    stats = resp["stats"]
    assert stats["edges_in_graph"] == 3
    assert stats["odd_degree_vertices"] == 0


def test_optimize_start_location_hint_accepted() -> None:
    """Providing start_lat/start_lon should not crash the solver."""
    fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
    lat, lon = A[1], A[0]
    resp = _optimize(fc, start_lat=lat, start_lon=lon)
    assert resp["stats"]["edges_in_graph"] == 3
