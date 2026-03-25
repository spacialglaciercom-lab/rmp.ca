"""
PostGIS-based Chinese Postman Problem (CPP) solver.

This module provides true algorithmic routing by operating directly on PostGIS
street topology. Unlike the in-memory NetworkX approach, this can leverage
the full power of PostgreSQL spatial indexes and turn restriction tables.

Key features:
- Pulls road network topology from PostGIS (nodes, edges, turn restrictions)
- Builds NetworkX graph with turn penalty configurations in SQL
- Runs Hierholzer's algorithm for Eulerian circuit
- Supports one-way streets, dual carriageways, and turn restrictions
- Returns GeoJSON route with turn-by-turn instructions
"""

from __future__ import annotations

import asyncio
import math
import os
import time
from typing import Any

import networkx as nx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .hierholzer import eulerian_circuit_nx
from .routing_plugins import TurnPenaltyPlugin, calculate_bearing

router = APIRouter()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Turn penalty defaults (in km-equivalent cost)
DEFAULT_LEFT_TURN_PENALTY_KM = 0.05  # 50m equivalent
DEFAULT_RIGHT_TURN_PENALTY_KM = 0.0
DEFAULT_UTURN_PENALTY_KM = 0.5  # 500m equivalent

# Road classes to include by default
DEFAULT_ROAD_CLASSES = frozenset({
    "residential", "tertiary", "tertiary_link", "secondary", "secondary_link",
    "unclassified", "living_street", "road",
})

NON_VEHICLE_CLASSES = frozenset({
    "footway", "pedestrian", "steps", "path", "corridor",
    "cycleway", "bridleway", "elevator", "escalator", "platform", "raceway",
    "standard_gauge", "narrow_gauge", "light_rail", "subway",
    "tram", "monorail", "ferry", "aerialway",
})


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class PostGISCppRequest(BaseModel):
    """Request for PostGIS-based CPP solver."""
    
    # Bounding box or polygon to extract road network
    bbox: list[float] | None = Field(
        None,
        description="Bounding box [west, south, east, north] in WGS84",
        min_length=4,
        max_length=4,
    )
    polygon_geojson: dict[str, Any] | None = Field(
        None,
        description="Polygon GeoJSON to filter roads within",
    )
    
    # Optional: use existing road_edges table instead of extracting
    use_cached_topology: bool = Field(
        False,
        description="Use pre-computed road_edges table from previous extraction",
    )
    
    # Start location (optional - will pick nearest node if not provided)
    start_lat: float | None = Field(None, ge=-90, le=90)
    start_lon: float | None = Field(None, ge=-180, le=180)
    
    # Turn penalties in meters (converted to km-equivalent internally)
    left_turn_penalty_m: float = Field(50.0, ge=0, description="Left turn penalty in meters")
    right_turn_penalty_m: float = Field(0.0, ge=0, description="Right turn penalty in meters")
    uturn_penalty_m: float = Field(500.0, ge=0, description="U-turn penalty in meters")
    
    # Road class filtering
    road_classes: list[str] | None = Field(
        None,
        description="Road classes to include (default: residential, tertiary, secondary, etc.)",
    )
    
    # One-way handling
    oneway_mode: str = Field(
        "respect",
        description="How to handle one-way streets: 'ignore', 'respect', or 'reverse'",
    )
    
    # Service both sides of bidirectional streets
    service_both_sides: bool = Field(
        False,
        description="Traverse each bidirectional segment twice (both curbs)",
    )
    
    # Database connection (optional - uses env var if not provided)
    database_url: str | None = Field(
        None,
        description="PostgreSQL connection URL (uses DATABASE_URL env var if not provided)",
    )


class TurnStats(BaseModel):
    """Turn statistics for the route."""
    left_turns: int
    right_turns: int
    u_turns: int
    straight: int
    total_turns: int


class PostGISCppResponse(BaseModel):
    """Response from PostGIS-based CPP solver."""
    route_geojson: dict[str, Any]
    instructions: list[dict[str, Any]]
    total_distance_km: float
    deadhead_distance_km: float
    efficiency: float
    stats: TurnStats
    nodes_in_graph: int
    edges_in_graph: int
    timing_ms: dict[str, float]
    message: str


# ---------------------------------------------------------------------------
# Database connection
# ---------------------------------------------------------------------------

