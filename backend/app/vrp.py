"""
VRP Solver API using Google OR-Tools.
Replaces the VROOM-Express functionality.
"""
from __future__ import annotations

import math
import sys
from typing import List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

from .gpx_export import Waypoint, RouteSegment, build_gpx
from .analytics import calculate_route_metrics
from .vrp_registry import get_solver, get_solver_ids, get_default_solver_id, register_solver

router = APIRouter()

# Accept header value for GPX response (dual-path: JSON or GPX)
ACCEPT_GPX = "application/gpx+xml"

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class VrpLocation(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)

class VrpStop(BaseModel):
    id: int  # Unique ID
    location: VrpLocation
    demand: list[int] = Field(default_factory=lambda: [0]) # List of capacities to match VROOM style
    time_window: Optional[Tuple[int, int]] = None  # (start, end)
    service_duration: int = Field(default=0, ge=0)
    label: Optional[str] = None

    @field_validator("time_window")
    @classmethod
    def validate_time_window(cls, v: Optional[Tuple[int, int]]) -> Optional[Tuple[int, int]]:
        if v and v[0] > v[1]:
            raise ValueError("time_window start must be <= end")
        return v

    @field_validator("demand")
    @classmethod
    def validate_demand(cls, v: list[int]) -> list[int]:
        if any(d < 0 for d in v):
            raise ValueError("demand values must be non-negative")
        return v

class VrpVehicle(BaseModel):
    id: int
    start_location: VrpLocation
    end_location: Optional[VrpLocation] = None
    capacity: list[int] = Field(default_factory=lambda: [100])
    time_window: Optional[Tuple[int, int]] = None

    @field_validator("time_window")
    @classmethod
    def validate_time_window(cls, v: Optional[Tuple[int, int]]) -> Optional[Tuple[int, int]]:
        if v and v[0] > v[1]:
            raise ValueError("time_window start must be <= end")
        return v

    @field_validator("capacity")
    @classmethod
    def validate_capacity(cls, v: list[int]) -> list[int]:
        if any(c < 0 for c in v):
            raise ValueError("capacity values must be non-negative")
        return v

class VrpRequest(BaseModel):
    stops: List[VrpStop]
    vehicles: List[VrpVehicle]
    use_time_windows: bool = False
    objective: str = "min_distance"  # min_distance | min_time | balance_load | min_vehicles
    solver: Optional[str] = None  # solver id from registry; default "ortools"

class VrpRouteStep(BaseModel):
    type: str  # "start", "job", "end"
    id: Optional[int] = None
    location: VrpLocation
    arrival: int
    duration: int
    wait: int = 0
    distance: int = 0

class VrpRoute(BaseModel):
    vehicle_id: int
    steps: List[VrpRouteStep]
    total_distance: int
    total_duration: int
    total_load: int
    metrics: dict = {}

class VrpResponse(BaseModel):
    routes: List[VrpRoute]
    total_distance: int
    total_duration: int
    unassigned: List[int] = []

# ---------------------------------------------------------------------------
# Solver Logic
# ---------------------------------------------------------------------------

def compute_distance_matrix(locations: List[Tuple[float, float]]) -> dict:
    """Computes Haversine distance matrix (in meters)."""
    size = len(locations)
    matrix = {}
    
    for from_node in range(size):
        matrix[from_node] = {}
        for to_node in range(size):
            if from_node == to_node:
                matrix[from_node][to_node] = 0
            else:
                lat1, lon1 = locations[from_node]
                lat2, lon2 = locations[to_node]
                # Haversine
                R = 6371000  # Radius of Earth in meters
                phi1, phi2 = math.radians(lat1), math.radians(lat2)
                dphi = math.radians(lat2 - lat1)
                dlambda = math.radians(lon2 - lon1)
                a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
                c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
                matrix[from_node][to_node] = int(R * c)
    return matrix


def _vrp_response_to_gpx_segments(response: VrpResponse) -> list[RouteSegment]:
    """Convert VrpResponse to RouteSegment list for GPX export."""
    segments: list[RouteSegment] = []
    for route in response.routes:
        waypoints = []
        for s in route.steps:
            if s.type == "start":
                name = "Depot"
            elif s.type == "job":
                name = f"Stop {s.id}" if s.id is not None else "Stop"
            else:
                name = "End"
            waypoints.append(Waypoint(s.location.lat, s.location.lon, name=name))
        track = [(s.location.lat, s.location.lon) for s in route.steps]
        segments.append(
            RouteSegment(
                track=track,
                waypoints=waypoints,
                name=f"Vehicle {route.vehicle_id}",
            )
        )
    return segments


