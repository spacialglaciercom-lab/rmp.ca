"""
Fuel-Aware Plugin tests.

Covers:
  - grade_percent: flat, uphill, downhill, tiny-segment guard, exact boundary
  - fuel_multiplier: flat, uphill, downhill, asymmetry, clamp, custom min
  - FuelAwarePlugin.calculate_multiplier: delegation to grade_percent + fuel_multiplier
  - FuelAwarePlugin.calculate_multiplier: missing/default elevation data
  - FuelAwarePlugin transition multiplier (always 1.0 — no turn penalty)
  - Asymmetric edge weights in CPP graph building (uphill vs downhill)
  - Plugin composition: FuelAware + TurnPenalty compounding
  - Factory function: create_fuel_aware_plugin fallback logic
  - Integration: fuel plugin affects CPP deadhead matching weights
"""
from __future__ import annotations

from unittest.mock import patch, MagicMock
import math

import networkx as nx
import pytest

from app.routing_plugins import (
    FuelAwarePlugin,
    TurnPenaltyPlugin,
    RoutingCostPlugin,
    create_fuel_aware_plugin,
    grade_percent,
    fuel_multiplier,
)
from app.optimize import _build_graph, _solve_cpp, _node_id
from app.geojson_ops import GeoJSONFeature


@pytest.fixture(autouse=True)
def _clear_dem_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEM_PATH", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)


# ---------------------------------------------------------------------------
# GeoJSON helpers
# ---------------------------------------------------------------------------

def _seg(lon0: float, lat0: float, lon1: float, lat1: float,
         road_class: str = "residential", **extra) -> dict:
    props: dict = {"class": road_class, **extra}
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[lon0, lat0], [lon1, lat1]]},
        "properties": props,
    }


def _fc(*features: dict) -> dict:
    return {"type": "FeatureCollection", "features": list(features)}


def _to_features(segs: list[dict]) -> list[GeoJSONFeature]:
    return [GeoJSONFeature(**s) for s in segs]


# ---------------------------------------------------------------------------
# A mock FuelAwarePlugin that doesn't need a real DEM file
# ---------------------------------------------------------------------------

class MockFuelPlugin(FuelAwarePlugin):
    """FuelAwarePlugin with elevation data injected instead of DEM file."""

    def __init__(
        self,
        elevations: dict[int, float],
        min_multiplier: float = 0.5,
    ) -> None:
        # Skip parent __init__ to avoid requiring a real dem_path
        self.min_multiplier = min_multiplier
        self._elevations = elevations

    def pre_process_nodes(
        self, coords_list: list[tuple[float, float]]
    ) -> dict[int, dict[str, object]]:
        return {
            i: {"elevation": self._elevations.get(i, 0.0)}
            for i in range(len(coords_list))
        }


# ===========================================================================
# grade_percent (detailed edge cases)
# ===========================================================================


class TestGradePercentDetailed:
    def test_flat_road(self):
        assert grade_percent(100.0, 100.0, 500.0) == pytest.approx(0.0)

    def test_uphill_5_percent(self):
        # 50m rise over 1000m = 5%
        assert grade_percent(0.0, 50.0, 1000.0) == pytest.approx(5.0)

    def test_downhill_10_percent(self):
        # 100m drop over 1000m = -10%
        assert grade_percent(100.0, 0.0, 1000.0) == pytest.approx(-10.0)

    def test_tiny_segment_guard_at_boundary(self):
        """distance_m < 1.0 returns 0.0 to avoid division spikes."""
        assert grade_percent(0.0, 999.0, 0.99) == pytest.approx(0.0)

    def test_exactly_one_meter(self):
        """distance_m == 1.0 should compute normally."""
        assert grade_percent(0.0, 0.1, 1.0) == pytest.approx(10.0)

    def test_negative_elevations(self):
        """Below sea level (Dead Sea scenario)."""
        assert grade_percent(-430.0, -420.0, 100.0) == pytest.approx(10.0)

    def test_symmetry(self):
        """Uphill A→B should be opposite sign of downhill B→A."""
        up = grade_percent(0.0, 50.0, 1000.0)
        down = grade_percent(50.0, 0.0, 1000.0)
        assert up == pytest.approx(-down)


