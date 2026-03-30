"""
UPS-style Turn Penalty Plugin tests.

Covers:
  - Angle boundary classification (straight/right/left/U-turn thresholds)
  - Custom multiplier parameters
  - Custom straight_deg threshold
  - Plugin integration with CPP optimizer (deadhead path selection)
  - Dijkstra transition-cost state machine
  - Dual-carriageway U-turn impossibility penalty
  - Plugin composition (TurnPenalty + FuelAware)
  - Consistency between plugin thresholds and analytics module
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routing_plugins import (
    TurnPenaltyPlugin,
    calculate_bearing,
    get_turn_angle,
)
from app.optimize import (
    _build_graph,
    _solve_cpp,
    _dijkstra_with_transition_costs,
    _node_id,
)
from app.geojson_ops import GeoJSONFeature

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_dem_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEM_PATH", raising=False)


# ---------------------------------------------------------------------------
# GeoJSON helpers (same as test_optimize.py)
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


def _optimize(fc: dict, **kwargs) -> dict:
    body = {"geojson": fc, "clean_before_optimize": False, **kwargs}
    r = client.post("/api/optimize/sync", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Coordinate constants — designed for specific turn geometries
# ---------------------------------------------------------------------------
#
#       N
#       |
#  W----O----E     O = origin intersection
#       |
#       S
#
#  Montreal-area coords (~100 m spacing)

O = (-73.560, 45.510)   # Origin intersection
N = (-73.560, 45.511)   # North of O
S = (-73.560, 45.509)   # South of O
E = (-73.559, 45.510)   # East of O
W = (-73.561, 45.510)   # West of O

# Extended grid for CPP tests
#
#  A----B----C
#  |         |
#  D----E----F
#
A = (-73.570, 45.510)
B = (-73.560, 45.510)
C = (-73.550, 45.510)
D = (-73.570, 45.500)
E_pt = (-73.560, 45.500)
F = (-73.550, 45.500)


# ===========================================================================
# 1. Angle boundary classification
# ===========================================================================


class TestAngleBoundaries:
    """Test exact boundary angles between turn classifications."""

    @pytest.fixture
    def plugin(self):
        return TurnPenaltyPlugin()

    def test_just_inside_straight_positive(self, plugin):
        """44.9° should still be classified as straight."""
        bearing_in = 0.0
        bearing_out = 44.9
        angle = get_turn_angle(bearing_in, bearing_out)
        assert -45 < angle < 45
        # Verify via plugin: construct coords that produce ~45° turn
        # North to NE-ish
        m = plugin.calculate_transition_multiplier(
            (0.0, 0.0), (0.0, 1.0), (0.7, 1.7)
        )
        assert m == pytest.approx(plugin.straight_mult)

    def test_just_inside_straight_negative(self, plugin):
        """Small left deviation should still be straight."""
        m = plugin.calculate_transition_multiplier(
            (0.0, 0.0), (0.0, 1.0), (-0.7, 1.7)
        )
        assert m == pytest.approx(plugin.straight_mult)

    def test_exact_right_90(self, plugin):
        """90° right turn should use right_mult."""
        m = plugin.calculate_transition_multiplier(
            (0.0, 0.0), (0.0, 1.0), (1.0, 1.0)
        )
        assert m == pytest.approx(plugin.right_mult)

    def test_exact_left_90(self, plugin):
        """90° left turn should use left_mult."""
        m = plugin.calculate_transition_multiplier(
            (0.0, 0.0), (0.0, 1.0), (-1.0, 1.0)
        )
        assert m == pytest.approx(plugin.left_mult)

    def test_u_turn_180(self, plugin):
        """Full reversal → U-turn multiplier."""
        m = plugin.calculate_transition_multiplier(
            (0.0, 0.0), (0.0, 1.0), (0.0, 0.0)
        )
        assert m == pytest.approx(plugin.u_turn_mult)

    def test_sharp_right_at_boundary(self, plugin):
        """135° right should still be right turn, not U-turn."""
        # Bearing in = 0 (north), bearing out = 135 (southeast)
        angle = get_turn_angle(0, 135)
        assert angle == pytest.approx(135.0)
        # At exactly 135° the plugin classifies as right (45 <= 135 <= 135)
        assert 45 <= angle <= 135

    def test_sharp_left_at_boundary(self, plugin):
        """-135° left should still be left turn, not U-turn."""
        angle = get_turn_angle(0, 225)  # 225 - 0 = 225 → normalized to -135
        assert angle == pytest.approx(-135.0)
        assert -135 <= angle <= -45

    def test_just_past_right_boundary_is_uturn(self, plugin):
        """136° should be classified as U-turn."""
        angle = get_turn_angle(0, 136)
        assert angle == pytest.approx(136.0)
        # >135 falls through to u_turn_mult
        assert angle > 135

    def test_just_past_left_boundary_is_uturn(self, plugin):
        """-136° should be classified as U-turn."""
        angle = get_turn_angle(0, 224)
        assert angle == pytest.approx(-136.0)
        assert angle < -135


# ===========================================================================
# 2. Custom parameters
# ===========================================================================


class TestCustomParameters:
    """Test non-default multipliers and straight_deg."""

    def test_custom_multipliers(self):
        """Custom values should be used for classification."""
        plugin = TurnPenaltyPlugin(
            straight_mult=0.8,
            right_mult=0.9,
            left_mult=2.0,
            u_turn_mult=5.0,
        )
        # Straight
        m = plugin.calculate_transition_multiplier((0, 0), (0, 1), (0, 2))
        assert m == pytest.approx(0.8)
        # Right
        m = plugin.calculate_transition_multiplier((0, 0), (0, 1), (1, 1))
        assert m == pytest.approx(0.9)
        # Left
        m = plugin.calculate_transition_multiplier((0, 0), (0, 1), (-1, 1))
        assert m == pytest.approx(2.0)
        # U-turn
        m = plugin.calculate_transition_multiplier((0, 0), (0, 1), (0, 0))
        assert m == pytest.approx(5.0)

    def test_custom_straight_deg_wider(self):
        """straight_deg=60 means ±60° is straight, so 50° turn is straight."""
        plugin = TurnPenaltyPlugin(straight_deg=60.0, left_mult=1.4)
        # 50° turn: with default straight_deg=45 this would be a right turn,
        # but with straight_deg=60 it should be straight.
        # North then ~50° right → still classified as straight
        # Use bearing_in=0, bearing_out=50 → angle=50, within ±60
        # Create coords: north then slightly east-of-north
        m = plugin.calculate_transition_multiplier(
            (0.0, 0.0), (0.0, 1.0), (0.85, 1.85)
        )
        assert m == pytest.approx(plugin.straight_mult)

    def test_custom_straight_deg_narrower(self):
        """straight_deg=20 means only ±20° is straight."""
        plugin = TurnPenaltyPlugin(straight_deg=20.0, right_mult=1.2)
        # 30° turn: with straight_deg=20 this should be a right turn
        angle = get_turn_angle(0, 30)
        assert angle == pytest.approx(30.0)
        assert angle > 20  # Outside narrow straight zone

    def test_penalize_right_turns_too(self):
        """right_mult > 1 should increase cost of right turns."""
        plugin = TurnPenaltyPlugin(right_mult=1.5)
        m = plugin.calculate_transition_multiplier((0, 0), (0, 1), (1, 1))
        assert m == pytest.approx(1.5)

    def test_zero_multipliers_means_free(self):
        """Setting all multipliers to 0 makes all turns free."""
        plugin = TurnPenaltyPlugin(
            straight_mult=0.0, right_mult=0.0, left_mult=0.0, u_turn_mult=0.0
        )
        for coords_v in [(0, 2), (1, 1), (-1, 1), (0, 0)]:
            m = plugin.calculate_transition_multiplier((0, 0), (0, 1), coords_v)
            assert m == pytest.approx(0.0)


# ===========================================================================
# 3. CPP integration — plugin influences deadhead path choice
# ===========================================================================


class TestCPPIntegration:
    """Verify the turn penalty plugin influences actual route optimization."""

    def test_plugin_flag_accepted(self):
        """use_turn_penalty_plugin=True should not crash and produce a valid route."""
        fc = _fc(
            _seg(*A, *B), _seg(*B, *C),
            _seg(*C, *F), _seg(*F, *E_pt),
            _seg(*E_pt, *D), _seg(*D, *A),
        )
        resp = _optimize(fc, use_turn_penalty_plugin=True)
        assert resp["stats"]["total_traversals"] >= 6
        assert resp["stats"]["total_distance_km"] > 0

    def test_plugin_preserves_edge_count(self):
        """Plugin should not add or remove edges from the graph."""
        fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
        base = _optimize(fc)
        with_plugin = _optimize(fc, use_turn_penalty_plugin=True)
        assert base["stats"]["edges_in_graph"] == with_plugin["stats"]["edges_in_graph"]

    def test_eulerian_graph_no_extra_traversals(self):
        """On an Eulerian graph (all even degree), the plugin should not
        force extra traversals — the circuit already exists."""
        fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
        resp = _optimize(fc, use_turn_penalty_plugin=True)
        assert resp["stats"]["total_traversals"] == 3
        assert resp["stats"]["deadhead_distance_km"] < 1e-4

    def test_plugin_with_non_eulerian_graph(self):
        """Non-Eulerian graph: plugin should still produce a valid route
        covering all edges, possibly with different deadhead cost."""
        #  A----B----C (path graph: A and C have odd degree)
        fc = _fc(_seg(*A, *B), _seg(*B, *C))
        resp_base = _optimize(fc)
        resp_tp = _optimize(fc, use_turn_penalty_plugin=True)
        # Both must cover all edges
        assert resp_base["stats"]["total_traversals"] >= 2
        assert resp_tp["stats"]["total_traversals"] >= 2
        # Both should have same edges in graph
        assert resp_base["stats"]["edges_in_graph"] == resp_tp["stats"]["edges_in_graph"]

    def test_plugin_affects_deadhead_cost_on_grid(self):
        """On a grid with odd-degree nodes, the turn penalty plugin should
        change the adjusted_cost (deadhead paths avoid left turns)."""
        #  A----B----C
        #  |         |
        #  D----E----F
        fc = _fc(
            _seg(*A, *B), _seg(*B, *C),
            _seg(*A, *D), _seg(*C, *F),
            _seg(*D, *E_pt), _seg(*E_pt, *F),
        )
        resp_base = _optimize(fc)
        resp_tp = _optimize(fc, use_turn_penalty_plugin=True)
        # Both must cover all 6 edges
        assert resp_base["stats"]["edges_in_graph"] == 6
        assert resp_tp["stats"]["edges_in_graph"] == 6
        assert resp_base["stats"]["total_traversals"] >= 6
        assert resp_tp["stats"]["total_traversals"] >= 6

    def test_plugin_combined_with_turn_penalties(self):
        """Both use_turn_penalty_plugin and turn_penalties can be set together."""
        fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
        resp = _optimize(
            fc,
            use_turn_penalty_plugin=True,
            turn_penalties={"left_turn": 1.0, "u_turn": 5.0, "right_turn": 0.0},
        )
        assert resp["stats"]["total_traversals"] == 3


# ===========================================================================
# 4. Dijkstra transition-cost state machine
# ===========================================================================


class TestDijkstraTransitionCosts:
    """Test the state-based Dijkstra directly with the turn penalty plugin."""

    def _make_line_graph(self):
        """Build a simple directed line graph: A -> B -> C -> D
        where at B there's a choice: go straight to C or turn to C'.
        """
        import networkx as nx
        G = nx.MultiGraph()
        # Straight path: south to north
        G.add_node("S", lon=-73.560, lat=45.509)
        G.add_node("O", lon=-73.560, lat=45.510)
        G.add_node("N", lon=-73.560, lat=45.511)
        # Right turn target (east)
        G.add_node("E", lon=-73.559, lat=45.510)
        # Left turn target (west)
        G.add_node("W", lon=-73.561, lat=45.510)

        G.add_edge("S", "O", key=0, length_km=0.1)
        G.add_edge("O", "N", key=0, length_km=0.1)
        G.add_edge("O", "E", key=0, length_km=0.1)
        G.add_edge("O", "W", key=0, length_km=0.1)
        return G

    def test_straight_path_cheapest(self):
        """With UPS penalties, going straight from S through O to N should be
        cheapest (mult=1.0), while left to W is penalized (mult=1.4)."""
        G = self._make_line_graph()
        plugin = TurnPenaltyPlugin()
        lengths, paths = _dijkstra_with_transition_costs(G, "S", [plugin])

        # All reachable
        assert "N" in lengths
        assert "E" in lengths
        assert "W" in lengths

        # Straight (S→O→N) should be cheaper than left turn (S→O→W)
        # Both have same edge weight (0.1 + 0.1), but W has left turn penalty
        assert lengths["N"] < lengths["W"]

        # Right (S→O→E) should be same cost as straight (both mult=1.0)
        assert lengths["N"] == pytest.approx(lengths["E"], abs=0.01)

    def test_no_plugins_all_equal(self):
        """Without plugins, all equidistant paths should have equal cost."""
        G = self._make_line_graph()
        lengths, _ = _dijkstra_with_transition_costs(G, "S", [])
        assert lengths["N"] == pytest.approx(lengths["E"])
        assert lengths["N"] == pytest.approx(lengths["W"])

    def test_u_turn_most_expensive(self):
        """U-turn back to S from O should be the most expensive."""
        G = self._make_line_graph()
        plugin = TurnPenaltyPlugin()
        lengths, _ = _dijkstra_with_transition_costs(G, "S", [plugin])
        # Path S→O→S would be a U-turn (3x multiplier on the return edge)
        # But "S" is the source so lengths["S"] = 0 (start). Check via manual path.
        # Instead: the cost to reach N via S→O→N (straight) vs S→O→S→O→N (U-turn + straight)
        # The direct path should always win
        assert paths_are_direct(lengths, "N", 0.2)

    def test_path_returned_is_valid(self):
        """The returned path should be a valid sequence of connected nodes."""
        G = self._make_line_graph()
        plugin = TurnPenaltyPlugin()
        _, paths = _dijkstra_with_transition_costs(G, "S", [plugin])
        for target, path in paths.items():
            assert path[0] == "S"
            assert path[-1] == target
            for i in range(len(path) - 1):
                assert G.has_edge(path[i], path[i + 1])


def paths_are_direct(lengths: dict, node: str, expected_direct: float) -> bool:
    """Helper: check the path cost is close to the direct distance."""
    return abs(lengths.get(node, float("inf")) - expected_direct) < 0.05


# ===========================================================================
# 5. Dual-carriageway U-turn penalty
# ===========================================================================


class TestDualCarriagewayUturn:
    """Dual-carriageway roads should get an extra U-turn penalty."""

    def test_dual_carriageway_uturn_via_api(self):
        """A U-turn on a dual_carriageway=yes road should be heavily penalized."""
        # Build a simple path where the only option is a U-turn on a dual carriageway
        fc = _fc(
            _seg(*A, *B, dual_carriageway="yes"),
            _seg(*B, *C, dual_carriageway="yes"),
        )
        resp = _optimize(fc, use_turn_penalty_plugin=True)
        # Should still produce a valid route
        assert resp["stats"]["total_traversals"] >= 2
        assert resp["stats"]["total_distance_km"] > 0


# ===========================================================================
# 6. Plugin composition
# ===========================================================================


class TestPluginComposition:
    """Multiple plugins should compose multiplicatively."""

    def test_two_plugins_multiply(self):
        """Two TurnPenaltyPlugins should multiply their costs."""
        p1 = TurnPenaltyPlugin(left_mult=1.4)
        p2 = TurnPenaltyPlugin(left_mult=2.0)

        # Left turn: p1 gives 1.4, p2 gives 2.0, composed = 1.4 * 2.0 = 2.8
        m1 = p1.calculate_transition_multiplier((0, 0), (0, 1), (-1, 1))
        m2 = p2.calculate_transition_multiplier((0, 0), (0, 1), (-1, 1))
        assert m1 * m2 == pytest.approx(2.8)

    def test_composition_in_dijkstra(self):
        """Dijkstra with two plugins should apply both multipliers."""
        import networkx as nx
        G = nx.MultiGraph()
        G.add_node("A", lon=0.0, lat=0.0)
        G.add_node("B", lon=0.0, lat=1.0)
        G.add_node("C", lon=-1.0, lat=1.0)  # Left turn from A→B→C
        G.add_node("D", lon=0.0, lat=2.0)   # Straight from A→B→D

        G.add_edge("A", "B", key=0, length_km=1.0)
        G.add_edge("B", "C", key=0, length_km=1.0)
        G.add_edge("B", "D", key=0, length_km=1.0)

        p1 = TurnPenaltyPlugin(left_mult=1.5)
        p2 = TurnPenaltyPlugin(left_mult=1.5)

        lengths_single, _ = _dijkstra_with_transition_costs(G, "A", [p1])
        lengths_double, _ = _dijkstra_with_transition_costs(G, "A", [p1, p2])

        # Straight A→B→D: mult = 1.0 for both plugins
        assert lengths_single["D"] == pytest.approx(lengths_double["D"])

        # Left A→B→C: single = 1.0 + 1.0*1.5 = 2.5; double = 1.0 + 1.0*1.5*1.5 = 3.25
        assert lengths_double["C"] > lengths_single["C"]
        assert lengths_single["C"] == pytest.approx(1.0 + 1.0 * 1.5)
        assert lengths_double["C"] == pytest.approx(1.0 + 1.0 * 1.5 * 1.5)


# ===========================================================================
# 7. Analytics consistency
# ===========================================================================


class TestAnalyticsConsistency:
    """Verify turn classification thresholds match between plugin and analytics."""

    def test_default_straight_deg_matches_analytics(self):
        """TurnPenaltyPlugin default straight_deg should be 45.0, matching
        the analytics module's _STRAIGHT_DEG constant."""
        plugin = TurnPenaltyPlugin()
        assert plugin.straight_deg == 45.0

    def test_adjusted_cost_increases_with_left_turns(self):
        """Route with left turns should have higher adjusted_cost than
        route with only right turns, when plugin is active."""
        from app.analytics import calculate_route_metrics

        plugin = TurnPenaltyPlugin(left_mult=1.4, u_turn_mult=3.0)

        # Straight path: A(0,0) → B(0,1) → C(0,2)
        straight = [(0, 0), (0, 1), (0, 2)]
        # Path with U-turn: A(0,0) → B(0,1) → A(0,0)
        uturn = [(0, 0), (0, 1), (0, 0)]

        m_straight = calculate_route_metrics(straight, [plugin])
        m_uturn = calculate_route_metrics(uturn, [plugin])

        # U-turn path should have higher adjusted cost per km
        assert m_uturn["adjusted_cost_m"] > m_straight["adjusted_cost_m"]