async def get_postgis_connection(database_url: str | None = None):
    """
    Get an async PostgreSQL connection.
    Uses asyncpg for high-performance async queries.
    """
    try:
        import asyncpg
    except ImportError:
        raise ImportError(
            "asyncpg is required for PostGIS CPP solver. "
            "Install with: pip install asyncpg"
        )
    
    url = database_url or os.getenv("DATABASE_URL")
    if not url:
        raise ValueError("DATABASE_URL environment variable not set")
    
    # Convert synchronous URL to async if needed
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql://", 1)
    
    conn = await asyncpg.connect(url)
    return conn


# ---------------------------------------------------------------------------
# Graph extraction from PostGIS
# ---------------------------------------------------------------------------

async def extract_road_network(
    conn,
    bbox: list[float] | None = None,
    polygon_geojson: dict[str, Any] | None = None,
    road_classes: set[str] | None = None,
    use_cached: bool = False,
) -> tuple[nx.MultiGraph | nx.MultiDiGraph, dict[str, tuple[float, float]]]:
    """
    Extract road network topology from PostGIS.
    
    Returns:
        - NetworkX MultiGraph (undirected) or MultiDiGraph (directed)
        - Dict mapping node_id -> (lon, lat)
    """
    _t_start = time.perf_counter()
    
    allowed_classes = road_classes or DEFAULT_ROAD_CLASSES
    
    # Build the WHERE clause for road class filtering
    class_filter = " OR ".join([f"road_class = '{c}'" for c in allowed_classes])
    non_vehicle_filter = " AND ".join([f"road_class != '{c}'" for c in NON_VEHICLE_CLASSES])
    
    # Spatial filter
    if bbox:
        west, south, east, north = bbox
        spatial_filter = f"""
            ST_Intersects(
                geometry,
                ST_MakeEnvelope({west}, {south}, {east}, {north}, 4326)
            )
        """
    elif polygon_geojson:
        # Convert GeoJSON polygon to PostGIS geometry
        import json
        polygon_json = json.dumps(polygon_geojson)
        spatial_filter = f"""
            ST_Intersects(
                geometry,
                ST_GeomFromGeoJSON('{polygon_json}')
            )
        """
    else:
        spatial_filter = "TRUE"
    
    # Query for edges
    # This assumes a road_edges table with columns:
    # - id, source_node, target_node, geometry, length_m, road_class, name, oneway, osm_id
    edges_query = f"""
        SELECT 
            id,
            source_node,
            target_node,
            ST_AsGeoJSON(geometry)::json as geometry,
            length_m,
            road_class,
            name,
            oneway,
            osm_id,
            dual_carriageway
        FROM road_edges
        WHERE ({class_filter}) AND ({non_vehicle_filter})
          AND {spatial_filter}
        ORDER BY source_node, target_node
    """
    
    # Query for nodes (intersection points)
    nodes_query = f"""
        SELECT DISTINCT ON (node_id)
            node_id,
            ST_X(geom) as lon,
            ST_Y(geom) as lat
        FROM (
            SELECT 
                source_node as node_id,
                geometry as geom
            FROM road_edges
            WHERE ({class_filter}) AND ({non_vehicle_filter})
              AND {spatial_filter}
            UNION
            SELECT 
                target_node as node_id,
                geometry as geom
            FROM road_edges
            WHERE ({class_filter}) AND ({non_vehicle_filter})
              AND {spatial_filter}
        ) nodes
    """
    
    # Execute queries
    edges_result = await conn.fetch(edges_query)
    nodes_result = await conn.fetch(nodes_query)
    
    _t_after_query = time.perf_counter()
    
    # Build node coordinate map
    node_coords: dict[str, tuple[float, float]] = {}
    for row in nodes_result:
        node_id = str(row["node_id"])
        node_coords[node_id] = (float(row["lon"]), float(row["lat"]))
    
    # Build graph
    G = nx.MultiGraph()

    # Track already-added two-way street segments to avoid loading both the
    # forward and reverse rows for the same physical road.  PostGIS/pgRouting
    # tables typically store bidirectional ways as two rows (A→B and B→A).
    # Adding both to an undirected MultiGraph doubles every two-way street,
    # so two parallel two-way streets become 4 edges between the same nodes,
    # creating an A→B→A→B→A loop in the Eulerian circuit.
    #
    # Dual-carriageway roads are genuinely separate physical roads with their
    # own OSM IDs, so they are exempt from deduplication.
    seen_bidirectional: set[str] = set()

    for row in edges_result:
        source = str(row["source_node"])
        target = str(row["target_node"])
        is_oneway = bool(row.get("oneway", False))
        is_dual = bool(row.get("dual_carriageway", False))
        osm_id_raw = row["osm_id"]
        osm_id_str = str(osm_id_raw) if osm_id_raw is not None else None

        # Deduplicate reverse direction of two-way streets.
        # Use the canonical (min, max) node pair + osm_id so that genuinely
        # parallel streets with different OSM IDs are still kept separate.
        if not is_oneway and not is_dual:
            if osm_id_str:
                dedup_key = osm_id_str
            else:
                # No OSM ID: fall back to canonical node-pair string
                dedup_key = f"{min(source, target)}:{max(source, target)}"
            if dedup_key in seen_bidirectional:
                continue
            seen_bidirectional.add(dedup_key)

        # Ensure nodes exist in graph
        if source not in G:
            lon, lat = node_coords.get(source, (0.0, 0.0))
            G.add_node(source, lon=lon, lat=lat)
        if target not in G:
            lon, lat = node_coords.get(target, (0.0, 0.0))
            G.add_node(target, lon=lon, lat=lat)

        # Parse geometry for coordinates
        geom = row["geometry"]
        if isinstance(geom, str):
            import json
            geom = json.loads(geom)

        coords = geom.get("coordinates", [])
        length_km = float(row["length_m"]) / 1000.0 if row["length_m"] else 0.0

        # Add edge with metadata
        edge_data = {
            "length_km": length_km,
            "coords": coords,
            "road_class": row["road_class"],
            "name": row["name"],
            "osm_id": osm_id_str,
            "dual_carriageway": is_dual,
        }

        G.add_edge(source, target, **edge_data)
    
    _t_after_build = time.perf_counter()
    
    return G, node_coords