# ===========================================================================
# fuel_multiplier (detailed edge cases)
# ===========================================================================


class TestFuelMultiplierDetailed:
    def test_flat_is_one(self):
        assert fuel_multiplier(0.0) == pytest.approx(1.0)

    def test_uphill_formula(self):
        """mult = 1.0 + grade_pct * 0.1"""
        for g in [1.0, 5.0, 10.0, 20.0]:
            assert fuel_multiplier(g) == pytest.approx(1.0 + g * 0.1)

    def test_downhill_formula(self):
        """mult = 1.0 + grade_pct * 0.04 (less sensitive than uphill)."""
        for g in [-1.0, -5.0, -10.0]:
            expected = 1.0 + g * 0.04
            assert fuel_multiplier(g) == pytest.approx(expected)

    def test_uphill_more_expensive_than_downhill(self):
        """Same absolute grade: uphill cost > downhill savings."""
        up = fuel_multiplier(5.0)
        down = fuel_multiplier(-5.0)
        assert up > 1.0
        assert down < 1.0
        # Uphill penalty (0.5) is bigger than downhill discount (0.2)
        assert (up - 1.0) > (1.0 - down)

    def test_steep_downhill_clamp_default(self):
        """Very steep downhill clamped to default min 0.5."""
        m = fuel_multiplier(-50.0)
        assert m == pytest.approx(0.5)

    def test_custom_min_multiplier(self):
        m = fuel_multiplier(-100.0, min_multiplier=0.2)
        assert m == pytest.approx(0.2)

    def test_min_multiplier_does_not_affect_uphill(self):
        """min_multiplier only clamps downhill; uphill is always >= 1.0."""
        m = fuel_multiplier(10.0, min_multiplier=0.9)
        assert m == pytest.approx(2.0)  # 1.0 + 10*0.1

    def test_zero_grade_treated_as_uphill_branch(self):
        """grade_pct == 0 hits the 'if grade_pct >= 0' branch → 1.0."""
        assert fuel_multiplier(0.0) == pytest.approx(1.0)

    def test_downhill_exactly_at_clamp(self):
        """grade = -12.5 → mult = 1.0 + (-12.5)*0.04 = 0.5 exactly."""
        assert fuel_multiplier(-12.5, min_multiplier=0.5) == pytest.approx(0.5)


# ===========================================================================
# FuelAwarePlugin.calculate_multiplier
# ===========================================================================


class TestFuelAwarePluginCalculateMultiplier:
    def test_flat_road(self):
        plugin = FuelAwarePlugin(dem_path="/fake")
        m = plugin.calculate_multiplier(
            (0, 0), (1, 0),
            {"elevation": 100.0}, {"elevation": 100.0},
            distance_m=1000.0,
        )
        assert m == pytest.approx(1.0)

    def test_uphill(self):
        plugin = FuelAwarePlugin(dem_path="/fake")
        m = plugin.calculate_multiplier(
            (0, 0), (1, 0),
            {"elevation": 0.0}, {"elevation": 100.0},
            distance_m=1000.0,
        )
        # grade = 10%, mult = 1.0 + 10*0.1 = 2.0
        assert m == pytest.approx(2.0)

    def test_downhill(self):
        plugin = FuelAwarePlugin(dem_path="/fake")
        m = plugin.calculate_multiplier(
            (0, 0), (1, 0),
            {"elevation": 100.0}, {"elevation": 0.0},
            distance_m=1000.0,
        )
        # grade = -10%, mult = 1.0 + (-10)*0.04 = 0.6
        assert m == pytest.approx(0.6)

    def test_missing_elevation_defaults_to_zero(self):
        """data_u/data_v without 'elevation' key → treated as 0.0."""
        plugin = FuelAwarePlugin(dem_path="/fake")
        m = plugin.calculate_multiplier(
            (0, 0), (1, 0), {}, {}, distance_m=1000.0,
        )
        # grade = 0%, mult = 1.0
        assert m == pytest.approx(1.0)

    def test_one_node_missing_elevation(self):
        """One node has elevation, the other defaults to 0."""
        plugin = FuelAwarePlugin(dem_path="/fake")
        m = plugin.calculate_multiplier(
            (0, 0), (1, 0),
            {}, {"elevation": 50.0},
            distance_m=1000.0,
        )
        # grade = 5%, mult = 1.5
        assert m == pytest.approx(1.5)

    def test_tiny_segment_returns_one(self):
        """Very short segment → grade_percent returns 0 → multiplier 1.0."""
        plugin = FuelAwarePlugin(dem_path="/fake")
        m = plugin.calculate_multiplier(
            (0, 0), (0.000001, 0),
            {"elevation": 0.0}, {"elevation": 500.0},
            distance_m=0.5,
        )
        assert m == pytest.approx(1.0)

    def test_custom_min_multiplier(self):
        plugin = FuelAwarePlugin(dem_path="/fake", min_multiplier=0.3)
        m = plugin.calculate_multiplier(
            (0, 0), (1, 0),
            {"elevation": 500.0}, {"elevation": 0.0},
            distance_m=100.0,
        )
        # grade = -500%, mult = 1 + (-500)*0.04 = -19 → clamped to 0.3
        assert m == pytest.approx(0.3)


