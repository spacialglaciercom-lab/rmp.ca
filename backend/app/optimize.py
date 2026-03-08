"""
Route optimization endpoint:
  POST /api/optimize — Chinese Postman route optimization on GeoJSON road data.

Given a GeoJSON FeatureCollection of LineString road segments, builds a graph,
solves the Chinese Postman Problem (traverse every edge at least once with
minimum total distance), and returns an ordered route with turn statistics.
"""
from __future__ import annotations

import math
from typing import Any

import networkx as nx
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .geojson_ops import (
    GeoJSONFeature,
    GeoJSONFeatureCollection,
    _haversine_km,
    _get_road_class,
)
from .vector_clean import CleanOptions, clean_geojson

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class TurnPenalties(BaseModel):
    left_turn: float = 0
    u_turn: float = 0
    right_turn: float = 0


class OptimizeRequest(BaseModel):
    geojson: GeoJSONFeatureCollection
    start_lat: float | None = None
    start_lon: float | None = None
    oneway_mode: str | None = None  # "ignore", "respect", "reverse"
    service_both_sides: bool | None = None  # when True, traverse each bidirectional segment twice (both curbs)
    road_classes: list[str] | None = None
    turn_penalties: TurnPenalties | None = None
    clean_before_optimize: bool = True  # run vector_clean before building graph (reduces loops from duplicate/self-loop edges)
    clean_options: CleanOptions | None = None


class RoutePoint(BaseModel):
    latitude: float
    longitude: float
    node_id: str | None = None


class RouteStats(BaseModel):
    total_traversals: int
    total_distance_km: float
    right_turns: int
    left_turns: int
    u_turns: int
    straight: int
    dead_ends: int
    odd_degree_vertices: int
    edges_in_graph: int
    nodes_in_graph: int
    deadhead_distance_km: float
    efficiency: float


class OptimizeResponse(BaseModel):
    route: list[RoutePoint]
    route_geojson: GeoJSONFeatureCollection
    total_distance_km: float
    message: str
    stats: RouteStats


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------


def _round_coord(val: float, decimals: int = 6) -> float:
    """Round coordinate to snap nearby nodes together."""
    return round(val, decimals)


def _node_id(lon: float, lat: float) -> str:
    return f"{_round_coord(lon)},{_round_coord(lat)}"


def _build_graph(
    features: list[GeoJSONFeature],
    oneway_mode: str = "ignore",
) -> nx.MultiGraph:
    """Build a MultiGraph from LineString features."""
    G = nx.MultiGraph()

    for idx, feat in enumerate(features):
        geom = feat.geometry
        gtype = geom.get("type", "")
        coords_list: list[list[list[float]]] = []

        if gtype == "LineString":
            coords_list = [geom.get("coordinates", [])]
        elif gtype == "MultiLineString":
            coords_list = geom.get("coordinates", [])
        else:
            continue

        for line_coords in coords_list:
            if len(line_coords) < 2:
                continue

            # Compute edge length
            length_km = 0.0
            for i in range(1, len(line_coords)):
                c0 = line_coords[i - 1]
                c1 = line_coords[i]
                length_km += _haversine_km(c0[0], c0[1], c1[0], c1[1])

            start = line_coords[0]
            end = line_coords[-1]
            u = _node_id(start[0], start[1])
            v = _node_id(end[0], end[1])

            # Store node positions
            if u not in G:
                G.add_node(u, lon=_round_coord(start[0]), lat=_round_coord(start[1]))
            if v not in G:
                G.add_node(v, lon=_round_coord(end[0]), lat=_round_coord(end[1]))

            G.add_edge(
                u,
                v,
                key=idx,
                length_km=length_km,
                coords=line_coords,
                feature_idx=idx,
                road_class=_get_road_class(feat),
            )

    return G


# ---------------------------------------------------------------------------
# Chinese Postman Problem solver
# ---------------------------------------------------------------------------