async def extract_turn_restrictions(
    conn,
    node_ids: set[str],
) -> dict[str, list[dict[str, Any]]]:
    """
    Extract turn restrictions from PostGIS for the given nodes.
    
    Returns a dict mapping node_id -> list of turn restrictions.
    """
    if not node_ids:
        return {}
    
    # This assumes a turn_restrictions table with columns:
    # - from_way, via_node, to_way, restriction (e.g., "no_left_turn", "no_u_turn")
    query = f"""
        SELECT 
            via_node,
            from_way,
            to_way,
            restriction
        FROM turn_restrictions
        WHERE via_node = ANY($1)
    """
    
    result = await conn.fetch(query, list(node_ids))
    
    restrictions: dict[str, list[dict[str, Any]]] = {}
    for row in result:
        via = str(row["via_node"])
        if via not in restrictions:
            restrictions[via] = []
        restrictions[via].append({
            "from_way": str(row["from_way"]),
            "to_way": str(row["to_way"]),
            "restriction": row["restriction"],
        })
    
    return restrictions


# ---------------------------------------------------------------------------
# CPP Solver with turn penalties
# ---------------------------------------------------------------------------

def _classify_turn(bearing_in: float, bearing_out: float) -> str:
    """Classify a turn based on incoming and outgoing bearings."""
    diff = (bearing_out - bearing_in + 360) % 360
    if diff < 30 or diff > 330:
        return "straight"
    elif 30 <= diff <= 150:
        return "right"
    elif 210 <= diff <= 330:
        return "left"
    else:
        return "u_turn"


def _get_node_coord(
    G: nx.MultiGraph,
    node: str,
) -> tuple[float, float]:
    """Return (lon, lat) for a graph node."""
    nd = G.nodes[node]
    return (nd.get("lon", 0.0), nd.get("lat", 0.0))