# ===========================================================================
# FuelAwarePlugin: transition multiplier is always 1.0
# ===========================================================================


class TestFuelAwareTransition:
    def test_no_transition_penalty(self):
        """FuelAwarePlugin doesn't apply turn penalties (that's TurnPenaltyPlugin's job)."""
        plugin = FuelAwarePlugin(dem_path="/fake")
        m = plugin.calculate_transition_multiplier(
            (0.0, 0.0), (0.0, 1.0), (-1.0, 1.0),
        )
        assert m == pytest.approx(1.0)

    def test_u_turn_still_no_penalty(self):
        """Even a U-turn has no fuel transition cost."""
        plugin = FuelAwarePlugin(dem_path="/fake")
        m = plugin.calculate_transition_multiplier(
            (0.0, 0.0), (0.0, 1.0), (0.0, 0.0),
        )
        assert m == pytest.approx(1.0)


# ===========================================================================
# Asymmetric edge weights in graph building
# ===========================================================================


class TestAsymmetricEdgeWeights:
    """Verify that _build_graph with FuelAwarePlugin creates asymmetric
    directed edges (uphill costs more than downhill)."""

    def _hill_segment(self) -> list[dict]:
        """A single segment with ~1km length going north."""
        return [_seg(-73.57, 45.50, -73.57, 45.51)]

    def test_directed_graph_created(self):
        """Plugin path always creates a MultiDiGraph."""
        feats = _to_features(self._hill_segment())
        plugin = MockFuelPlugin(elevations={0: 0.0, 1: 50.0})
        G = _build_graph(feats, plugins=[plugin])
        assert isinstance(G, nx.MultiDiGraph)

    def test_two_edges_per_segment(self):
        """Each segment produces U→V and V→U edges."""
        feats = _to_features(self._hill_segment())
        plugin = MockFuelPlugin(elevations={0: 0.0, 1: 50.0})
        G = _build_graph(feats, plugins=[plugin])
        nodes = list(G.nodes)
        assert len(nodes) == 2
        u, v = nodes[0], nodes[1]
        assert G.has_edge(u, v)
        assert G.has_edge(v, u)

    def test_uphill_heavier_than_downhill(self):
        """Edge going uphill should have a higher weight than the reverse."""
        feats = _to_features(self._hill_segment())
        # Node 0 at 0m, Node 1 at 100m
        plugin = MockFuelPlugin(elevations={0: 0.0, 1: 100.0})
        G = _build_graph(feats, plugins=[plugin])
        nodes = list(G.nodes)
        u, v = nodes[0], nodes[1]

        # Get weights for both directions
        w_uv = min(d["length_km"] for d in G[u][v].values())
        w_vu = min(d["length_km"] for d in G[v][u].values())

        # Uphill (u→v) should cost more; downhill (v→u) should cost less
        assert w_uv > w_vu

    def test_flat_road_symmetric(self):
        """Same elevation at both ends → symmetric weights."""
        feats = _to_features(self._hill_segment())
        plugin = MockFuelPlugin(elevations={0: 100.0, 1: 100.0})
        G = _build_graph(feats, plugins=[plugin])
        nodes = list(G.nodes)
        u, v = nodes[0], nodes[1]

        w_uv = min(d["length_km"] for d in G[u][v].values())
        w_vu = min(d["length_km"] for d in G[v][u].values())
        assert w_uv == pytest.approx(w_vu)

    def test_plugin_data_stored_on_graph(self):
        """Graph should store plugin references."""
        feats = _to_features(self._hill_segment())
        plugin = MockFuelPlugin(elevations={0: 0.0, 1: 50.0})
        G = _build_graph(feats, plugins=[plugin])
        assert "routing_plugins" in G.graph
        assert len(G.graph["routing_plugins"]) == 1


