"""
Route analytics tests.

Covers:
  - Empty / single-point paths return zeroed metrics
  - Physical distance computed via haversine
  - Elevation gain accumulated only for positive dz
  - Turn classification (straight, left, right, U-turn)
  - Adjusted cost equals physical distance when no plugins active
  - Edge multipliers from plugins scale adjusted cost
  - Transition (turn) multipliers from plugins scale adjusted cost
  - Combined edge + transition multipliers
"""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from app.analytics import calculate_route_metrics, _STRAIGHT_DEG, _TURN_DEG
from app.geojson_ops import _haversine_m
from app.routing_plugins import (
    RoutingCostPlugin,
    TurnPenaltyPlugin,
    calculate_bearing,
    get_turn_angle,
)


# ---------------------------------------------------------------------------
# Coordinate helpers
# ---------------------------------------------------------------------------

# Montreal-area points, ~100 m spacing  (lon, lat)
A = (-73.570, 45.510)
B = (-73.560, 45.510)   # east of A
C = (-73.560, 45.520)   # north of B
D = (-73.570, 45.520)   # north of A


def _pt(lon: float, lat: float, z: float | None = None):
    """Build a 2D or 3D coordinate tuple."""
    if z is not None:
        return (lon, lat, z)
    return (lon, lat)


# ---------------------------------------------------------------------------
# Stub plugin for deterministic multiplier testing
# ---------------------------------------------------------------------------


class _FixedMultPlugin(RoutingCostPlugin):
    """Plugin that returns fixed edge and transition multipliers."""

    def __init__(self, edge_mult: float = 1.0, transition_mult: float = 1.0):
        self._edge = edge_mult
        self._transition = transition_mult

    def pre_process_nodes(self, coords_list):
        return {i: {} for i in range(len(coords_list))}

    def calculate_multiplier(self, coords_u, coords_v, data_u, data_v, distance_m):
        return self._edge

    def calculate_transition_multiplier(self, coords_t, coords_u, coords_v):
        return self._transition


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_empty_path(self):
        result = calculate_route_metrics([], [])
        assert result["physical_distance_m"] == 0.0
        assert result["adjusted_cost_m"] == 0.0
        assert result["elevation_gain_m"] == 0.0
        assert result["turns"] == {"left": 0, "right": 0, "u_turn": 0, "straight": 0}

    def test_single_point(self):
        result = calculate_route_metrics([A], [])
        assert result["physical_distance_m"] == 0.0

    def test_two_points_no_plugins(self):
        result = calculate_route_metrics([A, B], [])
        assert result["physical_distance_m"] > 0
        assert result["adjusted_cost_m"] == result["physical_distance_m"]
        assert result["turns"] == {"left": 0, "right": 0, "u_turn": 0, "straight": 0}


# ---------------------------------------------------------------------------
# Physical distance
# ---------------------------------------------------------------------------


class TestPhysicalDistance:
    def test_matches_haversine(self):
        """Sum of haversine segment lengths must match physical_distance_m."""
        path = [A, B, C]
        expected = _haversine_m(*A, *B) + _haversine_m(*B, *C)
        result = calculate_route_metrics(path, [])
        assert result["physical_distance_m"] == round(expected, 2)

    def test_three_segments(self):
        path = [A, B, C, D]
        seg1 = _haversine_m(*A, *B)
        seg2 = _haversine_m(*B, *C)
        seg3 = _haversine_m(*C, *D)
        result = calculate_route_metrics(path, [])
        assert result["physical_distance_m"] == round(seg1 + seg2 + seg3, 2)


# ---------------------------------------------------------------------------
# Elevation gain
# ---------------------------------------------------------------------------


class TestElevationGain:
    def test_no_z_values(self):
        result = calculate_route_metrics([A, B], [])
        assert result["elevation_gain_m"] == 0.0

    def test_uphill_only(self):
        path = [_pt(*A, 0.0), _pt(*B, 10.0), _pt(*C, 25.0)]
        result = calculate_route_metrics(path, [])
        assert result["elevation_gain_m"] == 25.0

    def test_downhill_not_counted(self):
        path = [_pt(*A, 100.0), _pt(*B, 50.0)]
        result = calculate_route_metrics(path, [])
        assert result["elevation_gain_m"] == 0.0

    def test_mixed_uphill_downhill(self):
        # up 10, down 5, up 20  → gain = 30
        path = [
            _pt(*A, 0.0),
            _pt(*B, 10.0),
            _pt(*C, 5.0),
            _pt(*D, 25.0),
        ]
        result = calculate_route_metrics(path, [])
        assert result["elevation_gain_m"] == 30.0


# ---------------------------------------------------------------------------
# Turn classification
# ---------------------------------------------------------------------------


