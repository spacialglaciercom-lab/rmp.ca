"""
Tests for extract-viveaxgqat.geojson
=====================================

Service-road-heavy extract (160 service, 71 residential, 16 secondary, 3 tertiary).
Location: ~(-74.038, 45.397) — south-west Montreal area.

Validates:
  - Default road classes optimization
  - Residential-only optimization
  - All-classes optimization
  - Bridge connectivity behavior (service roads bridging residential components)
  - Turn penalty mode
  - Oneway handling
  - Performance bounds
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
GEOJSON_PATH = Path("/home/drone/Downloads/extract-viveaxgqat.geojson")


@pytest.fixture(autouse=True)
def _clear_dem_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEM_PATH", raising=False)


def _load() -> dict:
    with open(GEOJSON_PATH) as f:
        return json.load(f)


def _optimize(fc: dict, **kwargs) -> dict:
    body = {"geojson": fc, "clean_before_optimize": True, **kwargs}
    r = client.post("/api/optimize/sync", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _filter_classes(fc: dict, classes: set[str]) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            f for f in fc["features"]
            if f["geometry"]["type"] == "LineString"
            and f.get("properties", {}).get("class") in classes
        ],
    }


def _filter_linestrings(fc: dict) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            f for f in fc["features"]
            if f["geometry"]["type"] == "LineString"
        ],
    }


# ===========================================================================
# 1. Default road classes (residential + tertiary + secondary + unclassified)
# ===========================================================================

@pytest.mark.skipif(not GEOJSON_PATH.exists(), reason="Extract not found")
class TestDefaultRoadClasses:

    @pytest.fixture(scope="class")
    def resp(self) -> dict:
        return _optimize(_load())

    def test_completes_successfully(self, resp: dict) -> None:
        assert "stats" in resp
        assert "route" in resp

    def test_all_edges_traversed(self, resp: dict) -> None:
        s = resp["stats"]
        assert s["total_traversals"] >= s["edges_in_graph"], (
            f"Not all edges covered: {s['total_traversals']} traversals "
            f"for {s['edges_in_graph']} edges"
        )

    def test_efficiency_positive(self, resp: dict) -> None:
        assert resp["stats"]["efficiency"] > 0

    def test_total_distance_positive(self, resp: dict) -> None:
        assert resp["stats"]["total_distance_km"] > 0

    def test_route_has_points(self, resp: dict) -> None:
        assert len(resp["route"]) >= 2

    def test_stats_fields_present(self, resp: dict) -> None:
        required = [
            "edges_in_graph", "nodes_in_graph", "total_traversals",
            "total_distance_km", "deadhead_distance_km", "efficiency",
            "left_turns", "right_turns", "u_turns", "dead_ends",
        ]
        for field in required:
            assert field in resp["stats"], f"Missing stat: {field}"

    def test_bridge_metrics_present(self, resp: dict) -> None:
        metrics = resp.get("metrics", {})
        # Bridge connectivity should report its metric
        assert "service_bridge_features_added" in metrics

    def test_timing_present(self, resp: dict) -> None:
        timing = resp.get("timing_ms", {})
        assert "bridge_connectivity_ms" in timing


# ===========================================================================
# 2. Residential-only — tests bridge connectivity on this extract
# ===========================================================================

@pytest.mark.skipif(not GEOJSON_PATH.exists(), reason="Extract not found")
class TestResidentialOnly:

    @pytest.fixture(scope="class")
    def resp(self) -> dict:
        return _optimize(_load(), road_classes=["residential"])

    def test_completes(self, resp: dict) -> None:
        assert "stats" in resp

    def test_all_edges_traversed(self, resp: dict) -> None:
        s = resp["stats"]
        assert s["total_traversals"] >= s["edges_in_graph"]

    def test_bridge_features_reported(self, resp: dict) -> None:
        """With only 71 residential segments, some may be disconnected.
        Bridge connectivity should attempt to connect them."""
        metrics = resp.get("metrics", {})
        # Just verify the metric exists (value depends on connectivity)
        assert "service_bridge_features_added" in metrics

    def test_efficiency_reasonable(self, resp: dict) -> None:
        # Residential-only may have low efficiency due to disconnected components,
        # but bridge connectivity should help
        assert resp["stats"]["efficiency"] > 0


# ===========================================================================
# 3. All road classes including service
# ===========================================================================

@pytest.mark.skipif(not GEOJSON_PATH.exists(), reason="Extract not found")
class TestAllClasses:

    @pytest.fixture(scope="class")
    def resp(self) -> dict:
        return _optimize(
            _load(),
            road_classes=["residential", "tertiary", "secondary", "service", "unclassified"],
        )

    def test_completes(self, resp: dict) -> None:
        assert "stats" in resp

    def test_more_edges_than_default(self) -> None:
        """Including service roads should yield more edges."""
        default = _optimize(_load())
        all_cls = _optimize(
            _load(),
            road_classes=["residential", "tertiary", "secondary", "service", "unclassified"],
        )
        assert all_cls["stats"]["edges_in_graph"] >= default["stats"]["edges_in_graph"]

    def test_all_edges_traversed(self, resp: dict) -> None:
        s = resp["stats"]
        assert s["total_traversals"] >= s["edges_in_graph"]

    def test_no_bridge_needed(self, resp: dict) -> None:
        """With all vehicle classes included, bridge connectivity shouldn't
        need to add anything (service roads are already included)."""
        metrics = resp.get("metrics", {})
        assert metrics.get("service_bridge_features_added", 0) == 0


# ===========================================================================
# 4. Turn penalty mode
# ===========================================================================

@pytest.mark.skipif(not GEOJSON_PATH.exists(), reason="Extract not found")
class TestTurnPenalty:

    def test_turn_penalty_completes(self) -> None:
        resp = _optimize(_load(), use_turn_penalty_plugin=True)
        s = resp["stats"]
        assert s["total_traversals"] >= s["edges_in_graph"]
        assert s["efficiency"] > 0

    def test_turn_penalty_does_not_explode_distance(self) -> None:
        base = _optimize(_load())
        tp = _optimize(_load(), use_turn_penalty_plugin=True)
        # Turn penalty route should not be more than 2x the base distance
        assert tp["stats"]["total_distance_km"] < base["stats"]["total_distance_km"] * 2.0, (
            f"Turn penalty distance {tp['stats']['total_distance_km']:.2f} km "
            f"> 2x base {base['stats']['total_distance_km']:.2f} km"
        )


# ===========================================================================
# 5. Oneway handling
# ===========================================================================

@pytest.mark.skipif(not GEOJSON_PATH.exists(), reason="Extract not found")
class TestOneway:

    def test_oneway_respect(self) -> None:
        """With 13 oneway segments, respect mode should still complete.
        Note: directed graphs may have unreachable edges due to
        connectivity constraints, so traversals can be < edges."""
        resp = _optimize(_load(), oneway_mode="respect")
        s = resp["stats"]
        assert s["total_traversals"] > 0
        assert s["efficiency"] > 0

    def test_oneway_ignore(self) -> None:
        resp = _optimize(_load(), oneway_mode="ignore")
        assert resp["stats"]["total_traversals"] >= resp["stats"]["edges_in_graph"]


# ===========================================================================
# 6. Performance bounds
# ===========================================================================

@pytest.mark.skipif(not GEOJSON_PATH.exists(), reason="Extract not found")
class TestPerformance:

    def test_completes_under_30s(self) -> None:
        t0 = time.perf_counter()
        resp = _optimize(_load())
        elapsed = time.perf_counter() - t0
        assert elapsed < 30.0, f"Optimization took {elapsed:.1f}s (limit: 30s)"

    def test_bridge_connectivity_under_5s(self) -> None:
        resp = _optimize(_load())
        bridge_ms = resp.get("timing_ms", {}).get("bridge_connectivity_ms", 0)
        assert bridge_ms < 5000, f"Bridge connectivity took {bridge_ms:.0f}ms (limit: 5000ms)"


# ===========================================================================
# 7. Component analysis — compare connectivity strategies
# ===========================================================================

@pytest.mark.skipif(not GEOJSON_PATH.exists(), reason="Extract not found")
def test_connectivity_comparison() -> None:
    """Compare component counts and efficiency across road class configs."""
    raw = _load()

    # Default classes
    default = _optimize(raw)
    # Residential only
    res_only = _optimize(raw, road_classes=["residential"])
    # All vehicle classes
    all_cls = _optimize(
        raw,
        road_classes=["residential", "tertiary", "secondary", "service", "unclassified"],
    )

    print(f"\n  Extract: extract-viveaxgqat.geojson")
    print(f"  {'Config':<25} {'Edges':>6} {'Trav':>6} {'Eff%':>6} {'Dist km':>8} {'DH km':>7} {'Bridges':>8}")
    print(f"  {'-'*25} {'-'*6} {'-'*6} {'-'*6} {'-'*8} {'-'*7} {'-'*8}")

    for label, r in [("Default", default), ("Residential only", res_only), ("All classes", all_cls)]:
        s = r["stats"]
        m = r.get("metrics", {})
        print(
            f"  {label:<25} {s['edges_in_graph']:>6} {s['total_traversals']:>6} "
            f"{s['efficiency']:>5.1f}% {s['total_distance_km']:>7.2f} "
            f"{s['deadhead_distance_km']:>6.2f} {m.get('service_bridge_features_added', 0):>8}"
        )

    # Basic sanity: all configs produce valid routes
    for r in [default, res_only, all_cls]:
        assert r["stats"]["total_traversals"] >= r["stats"]["edges_in_graph"]


# ===========================================================================
# 8. Diagnostic — run with `pytest -s -k test_viveaxgqat_diagnostic`
# ===========================================================================

@pytest.mark.skipif(not GEOJSON_PATH.exists(), reason="Extract not found")
def test_viveaxgqat_diagnostic() -> None:
    """Full diagnostic report for this extract."""
    raw = _load()
    resp = _optimize(raw)
    s = resp["stats"]
    m = resp.get("metrics", {})
    t = resp.get("timing_ms", {})

    print(f"""