class OrtoolsVrpSolver:
    """OR-Tools-based VRP solver. Registered as "ortools" in the solver registry."""

    def solve(self, req: VrpRequest) -> VrpResponse:
        return _solve_ortools(req)


def _solve_ortools(req: VrpRequest) -> VrpResponse:
    """OR-Tools solve logic (used by OrtoolsVrpSolver)."""
    # 1. Prepare Data
    all_locs = [] # List[Tuple[lat, lon]]
    
    # Add stops (Indices 0 to num_stops-1)
    for stop in req.stops:
        all_locs.append((stop.location.lat, stop.location.lon))
    
    num_stops = len(req.stops)
    vehicle_indices = []

    for v in req.vehicles:
        # Add Start
        all_locs.append((v.start_location.lat, v.start_location.lon))
        start_idx = len(all_locs) - 1
        
        # Add End
        cutoff_loc = v.end_location if v.end_location else v.start_location
        all_locs.append((cutoff_loc.lat, cutoff_loc.lon))
        end_idx = len(all_locs) - 1
        
        vehicle_indices.append((start_idx, end_idx))

    # Create Routing Index Manager
    manager = pywrapcp.RoutingIndexManager(
        len(all_locs),
        len(req.vehicles),
        [vi[0] for vi in vehicle_indices],
        [vi[1] for vi in vehicle_indices]
    )

    routing = pywrapcp.RoutingModel(manager)

    # 2. Distance Callback
    dist_matrix = compute_distance_matrix(all_locs)
    
    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return dist_matrix[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # 3. Time Windows
    time_callback_index = None
    if req.use_time_windows:
        def time_callback(from_index, to_index):
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            
            service_time = 0
            if from_node < num_stops: # It's a job
                service_time = req.stops[from_node].service_duration
            
            dist = dist_matrix[from_node][to_node]
            travel_time = int(dist / 10.0) # Assumed 10 m/s
            return service_time + travel_time

        time_callback_index = routing.RegisterTransitCallback(time_callback)
        routing.AddDimension(
            time_callback_index,
            3600 * 24,  # slack (max waiting time)
            2**50,      # max cumul (huge capability for Epoch)
            False,      # start cumul to zero
            "Time"
        )
        time_dimension = routing.GetDimensionOrDie("Time")
        
        # Add time windows for Stops
        for i in range(num_stops):
            stop = req.stops[i]
            if stop.time_window:
                index = manager.NodeToIndex(i)
                time_dimension.CumulVar(index).SetRange(
                    stop.time_window[0], 
                    stop.time_window[1]
                )
        
        # Add time windows for Vehicles
        for i, v in enumerate(req.vehicles):
            if v.time_window:
                start_index = routing.Start(i)
                end_index = routing.End(i)
                time_dimension.CumulVar(start_index).SetRange(v.time_window[0], v.time_window[1])
                time_dimension.CumulVar(end_index).SetRange(v.time_window[0], v.time_window[1])

    # 4. Capacity Constraints
    # VROOM supports multi-dimensional capacity. Here we just take the first dimension [0]
    def demand_callback(from_index):
        from_node = manager.IndexToNode(from_index)
        if from_node < num_stops:
            d = req.stops[from_node].demand
            return d[0] if d else 0
        return 0

    demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)

    # Auto-cap vehicle capacity so OR-Tools is forced to spread stops across all
    # vehicles. Without this, a single vehicle with capacity=1000 would serve all
    # 100 stops (demand=1 each) since it fits, ignoring the other vehicles.
    total_demand = sum((s.demand[0] if s.demand else 1) for s in req.stops)
    max_single_demand = max((s.demand[0] if s.demand else 0) for s in req.stops) if req.stops else 0
    n_vehicles = len(req.vehicles)
    min_cap_to_spread = math.ceil(total_demand / n_vehicles) if n_vehicles > 1 else total_demand

    vehicle_caps = []
    for v in req.vehicles:
        user_cap = v.capacity[0] if v.capacity else 100
        # Encourage load spreading, but never cap below the largest single job demand.
        effective_cap = min(user_cap, max(min_cap_to_spread, max_single_demand, 1))
        vehicle_caps.append(effective_cap)

    routing.AddDimensionWithVehicleCapacity(
        demand_callback_index,
        0,  # null capacity slack
        vehicle_caps,
        True, # start cumul to zero
        "Capacity"
    )

    # 5. Solve Parameters
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    # PARALLEL_CHEAPEST_INSERTION distributes stops across vehicles much better
    # than PATH_CHEAPEST_ARC (which greedily builds one route at a time).
    search_parameters.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    )
    search_parameters.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_parameters.time_limit.seconds = 10

    # Load balancing: penalize imbalanced routes so vehicles get equal work.
    if req.objective in ("balance_load", "min_vehicles"):
        cap_dim = routing.GetDimensionOrDie("Capacity")
        for v_id in range(n_vehicles):
            cap_dim.SetGlobalSpanCostCoefficient(100)

    solution = routing.SolveWithParameters(search_parameters)

    # 6. Build Response
    if not solution:
        return VrpResponse(
            routes=[], 
            total_distance=0, 
            total_duration=0,
            unassigned=[s.id for s in req.stops]
        )

    response_routes = []
    total_dist_all = 0
    total_dur_all = 0
    
    time_dim = routing.GetDimensionOrDie("Time") if req.use_time_windows else None
    
    visited_indices = set()

    for vehicle_id in range(len(req.vehicles)):
        index = routing.Start(vehicle_id)
        steps = []
        route_dist = 0
        
        while not routing.IsEnd(index):
            node_index = manager.IndexToNode(index)
            visited_indices.add(node_index)
            
            # Type classification
            if node_index < num_stops:
                s_type = "job"
                s_id = req.stops[node_index].id
            else:
                s_type = "start"
                s_id = None
            
            # Arrival time
            arrival = 0
            if time_dim:
                arrival = solution.Min(time_dim.CumulVar(index))
            
            lat, lon = all_locs[node_index]
            
            steps.append(VrpRouteStep(
                type=s_type,
                id=s_id,
                location=VrpLocation(lat=lat, lon=lon),
                arrival=arrival,
                duration=0, 
                wait=0,
                distance=0
            ))
            
            previous_index = index
            index = solution.Value(routing.NextVar(index))
            
            if not routing.IsEnd(index):
                dist_leg = routing.GetArcCostForVehicle(previous_index, index, vehicle_id)
                route_dist += dist_leg
            else:
                # Last leg to end
                 dist_leg = routing.GetArcCostForVehicle(previous_index, index, vehicle_id)
                 route_dist += dist_leg

        # End Step
        node_index = manager.IndexToNode(index)
        lat, lon = all_locs[node_index]
        visited_indices.add(node_index)
        
        arrival = 0
        if time_dim:
            arrival = solution.Min(time_dim.CumulVar(index))
            
        steps.append(VrpRouteStep(
            type="end",
            location=VrpLocation(lat=lat, lon=lon),
            arrival=arrival,
            duration=0
        ))
        
        # Only include if route has stops (other than start/end)
        # But even moving start->end is a valid route if location differs.
        # VROOM seems to include routes only if they have jobs?
        has_jobs = any(s.type == "job" for s in steps)
        if has_jobs:
            # Analytics: compute per-route metrics from the ordered stop sequence.
            # VRP operates on straight-line (haversine) distances with no plugins.
            path_coords = [(s.location.lon, s.location.lat) for s in steps]
            route_metrics = calculate_route_metrics(path_coords, plugins=[])

            response_routes.append(VrpRoute(
                vehicle_id=vehicle_id,
                steps=steps,
                total_distance=route_dist,
                total_duration=0,
                total_load=0,
                metrics=route_metrics,
            ))
            total_dist_all += route_dist
        
    # Unassigned
    unassigned_ids = []
    assigned_stop_indices = {idx for idx in visited_indices if idx < num_stops}
    for i in range(num_stops):
        if i not in assigned_stop_indices:
            unassigned_ids.append(req.stops[i].id)

    return VrpResponse(
        routes=response_routes,
        total_distance=total_dist_all,
        total_duration=total_dur_all,
        unassigned=unassigned_ids,
    )