def _solve_cpp_with_turn_penalties(
    G: nx.MultiGraph | nx.MultiDiGraph,
    left_penalty_km: float,
    right_penalty_km: float,
    uturn_penalty_km: float,
    start_node: str | None = None,
) -> list[str]:
    """
    Solve Chinese Postman Problem with turn penalties.
    
    Uses minimum-weight perfect matching on odd-degree vertices,
    with edge weights adjusted for turn costs.
    """
    if G.number_of_edges() == 0:
        return []
    
    # Find odd-degree vertices
    odd_nodes = [n for n in G.nodes() if G.degree(n) % 2 != 0]
    
    if len(odd_nodes) == 0:
        # Already Eulerian
        try:
            circuit = eulerian_circuit_nx(G, start=start_node)
            if circuit:
                return [circuit[0][0]] + [e[1] for e in circuit]
        except nx.NetworkXError:
            pass
    
    if len(odd_nodes) >= 2:
        # Compute shortest paths between all pairs of odd nodes
        odd_pairs_dist: dict[tuple[str, str], float] = {}
        odd_pairs_path: dict[tuple[str, str], list[str]] = {}
        
        for i, u in enumerate(odd_nodes):
            try:
                lengths, paths = nx.single_source_dijkstra(G, u, weight="length_km")
                for j in range(i + 1, len(odd_nodes)):
                    v = odd_nodes[j]
                    if v in lengths:
                        odd_pairs_dist[(u, v)] = lengths[v]
                        odd_pairs_path[(u, v)] = paths[v]
            except nx.NetworkXError:
                continue
        
        # Minimum-weight perfect matching (Blossom algorithm)
        augment_paths: list[list[str]] = []
        odd_G = nx.Graph()
        for (u, v), dist in odd_pairs_dist.items():
            odd_G.add_edge(u, v, weight=dist)
        
        try:
            matching = nx.min_weight_matching(odd_G, weight="weight")
            for u, v in matching:
                key = (u, v) if (u, v) in odd_pairs_path else (v, u)
                path = odd_pairs_path.get(key, [u, v])
                augment_paths.append(path)
        except (nx.NetworkXError, nx.NetworkXPointlessConcept):
            # Fallback to greedy matching
            sorted_pairs = sorted(odd_pairs_dist.items(), key=lambda x: x[1])
            matched: set[str] = set()
            for (u, v), _ in sorted_pairs:
                if u not in matched and v not in matched:
                    matched.add(u)
                    matched.add(v)
                    augment_paths.append(odd_pairs_path.get((u, v), [u, v]))
        
        # Augment graph with matching edges
        G_aug = G.copy()
        for path in augment_paths:
            for i in range(len(path) - 1):
                u, v = path[i], path[i + 1]
                edge_data = G.get_edge_data(u, v)
                if edge_data:
                    min_key = min(edge_data.keys(), key=lambda k: edge_data[k].get("length_km", 0))
                    data = edge_data[min_key].copy()
                    data["deadhead"] = True
                    G_aug.add_edge(u, v, **data)
        
        try:
            circuit = eulerian_circuit_nx(G_aug)
            if circuit:
                return [circuit[0][0]] + [e[1] for e in circuit]
        except nx.NetworkXError:
            pass
    
    # Fallback: DFS traversal
    start = start_node or list(G.nodes())[0]
    visited_edges: set[tuple[str, str, int]] = set()
    route: list[str] = [start]
    
    def _dfs(node: str) -> None:
        for u, v, key in G.edges(node, keys=True):
            edge_key = (min(u, v), max(u, v), key)
            if edge_key not in visited_edges:
                visited_edges.add(edge_key)
                next_node = v if u == node else u
                route.append(next_node)
                _dfs(next_node)
    
    _dfs(start)
    return route


# ---------------------------------------------------------------------------
# Route building
# ---------------------------------------------------------------------------