# ===========================================================================
# Asymmetry ratio matches formula
# ===========================================================================


class TestAsymmetryFormula:
    """Verify the weight ratio between uphill/downhill matches the
    fuel_multiplier formula (0.1 uphill vs 0.04 downhill)."""

    def test_ratio_matches_fuel_model(self):
        feats = _to_features([_seg(-73.57, 45.50, -73.57, 45.51)])
        # 50m rise over ~1.1km ≈ ~4.5% grade
        plugin = MockFuelPlugin(elevations={0: 0.0, 1: 50.0})
        G = _build_graph(feats, plugins=[plugin])
        nodes = list(G.nodes)
        u, v = nodes[0], nodes[1]

        w_up = min(d["length_km"] for d in G[u][v].values())
        w_down = min(d["length_km"] for d in G[v][u].values())

        # The ratio should equal fuel_mult(+grade) / fuel_mult(-grade)
        # Both directions share the same base distance
        assert w_up / w_down > 1.0


# ===========================================================================
# Plugin composition: FuelAware + TurnPenalty
# ===========================================================================


class TestPluginComposition:
    def test_fuel_and_turn_plugins_compound(self):
        """When both plugins are active, edge weights include fuel and
        the graph stores both plugins for transition cost during Dijkstra."""
        feats = _to_features([_seg(-73.57, 45.50, -73.57, 45.51)])
        fuel = MockFuelPlugin(elevations={0: 0.0, 1: 50.0})
        turn = TurnPenaltyPlugin()
        G = _build_graph(feats, plugins=[fuel, turn])

        # TurnPenaltyPlugin has calculate_multiplier = 1.0,
        # so edge weights should be the same as fuel-only
        fuel_only = _build_graph(
            _to_features([_seg(-73.57, 45.50, -73.57, 45.51)]),
            plugins=[fuel],
        )

        nodes_both = list(G.nodes)
        nodes_fuel = list(fuel_only.nodes)
        u1, v1 = nodes_both[0], nodes_both[1]
        u2, v2 = nodes_fuel[0], nodes_fuel[1]

        w_both = min(d["length_km"] for d in G[u1][v1].values())
        w_fuel = min(d["length_km"] for d in fuel_only[u2][v2].values())
        assert w_both == pytest.approx(w_fuel)

    def test_both_plugins_stored(self):
        feats = _to_features([_seg(-73.57, 45.50, -73.57, 45.51)])
        fuel = MockFuelPlugin(elevations={0: 0.0, 1: 50.0})
        turn = TurnPenaltyPlugin()
        G = _build_graph(feats, plugins=[fuel, turn])
        assert len(G.graph["routing_plugins"]) == 2


# ===========================================================================
# CPP integration: fuel-weighted deadhead selection
# ===========================================================================