╔══════════════════════════════════════════════════════════════════╗
║     EXTRACT: extract-viveaxgqat.geojson                        ║
║     Location: ~(-74.038, 45.397) SW Montreal                   ║
║     250 LineStrings: 160 service, 71 res, 16 sec, 3 tert       ║
╠══════════════════════════════════════════════════════════════════╣
║   Edges in graph:      {s['edges_in_graph']:>6}                               ║
║   Nodes in graph:      {s['nodes_in_graph']:>6}                               ║
║   Total traversals:    {s['total_traversals']:>6}                               ║
║   Efficiency:          {s['efficiency']:>5.1f}%                              ║
║   Total distance:      {s['total_distance_km']:>6.2f} km                          ║
║   Deadhead distance:   {s['deadhead_distance_km']:>6.2f} km                          ║
║   Dead-ends:           {s['dead_ends']:>6}                               ║
║   U-turns:             {s['u_turns']:>6}                               ║
║   Left turns:          {s['left_turns']:>6}                               ║
║   Right turns:         {s['right_turns']:>6}                               ║
║   Bridge features:     {m.get('service_bridge_features_added', 0):>6}                               ║
║   Bridge time:         {t.get('bridge_connectivity_ms', 0):>5.0f} ms                            ║
╚══════════════════════════════════════════════════════════════════╝
""")