# Register built-in OR-Tools solver so /api/vrp/solve can dispatch by solver id
register_solver("ortools", OrtoolsVrpSolver())


# ---------------------------------------------------------------------------
# Async endpoint — enqueue task, return 202 immediately
# ---------------------------------------------------------------------------

@router.post("/api/vrp/solve")
def solve_vrp_async(req: VrpRequest) -> Response:
    """Enqueue a VRP solve job.

    Returns HTTP 202 Accepted with ``{"task_id": "<uuid>", "status": "PENDING"}``.
    Poll ``GET /api/vrp/status/{task_id}`` for progress and the final result.

    Falls back to HTTP 503 when the Redis broker is unreachable.
    """
    from .tasks.vrp_task import solve_vrp_task
    import json as _json

    if not req.vehicles:
        raise HTTPException(status_code=400, detail="No vehicles provided")

    try:
        task = solve_vrp_task.delay(req.model_dump())
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Task queue unavailable — is Redis running? {exc}",
        )

    return Response(
        content=_json.dumps({"task_id": task.id, "status": "PENDING"}),
        status_code=202,
        media_type="application/json",
    )


@router.get("/api/vrp/status/{task_id}")
def get_vrp_status(task_id: str) -> Response:
    """Poll VRP task status.

    State machine:
      PENDING    → job is waiting in the Redis queue
      PROCESSING → worker is actively solving
      SUCCESS    → result ready; ``result`` key contains VrpResponse
      FAILURE    → solver error; ``error`` key contains the message

    HTTP status codes mirror the error taxonomy:
      200 for PENDING / PROCESSING / SUCCESS
      400 for client errors (ValueError — bad stops/vehicles)
      500 for unexpected solver errors
    """
    from celery.result import AsyncResult
    from .celery_app import celery_app
    import json as _json

    ar = AsyncResult(task_id, app=celery_app)
    state = ar.state

    if state == "PENDING":
        payload = {"task_id": task_id, "status": "PENDING"}
        return Response(content=_json.dumps(payload), media_type="application/json")

    if state == "STARTED":
        payload = {"task_id": task_id, "status": "PROCESSING"}
        return Response(content=_json.dumps(payload), media_type="application/json")

    if state == "SUCCESS":
        payload = {"task_id": task_id, "status": "SUCCESS", "result": ar.result}
        return Response(content=_json.dumps(payload), media_type="application/json")

    if state == "FAILURE":
        exc = ar.result
        error_msg = str(exc) if exc else "Unknown VRP solver error"
        http_status = 400 if isinstance(exc, ValueError) else 500
        payload = {"task_id": task_id, "status": "FAILURE", "error": error_msg}
        return Response(
            content=_json.dumps(payload),
            status_code=http_status,
            media_type="application/json",
        )

    payload = {"task_id": task_id, "status": state}
    return Response(content=_json.dumps(payload), media_type="application/json")