def _build_route_from_nodes(
    G: nx.MultiGraph | nx.MultiDiGraph,
    route_nodes: list[str],
    left_penalty_km: float,
    right_penalty_km: float,
    uturn_penalty_km: float,
) -> tuple[list[dict[str, float]], list[dict[str, Any]], float, float, TurnStats]:
    """
    Build route coordinates and instructions from node sequence.
    
    Returns:
        - List of coordinate dicts [{lon, lat}, ...]
        - List of instruction dicts
        - Total distance in km
        - Deadhead distance in km
        - Turn statistics
    """
    route_coords: list[dict[str, float]] = []
    instructions: list[dict[str, Any]] = []
    total_distance_km = 0.0
    deadhead_distance_km = 0.0
    left_turns = right_turns = u_turns = straight = 0
    prev_bearing: float | None = None
    consumed_edge_keys: set[tuple[str, str, int]] = set()
    
    for i in range(len(route_nodes) - 1):
        u = route_nodes[i]
        v = route_nodes[i + 1]
        
        edge_data = G.get_edge_data(u, v) or G.get_edge_data(v, u)
        if not edge_data:
            # Bridge between components - use straight line
            u_data = G.nodes[u]
            v_data = G.nodes[v]
            route_coords.append({"lon": u_data.get("lon", 0), "lat": u_data.get("lat", 0)})
            route_coords.append({"lon": v_data.get("lon", 0), "lat": v_data.get("lat", 0)})
            continue
        
        # Find unused edge
        chosen_key: int | None = None
        edge_coords: list[list[float]] = []
        is_deadhead = False
        edge_name: str | None = None
        edge_dist_km: float = 0.0
        
        for ek, edata in edge_data.items():
            canon = (u, v, ek) if G.is_directed() else (min(u, v), max(u, v), ek)
            if canon not in consumed_edge_keys:
                chosen_key = ek
                consumed_edge_keys.add(canon)
                is_deadhead = bool(edata.get("deadhead"))
                raw_coords = edata.get("coords") or []
                edge_name = edata.get("name")
                edge_dist_km = edata.get("length_km", 0)
                
                if raw_coords:
                    # Compare using node coordinates, not node ID strings.
                    # PostGIS graphs use integer node IDs ("1234"), so the old
                    # f"{lon:.6f},{lat:.6f}" string would never equal the node ID,
                    # causing every edge to be reversed and creating route loops.
                    u_data = G.nodes.get(u, {})
                    u_lon = u_data.get("lon")
                    u_lat = u_data.get("lat")
                    if u_lon is not None and u_lat is not None:
                        start_lon = float(raw_coords[0][0])
                        start_lat = float(raw_coords[0][1])
                        reversed_coords = not (
                            abs(start_lon - u_lon) < 1e-5
                            and abs(start_lat - u_lat) < 1e-5
                        )
                    else:
                        reversed_coords = False
                    edge_coords = list(reversed(raw_coords)) if reversed_coords else raw_coords
                break
        
        if not edge_coords:
            # Use node coordinates
            u_data = G.nodes[u]
            v_data = G.nodes[v]
            edge_coords = [
                [u_data.get("lon", 0), u_data.get("lat", 0)],
                [v_data.get("lon", 0), v_data.get("lat", 0)],
            ]
        
        # Calculate bearing and turn
        if len(edge_coords) >= 2:
            start_bearing = calculate_bearing(
                edge_coords[0][0], edge_coords[0][1],
                edge_coords[1][0], edge_coords[1][1],
            )
            end_bearing = calculate_bearing(
                edge_coords[-2][0], edge_coords[-2][1],
                edge_coords[-1][0], edge_coords[-1][1],
            )
            
            maneuver = "continue"
            if prev_bearing is not None:
                turn = _classify_turn(prev_bearing, start_bearing)
                if turn == "right":
                    maneuver = "turn_right"
                    right_turns += 1
                elif turn == "left":
                    maneuver = "turn_left"
                    left_turns += 1
                elif turn == "u_turn":
                    maneuver = "u_turn"
                    u_turns += 1
                else:
                    straight += 1
            
            maneuver_text = maneuver.replace("_", " ").capitalize()
            text = maneuver_text
            if edge_name:
                text += f" onto {edge_name}" if maneuver != "continue" else f" on {edge_name}"
            
            instructions.append({
                "text": text,
                "distance_km": round(edge_dist_km, 4),
                "way_id": None,
                "type": maneuver,
            })
            prev_bearing = end_bearing
        
        # Add coordinates
        start_k = 0 if i == 0 else 1
        for k, c in enumerate(edge_coords):
            if k < start_k:
                continue
            route_coords.append({"lon": c[0], "lat": c[1]})
        
        # Accumulate distance
        for k in range(1, len(edge_coords)):
            c0 = edge_coords[k - 1]
            c1 = edge_coords[k]
            seg_dist = _haversine_km(c0[0], c0[1], c1[0], c1[1])
            total_distance_km += seg_dist
            if is_deadhead:
                deadhead_distance_km += seg_dist
    
    return (
        route_coords,
        instructions,
        total_distance_km,
        deadhead_distance_km,
        TurnStats(
            left_turns=left_turns,
            right_turns=right_turns,
            u_turns=u_turns,
            straight=straight,
            total_turns=left_turns + right_turns + u_turns + straight,
        ),
    )


