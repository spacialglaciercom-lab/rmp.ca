"""
Real-world Eulerian circuit verification tests.

Uses actual road-network GeoJSON extracts (Montreal-area) to verify that
the CPP optimizer produces valid Eulerian circuits — every graph edge is
traversed, and the route forms a closed loop.

Fixtures:
  - extract-cqlyj7tv7s.geojson: 71 LineStrings, 49 one-way segments (directed CPP)
  - extract-r7nv0jvliq.geojson: 99 LineStrings, 0 one-way segments (undirected CPP)
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.optimize import (
    _build_graph,
    _solve_cpp,
    _node_id,
    _normalize_oneway_mode,
    DEFAULT_ROAD_CLASSES,
    NON_VEHICLE_CLASSES,
)

client = TestClient(app)

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def _clear_dem_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEM_PATH", raising=False)


def _load_fixture(name: str) -> dict:
    with open(FIXTURES / name) as fh:
        return json.load(fh)


def _optimize_sync(fc: dict, **kwargs) -> dict:
    body = {"geojson": fc, "clean_before_optimize": False, **kwargs}
    r = client.post("/api/optimize/sync", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Helpers: verify Eulerian properties on the raw graph + route
# ---------------------------------------------------------------------------


def _build_test_graph(fc: dict, oneway_mode: str = "ignore"):
    """Build graph from fixture the same way the optimizer does."""
    from app.geojson_ops import GeoJSONFeature, GeoJSONFeatureCollection

    parsed = GeoJSONFeatureCollection(**fc)
    features = [
        f for f in parsed.features
        if f.geometry.get("type") in ("LineString", "MultiLineString")
    ]
    allowed = set(DEFAULT_ROAD_CLASSES)
    features = [
        f for f in features
        if (f.properties or {}).get("class", "") in allowed
        and (f.properties or {}).get("class", "") not in NON_VEHICLE_CLASSES
    ]
    return _build_graph(features, _normalize_oneway_mode(oneway_mode))


def _route_covers_all_edges(route_nodes: list[str], G, is_directed: bool) -> tuple[bool, int, int]:
    """Check that the route traverses every graph edge at least once.

    Returns (all_covered, edges_covered, total_edges).
    """
    total_edges = set()
    for u, v, k in G.edges(keys=True):
        canon = (u, v, k) if is_directed else (min(u, v), max(u, v), k)
        total_edges.add(canon)

    covered = set()
    for i in range(len(route_nodes) - 1):
        u, v = route_nodes[i], route_nodes[i + 1]
        edge_data = G.get_edge_data(u, v)
        if edge_data:
            for k in edge_data:
                canon = (u, v, k) if is_directed else (min(u, v), max(u, v), k)
                if canon in total_edges and canon not in covered:
                    covered.add(canon)
                    break
        if not is_directed:
            edge_data_rev = G.get_edge_data(v, u)
            if edge_data_rev:
                for k in edge_data_rev:
                    canon = (min(u, v), max(u, v), k)
                    if canon in total_edges and canon not in covered:
                        covered.add(canon)
                        break

    return covered == total_edges, len(covered), len(total_edges)


# ===========================================================================
# Undirected real-world tests (extract-r7nv0jvliq — 99 LineStrings, no oneway)
# ===========================================================================


class TestRealWorldUndirected:
    """Undirected CPP on a real Montreal-area residential extract."""

    @pytest.fixture()
    def fc(self) -> dict:
        return _load_fixture("extract-r7nv0jvliq.geojson")

    def test_optimizer_returns_valid_route(self, fc: dict) -> None:
        resp = _optimize_sync(fc)
        stats = resp["stats"]
        assert stats["total_distance_km"] > 0
        assert stats["total_traversals"] > 0
        assert len(resp["route"]) >= 2

    def test_all_edges_covered(self, fc: dict) -> None:
        """Every edge in the graph must be traversed at least once."""
        G = _build_test_graph(fc, "ignore")
        route_nodes = _solve_cpp(G)
        assert len(route_nodes) >= 2, "CPP returned empty route"

        all_covered, n_covered, n_total = _route_covers_all_edges(
            route_nodes, G, is_directed=False,
        )
        assert all_covered, (
            f"Route covers {n_covered}/{n_total} edges — "
            f"{n_total - n_covered} edge(s) missed"
        )

    def test_efficiency_above_threshold(self, fc: dict) -> None:
        """Real-world residential grids should achieve reasonable efficiency."""
        resp = _optimize_sync(fc)
        assert resp["stats"]["efficiency"] > 40.0, (
            f"Efficiency {resp['stats']['efficiency']}% is suspiciously low — "
            f"may indicate DFS fallback instead of Eulerian circuit"
        )

    def test_route_is_closed_circuit(self, fc: dict) -> None:
        """The route should form a closed loop (start == end)."""
        G = _build_test_graph(fc, "ignore")
        route_nodes = _solve_cpp(G)
        assert len(route_nodes) >= 3
        assert route_nodes[0] == route_nodes[-1], (
            "Route is not a closed circuit"
        )


# ===========================================================================
# Directed real-world tests (extract-cqlyj7tv7s — 71 LineStrings, 49 oneway)
# ===========================================================================


class TestRealWorldDirected:
    """Directed CPP on a real extract with one-way streets."""

    @pytest.fixture()
    def fc(self) -> dict:
        return _load_fixture("extract-cqlyj7tv7s.geojson")

    def test_directed_optimizer_returns_valid_route(self, fc: dict) -> None:
        resp = _optimize_sync(fc, oneway_mode="respect")
        stats = resp["stats"]
        assert stats["total_distance_km"] > 0
        assert stats["total_traversals"] > 0
        assert len(resp["route"]) >= 2

    def test_directed_all_edges_covered(self, fc: dict) -> None:
        """Every directed arc must be traversed at least once."""
        G = _build_test_graph(fc, "respect")
        route_nodes = _solve_cpp(G)
        assert len(route_nodes) >= 2, "CPP returned empty route"

        all_covered, n_covered, n_total = _route_covers_all_edges(
            route_nodes, G, is_directed=True,
        )
        assert all_covered, (
            f"Route covers {n_covered}/{n_total} directed edges — "
            f"{n_total - n_covered} arc(s) missed"
        )

    def test_directed_efficiency_above_threshold(self, fc: dict) -> None:
        """Directed CPP with one-way streets should still achieve reasonable efficiency."""
        resp = _optimize_sync(fc, oneway_mode="respect")
        assert resp["stats"]["efficiency"] > 30.0, (
            f"Efficiency {resp['stats']['efficiency']}% is suspiciously low"
        )

    def test_directed_more_edges_than_undirected(self, fc: dict) -> None:
        """Respecting one-way tags should create more directed arcs than undirected edges."""
        resp_ignore = _optimize_sync(fc, oneway_mode="ignore")
        resp_respect = _optimize_sync(fc, oneway_mode="respect")
        # One-way=ignore produces 1 undirected edge per segment.
        # One-way=respect produces 2 directed arcs for bidirectional segments
        # and 1 for one-way segments, so always >= undirected count.
        assert resp_respect["stats"]["edges_in_graph"] >= resp_ignore["stats"]["edges_in_graph"]


# ===========================================================================
# Service-both-sides on real data
# ===========================================================================


class TestRealWorldServiceBothSides:
    """service_both_sides=True on real undirected extract."""

    @pytest.fixture()
    def fc(self) -> dict:
        return _load_fixture("extract-r7nv0jvliq.geojson")

    def test_service_both_sides_doubles_edges(self, fc: dict) -> None:
        resp_normal = _optimize_sync(fc)
        resp_sbs = _optimize_sync(fc, service_both_sides=True)
        # service_both_sides converts each undirected edge to 2 directed arcs
        assert resp_sbs["stats"]["edges_in_graph"] == 2 * resp_normal["stats"]["edges_in_graph"]

    def test_service_both_sides_covers_all_arcs(self, fc: dict) -> None:
        resp = _optimize_sync(fc, service_both_sides=True)
        stats = resp["stats"]
        # Must traverse at least as many arcs as edges exist
        assert stats["total_traversals"] >= stats["edges_in_graph"]
        assert stats["total_distance_km"] > 0