# ---------------------------------------------------------------------------
# Sync endpoint — kept for GPX export and backward-compat testing
# ---------------------------------------------------------------------------

@router.post("/api/vrp/solve/sync")
def solve_vrp_sync(request: Request, req: VrpRequest):
    """Synchronous VRP solve — blocks until complete.

    Supports GPX export via ``Accept: application/gpx+xml``.
    Prefer ``POST /api/vrp/solve`` (async) for production use.
    """
    if not req.vehicles:
        raise HTTPException(status_code=400, detail="No vehicles provided")
    if not req.stops:
        return VrpResponse(routes=[], total_distance=0, total_duration=0)

    solver_id = req.solver or get_default_solver_id()
    solver = get_solver(solver_id)
    if not solver:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown solver: {solver_id}. Available: {', '.join(get_solver_ids())}",
        )

    response = solver.solve(req)

    # Dual-path: return GPX when client requests application/gpx+xml
    accept = request.headers.get("Accept", "")
    if ACCEPT_GPX in accept and response.routes:
        segments = _vrp_response_to_gpx_segments(response)
        gpx_str = build_gpx(segments)
        return Response(
            content=gpx_str,
            media_type=ACCEPT_GPX,
            headers={"Content-Disposition": "attachment; filename=route.gpx"},
        )
    return response