def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Calculate haversine distance in kilometers."""
    R = 6371.0  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/api/postgis/cpp", response_model=PostGISCppResponse)
async def solve_postgis_cpp(request: PostGISCppRequest):
    """
    Solve Chinese Postman Problem on PostGIS road network topology.
    
    This endpoint:
    1. Extracts road network from PostGIS within the given bbox/polygon
    2. Builds a NetworkX graph with turn penalties
    3. Solves CPP using Hierholzer's algorithm with minimum-weight matching
    4. Returns GeoJSON route with turn-by-turn instructions
    
    Requires DATABASE_URL environment variable or database_url parameter.
    """
    _t_start = time.perf_counter()
    
    # Validate input
    if not request.bbox and not request.polygon_geojson and not request.use_cached_topology:
        raise HTTPException(
            status_code=400,
            detail="Either bbox, polygon_geojson, or use_cached_topology must be provided",
        )
    
    # Connect to database
    try:
        conn = await get_postgis_connection(request.database_url)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Database connection failed: {str(e)}",
        )
    
    try:
        # Extract road network
        road_classes = set(request.road_classes) if request.road_classes else None
        G, node_coords = await extract_road_network(
            conn,
            bbox=request.bbox,
            polygon_geojson=request.polygon_geojson,
            road_classes=road_classes,
            use_cached=request.use_cached_topology,
        )
        _t_after_extract = time.perf_counter()
        
        if G.number_of_nodes() < 2:
            raise HTTPException(
                status_code=400,
                detail=f"Graph has only {G.number_of_nodes()} node(s) — need at least 2",
            )
        
        if G.number_of_edges() == 0:
            raise HTTPException(
                status_code=400,
                detail="Graph has no edges — cannot compute route",
            )
        
        # Find start node
        start_node = None
        if request.start_lat is not None and request.start_lon is not None:
            min_dist = float("inf")
            for node in G.nodes():
                ndata = G.nodes[node]
                lon = ndata.get("lon", 0)
                lat = ndata.get("lat", 0)
                d = _haversine_km(request.start_lon, request.start_lat, lon, lat)
                if d < min_dist:
                    min_dist = d
                    start_node = node
        
        # Convert penalties from meters to km
        left_penalty_km = request.left_turn_penalty_m / 1000.0
        right_penalty_km = request.right_turn_penalty_m / 1000.0
        uturn_penalty_km = request.uturn_penalty_m / 1000.0
        
        # Solve CPP
        route_nodes = _solve_cpp_with_turn_penalties(
            G,
            left_penalty_km,
            right_penalty_km,
            uturn_penalty_km,
            start_node=start_node,
        )
        _t_after_cpp = time.perf_counter()
        
        if not route_nodes:
            raise HTTPException(
                status_code=400,
                detail="Could not compute route — graph may be empty or disconnected",
            )
        
        # Build route
        route_coords, instructions, total_distance_km, deadhead_distance_km, turn_stats = _build_route_from_nodes(
            G,
            route_nodes,
            left_penalty_km,
            right_penalty_km,
            uturn_penalty_km,
        )
        _t_after_build = time.perf_counter()
        
        # Calculate efficiency
        total_edge_dist = sum(data.get("length_km", 0) for _, _, data in G.edges(data=True))
        efficiency = (total_edge_dist / total_distance_km * 100) if total_distance_km > 0 else 100.0
        efficiency = max(0.0, min(100.0, efficiency))
        
        # Build GeoJSON response
        route_geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[c["lon"], c["lat"]] for c in route_coords],
                    },
                    "properties": {
                        "total_distance_km": round(total_distance_km, 4),
                        "total_traversals": len(route_nodes) - 1,
                        "efficiency": round(efficiency, 2),
                    },
                }
            ],
        }
        
        _t_end = time.perf_counter()
        
        return PostGISCppResponse(
            route_geojson=route_geojson,
            instructions=instructions,
            total_distance_km=round(total_distance_km, 4),
            deadhead_distance_km=round(deadhead_distance_km, 4),
            efficiency=round(efficiency, 2),
            stats=turn_stats,
            nodes_in_graph=G.number_of_nodes(),
            edges_in_graph=G.number_of_edges(),
            timing_ms={
                "extract_ms": round((_t_after_extract - _t_start) * 1000, 2),
                "cpp_solve_ms": round((_t_after_cpp - _t_after_extract) * 1000, 2),
                "route_build_ms": round((_t_after_build - _t_after_cpp) * 1000, 2),
                "total_ms": round((_t_end - _t_start) * 1000, 2),
            },
            message=f"Route computed: {len(route_nodes) - 1} traversals, {round(total_distance_km, 2)} km, {round(efficiency, 1)}% efficiency",
        )
        
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@router.get("/api/postgis/health")
async def postgis_health():
    """Check if PostGIS connection is available."""
    try:
        conn = await get_postgis_connection()
        result = await conn.fetchval("SELECT PostGIS_Version()")
        await conn.close()
        return {"status": "ok", "postgis_version": result}
    except Exception as e:
        return {"status": "error", "message": str(e)}