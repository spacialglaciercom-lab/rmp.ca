"""
Tests for connectivity-aware selective inclusion of bridge features.

Verifies that _augment_features_for_connectivity selectively adds
non-allowed-class road segments (e.g. service roads) ONLY where they
bridge disconnected components, without including all service roads
(which would add dead-ends and degrade matching quality).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

GEOJSON_PATH = Path(__file__).resolve().parents[2] / "extract-8v1w0jvao6.geojson"


@pytest.fixture(autouse=True)
def _clear_dem_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEM_PATH", raising=False)


# ---------------------------------------------------------------------------
# GeoJSON helpers (same pattern as test_optimize.py)
# ---------------------------------------------------------------------------

def _seg(lon0: float, lat0: float, lon1: float, lat1: float,
         road_class: str = "residential", **extra_props) -> dict:
    props: dict = {"class": road_class, **extra_props}
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[lon0, lat0], [lon1, lat1]]},
        "properties": props,
    }


def _fc(*features: dict) -> dict:
    return {"type": "FeatureCollection", "features": list(features)}


def _optimize(fc: dict, **kwargs) -> dict:
    body = {"geojson": fc, "clean_before_optimize": False, **kwargs}
    r = client.post("/api/optimize/sync", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Coordinate constants — two residential clusters linked by a service road
# ---------------------------------------------------------------------------
#
#  Cluster A (residential):       Cluster B (residential):
#    A1---A2---A3                    B1---B2---B3
#              |                    |
#              A3 ~~~ service ~~~ B1
#

A1 = (-73.570, 45.510)
A2 = (-73.560, 45.510)
A3 = (-73.550, 45.510)

B1 = (-73.540, 45.510)
B2 = (-73.530, 45.510)
B3 = (-73.520, 45.510)

# A third cluster further away
C1 = (-73.510, 45.510)
C2 = (-73.500, 45.510)


# ===========================================================================
# Test 1: Bridge adds service road
# ===========================================================================

def test_bridge_adds_service_road() -> None:
    """
    Two residential triangles connected only by a service road.
    The bridge connector should add the service road, producing a
    single connected route.
    """
    fc = _fc(
        # Cluster A: residential path
        _seg(*A1, *A2),
        _seg(*A2, *A3),
        # Cluster B: residential path
        _seg(*B1, *B2),
        _seg(*B2, *B3),
        # Service road bridge
        _seg(*A3, *B1, road_class="service"),
    )
    resp = _optimize(fc)
    stats = resp["stats"]
    metrics = resp.get("metrics", {})

    # The service road should have been added as a bridge
    assert metrics.get("service_bridge_features_added", 0) >= 1, (
        "Expected at least 1 bridge feature added"
    )
    # All edges should be traversed (5 total: 2 residential + 2 residential + 1 service)
    assert stats["edges_in_graph"] >= 5, (
        f"Expected ≥5 edges (incl. service bridge), got {stats['edges_in_graph']}"
    )
    assert stats["total_traversals"] >= stats["edges_in_graph"]


# ===========================================================================
# Test 2: No-op when already connected
# ===========================================================================

def test_bridge_no_op_when_connected() -> None:
    """
    A single connected residential network needs no bridge features.
    """
    fc = _fc(
        _seg(*A1, *A2),
        _seg(*A2, *A3),
        _seg(*A3, *B1),  # already residential — connected
        _seg(*B1, *B2),
    )
    resp = _optimize(fc)
    metrics = resp.get("metrics", {})

    assert metrics.get("service_bridge_features_added", 0) == 0, (
        "No bridge features should be added to an already-connected graph"
    )


# ===========================================================================
# Test 3: Skips non-vehicle roads (footway)
# ===========================================================================

def test_bridge_skips_non_vehicle() -> None:
    """
    Two residential components connected only by a footway.
    Footway is in NON_VEHICLE_CLASSES and must NOT be used as a bridge.
    """
    fc = _fc(
        _seg(*A1, *A2),
        _seg(*A2, *A3),
        _seg(*B1, *B2),
        _seg(*B2, *B3),
        # Footway — should NOT be used as bridge
        _seg(*A3, *B1, road_class="footway"),
    )
    resp = _optimize(fc)
    metrics = resp.get("metrics", {})

    # Footway must not be added
    assert metrics.get("service_bridge_features_added", 0) == 0, (
        "Footway should not be used as a bridge connector"
    )


# ===========================================================================
# Test 4: Works with custom road_classes
# ===========================================================================

def test_bridge_with_custom_road_classes() -> None:
    """
    User specifies road_classes=["residential"] only.
    Two residential clusters connected by a tertiary road.
    The tertiary road should be added as a bridge.
    """
    fc = _fc(
        _seg(*A1, *A2),
        _seg(*A2, *A3),
        _seg(*B1, *B2),
        _seg(*B2, *B3),
        # Tertiary bridge
        _seg(*A3, *B1, road_class="tertiary"),
    )
    resp = _optimize(fc, road_classes=["residential"])
    metrics = resp.get("metrics", {})

    assert metrics.get("service_bridge_features_added", 0) >= 1, (
        "Tertiary road should be added as bridge when only residential is allowed"
    )


# ===========================================================================
# Test 5: Truly isolated components (no vehicle road connects them)
# ===========================================================================

def test_bridge_truly_isolated() -> None:
    """
    Two residential components with no vehicle road connecting them.
    Should return 0 bridge features and still produce a valid route
    (existing multi-component CPP handles this).
    """
    fc = _fc(
        _seg(*A1, *A2),
        _seg(*A2, *A3),
        _seg(*B1, *B2),
        _seg(*B2, *B3),
        # No connecting road at all
    )
    resp = _optimize(fc)
    stats = resp["stats"]
    metrics = resp.get("metrics", {})

    assert metrics.get("service_bridge_features_added", 0) == 0
    # Both components should still be solved
    assert stats["total_traversals"] >= 4, (
        "Both components should be traversed even without bridge"
    )


# ===========================================================================
# Test 6: Multiple orphans each needing a bridge
# ===========================================================================

def test_bridge_multiple_orphans() -> None:
    """
    Three disconnected residential components, each connected to the
    main cluster via separate service roads.
    """
    fc = _fc(
        # Main cluster (residential)
        _seg(*A1, *A2),
        _seg(*A2, *A3),
        # Orphan 1
        _seg(*B1, *B2),
        _seg(*A3, *B1, road_class="service"),  # bridge 1
        # Orphan 2
        _seg(*C1, *C2),
        _seg(*B2, *C1, road_class="service"),  # bridge 2
    )
    resp = _optimize(fc)
    metrics = resp.get("metrics", {})

    assert metrics.get("service_bridge_features_added", 0) >= 2, (
        f"Expected ≥2 bridge features for 2 orphans, got "
        f"{metrics.get('service_bridge_features_added', 0)}"
    )
    # All 6 edges should be in the graph
    assert resp["stats"]["edges_in_graph"] >= 6


# ===========================================================================
# Test 7: Real Overture extract — efficiency check
# ===========================================================================

@pytest.mark.skipif(not GEOJSON_PATH.exists(), reason="Overture extract not found")
def test_real_extract_efficiency() -> None:
    """
    Run the full Overture extract with default road classes.
    With bridge connectivity, efficiency should be at least 74%.
    """
    with open(GEOJSON_PATH) as f:
        raw = json.load(f)

    resp = _optimize(raw, clean_before_optimize=True)
    stats = resp["stats"]
    metrics = resp.get("metrics", {})
    timing = resp.get("timing_ms", {})

    assert stats["efficiency"] >= 70.0, (
        f"Efficiency {stats['efficiency']:.1f}% below 70% on full extract"
    )
    assert stats["total_traversals"] >= stats["edges_in_graph"]

    # Bridge connectivity should complete quickly
    bridge_ms = timing.get("bridge_connectivity_ms", 0)
    assert bridge_ms < 5000, (
        f"Bridge connectivity took {bridge_ms:.0f} ms (limit: 5000 ms)"
    )

    print(f"\n  Real extract results:")
    print(f"    Efficiency: {stats['efficiency']:.1f}%")
    print(f"    Bridge features added: {metrics.get('service_bridge_features_added', 0)}")
    print(f"    Bridge connectivity time: {bridge_ms:.1f} ms")
    print(f"    Edges: {stats['edges_in_graph']}, Traversals: {stats['total_traversals']}")
    print(f"    Distance: {stats['total_distance_km']:.2f} km")
    print(f"    Deadhead: {stats['deadhead_distance_km']:.2f} km")
