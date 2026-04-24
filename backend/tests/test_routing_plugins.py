"""
Tests for routing_plugins.py — bearing, turn angles, fuel model, and plugin classes.

Covers:
  - calculate_bearing: cardinal directions, edge cases
  - get_turn_angle: right/left/U-turn/straight
  - grade_percent: uphill, downhill, tiny segment guard
  - fuel_multiplier: flat, uphill, downhill, clamp
  - TurnPenaltyPlugin: transition multipliers for all turn types
  - FuelAwarePlugin: interface contract (pre_process_nodes, calculate_multiplier)
  - RoutingCostPlugin ABC: default transition multiplier
"""
from __future__ import annotations

import pytest

from app.routing_plugins import (
    FuelAwarePlugin,
    RoutingCostPlugin,
    TurnPenaltyPlugin,
    calculate_bearing,
    fuel_multiplier,
    get_turn_angle,
    grade_percent,
)


# ===========================================================================
# calculate_bearing
# ===========================================================================


class TestCalculateBearing:
    def test_north(self):
        """Going due north: bearing ~0°."""
        b = calculate_bearing(0.0, 0.0, 0.0, 1.0)
        assert b == pytest.approx(0.0, abs=0.1)

    def test_east(self):
        """Going due east: bearing ~90°."""
        b = calculate_bearing(0.0, 0.0, 1.0, 0.0)
        assert b == pytest.approx(90.0, abs=0.5)

    def test_south(self):
        """Going due south: bearing ~180°."""
        b = calculate_bearing(0.0, 1.0, 0.0, 0.0)
        assert b == pytest.approx(180.0, abs=0.1)

    def test_west(self):
        """Going due west: bearing ~270°."""
        b = calculate_bearing(0.0, 0.0, -1.0, 0.0)
        assert b == pytest.approx(270.0, abs=0.5)

    def test_same_point_returns_zero(self):
        b = calculate_bearing(5.0, 5.0, 5.0, 5.0)
        assert 0.0 <= b < 360.0

    def test_range_0_360(self):
        """Result is always in [0, 360)."""
        for lon2, lat2 in [(1, 1), (-1, -1), (0, -1), (-1, 0)]:
            b = calculate_bearing(0, 0, lon2, lat2)
            assert 0.0 <= b < 360.0


# ===========================================================================
# get_turn_angle
# ===========================================================================


class TestGetTurnAngle:
    def test_straight(self):
        assert get_turn_angle(90, 90) == pytest.approx(0.0)

    def test_right_90(self):
        angle = get_turn_angle(0, 90)
        assert angle == pytest.approx(90.0)

    def test_left_90(self):
        angle = get_turn_angle(90, 0)
        assert angle == pytest.approx(-90.0)

    def test_u_turn(self):
        angle = get_turn_angle(0, 180)
        assert abs(angle) == pytest.approx(180.0)

    def test_range(self):
        """Output always in [-180, 180]."""
        for b_in in range(0, 360, 45):
            for b_out in range(0, 360, 45):
                a = get_turn_angle(b_in, b_out)
                assert -180 <= a <= 180


# ===========================================================================
# grade_percent
# ===========================================================================


class TestGradePercent:
    def test_flat(self):
        assert grade_percent(100.0, 100.0, 1000.0) == pytest.approx(0.0)

    def test_uphill(self):
        assert grade_percent(0.0, 10.0, 100.0) == pytest.approx(10.0)

    def test_downhill(self):
        assert grade_percent(10.0, 0.0, 100.0) == pytest.approx(-10.0)

    def test_tiny_distance_returns_zero(self):
        """Segments < 1m should return 0 to avoid extreme spikes."""
        assert grade_percent(0.0, 100.0, 0.5) == pytest.approx(0.0)

    def test_zero_distance_returns_zero(self):
        assert grade_percent(0.0, 50.0, 0.0) == pytest.approx(0.0)


# ===========================================================================
# fuel_multiplier
# ===========================================================================


class TestFuelMultiplier:
    def test_flat_is_one(self):
        assert fuel_multiplier(0.0) == pytest.approx(1.0)

    def test_uphill_increases(self):
        m = fuel_multiplier(5.0)
        assert m > 1.0
        assert m == pytest.approx(1.0 + 5.0 * 0.1)  # 1.5

    def test_downhill_decreases(self):
        m = fuel_multiplier(-5.0)
        assert m < 1.0
        assert m == pytest.approx(1.0 + (-5.0) * 0.04)  # 0.8

    def test_extreme_downhill_clamped(self):
        """Very steep downhill should be clamped to min_multiplier."""
        m = fuel_multiplier(-30.0, min_multiplier=0.5)
        assert m == pytest.approx(0.5)

    def test_custom_min_multiplier(self):
        m = fuel_multiplier(-100.0, min_multiplier=0.3)
        assert m == pytest.approx(0.3)


