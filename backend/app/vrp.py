"""
VRP Solver API using Google OR-Tools.
Replaces the VROOM-Express functionality.
"""
from __future__ import annotations

import math
import sys
from typing import List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

from .gpx_export import Waypoint, RouteSegment, build_gpx
from .analytics import calculate_route_metrics

router = APIRouter()

# Accept header value for GPX response (dual-path: JSON or GPX)
ACCEPT_GPX = "application/gpx+xml"

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class VrpLocation(BaseModel):
    lat: float
    lon: float

class VrpStop(BaseModel):
    id: int  # Unique ID
    location: VrpLocation
    demand: list[int] = [0] # List of capacities to match VROOM style
    time_window: Optional[Tuple[int, int]] = None  # (start, end)
    service_duration: int = 0
    label: Optional[str] = None

class VrpVehicle(BaseModel):
    id: int
    start_location: VrpLocation
    end_location: Optional[VrpLocation] = None
    capacity: list[int] = [100]
    time_window: Optional[Tuple[int, int]] = None

class VrpRequest(BaseModel):
    stops: List[VrpStop]
    vehicles: List[VrpVehicle]
    use_time_windows: bool = False
    objective: str = "min_distance"  # min_distance | min_time | balance_load | min_vehicles

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


@router.post("/api/vrp/solve")
def solve_vrp(request: Request, req: VrpRequest):
    if not req.vehicles:
        raise HTTPException(status_code=400, detail="No vehicles provided")
    if not req.stops:
        return VrpResponse(routes=[], total_distance=0, total_duration=0)

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
    n_vehicles = len(req.vehicles)
    min_cap_to_spread = math.ceil(total_demand / n_vehicles) if n_vehicles > 1 else total_demand

    vehicle_caps = []
    for v in req.vehicles:
        user_cap = v.capacity[0] if v.capacity else 100
        # Cap to min_cap_to_spread so each vehicle can only carry its fair share,
        # but never reduce below 1 or the user's cap if it was already constraining.
        effective_cap = min(user_cap, max(min_cap_to_spread, 1))
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

    response = VrpResponse(
        routes=response_routes,
        total_distance=total_dist_all,
        total_duration=total_dur_all,
        unassigned=unassigned_ids,
    )
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