class TestTurnClassification:
    def test_straight_path(self):
        """Three collinear points → one straight transition."""
        # A → B → further east  (all on same latitude)
        far_east = (-73.550, 45.510)
        result = calculate_route_metrics([A, B, far_east], [])
        assert result["turns"]["straight"] == 1
        assert result["turns"]["left"] == 0
        assert result["turns"]["right"] == 0
        assert result["turns"]["u_turn"] == 0

    def test_right_turn(self):
        """A(west) → B(east) → C(north-of-B) is a left turn in lon-first convention.
        Let's build an explicit right turn: go east then south."""
        south_of_b = (-73.560, 45.500)
        result = calculate_route_metrics([A, B, south_of_b], [])
        assert result["turns"]["right"] == 1

    def test_left_turn(self):
        """Go east then north → left turn."""
        result = calculate_route_metrics([A, B, C], [])
        assert result["turns"]["left"] == 1

    def test_u_turn(self):
        """Go east then back west → U-turn."""
        result = calculate_route_metrics([A, B, A], [])
        assert result["turns"]["u_turn"] == 1

    def test_multiple_turns(self):
        """Square path: A→B→C→D should produce three turn events."""
        result = calculate_route_metrics([A, B, C, D], [])
        total = sum(result["turns"].values())
        assert total == 2  # two inner vertices produce two turn events


# ---------------------------------------------------------------------------
# Adjusted cost with plugins
# ---------------------------------------------------------------------------


class TestAdjustedCost:
    def test_no_plugins_equals_physical(self):
        result = calculate_route_metrics([A, B, C], [])
        assert result["adjusted_cost_m"] == result["physical_distance_m"]

    def test_edge_multiplier_scales_cost(self):
        plugin = _FixedMultPlugin(edge_mult=2.0)
        result = calculate_route_metrics([A, B], [plugin])
        no_plugin = calculate_route_metrics([A, B], [])
        # Both values are rounded to 2dp independently, so allow small abs diff
        assert result["adjusted_cost_m"] == pytest.approx(
            no_plugin["physical_distance_m"] * 2.0, abs=0.02
        )

    def test_transition_multiplier_on_first_edge(self):
        """First edge has no predecessor → transition_mult stays 1.0."""
        plugin = _FixedMultPlugin(transition_mult=5.0)
        result = calculate_route_metrics([A, B], [plugin])
        # Only one edge, no transition applied
        assert result["adjusted_cost_m"] == result["physical_distance_m"]

    def test_transition_multiplier_on_second_edge(self):
        """Second edge gets transition multiplier applied."""
        plugin = _FixedMultPlugin(transition_mult=2.0)
        result = calculate_route_metrics([A, B, C], [plugin])
        d1 = _haversine_m(*A, *B)
        d2 = _haversine_m(*B, *C)
        expected = d1 * 1.0 + d2 * 1.0 * 2.0  # edge_mult=1, transition on 2nd
        assert result["adjusted_cost_m"] == pytest.approx(round(expected, 2), abs=0.02)

    def test_combined_edge_and_transition(self):
        plugin = _FixedMultPlugin(edge_mult=1.5, transition_mult=2.0)
        result = calculate_route_metrics([A, B, C], [plugin])
        d1 = _haversine_m(*A, *B)
        d2 = _haversine_m(*B, *C)
        expected = d1 * 1.5 * 1.0 + d2 * 1.5 * 2.0
        assert result["adjusted_cost_m"] == pytest.approx(round(expected, 2), abs=0.02)

    def test_multiple_plugins_multiply(self):
        p1 = _FixedMultPlugin(edge_mult=2.0)
        p2 = _FixedMultPlugin(edge_mult=3.0)
        result = calculate_route_metrics([A, B], [p1, p2])
        no_plugin = calculate_route_metrics([A, B], [])
        assert result["adjusted_cost_m"] == pytest.approx(
            no_plugin["physical_distance_m"] * 6.0, abs=0.03
        )

    def test_turn_penalty_plugin_integration(self):
        """Real TurnPenaltyPlugin affects adjusted_cost via transition multiplier."""
        tp = TurnPenaltyPlugin(left_mult=1.4, u_turn_mult=3.0)
        # U-turn: A → B → A  → transition mult = 3.0 on the second edge
        result = calculate_route_metrics([A, B, A], [tp])
        d = _haversine_m(*A, *B)
        expected = d * 1.0 + d * 3.0
        assert result["adjusted_cost_m"] == pytest.approx(round(expected, 2), abs=0.02)


# ---------------------------------------------------------------------------
# Return value structure
# ---------------------------------------------------------------------------


class TestReturnStructure:
    def test_keys_present(self):
        result = calculate_route_metrics([A, B, C], [])
        assert "physical_distance_m" in result
        assert "adjusted_cost_m" in result
        assert "elevation_gain_m" in result
        assert "turns" in result

    def test_turns_keys(self):
        result = calculate_route_metrics([A, B, C], [])
        for key in ("left", "right", "u_turn", "straight"):
            assert key in result["turns"]

    def test_values_are_rounded(self):
        result = calculate_route_metrics([A, B], [])
        # Check values are rounded to 2 decimal places
        assert result["physical_distance_m"] == round(result["physical_distance_m"], 2)
        assert result["adjusted_cost_m"] == round(result["adjusted_cost_m"], 2)
        assert result["elevation_gain_m"] == round(result["elevation_gain_m"], 2)