# ===========================================================================
# TurnPenaltyPlugin
# ===========================================================================


class TestTurnPenaltyPlugin:
    @pytest.fixture
    def plugin(self):
        return TurnPenaltyPlugin(
            straight_mult=1.0,
            right_mult=1.0,
            left_mult=1.4,
            u_turn_mult=3.0,
        )

    def test_edge_multiplier_is_always_one(self, plugin):
        m = plugin.calculate_multiplier((0, 0), (1, 0), {}, {}, 100.0)
        assert m == pytest.approx(1.0)

    def test_pre_process_returns_empty_dicts(self, plugin):
        result = plugin.pre_process_nodes([(0, 0), (1, 1)])
        assert len(result) == 2
        assert result[0] == {}

    def test_straight_transition(self, plugin):
        """Going north then continuing north → straight."""
        # T=(0,0), U=(0,1), V=(0,2): all northward
        m = plugin.calculate_transition_multiplier((0, 0), (0, 1), (0, 2))
        assert m == pytest.approx(1.0)

    def test_right_turn_transition(self, plugin):
        """Going north then turning east → right turn."""
        # T south of U, V east of U
        m = plugin.calculate_transition_multiplier((0.0, 0.0), (0.0, 1.0), (1.0, 1.0))
        assert m == pytest.approx(1.0)  # right_mult

    def test_left_turn_transition(self, plugin):
        """Going north then turning west → left turn."""
        m = plugin.calculate_transition_multiplier((0.0, 0.0), (0.0, 1.0), (-1.0, 1.0))
        assert m == pytest.approx(1.4)  # left_mult

    def test_u_turn_transition(self, plugin):
        """Going north then reversing → U-turn."""
        m = plugin.calculate_transition_multiplier((0.0, 0.0), (0.0, 1.0), (0.0, 0.0))
        assert m == pytest.approx(3.0)  # u_turn_mult


# ===========================================================================
# FuelAwarePlugin (without real DEM)
# ===========================================================================


class TestFuelAwarePlugin:
    def test_calculate_multiplier_flat(self):
        """Same elevation → multiplier 1.0."""
        plugin = FuelAwarePlugin(dem_path="/fake/path")
        m = plugin.calculate_multiplier(
            (0, 0), (1, 0),
            {"elevation": 100.0}, {"elevation": 100.0},
            distance_m=1000.0,
        )
        assert m == pytest.approx(1.0)

    def test_calculate_multiplier_uphill(self):
        plugin = FuelAwarePlugin(dem_path="/fake/path")
        m = plugin.calculate_multiplier(
            (0, 0), (1, 0),
            {"elevation": 0.0}, {"elevation": 50.0},
            distance_m=1000.0,
        )
        # grade = 5%, mult = 1 + 5*0.1 = 1.5
        assert m == pytest.approx(1.5)

    def test_calculate_multiplier_downhill_clamped(self):
        plugin = FuelAwarePlugin(dem_path="/fake/path", min_multiplier=0.5)
        m = plugin.calculate_multiplier(
            (0, 0), (1, 0),
            {"elevation": 200.0}, {"elevation": 0.0},
            distance_m=100.0,
        )
        # grade = -200%, mult = 1 + (-200)*0.04 = -7 → clamped to 0.5
        assert m == pytest.approx(0.5)

    def test_pre_process_requires_rasterio(self):
        """pre_process_nodes with a non-existent DEM should raise."""
        plugin = FuelAwarePlugin(dem_path="/nonexistent/dem.tif")
        with pytest.raises(Exception):
            plugin.pre_process_nodes([(0, 0)])


# ===========================================================================
# RoutingCostPlugin ABC
# ===========================================================================


class TestRoutingCostPluginABC:
    def test_default_transition_multiplier(self):
        """Base class transition multiplier defaults to 1.0."""

        class DummyPlugin(RoutingCostPlugin):
            def pre_process_nodes(self, coords_list):
                return {}
            def calculate_multiplier(self, coords_u, coords_v, data_u, data_v, distance_m):
                return 1.0

        p = DummyPlugin()
        assert p.calculate_transition_multiplier((0, 0), (1, 1), (2, 2)) == 1.0

    def test_cannot_instantiate_abstract(self):
        with pytest.raises(TypeError):
            RoutingCostPlugin()
