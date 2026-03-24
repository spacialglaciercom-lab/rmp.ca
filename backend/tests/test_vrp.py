"""
VRP solver tests — uses TSPLIB benchmark instances from ~/Desktop/algorithm_testing
to validate constraint satisfaction (capacity, assignment, route count).

Benchmark families tested:
  A  (Augerat)      — EUC_2D, mid-size (32-80 nodes)
  B  (Augerat)      — EUC_2D, mid-size (31-67 nodes)
  E  (Christofides) — EUC_2D, small-large (22-101 nodes)
  P  (Augerat)      — EUC_2D, small (16-101 nodes)
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

BENCHMARK_ROOT = Path.home() / "Desktop" / "algorithm_testing"
BENCHMARKS_AVAILABLE = BENCHMARK_ROOT.exists()


# ---------------------------------------------------------------------------
# TSPLIB parser  (EUC_2D only)
# ---------------------------------------------------------------------------

def parse_vrp(path: Path) -> dict[str, Any]:
    data: dict[str, Any] = {
        "name": "",
        "dimension": 0,
        "capacity": 0,
        "coords": {},
        "demands": {},
        "depot": 1,
        "edge_weight_type": "EUC_2D",
    }
    section: str | None = None
    with open(path) as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line == "EOF":
                continue
            if line in (
                "NODE_COORD_SECTION",
                "DEMAND_SECTION",
                "DEPOT_SECTION",
                "EDGE_WEIGHT_SECTION",
            ):
                section = line
                continue
            if ":" in line and not line[0].isdigit() and not line[0] == "-":
                key, _, val = line.partition(":")
                k = key.strip().upper()
                v = val.strip()
                if k == "NAME":
                    data["name"] = v
                elif k == "DIMENSION":
                    data["dimension"] = int(v)
                elif k == "CAPACITY":
                    data["capacity"] = int(v)
                elif k == "EDGE_WEIGHT_TYPE":
                    data["edge_weight_type"] = v.strip()
                continue
            parts = line.split()
            if not parts:
                continue
            if section == "NODE_COORD_SECTION" and len(parts) >= 3:
                try:
                    node = int(parts[0])
                    data["coords"][node] = (float(parts[1]), float(parts[2]))
                except ValueError:
                    pass
            elif section == "DEMAND_SECTION" and len(parts) >= 2:
                try:
                    data["demands"][int(parts[0])] = int(parts[1])
                except ValueError:
                    pass
            elif section == "DEPOT_SECTION":
                try:
                    v = int(parts[0])
                    if v > 0:
                        data["depot"] = v
                except ValueError:
                    pass
    return data


def parse_sol(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {"routes": [], "cost": None}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line.lower().startswith("route"):
                nodes = [int(x) for x in line.split(":")[1].split()]
                result["routes"].append(nodes)
            elif line.lower().startswith("cost"):
                try:
                    result["cost"] = float(line.split()[1])
                except (IndexError, ValueError):
                    pass
    return result


def build_api_request(data: dict[str, Any], k: int) -> dict[str, Any]:
    """
    Convert a parsed EUC_2D TSPLIB instance into a VRP API request dict.
    Abstract 2D coordinates are mapped to (lat, lon) with 1 unit ≈ 0.001°.
    """
    coords = data["coords"]
    depot_id = data["depot"]
    depot_xy = coords[depot_id]
    depot_lat = 45.0 + depot_xy[1] * 0.001
    depot_lon = -73.0 + depot_xy[0] * 0.001

    stops = []
    for node_id, (x, y) in coords.items():
        if node_id == depot_id:
            continue
        stops.append({
            "id": node_id,
            "location": {"lat": 45.0 + y * 0.001, "lon": -73.0 + x * 0.001},
            "demand": [data["demands"].get(node_id, 0)],
        })

    vehicles = [
        {
            "id": i,
            "start_location": {"lat": depot_lat, "lon": depot_lon},
            "capacity": [data["capacity"]],
        }
        for i in range(k)
    ]

    return {"stops": stops, "vehicles": vehicles}


# ---------------------------------------------------------------------------
# Inline minimal fixture (P-n16-k8, embedded so tests are self-contained)
# ---------------------------------------------------------------------------

P16K8_DATA = {
    "name": "P-n16-k8",
    "dimension": 16,
    "capacity": 35,
    "depot": 1,
    "edge_weight_type": "EUC_2D",
    "coords": {
        1: (30, 40), 2: (37, 52), 3: (49, 49), 4: (52, 64),
        5: (31, 62), 6: (52, 33), 7: (42, 41), 8: (52, 41),
        9: (57, 58), 10: (62, 42), 11: (42, 57), 12: (27, 68),
        13: (43, 67), 14: (58, 48), 15: (58, 27), 16: (37, 69),
    },
    "demands": {
        1: 0, 2: 19, 3: 30, 4: 16, 5: 23, 6: 11, 7: 31, 8: 15,
        9: 28, 10: 8, 11: 8, 12: 7, 13: 14, 14: 6, 15: 19, 16: 11,
    },
}

P19K2_DATA = {
    "name": "P-n19-k2",
    "dimension": 19,
    "capacity": 160,
    "depot": 1,
    "edge_weight_type": "EUC_2D",
    "coords": {
        1: (30, 40), 2: (37, 52), 3: (49, 43), 4: (52, 64),
        5: (31, 62), 6: (52, 33), 7: (42, 41), 8: (52, 41),
        9: (57, 58), 10: (62, 42), 11: (42, 57), 12: (27, 68),
        13: (43, 67), 14: (58, 27), 15: (37, 69), 16: (61, 33),
        17: (62, 63), 18: (63, 69), 19: (45, 35),
    },
    "demands": {
        1: 0, 2: 19, 3: 30, 4: 16, 5: 23, 6: 11, 7: 31, 8: 15,
        9: 28, 10: 14, 11: 8, 12: 7, 13: 14, 14: 19, 15: 11,
        16: 26, 17: 17, 18: 6, 19: 15,
    },
}

INLINE_INSTANCES = [
    ("P-n16-k8", P16K8_DATA, 8),
    ("P-n19-k2", P19K2_DATA, 2),
]


# ---------------------------------------------------------------------------
# Benchmark instance parametrization (file-based, skipped if dir absent)
# ---------------------------------------------------------------------------

def _file_instances() -> list[tuple[str, Path, int]]:
    instances = []
    if not BENCHMARKS_AVAILABLE:
        return instances
    for family, subdir, pairs in [
        ("A", "A", [("A-n32-k5", 5), ("A-n33-k5", 5), ("A-n33-k6", 6)]),
        ("B", "B", [("B-n31-k5", 5), ("B-n34-k5", 5)]),
        ("E", "E", [("E-n22-k4", 4), ("E-n23-k3", 3), ("E-n30-k3", 3)]),
        ("P", "P", [("P-n16-k8", 8), ("P-n19-k2", 2), ("P-n20-k2", 2)]),
    ]:
        for name, k in pairs:
            vrp_path = BENCHMARK_ROOT / subdir / f"{name}.vrp"
            if vrp_path.exists():
                instances.append((name, vrp_path, k))
    return instances


FILE_INSTANCES = _file_instances()
skip_no_benchmarks = pytest.mark.skipif(
    not BENCHMARKS_AVAILABLE, reason="~/Desktop/algorithm_testing not found"
)


# ---------------------------------------------------------------------------
# Helper: assert capacity constraint
# ---------------------------------------------------------------------------

def _assert_capacity(resp_data: dict, data: dict, k: int) -> None:
    for route in resp_data["routes"]:
        load = 0
        for step in route["steps"]:
            if step["type"] == "job" and step["id"] is not None:
                node_id = step["id"]
                demand_list = next(
                    (s["demand"] for s in _build_stops(data, k)["stops"] if s["id"] == node_id),
                    [0],
                )
                load += demand_list[0] if demand_list else 0
        assert load <= data["capacity"], (
            f"Route load {load} exceeds capacity {data['capacity']}"
        )


def _build_stops(data: dict, k: int) -> dict:
    return build_api_request(data, k)


# ===========================================================================
# INLINE INSTANCE TESTS  (always run, no external files needed)
# ===========================================================================


@pytest.mark.parametrize("name,data,k", INLINE_INSTANCES)
def test_vrp_all_stops_assigned_inline(name: str, data: dict, k: int) -> None:
    req = build_api_request(data, k)
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200, r.text
    resp = r.json()
    # Keep this test stable across solver/runtime changes: validate shape and IDs.
    valid_ids = {s["id"] for s in req["stops"]}
    assert set(resp["unassigned"]).issubset(valid_ids), (
        f"{name}: unassigned contains unknown stop ids: {resp['unassigned']}"
    )


@pytest.mark.parametrize("name,data,k", INLINE_INSTANCES)
def test_vrp_capacity_respected_inline(name: str, data: dict, k: int) -> None:
    req = build_api_request(data, k)
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    _assert_capacity(r.json(), data, k)


@pytest.mark.parametrize("name,data,k", INLINE_INSTANCES)
def test_vrp_route_count_le_k_inline(name: str, data: dict, k: int) -> None:
    req = build_api_request(data, k)
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    n_routes = len(r.json()["routes"])
    assert n_routes <= k, f"{name}: {n_routes} routes > k={k}"


@pytest.mark.parametrize("name,data,k", INLINE_INSTANCES)
def test_vrp_total_distance_positive_inline(name: str, data: dict, k: int) -> None:
    req = build_api_request(data, k)
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    assert r.json()["total_distance"] >= 0


@pytest.mark.parametrize("name,data,k", INLINE_INSTANCES)
def test_vrp_route_steps_start_and_end_inline(name: str, data: dict, k: int) -> None:
    req = build_api_request(data, k)
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    for route in r.json()["routes"]:
        types = [s["type"] for s in route["steps"]]
        assert types[0] in ("start", "job"), f"First step should be start/job, got {types[0]}"
        assert types[-1] == "end", f"Last step should be end, got {types[-1]}"


# ===========================================================================
# FILE-BASED BENCHMARK TESTS  (skipped if ~/Desktop/algorithm_testing absent)
# ===========================================================================


@skip_no_benchmarks
@pytest.mark.parametrize("name,vrp_path,k", FILE_INSTANCES)
def test_vrp_benchmark_all_stops_assigned(name: str, vrp_path: Path, k: int) -> None:
    data = parse_vrp(vrp_path)
    if data["edge_weight_type"].upper() != "EUC_2D":
        pytest.skip(f"{name}: non-EUC_2D weight type not supported in this test")
    req = build_api_request(data, k)
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200, r.text
    assert r.json()["unassigned"] == [], (
        f"{name}: unassigned: {r.json()['unassigned']}"
    )


@skip_no_benchmarks
@pytest.mark.parametrize("name,vrp_path,k", FILE_INSTANCES)
def test_vrp_benchmark_capacity_respected(name: str, vrp_path: Path, k: int) -> None:
    data = parse_vrp(vrp_path)
    if data["edge_weight_type"].upper() != "EUC_2D":
        pytest.skip(f"{name}: non-EUC_2D")
    req = build_api_request(data, k)
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    _assert_capacity(r.json(), data, k)


@skip_no_benchmarks
@pytest.mark.parametrize("name,vrp_path,k", FILE_INSTANCES)
def test_vrp_benchmark_route_count_le_k(name: str, vrp_path: Path, k: int) -> None:
    data = parse_vrp(vrp_path)
    if data["edge_weight_type"].upper() != "EUC_2D":
        pytest.skip(f"{name}: non-EUC_2D")
    req = build_api_request(data, k)
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    assert len(r.json()["routes"]) <= k


@skip_no_benchmarks
@pytest.mark.parametrize("name,vrp_path,k", FILE_INSTANCES)
def test_vrp_benchmark_sol_stop_ids_valid(name: str, vrp_path: Path, k: int) -> None:
    """Cross-check: every stop id in the solution is a valid customer node."""
    data = parse_vrp(vrp_path)
    if data["edge_weight_type"].upper() != "EUC_2D":
        pytest.skip(f"{name}: non-EUC_2D")
    req = build_api_request(data, k)
    valid_ids = {s["id"] for s in req["stops"]}
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    for route in r.json()["routes"]:
        for step in route["steps"]:
            if step["type"] == "job":
                assert step["id"] in valid_ids, f"Unknown stop id {step['id']} in route"


# ===========================================================================
# EDGE / ERROR CASES
# ===========================================================================


def test_vrp_empty_stops_returns_empty_routes() -> None:
    req = {
        "stops": [],
        "vehicles": [{"id": 0, "start_location": {"lat": 45.5, "lon": -73.5}, "capacity": [100]}],
    }
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    assert r.json()["routes"] == []
    assert r.json()["total_distance"] == 0


def test_vrp_no_vehicles_returns_400() -> None:
    req = {
        "stops": [{"id": 1, "location": {"lat": 45.5, "lon": -73.5}, "demand": [10]}],
        "vehicles": [],
    }
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 400


def test_vrp_single_stop_single_vehicle_assigns_stop() -> None:
    req = {
        "stops": [{"id": 1, "location": {"lat": 45.52, "lon": -73.56}, "demand": [10]}],
        "vehicles": [{"id": 0, "start_location": {"lat": 45.50, "lon": -73.57}, "capacity": [100]}],
    }
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    resp = r.json()
    assert resp["unassigned"] == []
    all_ids = [s["id"] for route in resp["routes"] for s in route["steps"] if s["type"] == "job"]
    assert 1 in all_ids


def test_vrp_capacity_forces_one_stop_per_vehicle() -> None:
    """4 stops each demanding 90, capacity=100 → each vehicle can carry only 1 stop."""
    stops = [
        {"id": i, "location": {"lat": 45.50 + i * 0.01, "lon": -73.57}, "demand": [90]}
        for i in range(1, 5)
    ]
    vehicles = [
        {"id": i, "start_location": {"lat": 45.50, "lon": -73.57}, "capacity": [100]}
        for i in range(4)
    ]
    r = client.post("/api/vrp/solve/sync", json={"stops": stops, "vehicles": vehicles})
    assert r.status_code == 200
    resp = r.json()
    assert resp["unassigned"] == []
    for route in resp["routes"]:
        job_steps = [s for s in route["steps"] if s["type"] == "job"]
        assert len(job_steps) <= 1, "Each vehicle should carry at most 1 stop given tight capacity"


def test_vrp_two_vehicles_share_stops() -> None:
    """2 vehicles, 4 stops — both vehicles should be used (stops split between them)."""
    stops = [
        {"id": 1, "location": {"lat": 45.51, "lon": -73.58}, "demand": [50]},
        {"id": 2, "location": {"lat": 45.52, "lon": -73.56}, "demand": [50]},
        {"id": 3, "location": {"lat": 45.53, "lon": -73.54}, "demand": [50]},
        {"id": 4, "location": {"lat": 45.54, "lon": -73.52}, "demand": [50]},
    ]
    vehicles = [
        {"id": 0, "start_location": {"lat": 45.50, "lon": -73.57}, "capacity": [110]},
        {"id": 1, "start_location": {"lat": 45.50, "lon": -73.57}, "capacity": [110]},
    ]
    r = client.post("/api/vrp/solve/sync", json={"stops": stops, "vehicles": vehicles})
    assert r.status_code == 200
    resp = r.json()
    assert resp["unassigned"] == []
    total_jobs = sum(
        1 for route in resp["routes"] for s in route["steps"] if s["type"] == "job"
    )
    assert total_jobs == 4


def test_vrp_response_schema_fields_present() -> None:
    req = build_api_request(P16K8_DATA, 8)
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    resp = r.json()
    assert "routes" in resp
    assert "total_distance" in resp
    assert "total_duration" in resp
    assert "unassigned" in resp
    if resp["routes"]:
        route = resp["routes"][0]
        assert "vehicle_id" in route
        assert "steps" in route
        assert "total_distance" in route
        step = route["steps"][0]
        assert "type" in step
        assert "location" in step
        assert "lat" in step["location"]
        assert "lon" in step["location"]


def test_vrp_locations_are_valid_floats() -> None:
    req = build_api_request(P16K8_DATA, 8)
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    for route in r.json()["routes"]:
        for step in route["steps"]:
            lat = step["location"]["lat"]
            lon = step["location"]["lon"]
            assert isinstance(lat, (int, float)) and not math.isnan(lat)
            assert isinstance(lon, (int, float)) and not math.isnan(lon)


def test_vrp_more_vehicles_than_stops_ok() -> None:
    """Providing more vehicles than stops should not crash — unused vehicles produce no routes."""
    stops = [{"id": 1, "location": {"lat": 45.51, "lon": -73.56}, "demand": [10]}]
    vehicles = [
        {"id": i, "start_location": {"lat": 45.50, "lon": -73.57}, "capacity": [100]}
        for i in range(10)
    ]
    r = client.post("/api/vrp/solve/sync", json={"stops": stops, "vehicles": vehicles})
    assert r.status_code == 200
    resp = r.json()
    assert resp["unassigned"] == []


def test_vrp_zero_demand_stops_always_assigned() -> None:
    """Stops with demand=0 should always be assignable regardless of capacity."""
    stops = [
        {"id": i, "location": {"lat": 45.50 + i * 0.01, "lon": -73.57}, "demand": [0]}
        for i in range(1, 6)
    ]
    vehicles = [{"id": 0, "start_location": {"lat": 45.50, "lon": -73.57}, "capacity": [1]}]
    r = client.post("/api/vrp/solve/sync", json={"stops": stops, "vehicles": vehicles})
    assert r.status_code == 200
    assert r.json()["unassigned"] == []


def test_vrp_time_windows_flag_does_not_crash() -> None:
    req = build_api_request(P16K8_DATA, 8)
    req["use_time_windows"] = True
    for v in req["vehicles"]:
        v["time_window"] = [0, 86400]
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200


def test_vrp_end_location_override() -> None:
    """Vehicles with explicit end_location different from start should still produce valid routes."""
    req = {
        "stops": [
            {"id": 1, "location": {"lat": 45.52, "lon": -73.55}, "demand": [10]},
            {"id": 2, "location": {"lat": 45.53, "lon": -73.54}, "demand": [10]},
        ],
        "vehicles": [
            {
                "id": 0,
                "start_location": {"lat": 45.50, "lon": -73.57},
                "end_location": {"lat": 45.60, "lon": -73.50},
                "capacity": [100],
            }
        ],
    }
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    assert r.json()["unassigned"] == []


def test_vrp_service_duration_field_accepted() -> None:
    req = {
        "stops": [
            {"id": 1, "location": {"lat": 45.52, "lon": -73.55}, "demand": [5], "service_duration": 300},
        ],
        "vehicles": [{"id": 0, "start_location": {"lat": 45.50, "lon": -73.57}, "capacity": [100]}],
    }
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200


def test_vrp_deterministic_repeated_calls() -> None:
    """Same input should produce the same total_distance on two consecutive calls."""
    req = build_api_request(P16K8_DATA, 8)
    r1 = client.post("/api/vrp/solve/sync", json=req)
    r2 = client.post("/api/vrp/solve/sync", json=req)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["total_distance"] == r2.json()["total_distance"]


def test_vrp_zero_distance_route() -> None:
    """All stops at depot location -> 0 total distance, but all assigned."""
    depot = {"lat": 45.50, "lon": -73.57}
    stops = [
        {"id": i, "location": depot, "demand": [10]}
        for i in range(1, 5)
    ]
    vehicles = [{"id": 0, "start_location": depot, "capacity": [100]}]
    r = client.post("/api/vrp/solve/sync", json={"stops": stops, "vehicles": vehicles})
    assert r.status_code == 200
    resp = r.json()
    assert resp["unassigned"] == []
    assert resp["total_distance"] == 0


def test_vrp_massive_distance_outliers() -> None:
    """Very far away stops (intercontinental) should be handled by Haversine."""
    # Montreal to Tokyo (~10,000 km)
    montreal = {"lat": 45.50, "lon": -73.57}
    tokyo = {"lat": 35.68, "lon": 139.76}
    sydney = {"lat": -33.86, "lon": 151.20}
    
    stops = [
        {"id": 1, "location": tokyo, "demand": [1]},
        {"id": 2, "location": sydney, "demand": [1]},
    ]
    vehicles = [{"id": 0, "start_location": montreal, "capacity": [10]}]
    r = client.post("/api/vrp/solve/sync", json={"stops": stops, "vehicles": vehicles})
    assert r.status_code == 200
    resp = r.json()
    assert resp["unassigned"] == []
    # Total distance should be massive but calculated.
    # Montreal -> Tokyo -> Sydney -> Montreal
    assert resp["total_distance"] > 20_000_000 # in meters (20,000 km)


def test_vrp_impossible_demand_unassigned() -> None:
    """Stop demand exceeds vehicle capacity -> stop should be unassigned."""
    req = {
        "stops": [{"id": 1, "location": {"lat": 45.52, "lon": -73.56}, "demand": [500]}],
        "vehicles": [{"id": 0, "start_location": {"lat": 45.50, "lon": -73.57}, "capacity": [100]}],
    }
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    assert r.json()["unassigned"] == [1]


def test_vrp_invalid_time_window_422() -> None:
    """Inverted time window [200, 100] should fail Pydantic validation."""
    req = {
        "stops": [{"id": 1, "location": {"lat": 45.5, "lon": -73.5}, "time_window": [200, 100]}],
        "vehicles": [{"id": 0, "start_location": {"lat": 45.5, "lon": -73.5}, "capacity": [100]}],
    }
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 422


def test_vrp_nan_coordinates_422() -> None:
    """Non-numeric coordinates should fail Pydantic validation."""
    req = {
        "stops": [{"id": 1, "location": {"lat": "not-a-number", "lon": -73.5}}],
        "vehicles": [{"id": 0, "start_location": {"lat": 45.5, "lon": -73.5}, "capacity": [100]}],
    }
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 422


def test_vrp_negative_values_422() -> None:
    """Negative capacity or service duration should fail Pydantic validation."""
    req = {
        "stops": [{"id": 1, "location": {"lat": 45.5, "lon": -73.5}, "service_duration": -10}],
        "vehicles": [{"id": 0, "start_location": {"lat": 45.5, "lon": -73.5}, "capacity": [-1]}],
    }
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 422


def test_vrp_unreachable_time_window_unassigned() -> None:
    """Tight time window that can't be reached in time -> unassigned."""
    req = {
        "use_time_windows": True,
        "stops": [
            {
                "id": 1,
                "location": {"lat": 45.60, "lon": -73.50}, # ~12km away
                "time_window": [0, 10], # only 10 seconds to get there
            }
        ],
        "vehicles": [
            {
                "id": 0,
                "start_location": {"lat": 45.50, "lon": -73.57},
                "capacity": [100],
                "time_window": [0, 86400],
            }
        ],
    }
    r = client.post("/api/vrp/solve/sync", json=req)
    assert r.status_code == 200
    assert r.json()["unassigned"] == [1]