def _solve_cpp(G: nx.MultiGraph | nx.MultiDiGraph) -> list[str]:
    """
    Approximate solution to the Chinese Postman Problem:
    traverse every edge at least once with minimum extra (deadhead) distance.

    1. Find odd-degree vertices (or unbalanced for directed: in_degree != out_degree).
    2. Compute shortest paths between all pairs of odd-degree vertices.
    3. Find minimum weight perfect matching on odd-degree vertices.
    4. Augment graph with matching edges (duplicating shortest paths).
    5. Find Eulerian circuit on augmented graph.
    """
    if G.number_of_edges() == 0:
        return []

    is_directed = G.is_directed()

    # If graph is disconnected, work on largest component
    if is_directed:
        components = list(nx.weakly_connected_components(G))
    else:
        components = list(nx.connected_components(G))
    if len(components) > 1:
        largest = max(components, key=len)
        G = G.subgraph(largest).copy()

    # Find odd-degree (undirected) or unbalanced (directed) vertices
    if is_directed:
        odd_nodes = [n for n in G.nodes() if G.in_degree(n) != G.out_degree(n)]
    else:
        odd_nodes = [n for n in G.nodes() if G.degree(n) % 2 != 0]

    if len(odd_nodes) == 0:
        # Already Eulerian — find circuit directly
        try:
            circuit = list(nx.eulerian_circuit(G))
            if circuit:
                return [circuit[0][0]] + [e[1] for e in circuit]
        except nx.NetworkXError:
            pass

    if len(odd_nodes) >= 2:
        # Compute shortest path lengths and paths between all pairs of odd nodes
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

        # Exact minimum-weight perfect matching (Blossom) to minimize deadhead distance.
        # Greedy matching can pair distant odd nodes and add unnecessary loops.
        augment_paths: list[list[str]] = []
        if not is_directed:
            # Build complete graph on odd nodes with edge weight = shortest path distance
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
                # Fallback to greedy if Blossom fails (e.g. empty or odd-sized)
                sorted_pairs = sorted(odd_pairs_dist.items(), key=lambda x: x[1])
                matched: set[str] = set()
                for (u, v), _ in sorted_pairs:
                    if u not in matched and v not in matched:
                        matched.add(u)
                        matched.add(v)
                        augment_paths.append(odd_pairs_path.get((u, v), [u, v]))
        else:
            # Directed: keep greedy pairing for unbalanced nodes (exact would need min-cost flow)
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
                # Find shortest edge between u and v to duplicate
                edge_data = G.get_edge_data(u, v)
                if edge_data:
                    # Pick the shortest edge
                    min_key = min(edge_data.keys(), key=lambda k: edge_data[k].get("length_km", 0))
                    data = edge_data[min_key].copy()
                    data["deadhead"] = True
                    G_aug.add_edge(u, v, **data)

        try:
            circuit = list(nx.eulerian_circuit(G_aug))
            if circuit:
                return [circuit[0][0]] + [e[1] for e in circuit]
        except nx.NetworkXError:
            pass

    # If we have exactly 2 odd nodes, graph is semi-Eulerian — try eulerian_path
    if len(odd_nodes) == 2 and not is_directed:
        try:
            path_edges = list(nx.eulerian_path(G))
            if path_edges:
                return [path_edges[0][0]] + [e[1] for e in path_edges]
        except nx.NetworkXError:
            pass

    # Last resort: DFS traversal (can produce suboptimal loops; prefer failing with clear error for debugging)
    start_node = list(G.nodes())[0]
    visited_edges: set[tuple[str, str, int]] = set()
    route: list[str] = [start_node]

    def _dfs(node: str) -> None:
        for u, v, key in G.edges(node, keys=True):
            edge_key = (u, v, key) if is_directed else (min(u, v), max(u, v), key)
            if edge_key not in visited_edges:
                visited_edges.add(edge_key)
                next_node = v if u == node else u
                route.append(next_node)
                _dfs(next_node)

    _dfs(start_node)
    return route


# ---------------------------------------------------------------------------
# Turn classification
# ---------------------------------------------------------------------------