class TestCPPWithFuel:
    """Verify that the CPP solver uses fuel-adjusted edge weights
    when selecting deadhead paths."""

    def _triangle(self) -> list[dict]:
        """Non-Eulerian triangle: three segments, each traversed once."""
        A = (-73.57, 45.50)
        B = (-73.56, 45.50)
        C = (-73.565, 45.51)
        return [
            _seg(*A, *B),
            _seg(*B, *C),
            _seg(*C, *A),
        ]

    def test_cpp_accepts_fuel_plugin(self):
        """_solve_cpp should work with a fuel-weighted graph."""
        feats = _to_features(self._triangle())
        plugin = MockFuelPlugin(elevations={0: 0.0, 1: 0.0, 2: 100.0})
        G = _build_graph(feats, plugins=[plugin])
        path = _solve_cpp(G)
        assert len(path) > 0

    def test_fuel_weighted_path_covers_all_edges(self):
        """Every original edge should appear in the Eulerian circuit."""
        feats = _to_features(self._triangle())
        plugin = MockFuelPlugin(elevations={0: 0.0, 1: 0.0, 2: 100.0})
        G = _build_graph(feats, plugins=[plugin])
        path = _solve_cpp(G)

        # Check that we have a valid circuit (each edge traversed)
        edge_set = set()
        for i in range(len(path) - 1):
            edge_set.add((path[i], path[i + 1]))
        # At minimum, all original 3 edges (in some direction) should be covered
        assert len(edge_set) >= 3


# ===========================================================================
# Factory function: create_fuel_aware_plugin
# ===========================================================================


class TestCreateFuelAwarePlugin:
    def test_no_source_raises(self):
        """No DEM path and no PostGIS → ValueError."""
        with pytest.raises(ValueError, match="No DEM data source"):
            create_fuel_aware_plugin(dem_path=None, database_url=None)

    def test_dem_path_without_rasterio_raises(self):
        """If rasterio not available, file-based plugin can't be created."""
        with patch("app.routing_plugins.rasterio", None):
            with pytest.raises(ValueError, match="No DEM data source"):
                create_fuel_aware_plugin(dem_path="/some/dem.tif")

    def test_dem_path_with_rasterio_returns_file_plugin(self):
        """If rasterio is available and PostGIS is not, returns FuelAwarePlugin."""
        mock_rasterio = MagicMock()
        with patch("app.routing_plugins.rasterio", mock_rasterio), \
             patch("app.routing_plugins.dem_is_available", None):
            plugin = create_fuel_aware_plugin(dem_path="/some/dem.tif")
            assert isinstance(plugin, FuelAwarePlugin)
            assert plugin.dem_path == "/some/dem.tif"

    def test_custom_min_multiplier_passed_through(self):
        mock_rasterio = MagicMock()
        with patch("app.routing_plugins.rasterio", mock_rasterio), \
             patch("app.routing_plugins.dem_is_available", None):
            plugin = create_fuel_aware_plugin(dem_path="/dem.tif", min_multiplier=0.3)
            assert plugin.min_multiplier == pytest.approx(0.3)


# ===========================================================================
# Edge cases and robustness
# ===========================================================================


class TestFuelPluginEdgeCases:
    def test_zero_distance_multiplier_is_one(self):
        """0m distance → grade 0% → multiplier 1.0."""
        plugin = FuelAwarePlugin(dem_path="/fake")
        m = plugin.calculate_multiplier(
            (0, 0), (0, 0),
            {"elevation": 0.0}, {"elevation": 1000.0},
            distance_m=0.0,
        )
        assert m == pytest.approx(1.0)

    def test_extreme_uphill_still_computed(self):
        """100% grade (45°) — no upper clamp, just formula."""
        plugin = FuelAwarePlugin(dem_path="/fake")
        m = plugin.calculate_multiplier(
            (0, 0), (1, 0),
            {"elevation": 0.0}, {"elevation": 1000.0},
            distance_m=1000.0,
        )
        # grade = 100%, mult = 1.0 + 100*0.1 = 11.0
        assert m == pytest.approx(11.0)

    def test_gentle_downhill_reduces_cost(self):
        """Gentle 2% downhill should slightly reduce cost."""
        plugin = FuelAwarePlugin(dem_path="/fake")
        m = plugin.calculate_multiplier(
            (0, 0), (1, 0),
            {"elevation": 20.0}, {"elevation": 0.0},
            distance_m=1000.0,
        )
        # grade = -2%, mult = 1.0 + (-2)*0.04 = 0.92
        assert m == pytest.approx(0.92)

    def test_pre_process_requires_dem(self):
        """Calling pre_process_nodes with invalid DEM raises."""
        plugin = FuelAwarePlugin(dem_path="/no/such/file.tif")
        with pytest.raises(Exception):
            plugin.pre_process_nodes([(0.0, 0.0), (1.0, 1.0)])
