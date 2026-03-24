"""
Tests for Celery tasks: optimize_task.py and vrp_task.py.

These test the task *functions* directly (not via Celery broker) to validate:
  - Deserialization (valid/invalid payloads)
  - Error mapping (ValueError for client errors, RuntimeError for server errors)
  - SoftTimeLimitExceeded handling
  - MemoryError handling
  - Happy-path round-trip (serialize → task → deserialize)
  - VRP empty-stops shortcut
  - VRP no-vehicles guard
"""
from __future__ import annotations

import os
from typing import Any
from unittest.mock import patch

import pytest

from app.tasks.optimize_task import optimize_route_task, _OptimizeTaskBase
from app.tasks.vrp_task import solve_vrp_task, _VrpTaskBase


# ---------------------------------------------------------------------------
# GeoJSON / request helpers
# ---------------------------------------------------------------------------

def _seg(lon0: float, lat0: float, lon1: float, lat1: float, road_class: str = "residential") -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[lon0, lat0], [lon1, lat1]]},
        "properties": {"class": road_class},
    }

def _fc(*features: dict) -> dict:
    return {"type": "FeatureCollection", "features": list(features)}

# Montreal grid
A = (-73.570, 45.510)
B = (-73.560, 45.510)
C = (-73.550, 45.510)


def _optimize_req(fc: dict | None = None, **kwargs) -> dict:
    if fc is None:
        fc = _fc(_seg(*A, *B), _seg(*B, *C), _seg(*C, *A))
    return {"geojson": fc, "clean_before_optimize": False, **kwargs}


def _vrp_req(stops: list[dict] | None = None, vehicles: list[dict] | None = None) -> dict:
    if stops is None:
        stops = [
            {"id": 0, "location": {"lat": 45.5, "lon": -73.57}, "demand": [0]},
            {"id": 1, "location": {"lat": 45.51, "lon": -73.56}, "demand": [1]},
            {"id": 2, "location": {"lat": 45.52, "lon": -73.55}, "demand": [1]},
        ]
    if vehicles is None:
        vehicles = [{
            "id": 0,
            "start_location": {"lat": 45.5, "lon": -73.57},
            "end_location": {"lat": 45.5, "lon": -73.57},
            "capacity": [10],
        }]
    return {"stops": stops, "vehicles": vehicles}


# ---------------------------------------------------------------------------
# For bind=True Celery tasks, .run is a bound method (self already provided).
# Call .run(req_dict) directly — no need to pass task instance.
# ---------------------------------------------------------------------------


# ===========================================================================
# optimize_route_task tests
# ===========================================================================


class TestOptimizeRouteTask:
    def test_happy_path(self):
        """Valid request → returns dict with route and stats."""
        # Keep test deterministic even when DEM_PATH is set in shell env.
        with patch.dict(os.environ, {"DEM_PATH": ""}, clear=False):
            result = optimize_route_task.run(_optimize_req())
        assert isinstance(result, dict)
        assert "route" in result
        assert "stats" in result
        assert result["stats"]["edges_in_graph"] == 3

    def test_invalid_payload_raises_value_error(self):
        with pytest.raises(ValueError, match="Invalid optimize request payload"):
            optimize_route_task.run({"not_a_valid": "payload"})

    def test_empty_geojson_raises_value_error(self):
        with pytest.raises(ValueError):
            optimize_route_task.run(_optimize_req(_fc()))

    def test_soft_time_limit_raises_runtime_error(self):
        from celery.exceptions import SoftTimeLimitExceeded
        with patch("app.tasks.optimize_task._run_optimize", side_effect=SoftTimeLimitExceeded()):
            with pytest.raises(RuntimeError, match="time limit"):
                optimize_route_task.run(_optimize_req())

    def test_memory_error_raises_runtime_error(self):
        with patch("app.tasks.optimize_task._run_optimize", side_effect=MemoryError()):
            with pytest.raises(RuntimeError, match="out of memory"):
                optimize_route_task.run(_optimize_req())

    def test_unexpected_error_raises_runtime_error(self):
        with patch("app.tasks.optimize_task._run_optimize", side_effect=ZeroDivisionError("boom")):
            with pytest.raises(RuntimeError, match="Optimisation error"):
                optimize_route_task.run(_optimize_req())


class TestOptimizeTaskBase:
    def test_on_failure_logs(self):
        """on_failure should not raise."""
        base = _OptimizeTaskBase()
        base.on_failure(
            exc=RuntimeError("test"),
            task_id="abc",
            args=(),
            kwargs={},
            einfo=None,
        )


# ===========================================================================
# solve_vrp_task tests
# ===========================================================================


class TestSolveVrpTask:
    def test_happy_path(self):
        result = solve_vrp_task.run(_vrp_req())
        assert isinstance(result, dict)
        assert "routes" in result
        assert "total_distance" in result

    def test_invalid_payload_raises_value_error(self):
        with pytest.raises(ValueError, match="Invalid VRP request payload"):
            solve_vrp_task.run({"garbage": True})

    def test_no_vehicles_raises_value_error(self):
        with pytest.raises(ValueError, match="no vehicles"):
            solve_vrp_task.run(_vrp_req(vehicles=[]))

    def test_no_stops_returns_empty_solution(self):
        result = solve_vrp_task.run(_vrp_req(stops=[]))
        assert result["routes"] == []
        assert result["total_distance"] == 0

    def test_soft_time_limit_raises_runtime_error(self):
        from celery.exceptions import SoftTimeLimitExceeded
        with patch("app.tasks.vrp_task._solve_ortools", side_effect=SoftTimeLimitExceeded()):
            with pytest.raises(RuntimeError, match="time limit"):
                solve_vrp_task.run(_vrp_req())

    def test_memory_error_raises_runtime_error(self):
        with patch("app.tasks.vrp_task._solve_ortools", side_effect=MemoryError()):
            with pytest.raises(RuntimeError, match="out of memory"):
                solve_vrp_task.run(_vrp_req())

    def test_unexpected_error_raises_runtime_error(self):
        with patch("app.tasks.vrp_task._solve_ortools", side_effect=TypeError("oops")):
            with pytest.raises(RuntimeError, match="Solver error"):
                solve_vrp_task.run(_vrp_req())


class TestVrpTaskBase:
    def test_on_failure_logs(self):
        base = _VrpTaskBase()
        base.on_failure(
            exc=RuntimeError("test"),
            task_id="abc",
            args=(),
            kwargs={},
            einfo=None,
        )
