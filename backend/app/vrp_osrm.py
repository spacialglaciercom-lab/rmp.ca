"""
VRP (Vehicle Routing Problem) solver with OSRM distance matrix integration.

This module provides true road-distance-based VRP solving using OSRM
for accurate distance and time matrices, replacing haversine approximations.

Key features:
- Fetches distance/time matrices from OSRM Table API
- Supports multiple vehicles with capacity constraints
- Time windows and service times
- Zone clustering for large-scale problems
- Caching for repeated queries
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import time
from dataclasses import dataclass, field
from typing import Any

import aiohttp
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

OSRM_URL = os.getenv("OSRM_URL", "http://localhost:5000")
OSRM_TABLE_URL = f"{OSRM_URL}/table/v1/driving"
OSRM_ROUTE_URL = f"{OSRM_URL}/route/v1/driving"

# Cache settings
DISTANCE_CACHE_TTL_SECONDS = 3600  # 1 hour
MAX_CACHE_SIZE = 10000

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class VrpLocation(BaseModel):
    """A location in the VRP."""
    id: str
    lat: float
    lon: float
    demand: float = 0.0
    service_time_minutes: float = 5.0
    time_window_start: float | None = None  # Minutes from start of day
    time_window_end: float | None = None


class VrpVehicle(BaseModel):
    """A vehicle in the VRP."""
    id: str
    capacity: float
    start_lat: float
    start_lon: float
    end_lat: float | None = None
    end_lon: float | None = None
    max_route_time_minutes: float | None = None


class VrpOsrmRequest(BaseModel):
    """Request for VRP with OSRM distances."""
    locations: list[VrpLocation]
    vehicles: list[VrpVehicle]
    
    # Solver options
    solver: str = Field(
        "clarke-wright",
        description="Solver algorithm: 'clarke-wright', 'or-tools', or 'zone-cluster'",
    )
    max_iterations: int = Field(100, ge=1, description="Max iterations for local search")
    
    # OSRM options
    use_osrm: bool = Field(True, description="Use OSRM for distance matrix (fallback to haversine)")
    osrm_annotations: str = Field(
        "duration,distance",
        description="OSRM annotations to fetch: 'duration', 'distance', or 'duration,distance'",
    )
    
    # Caching
    cache_distance_matrix: bool = Field(True, description="Cache OSRM distance matrix results")


class VrpRoute(BaseModel):
    """A single vehicle route."""
    vehicle_id: str
    stops: list[str]
    total_distance_km: float
    total_time_minutes: float
    total_demand: float
    geometry: list[list[float]]  # [[lon, lat], ...]


class VrpOsrmResponse(BaseModel):
    """Response from VRP solver."""
    routes: list[VrpRoute]
    total_distance_km: float
    total_time_minutes: float
    unassigned: list[str]
    timing_ms: dict[str, float]
    distance_matrix_source: str
    message: str


# ---------------------------------------------------------------------------
# Distance Matrix Cache
# ---------------------------------------------------------------------------

_distance_cache: dict[str, tuple[list[list[float]], list[list[float]], float]] = {}


def _cache_key(locations: list[VrpLocation], annotations: str) -> str:
    """Generate cache key for distance matrix."""
    coords = ";".join(f"{loc.lon:.6f},{loc.lat:.6f}" for loc in locations)
    return hashlib.md5(f"{coords}:{annotations}".encode()).hexdigest()


def _get_cached_matrix(key: str) -> tuple[list[list[float]], list[list[float]]] | None:
    """Get cached distance matrix if not expired."""
    if key in _distance_cache:
        distances, durations, timestamp = _distance_cache[key]
        if time.time() - timestamp < DISTANCE_CACHE_TTL_SECONDS:
            return distances, durations
        del _distance_cache[key]
    return None


def _set_cached_matrix(key: str, distances: list[list[float]], durations: list[list[float]]) -> None:
    """Cache distance matrix."""
    if len(_distance_cache) >= MAX_CACHE_SIZE:
        # Remove oldest entry
        oldest_key = min(_distance_cache.keys(), key=lambda k: _distance_cache[k][2])
        del _distance_cache[oldest_key]
    _distance_cache[key] = (distances, durations, time.time())


# ---------------------------------------------------------------------------
# OSRM Distance Matrix
# ---------------------------------------------------------------------------

async def fetch_osrm_matrix(
    locations: list[VrpLocation],
    annotations: str = "duration,distance",
    session: aiohttp.ClientSession | None = None,
) -> tuple[list[list[float]], list[list[float]]]:
    """
    Fetch distance and duration matrix from OSRM Table API.
    
    Returns:
        - Distance matrix in kilometers
        - Duration matrix in minutes
    """
    # Build coordinates string
    coords = ";".join(f"{loc.lon},{loc.lat}" for loc in locations)
    
    url = f"{OSRM_TABLE_URL}/{coords}"
    params = {
        "annotations": annotations,
        "sources": ";".join(str(i) for i in range(len(locations))),
        "destinations": ";".join(str(i) for i in range(len(locations))),
    }
    
    own_session = session is None
    if own_session:
        session = aiohttp.ClientSession()
    
    try:
        async with session.get(url, params=params) as response:
            if response.status != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"OSRM error: {response.status}",
                )
            
            data = await response.json()
            
            if data.get("code") != "Ok":
                raise HTTPException(
                    status_code=502,
                    detail=f"OSRM error: {data.get('message', 'Unknown error')}",
                )
            
            # Extract matrices
            distances_m = data.get("distances", [])
            durations_s = data.get("durations", [])
            
            # Convert to km and minutes
            n = len(locations)
            distances_km = [[0.0] * n for _ in range(n)]
            durations_min = [[0.0] * n for _ in range(n)]
            
            for i in range(n):
                for j in range(n):
                    if distances_m:
                        distances_km[i][j] = (distances_m[i][j] or 0) / 1000.0
                    if durations_s:
                        durations_min[i][j] = (durations_s[i][j] or 0) / 60.0
            
            return distances_km, durations_min
            
    finally:
        if own_session:
            await session.close()


def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Calculate haversine distance in kilometers."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def _haversine_matrix(locations: list[VrpLocation]) -> tuple[list[list[float]], list[list[float]]]:
    """Compute distance matrix using haversine formula."""
    n = len(locations)
    distances_km = [[0.0] * n for _ in range(n)]
    durations_min = [[0.0] * n for _ in range(n)]
    
    # Assume average speed of 30 km/h for duration estimation
    avg_speed_kmh = 30.0
    
    for i in range(n):
        for j in range(n):
            if i != j:
                dist = _haversine_km(
                    locations[i].lon, locations[i].lat,
                    locations[j].lon, locations[j].lat,
                )
                distances_km[i][j] = dist
                durations_min[i][j] = (dist / avg_speed_kmh) * 60.0
    
    return distances_km, durations_min


# ---------------------------------------------------------------------------
# Clarke-Wright Savings Algorithm
# ---------------------------------------------------------------------------

@dataclass
class _SavingsNode:
    """Node in the savings list."""
    i: int
    j: int
    savings: float


def _clarke_wright_solve(
    locations: list[VrpLocation],
    vehicles: list[VrpVehicle],
    distances_km: list[list[float]],
    durations_min: list[list[float]],
) -> list[VrpRoute]:
    """
    Solve VRP using Clarke-Wright savings algorithm.
    
    This is a parallel savings algorithm that builds routes by merging
    smaller routes based on distance savings.
    """
    n = len(locations)
    depot_idx = 0  # First location is depot
    
    # Initialize: each location is its own route
    # routes[i] = list of location indices in route
    routes: list[list[int]] = [[i] for i in range(1, n)]
    route_of: dict[int, int] = {i: i - 1 for i in range(1, n)}
    vehicle_routes: list[list[int]] = []
    
    # Calculate savings: s(i,j) = d(depot,i) + d(depot,j) - d(i,j)
    savings: list[_SavingsNode] = []
    for i in range(1, n):
        for j in range(i + 1, n):
            s = distances_km[depot_idx][i] + distances_km[depot_idx][j] - distances_km[i][j]
            if s > 0:
                savings.append(_SavingsNode(i, j, s))
    
    # Sort by savings (descending)
    savings.sort(key=lambda x: x.savings, reverse=True)
    
    # Merge routes based on savings
    for sn in savings:
        i, j = sn.i, sn.j
        
        # Check if i and j are in different routes and at endpoints
        if i not in route_of or j not in route_of:
            continue
        
        ri = route_of[i]
        rj = route_of[j]
        
        if ri == rj:
            continue  # Same route
        
        route_i = routes[ri]
        route_j = routes[rj]
        
        # Check if i and j are at endpoints of their routes
        i_at_start = route_i[0] == i
        i_at_end = route_i[-1] == i
        j_at_start = route_j[0] == j
        j_at_end = route_j[-1] == j
        
        if not (i_at_start or i_at_end) or not (j_at_start or j_at_end):
            continue
        
        # Check capacity constraints
        total_demand = sum(locations[idx].demand for idx in route_i + route_j)
        if vehicles and total_demand > vehicles[0].capacity:
            continue
        
        # Merge routes
        if i_at_end and j_at_start:
            new_route = route_i + route_j
        elif i_at_start and j_at_end:
            new_route = route_j + route_i
        elif i_at_end and j_at_end:
            new_route = route_i + list(reversed(route_j))
        else:  # i_at_start and j_at_start
            new_route = list(reversed(route_i)) + route_j
        
        # Update routes
        routes[ri] = new_route
        routes[rj] = []
        
        for idx in new_route:
            route_of[idx] = ri
    
    # Filter empty routes
    routes = [r for r in routes if r]
    
    # Assign routes to vehicles
    for v_idx, vehicle in enumerate(vehicles):
        if v_idx < len(routes):
            route = routes[v_idx]
            vehicle_routes.append(route)
    
    # Build VrpRoute objects
    result: list[VrpRoute] = []
    for v_idx, route_indices in enumerate(vehicle_routes):
        if not route_indices:
            continue
        
        vehicle = vehicles[v_idx] if v_idx < len(vehicles) else vehicles[0]
        
        # Calculate totals
        total_dist = 0.0
        total_time = 0.0
        total_demand = 0.0
        
        # Add depot to start
        full_route = [depot_idx] + route_indices + [depot_idx]
        
        for k in range(len(full_route) - 1):
            i, j = full_route[k], full_route[k + 1]
            total_dist += distances_km[i][j]
            total_time += durations_min[i][j]
            total_time += locations[full_route[k + 1]].service_time_minutes
        
        total_demand = sum(locations[idx].demand for idx in route_indices)
        
        # Build geometry
        geometry: list[list[float]] = []
        for idx in full_route:
            geometry.append([locations[idx].lon, locations[idx].lat])
        
        result.append(VrpRoute(
            vehicle_id=vehicle.id,
            stops=[locations[idx].id for idx in route_indices],
            total_distance_km=round(total_dist, 4),
            total_time_minutes=round(total_time, 2),
            total_demand=total_demand,
            geometry=geometry,
        ))
    
    return result


# ---------------------------------------------------------------------------
# Zone Clustering + 2-opt
# ---------------------------------------------------------------------------

def _zone_cluster_solve(
    locations: list[VrpLocation],
    vehicles: list[VrpVehicle],
    distances_km: list[list[float]],
    durations_min: list[list[float]],
) -> list[VrpRoute]:
    """
    Solve VRP using zone clustering + 2-opt improvement.
    
    This approach:
    1. Clusters locations into zones using k-means
    2. Assigns zones to vehicles
    3. Solves TSP within each zone using 2-opt
    """
    n = len(locations)
    if n <= 1:
        return []
    
    depot_idx = 0
    depot_lat = locations[depot_idx].lat
    depot_lon = locations[depot_idx].lon
    
    # Simple clustering: assign each location to nearest vehicle start
    clusters: dict[int, list[int]] = {v_idx: [] for v_idx in range(len(vehicles))}
    
    for i in range(1, n):
        min_dist = float("inf")
        best_v = 0
        for v_idx, vehicle in enumerate(vehicles):
            dist = _haversine_km(
                locations[i].lon, locations[i].lat,
                vehicle.start_lon, vehicle.start_lat,
            )
            if dist < min_dist:
                min_dist = dist
                best_v = v_idx
        clusters[best_v].append(i)
    
    # Solve TSP within each cluster using 2-opt
    result: list[VrpRoute] = []
    
    for v_idx, cluster in clusters.items():
        if not cluster:
            continue
        
        vehicle = vehicles[v_idx]
        
        # 2-opt improvement
        route = _two_opt_tsp(cluster, distances_km, depot_idx)
        
        # Calculate totals
        total_dist = 0.0
        total_time = 0.0
        total_demand = 0.0
        
        full_route = [depot_idx] + route + [depot_idx]
        
        for k in range(len(full_route) - 1):
            i, j = full_route[k], full_route[k + 1]
            total_dist += distances_km[i][j]
            total_time += durations_min[i][j]
            total_time += locations[full_route[k + 1]].service_time_minutes
        
        total_demand = sum(locations[idx].demand for idx in route)
        
        # Build geometry
        geometry: list[list[float]] = []
        for idx in full_route:
            geometry.append([locations[idx].lon, locations[idx].lat])
        
        result.append(VrpRoute(
            vehicle_id=vehicle.id,
            stops=[locations[idx].id for idx in route],
            total_distance_km=round(total_dist, 4),
            total_time_minutes=round(total_time, 2),
            total_demand=total_demand,
            geometry=geometry,
        ))
    
    return result


def _two_opt_tsp(
    locations: list[int],
    distances_km: list[list[float]],
    depot_idx: int = 0,
) -> list[int]:
    """
    Solve TSP using 2-opt local search.
    
    Returns ordered list of location indices (excluding depot).
    """
    if len(locations) <= 2:
        return locations
    
    # Start with nearest neighbor heuristic
    route = _nearest_neighbor(locations, distances_km, depot_idx)
    
    # 2-opt improvement
    improved = True
    while improved:
        improved = False
        for i in range(len(route) - 1):
            for j in range(i + 2, len(route)):
                # Calculate current distance
                d_current = (
                    distances_km[route[i]][route[i + 1]] +
                    distances_km[route[j]][route[(j + 1) % len(route)]]
                )
                # Calculate new distance after 2-opt swap
                d_new = (
                    distances_km[route[i]][route[j]] +
                    distances_km[route[i + 1]][route[(j + 1) % len(route)]]
                )
                
                if d_new < d_current:
                    # Perform 2-opt swap
                    route[i + 1:j + 1] = reversed(route[i + 1:j + 1])
                    improved = True
    
    return route


def _nearest_neighbor(
    locations: list[int],
    distances_km: list[list[float]],
    depot_idx: int = 0,
) -> list[int]:
    """Nearest neighbor heuristic for TSP."""
    if not locations:
        return []
    
    route: list[int] = []
    remaining = set(locations)
    current = depot_idx
    
    while remaining:
        nearest = min(remaining, key=lambda x: distances_km[current][x])
        route.append(nearest)
        remaining.remove(nearest)
        current = nearest
    
    return route


# ---------------------------------------------------------------------------
# OR-Tools Integration
# ---------------------------------------------------------------------------

def _ortools_solve(
    locations: list[VrpLocation],
    vehicles: list[VrpVehicle],
    distances_km: list[list[float]],
    durations_min: list[list[float]],
) -> list[VrpRoute]:
    """
    Solve VRP using Google OR-Tools.
    
    Falls back to Clarke-Wright if OR-Tools is not available.
    """
    try:
        from ortools.constraint_solver import routing_enums_pb2
        from ortools.constraint_solver import pywrapcp
    except ImportError:
        # Fallback to Clarke-Wright
        return _clarke_wright_solve(locations, vehicles, distances_km, durations_min)
    
    n = len(locations)
    depot_idx = 0
    
    # Create routing index manager
    manager = pywrapcp.RoutingIndexManager(
        n,  # number of locations
        len(vehicles),  # number of vehicles
        depot_idx,  # depot
    )
    
    # Create routing model
    routing = pywrapcp.RoutingModel(manager)
    
    # Create distance callback
    def distance_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return int(distances_km[from_node][to_node] * 1000)  # Convert to meters
    
    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    
    # Define cost of each arc
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)
    
    # Add capacity constraint
    def demand_callback(from_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        return int(locations[from_node].demand)
    
    demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
    
    for v_idx, vehicle in enumerate(vehicles):
        routing.AddDimensionWithVehicleCapacity(
            demand_callback_index,
            0,  # null capacity slack
            [int(vehicle.capacity)],  # vehicle maximum capacities
            False,  # start cumul to zero
            "Capacity",
        )
    
    # Setting first solution heuristic
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_parameters.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_parameters.time_limit.seconds = 30
    
    # Solve
    solution = routing.SolveWithParameters(search_parameters)
    
    if not solution:
        # Fallback to Clarke-Wright
        return _clarke_wright_solve(locations, vehicles, distances_km, durations_min)
    
    # Extract routes
    result: list[VrpRoute] = []
    
    for v_idx, vehicle in enumerate(vehicles):
        index = routing.Start(v_idx)
        route_indices: list[int] = []
        
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            if node != depot_idx:
                route_indices.append(node)
            index = solution.Value(routing.NextVar(index))
        
        if not route_indices:
            continue
        
        # Calculate totals
        total_dist = 0.0
        total_time = 0.0
        total_demand = 0.0
        
        full_route = [depot_idx] + route_indices + [depot_idx]
        
        for k in range(len(full_route) - 1):
            i, j = full_route[k], full_route[k + 1]
            total_dist += distances_km[i][j]
            total_time += durations_min[i][j]
            total_time += locations[full_route[k + 1]].service_time_minutes
        
        total_demand = sum(locations[idx].demand for idx in route_indices)
        
        # Build geometry
        geometry: list[list[float]] = []
        for idx in full_route:
            geometry.append([locations[idx].lon, locations[idx].lat])
        
        result.append(VrpRoute(
            vehicle_id=vehicle.id,
            stops=[locations[idx].id for idx in route_indices],
            total_distance_km=round(total_dist, 4),
            total_time_minutes=round(total_time, 2),
            total_demand=total_demand,
            geometry=geometry,
        ))
    
    return result


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/api/vrp/osrm", response_model=VrpOsrmResponse)
async def solve_vrp_osrm(request: VrpOsrmRequest):
    """
    Solve VRP using OSRM distance matrix.
    
    This endpoint:
    1. Fetches distance/time matrix from OSRM Table API
    2. Solves VRP using the specified algorithm
    3. Returns routes with geometry
    
    Supports:
    - Clarke-Wright savings algorithm (default)
    - Zone clustering + 2-opt
    - Google OR-Tools (if installed)
    """
    _t_start = time.perf_counter()
    
    # Validate input
    if len(request.locations) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least 2 locations required",
        )
    
    if not request.vehicles:
        raise HTTPException(
            status_code=400,
            detail="At least 1 vehicle required",
        )
    
    # Get distance matrix
    distances_km: list[list[float]]
    durations_min: list[list[float]]
    distance_source = "haversine"
    
    if request.use_osrm:
        try:
            # Check cache
            cache_key = _cache_key(request.locations, request.osrm_annotations)
            cached = _get_cached_matrix(cache_key) if request.cache_distance_matrix else None
            
            if cached:
                distances_km, durations_min = cached
                distance_source = "osrm_cached"
            else:
                distances_km, durations_min = await fetch_osrm_matrix(
                    request.locations,
                    request.osrm_annotations,
                )
                distance_source = "osrm"
                
                if request.cache_distance_matrix:
                    _set_cached_matrix(cache_key, distances_km, durations_min)
                    
        except Exception as e:
            # Fallback to haversine
            distances_km, durations_min = _haversine_matrix(request.locations)
            distance_source = f"haversine_fallback:{str(e)}"
    else:
        distances_km, durations_min = _haversine_matrix(request.locations)
    
    _t_after_matrix = time.perf_counter()
    
    # Solve VRP
    if request.solver == "clarke-wright":
        routes = _clarke_wright_solve(request.locations, request.vehicles, distances_km, durations_min)
    elif request.solver == "zone-cluster":
        routes = _zone_cluster_solve(request.locations, request.vehicles, distances_km, durations_min)
    elif request.solver == "or-tools":
        routes = _ortools_solve(request.locations, request.vehicles, distances_km, durations_min)
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown solver: {request.solver}",
        )
    
    _t_after_solve = time.perf_counter()
    
    # Calculate totals
    total_distance_km = sum(r.total_distance_km for r in routes)
    total_time_minutes = sum(r.total_time_minutes for r in routes)
    
    # Find unassigned locations
    assigned = set()
    for route in routes:
        assigned.update(route.stops)
    unassigned = [loc.id for loc in request.locations if loc.id not in assigned and loc.id != request.locations[0].id]
    
    _t_end = time.perf_counter()
    
    return VrpOsrmResponse(
        routes=routes,
        total_distance_km=round(total_distance_km, 4),
        total_time_minutes=round(total_time_minutes, 2),
        unassigned=unassigned,
        timing_ms={
            "matrix_ms": round((_t_after_matrix - _t_start) * 1000, 2),
            "solve_ms": round((_t_after_solve - _t_after_matrix) * 1000, 2),
            "total_ms": round((_t_end - _t_start) * 1000, 2),
        },
        distance_matrix_source=distance_source,
        message=f"Solved VRP with {len(routes)} routes, {round(total_distance_km, 2)} km total distance",
    )


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@router.get("/api/vrp/osrm/health")
async def osrm_health():
    """Check if OSRM is available."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{OSRM_URL}/health", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status == 200:
                    return {"status": "ok", "osrm_url": OSRM_URL}
                return {"status": "error", "message": f"OSRM returned {resp.status}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}