def _bearing(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Compute bearing in degrees from (lon1,lat1) to (lon2,lat2)."""
    dlon = math.radians(lon2 - lon1)
    lat1_r = math.radians(lat1)
    lat2_r = math.radians(lat2)
    x = math.sin(dlon) * math.cos(lat2_r)
    y = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


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


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/api/optimize", response_model=OptimizeResponse)
def optimize_route(body: OptimizeRequest):
    """
    Chinese Postman route optimization on GeoJSON road data.

    Builds a graph from LineString features, solves the CPP (approximate),
    and returns an ordered route with turn statistics.
    """
    features = body.geojson.features

    if body.clean_before_optimize:
        if body.clean_options is not None:
            opts = body.clean_options
        else:
            # Default: aggressive cleaning to reduce loops (dedupe, self-loops, short edges, parallel edges)
            opts = CleanOptions(
                remove_selfloops=True,
                dedupe_edges=True,
                merge_parallel_edges=True,
                min_length_m=10.0,
            )
        cleaned_fc, _ = clean_geojson(body.geojson.model_dump(), opts)
        features = cleaned_fc.features

    # Filter by road classes if specified
    if body.road_classes:
        allowed = set(body.road_classes)
        features = [f for f in features if _get_road_class(f) in allowed]

    # Filter to LineString/MultiLineString only
    features = [
        f for f in features
        if f.geometry.get("type") in ("LineString", "MultiLineString")
    ]

    if not features:
        raise HTTPException(
            status_code=400,
            detail="No LineString/MultiLineString features found in the GeoJSON",
        )

    # Build graph
    oneway_mode = body.oneway_mode or "ignore"
    G = _build_graph(features, oneway_mode)

    # When service_both_sides is True, ensure each segment is traversed in BOTH directions
    # (u→v and v→u = both curbs). Use a directed graph so the Eulerian circuit must use both.
    if body.service_both_sides:
        edges_snapshot = list(G.edges(keys=True, data=True))
        max_key = max((k for _, _, k in G.edges(keys=True)), default=0)
        G_dir = nx.MultiDiGraph()
        for n, ndata in G.nodes(data=True):
            G_dir.add_node(n, **ndata)
        for i, (u, v, key, data) in enumerate(edges_snapshot):
            d = dict(
                length_km=data["length_km"],
                coords=data.get("coords", []),
                feature_idx=data.get("feature_idx", 0),
                road_class=data.get("road_class", ""),
            )
            G_dir.add_edge(u, v, key=key, **d)
            G_dir.add_edge(v, u, key=max_key + 1 + i, **d)
        G = G_dir

    if G.number_of_nodes() < 2:
        raise HTTPException(
            status_code=400,
            detail=f"Graph has only {G.number_of_nodes()} node(s) — need at least 2",
        )

    # Count odd-degree vertices (before solving)
    odd_degree = sum(1 for n in G.nodes() if G.degree(n) % 2 != 0)

    # Total edge distance (the minimum possible route distance)
    total_edge_dist = sum(
        data.get("length_km", 0)
        for _, _, data in G.edges(data=True)
    )

    # Find start node closest to start point
    start_node = None
    if body.start_lat is not None and body.start_lon is not None:
        min_dist = float("inf")
        for node in G.nodes():
            ndata = G.nodes[node]
            d = _haversine_km(
                body.start_lon, body.start_lat,
                ndata.get("lon", 0), ndata.get("lat", 0),
            )
            if d < min_dist:
                min_dist = d
                start_node = node

    # Solve CPP
    route_nodes = _solve_cpp(G)

    if not route_nodes:
        raise HTTPException(status_code=400, detail="Could not compute route — graph may be empty or disconnected")

    # If start node specified, rotate circuit to start there
    if start_node and start_node in route_nodes:
        idx = route_nodes.index(start_node)
        route_nodes = route_nodes[idx:] + route_nodes[1:idx + 1]

    # Build route points and stats
    route_points: list[RoutePoint] = []
    route_coords: list[list[float]] = []  # for route GeoJSON
    total_distance_km = 0.0
    deadhead_distance_km = 0.0
    right_turns = left_turns = u_turns = straight = dead_ends = 0
    total_traversals = 0

    prev_bearing: float | None = None

    for i, node in enumerate(route_nodes):
        ndata = G.nodes[node]
        lon = ndata.get("lon", 0)
        lat = ndata.get("lat", 0)
        route_points.append(RoutePoint(latitude=lat, longitude=lon, node_id=node))
        route_coords.append([lon, lat])

        if i > 0:
            prev_node = route_nodes[i - 1]
            prev_data = G.nodes[prev_node]

            seg_dist = _haversine_km(
                prev_data.get("lon", 0), prev_data.get("lat", 0),
                lon, lat,
            )
            total_distance_km += seg_dist
            total_traversals += 1

            # Check if this edge is a deadhead
            edge_data = G.get_edge_data(prev_node, node)
            if edge_data:
                for key, edata in edge_data.items():
                    if edata.get("deadhead"):
                        deadhead_distance_km += seg_dist
                        break

            # Turn classification
            curr_bearing = _bearing(
                prev_data.get("lon", 0), prev_data.get("lat", 0),
                lon, lat,
            )
            if prev_bearing is not None:
                turn = _classify_turn(prev_bearing, curr_bearing)
                if turn == "right":
                    right_turns += 1
                elif turn == "left":
                    left_turns += 1
                elif turn == "u_turn":
                    u_turns += 1
                else:
                    straight += 1
            prev_bearing = curr_bearing

    # Count dead ends (degree-1 nodes)
    dead_ends = sum(1 for n in G.nodes() if G.degree(n) == 1)

    # Efficiency = minimum possible distance / actual distance
    efficiency = (total_edge_dist / total_distance_km * 100) if total_distance_km > 0 else 100.0

    # Build route GeoJSON
    route_geojson = GeoJSONFeatureCollection(
        type="FeatureCollection",
        features=[
            GeoJSONFeature(
                type="Feature",
                geometry={"type": "LineString", "coordinates": route_coords},
                properties={
                    "total_distance_km": round(total_distance_km, 4),
                    "total_traversals": total_traversals,
                },
            )
        ],
    )

    stats = RouteStats(
        total_traversals=total_traversals,
        total_distance_km=round(total_distance_km, 4),
        right_turns=right_turns,
        left_turns=left_turns,
        u_turns=u_turns,
        straight=straight,
        dead_ends=dead_ends,
        odd_degree_vertices=odd_degree,
        edges_in_graph=G.number_of_edges(),
        nodes_in_graph=G.number_of_nodes(),
        deadhead_distance_km=round(deadhead_distance_km, 4),
        efficiency=round(efficiency, 2),
    )

    return OptimizeResponse(
        route=route_points,
        route_geojson=route_geojson,
        total_distance_km=round(total_distance_km, 4),
        message=f"Route computed: {total_traversals} traversals, {round(total_distance_km, 2)} km, {round(efficiency, 1)}% efficiency",
        stats=stats,
    )
