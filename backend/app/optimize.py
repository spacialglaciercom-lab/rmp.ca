"""
Route optimization endpoint:
  POST /api/optimize — Chinese Postman route optimization on GeoJSON road data.

Given a GeoJSON FeatureCollection of LineString road segments, builds a graph,
solves the Chinese Postman Problem (traverse every edge at least once with
minimum total distance), and returns an ordered route with turn statistics.

Route geometry uses only coordinates from the input graph (and straight chords
between disconnected components). Those points lie inside the axis-aligned
bounding box of all input coordinates; we verify this and expose
``extractor_input_bbox_lon_lat`` / ``route_inside_extractor_coord_bbox`` in
``metrics``. (This is the extract GeoJSON extent, not the user-drawn polygon
unless they match.) For polygon-tight clipping, filter roads with
``/api/geojson/filter`` before optimizing.
"""
from __future__ import annotations

import heapq
import math
import os
import time
from typing import Any

import networkx as nx
import numpy as np
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

# Cap turn penalties to avoid overflow in matching weights and nonsensical cost
MAX_TURN_PENALTY = 10_000.0

# Fixed cost (km) added when a U-turn is attempted on a dual_carriageway=yes road.
# Physical median dividers make this manoeuvre essentially impossible in practice.
DUAL_CARRIAGEWAY_UTURN_KM = 500.0

from .geojson_ops import (
    GeoJSONFeature,
    GeoJSONFeatureCollection,
    _haversine_km,
    _haversine_m,
    _get_road_class,
)
from .hierholzer import eulerian_circuit_nx
from .routing_plugins import (
    FuelAwarePlugin,
    RoutingCostPlugin,
    TurnPenaltyPlugin,
    calculate_bearing,
)
from .vector_clean import CleanOptions, clean_geojson
from .analytics import calculate_route_metrics

# GPX export support
try:
    from .gpx_export import Waypoint, RouteSegment, build_gpx
    GPX_EXPORT_AVAILABLE = True
    ACCEPT_GPX = "application/gpx+xml"
except ImportError:
    GPX_EXPORT_AVAILABLE = False
    ACCEPT_GPX = "application/gpx+xml"  # Still define for type checking

router = APIRouter()

# ---------------------------------------------------------------------------
# Road class defaults
# ---------------------------------------------------------------------------

# Default allowlist: vehicle-routable residential/local road classes.
# Applied when the caller does not supply road_classes.
# Excludes: motorways, highways (trunk/primary), driveways, service roads.
DEFAULT_ROAD_CLASSES: frozenset[str] = frozenset({
    "residential",
    "tertiary",
    "tertiary_link",
    "secondary",
    "secondary_link",
    "unclassified",
    "living_street",
    "road",  # OSM catch-all for unknown paved roads
})

# Always excluded regardless of road_classes param — non-vehicle infrastructure
# and Overture-specific transit/rail classes.
NON_VEHICLE_CLASSES: frozenset[str] = frozenset({
    "footway", "pedestrian", "steps", "path", "corridor",
    "cycleway", "bridleway", "elevator", "escalator", "platform", "raceway",
    # Overture rail / transit
    "standard_gauge", "narrow_gauge", "light_rail", "subway",
    "tram", "monorail", "ferry", "aerialway",
})


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class TurnPenalties(BaseModel):
    left_turn: float = 0
    u_turn: float = 0
    right_turn: float = 0

    @field_validator("left_turn", "u_turn", "right_turn", mode="after")
    @classmethod
    def clamp_penalty(cls, v: float) -> float:
        """Clamp penalty values to prevent overflow and negative weights."""
        return max(0.0, min(MAX_TURN_PENALTY, float(v)))


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
    dem_path: str | None = None  # optional DEM GeoTIFF path for fuel-aware (directed) edge weights
    use_turn_penalty_plugin: bool = False  # when True, apply UPS-style left/U-turn penalties via transition costs


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


class Instruction(BaseModel):
    text: str
    distance_km: float
    way_id: str | None = None
    type: str  # "depart", "arrive", "continue", "turn_left", "turn_right", "u_turn"


class OptimizeResponse(BaseModel):
    route: list[RoutePoint]
    route_geojson: GeoJSONFeatureCollection
    instructions: list[Instruction] = []
    total_distance_km: float
    message: str
    stats: RouteStats
    metrics: dict = {}
    timing_ms: dict[str, float] = Field(
        default_factory=dict,
        description="Wall-clock milliseconds for each optimization phase: "
                    "clean, graph_build, cpp_solve, route_build, analytics, total",
    )


# ---------------------------------------------------------------------------
# Extractor bounding box verification (same GeoJSON fed to the graph)
# ---------------------------------------------------------------------------


def _coordinate_bbox_from_geojson_features(
    features: list[GeoJSONFeature],
) -> tuple[float, float, float, float] | None:
    """Axis-aligned lon/lat bbox over all LineString / MultiLineString coordinates."""
    min_lon = min_lat = math.inf
    max_lon = max_lat = -math.inf
    for feat in features:
        geom = feat.geometry
        gtype = geom.get("type", "")
        lines: list[list[list[float]]] = []
        if gtype == "LineString":
            lines = [geom.get("coordinates", [])]
        elif gtype == "MultiLineString":
            lines = geom.get("coordinates", [])
        else:
            continue
        for line in lines:
            for pt in line:
                if len(pt) < 2:
                    continue
                lon, lat = float(pt[0]), float(pt[1])
                if not math.isfinite(lon) or not math.isfinite(lat):
                    continue
                min_lon = min(min_lon, lon)
                min_lat = min(min_lat, lat)
                max_lon = max(max_lon, lon)
                max_lat = max(max_lat, lat)
    if min_lon == math.inf:
        return None
    return (min_lon, min_lat, max_lon, max_lat)


def _count_route_samples_outside_lon_lat_bbox(
    route_coords: list[list[float]],
    bbox: tuple[float, float, float, float],
    *,
    pad_deg: float = 1e-5,
    interior_samples_per_segment: int = 4,
) -> int:
    """Count vertices + interior samples per segment outside the bbox.

    For an axis-aligned lon/lat rectangle, a straight segment between two in-bbox
    endpoints stays inside the box; violations indicate bad floats or solver bugs.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    min_lon -= pad_deg
    min_lat -= pad_deg
    max_lon += pad_deg
    max_lat += pad_deg

    def inside(lon: float, lat: float) -> bool:
        return (
            math.isfinite(lon)
            and math.isfinite(lat)
            and min_lon <= lon <= max_lon
            and min_lat <= lat <= max_lat
        )

    violations = 0
    for c in route_coords:
        if len(c) < 2:
            continue
        if not inside(float(c[0]), float(c[1])):
            violations += 1

    for i in range(len(route_coords) - 1):
        a, b = route_coords[i], route_coords[i + 1]
        if len(a) < 2 or len(b) < 2:
            continue
        for k in range(1, interior_samples_per_segment + 1):
            t = k / (interior_samples_per_segment + 1)
            lon = float(a[0]) + t * (float(b[0]) - float(a[0]))
            lat = float(a[1]) + t * (float(b[1]) - float(a[1]))
            if not inside(lon, lat):
                violations += 1

    return violations


def _merge_extractor_bbox_verification(
    features: list[GeoJSONFeature],
    route_coords: list[list[float]],
    route_metrics: dict[str, Any],
    message: str,
) -> tuple[dict[str, Any], str]:
    """Attach bbox verification fields; extend message if samples fall outside input bbox."""
    bbox = _coordinate_bbox_from_geojson_features(features)
    violations = 0
    if bbox is not None and route_coords:
        violations = _count_route_samples_outside_lon_lat_bbox(route_coords, bbox)
    out: dict[str, Any] = dict(route_metrics)
    out["extractor_input_bbox_lon_lat"] = list(bbox) if bbox is not None else None
    out["route_inside_extractor_coord_bbox"] = violations == 0
    out["extractor_coord_bbox_violation_count"] = violations
    msg = message
    if violations > 0:
        msg += (
            f" — warning: {violations} route sample(s) outside GeoJSON coordinate bounding box"
        )
    return out, msg


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------


def _round_coord(val: float, decimals: int = 6) -> float:
    """Round coordinate to snap nearby nodes together."""
    return round(val, decimals)


def _node_id(lon: float, lat: float) -> str:
    return f"{_round_coord(lon)},{_round_coord(lat)}"


def _normalize_oneway_mode(raw: str | None) -> str:
    """Map client / legacy values to ``ignore`` or ``respect``.

    Accepts: ignore, respect, A/B (planner), yes/no, booleans as strings.
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return "ignore"
    s = str(raw).strip().lower()
    if s in ("a", "ignore", "no", "false", "0", "off"):
        return "ignore"
    if s in ("b", "respect", "yes", "true", "1", "on"):
        return "respect"
    if s in ("reverse", "-1"):
        return "respect"
    return "ignore"


def _oneway_allowed_directions(props: dict[str, Any]) -> tuple[bool, bool]:
    """For a segment stored along GeoJSON vertex order (u → v).

    Returns (allow_u_to_v, allow_v_to_u). OSM ``oneway=-1`` is opposite to digitization.
    """
    ow = props.get("oneway")
    if ow is True or ow == 1:
        return (True, False)
    if isinstance(ow, str):
        osl = ow.strip().lower()
        if osl in ("yes", "true", "1"):
            return (True, False)
        if osl in ("-1", "reverse"):
            return (False, True)
    if ow == -1:
        return (False, True)
    return (True, True)


def _build_graph(
    features: list[GeoJSONFeature],
    oneway_mode: str = "ignore",
    plugins: list[RoutingCostPlugin] | None = None,
) -> nx.MultiGraph | nx.MultiDiGraph:
    """Build a MultiGraph (or MultiDiGraph when plugins are set) from LineString features.

    When plugins is None or empty: ``oneway_mode`` controls the graph:
      - ``ignore``: undirected ``MultiGraph`` (one edge per split segment).
      - ``respect``: directed ``MultiDiGraph``; ``properties.oneway`` selects traversable directions.

    When plugins is non-empty: directed ``MultiDiGraph`` with two edges per segment (u->v and v->u);
    edge weight = compounded cost (distance_m * product of each plugin's multiplier) / 1000.
    One-way tagging is **not** applied on the plugin path (both directions remain available for costing).

    Splitting at shared intersection nodes is unchanged.
    """
    # ------------------------------------------------------------------ #
    # Step 1: Collect all lines and find split nodes                       #
    # ------------------------------------------------------------------ #
    all_lines: list[tuple[list[list[float]], int]] = []  # (coords, feat_idx)
    coord_count: dict[str, int] = {}

    for feat_idx, feat in enumerate(features):
        geom = feat.geometry
        gtype = geom.get("type", "")
        if gtype == "LineString":
            lines = [geom.get("coordinates", [])]
        elif gtype == "MultiLineString":
            lines = geom.get("coordinates", [])
        else:
            continue
        for line_coords in lines:
            if len(line_coords) < 2:
                continue
            all_lines.append((line_coords, feat_idx))
            for c in line_coords:
                nid = _node_id(c[0], c[1])
                coord_count[nid] = coord_count.get(nid, 0) + 1

    split_nodes: set[str] = set()
    for line_coords, _ in all_lines:
        split_nodes.add(_node_id(line_coords[0][0], line_coords[0][1]))
        split_nodes.add(_node_id(line_coords[-1][0], line_coords[-1][1]))
    for nid, cnt in coord_count.items():
        if cnt >= 2:
            split_nodes.add(nid)

    if plugins:
        # ------------------------------------------------------------------ #
        # Plugin path: collect segments and node coords, run plugins          #
        # ------------------------------------------------------------------ #
        node_order: list[str] = []
        node_id_to_coord: dict[str, tuple[float, float]] = {}
        segments_raw: list[tuple[str, str, list[list[float]], float, int, GeoJSONFeature]] = []

        for line_coords, feat_idx in all_lines:
            feat = features[feat_idx]
            run_start = 0
            for i in range(1, len(line_coords)):
                nid = _node_id(line_coords[i][0], line_coords[i][1])
                if nid not in split_nodes and i != len(line_coords) - 1:
                    continue

                segment = line_coords[run_start : i + 1]
                if len(segment) < 2:
                    run_start = i
                    continue

                length_km = sum(
                    _haversine_km(segment[j - 1][0], segment[j - 1][1], segment[j][0], segment[j][1])
                    for j in range(1, len(segment))
                )
                start, end = segment[0], segment[-1]
                u = _node_id(start[0], start[1])
                v = _node_id(end[0], end[1])

                if u not in node_id_to_coord:
                    node_id_to_coord[u] = (_round_coord(start[0]), _round_coord(start[1]))
                    node_order.append(u)
                if v not in node_id_to_coord:
                    node_id_to_coord[v] = (_round_coord(end[0]), _round_coord(end[1]))
                    node_order.append(v)

                segments_raw.append((u, v, segment, length_km, feat_idx, feat))
                run_start = i

        coords_list = [node_id_to_coord[nid] for nid in node_order]
        plugin_node_data: list[dict[int, dict]] = []
        for plugin in plugins:
            plugin_node_data.append(plugin.pre_process_nodes(coords_list))

        node_id_to_index = {nid: i for i, nid in enumerate(node_order)}

        G = nx.MultiDiGraph()
        for nid in node_order:
            lon, lat = node_id_to_coord[nid]
            G.add_node(nid, lon=lon, lat=lat)

        edge_idx = 0
        for u, v, segment, length_km, feat_idx, feat in segments_raw:
            coords_u = node_id_to_coord[u]
            coords_v = node_id_to_coord[v]
            distance_m = _haversine_m(coords_u[0], coords_u[1], coords_v[0], coords_v[1])

            cost_uv_m = distance_m
            for i, plugin in enumerate(plugins):
                data_u = plugin_node_data[i].get(node_id_to_index[u], {})
                data_v = plugin_node_data[i].get(node_id_to_index[v], {})
                cost_uv_m *= plugin.calculate_multiplier(
                    coords_u, coords_v, data_u, data_v, distance_m
                )
            weight_uv_km = cost_uv_m / 1000.0

            cost_vu_m = distance_m
            for i, plugin in enumerate(plugins):
                data_u = plugin_node_data[i].get(node_id_to_index[u], {})
                data_v = plugin_node_data[i].get(node_id_to_index[v], {})
                cost_vu_m *= plugin.calculate_multiplier(
                    coords_v, coords_u, data_v, data_u, distance_m
                )
            weight_vu_km = cost_vu_m / 1000.0

            props = feat.properties or {}
            dc = props.get("dual_carriageway") == "yes" or props.get("is_dual_carriageway") is True
            edge_attrs = dict(
                coords=segment,
                feature_idx=feat_idx,
                road_class=_get_road_class(feat),
                name=props.get("name"),
                osm_id=props.get("osm_id"),
                dual_carriageway=dc,
            )

            G.add_edge(u, v, key=edge_idx, length_km=weight_uv_km, **edge_attrs)
            G.add_edge(v, u, key=edge_idx + 1, length_km=weight_vu_km, **edge_attrs)
            edge_idx += 2

        G.graph["routing_plugins"] = plugins
        return G

    # ------------------------------------------------------------------ #
    # Standard path (no plugins): undirected or directed by oneway_mode   #
    # ------------------------------------------------------------------ #
    norm = _normalize_oneway_mode(oneway_mode)

    if norm == "ignore":
        G = nx.MultiGraph()
        edge_idx = 0
        for line_coords, feat_idx in all_lines:
            feat = features[feat_idx]
            run_start = 0
            for i in range(1, len(line_coords)):
                nid = _node_id(line_coords[i][0], line_coords[i][1])
                if nid not in split_nodes and i != len(line_coords) - 1:
                    continue

                segment = line_coords[run_start : i + 1]
                if len(segment) < 2:
                    run_start = i
                    continue

                length_km = sum(
                    _haversine_km(segment[j - 1][0], segment[j - 1][1], segment[j][0], segment[j][1])
                    for j in range(1, len(segment))
                )
                start = segment[0]
                end = segment[-1]
                u = _node_id(start[0], start[1])
                v = _node_id(end[0], end[1])

                if u not in G:
                    G.add_node(u, lon=_round_coord(start[0]), lat=_round_coord(start[1]))
                if v not in G:
                    G.add_node(v, lon=_round_coord(end[0]), lat=_round_coord(end[1]))

                props = feat.properties or {}
                dc = props.get("dual_carriageway") == "yes" or props.get("is_dual_carriageway") is True
                G.add_edge(
                    u,
                    v,
                    key=edge_idx,
                    length_km=length_km,
                    coords=segment,
                    feature_idx=feat_idx,
                    road_class=_get_road_class(feat),
                    name=props.get("name"),
                    osm_id=props.get("osm_id"),
                    dual_carriageway=dc,
                )
                edge_idx += 1
                run_start = i

        return G

    # respect: MultiDiGraph — one-way segments are traversable in one direction only
    G = nx.MultiDiGraph()
    edge_idx = 0
    for line_coords, feat_idx in all_lines:
        feat = features[feat_idx]
        run_start = 0
        for i in range(1, len(line_coords)):
            nid = _node_id(line_coords[i][0], line_coords[i][1])
            if nid not in split_nodes and i != len(line_coords) - 1:
                continue

            segment = line_coords[run_start : i + 1]
            if len(segment) < 2:
                run_start = i
                continue

            length_km = sum(
                _haversine_km(segment[j - 1][0], segment[j - 1][1], segment[j][0], segment[j][1])
                for j in range(1, len(segment))
            )
            start = segment[0]
            end = segment[-1]
            u = _node_id(start[0], start[1])
            v = _node_id(end[0], end[1])

            if u not in G:
                G.add_node(u, lon=_round_coord(start[0]), lat=_round_coord(start[1]))
            if v not in G:
                G.add_node(v, lon=_round_coord(end[0]), lat=_round_coord(end[1]))

            props = feat.properties or {}
            dc = props.get("dual_carriageway") == "yes" or props.get("is_dual_carriageway") is True
            allow_uv, allow_vu = _oneway_allowed_directions(props)
            base_attrs = dict(
                length_km=length_km,
                feature_idx=feat_idx,
                road_class=_get_road_class(feat),
                name=props.get("name"),
                osm_id=props.get("osm_id"),
                dual_carriageway=dc,
            )
            if allow_uv:
                G.add_edge(u, v, key=edge_idx, coords=segment, **base_attrs)
                edge_idx += 1
            if allow_vu:
                rev_seg = list(reversed(segment))
                G.add_edge(v, u, key=edge_idx, coords=rev_seg, **base_attrs)
                edge_idx += 1
            run_start = i

    return G


def _get_node_coord(G: nx.MultiGraph | nx.MultiDiGraph, node: str) -> tuple[float, float]:
    """Return (lon, lat) for a graph node."""
    nd = G.nodes[node]
    return (nd.get("lon", 0.0), nd.get("lat", 0.0))


def _dijkstra_with_transition_costs(
    G: nx.MultiGraph | nx.MultiDiGraph,
    source: str,
    plugins: list[RoutingCostPlugin],
) -> tuple[dict[str, float], dict[str, list[str]]]:
    """
    Shortest paths from source with path-dependent transition costs.
    State is (current_node, previous_node); when previous is None (start), transition mult = 1.0.
    Returns (lengths, paths) where lengths[v] = cost to v, paths[v] = node list from source to v.
    """
    lengths: dict[str, float] = {source: 0.0}
    paths: dict[str, list[str]] = {source: [source]}
    # state = (node, prev_node); prev_node None only at start
    path_to_state: dict[tuple[str, str | None], list[str]] = {(source, None): [source]}
    # (distance, (node, prev_node))
    heap: list[tuple[float, tuple[str, str | None]]] = [(0.0, (source, None))]
    expanded: set[tuple[str, str | None]] = set()

    def edge_weight(u: str, v: str) -> float:
        """Minimum length_km over all edges u->v (or u-v)."""
        data = G.get_edge_data(u, v)
        if not data:
            return float("inf")
        return min(data[k].get("length_km", float("inf")) for k in data)

    def edge_is_dual_carriageway(u: str, v: str) -> bool:
        data = G.get_edge_data(u, v)
        if not data:
            return False
        best_k = min(data, key=lambda k: data[k].get("length_km", float("inf")))
        return bool(data[best_k].get("dual_carriageway"))

    def neighbors(u: str):
        if G.is_directed():
            return G.successors(u)
        return G.neighbors(u)

    while heap:
        d, (u, t) = heapq.heappop(heap)
        if (u, t) in expanded:
            continue
        expanded.add((u, t))
        coords_u = _get_node_coord(G, u)
        for v in neighbors(u):
            w = edge_weight(u, v)
            if w == float("inf"):
                continue
            if t is None:
                transition_mult = 1.0
            else:
                coords_t = _get_node_coord(G, t)
                coords_v = _get_node_coord(G, v)
                transition_mult = 1.0
                for plugin in plugins:
                    transition_mult *= plugin.calculate_transition_multiplier(
                        coords_t, coords_u, coords_v
                    )
            cost = w * transition_mult

            # Dual-carriageway U-turn: physically impossible.
            if t is not None and edge_is_dual_carriageway(u, v):
                bearing_in = calculate_bearing(
                    *_get_node_coord(G, t), *coords_u
                )
                bearing_out = calculate_bearing(*coords_u, *_get_node_coord(G, v))
                if _classify_turn(bearing_in, bearing_out) == "u_turn":
                    cost += DUAL_CARRIAGEWAY_UTURN_KM

            new_d = d + cost
            if new_d < lengths.get(v, float("inf")):
                lengths[v] = new_d
                path_to_state[(v, u)] = path_to_state[(u, t)] + [v]
                paths[v] = path_to_state[(v, u)]
                heapq.heappush(heap, (new_d, (v, u)))

    return lengths, paths


# ---------------------------------------------------------------------------
# Chinese Postman Problem solver
# ---------------------------------------------------------------------------


def _solve_cpp(
    G: nx.MultiGraph | nx.MultiDiGraph,
    turn_penalties: TurnPenalties | None = None,
) -> list[str]:
    """
    Approximate solution to the Chinese Postman Problem:
    traverse every edge at least once with minimum extra (deadhead) distance.

    1. Find odd-degree vertices (or unbalanced for directed: in_degree != out_degree).
    2. Compute shortest paths between all pairs of odd-degree vertices.
    3. Find minimum weight perfect matching on odd-degree vertices.
    4. Augment graph with matching edges (duplicating shortest paths).
    5. Find Eulerian circuit on augmented graph.

    When turn_penalties is provided, each edge's effective weight includes a
    turn-cost surcharge so the Blossom matching prefers deadhead paths with
    fewer/cheaper turns.
    """
    if G.number_of_edges() == 0:
        return []

    is_directed = G.is_directed()

    # If graph is disconnected, solve CPP on each component and concatenate.
    # This ensures every road segment is covered, not just the largest piece.
    if is_directed:
        components = list(nx.weakly_connected_components(G))
    else:
        components = list(nx.connected_components(G))
    if len(components) > 1:
        full_route: list[str] = []
        for comp_nodes in sorted(components, key=len, reverse=True):
            sub = G.subgraph(comp_nodes).copy()
            if "routing_plugins" in G.graph:
                sub.graph["routing_plugins"] = G.graph["routing_plugins"]
            # Skip components with no edges (isolated nodes)
            if sub.number_of_edges() == 0:
                continue
            sub_route = _solve_cpp(sub, turn_penalties=turn_penalties)
            if sub_route:
                if full_route:
                    full_route.extend(sub_route)
                else:
                    full_route = sub_route
        return full_route

    # Find odd-degree (undirected) or unbalanced (directed) vertices
    if is_directed:
        odd_nodes = [n for n in G.nodes() if G.in_degree(n) != G.out_degree(n)]
    else:
        odd_nodes = [n for n in G.nodes() if G.degree(n) % 2 != 0]

    if len(odd_nodes) == 0:
        # Already Eulerian — find circuit directly
        try:
            circuit = eulerian_circuit_nx(G)
            if circuit:
                return [circuit[0][0]] + [e[1] for e in circuit]
        except nx.NetworkXError:
            pass

    if len(odd_nodes) >= 2:
        # Compute shortest path lengths and paths between all pairs of odd nodes
        odd_pairs_dist: dict[tuple[str, str], float] = {}
        odd_pairs_path: dict[tuple[str, str], list[str]] = {}

        plugins = G.graph.get("routing_plugins", [])
        use_transition_costs = len(plugins) > 0

        for i, u in enumerate(odd_nodes):
            try:
                if use_transition_costs:
                    lengths, paths = _dijkstra_with_transition_costs(G, u, plugins)
                    # Path cost already includes transition (turn) multipliers
                    for j in range(i + 1, len(odd_nodes)):
                        v = odd_nodes[j]
                        if v in lengths:
                            odd_pairs_dist[(u, v)] = lengths[v]
                            odd_pairs_path[(u, v)] = paths[v]
                else:
                    lengths, paths = nx.single_source_dijkstra(G, u, weight="length_km")
                    for j in range(i + 1, len(odd_nodes)):
                        v = odd_nodes[j]
                        if v in lengths:
                            dist_km = lengths[v]
                            path = paths[v]
                            penalty_cost = 0.0
                            if turn_penalties:
                                penalty_cost = _calculate_path_turn_cost(path, G, turn_penalties)
                            odd_pairs_dist[(u, v)] = dist_km + penalty_cost
                            odd_pairs_path[(u, v)] = path
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
            circuit = eulerian_circuit_nx(G_aug)
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


def _calculate_path_turn_cost(path: list[str], G: nx.MultiGraph, penalties: TurnPenalties | None) -> float:
    """Calculate total turn penalties for a given sequence of nodes."""
    if not penalties or len(path) < 3:
        return 0.0

    cost = 0.0
    for i in range(1, len(path) - 1):
        prev_node = path[i - 1]
        curr_node = path[i]
        next_node = path[i + 1]

        def get_edge_bearing(u: str, v: str, traverse_to_v: bool) -> float:
            """Get bearing of the edge segment adjacent to v (if traverse_to_v) or u."""
            # Find the edge data for u-v. Use shortest if multiple.
            edge_data = G.get_edge_data(u, v)
            if not edge_data:
                return 0.0
            # Pick edge with min length (Dijkstra preference)
            best_key = min(edge_data.keys(), key=lambda k: edge_data[k].get("length_km", float("inf")))
            data = edge_data[best_key]
            coords = data["coords"]
            
            # Identify direction based on node ID matching
            # u_node is the start of traversal
            start_coord = coords[0]
            start_id = _node_id(start_coord[0], start_coord[1])
            is_forward_in_coords = (start_id == u)

            if traverse_to_v:
                # We are arriving at v. We need bearing of the END of the segment.
                if is_forward_in_coords:
                     # Coords run u -> v. End is last.
                     p1, p2 = coords[-2], coords[-1]
                else:
                     # Coords run v -> u. We traversed u -> v.
                     # "End" of our traversal is start of coords (v).
                     p1, p2 = coords[1], coords[0]
            else:
                # We are leaving u (curr_node). We need bearing of the START of the segment.
                if is_forward_in_coords:
                    # Coords run u -> v. Start is first.
                    p1, p2 = coords[0], coords[1]
                else:
                    # Coords run v -> u. We traverse u -> v.
                    # "Start" of our traversal is end of coords (u).
                    p1, p2 = coords[-1], coords[-2]

            return calculate_bearing(p1[0], p1[1], p2[0], p2[1])

        bearing_in = get_edge_bearing(prev_node, curr_node, traverse_to_v=True)
        bearing_out = get_edge_bearing(curr_node, next_node, traverse_to_v=False)

        turn_type = _classify_turn(bearing_in, bearing_out)
        if turn_type == "right":
            cost += penalties.right_turn
        elif turn_type == "left":
            cost += penalties.left_turn
        elif turn_type == "u_turn":
            cost += penalties.u_turn

        # Dual-carriageway U-turn: physically impossible — add a fixed large cost.
        if turn_type == "u_turn":
            out_edge_data = G.get_edge_data(curr_node, next_node)
            if out_edge_data:
                best_k = min(out_edge_data, key=lambda k: out_edge_data[k].get("length_km", float("inf")))
                if out_edge_data[best_k].get("dual_carriageway"):
                    cost += DUAL_CARRIAGEWAY_UTURN_KM

    return cost


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


def cpp_solution_to_gpx_segments(
    G: nx.Graph,
    route_nodes: list,
) -> list[RouteSegment]:
    """
    Convert CPP solution to RouteSegment list for GPX export.
    
    Args:
        G: NetworkX graph with node coordinates in node attributes (lat, lon)
        route_nodes: List of nodes in the Eulerian circuit
        
    Returns:
        List of RouteSegment objects for GPX export
    """
    if not GPX_EXPORT_AVAILABLE:
        return []
        
    if not route_nodes:
        return []
        
    # Create waypoints for each unique node
    waypoints = []
    added_nodes = set()
    
    for node in route_nodes:
        if node not in added_nodes:
            # Get node coordinates from graph
            if node in G.nodes:
                ndata = G.nodes[node]
                lat = ndata.get("lat", 0)
                lon = ndata.get("lon", 0)
                waypoints.append(Waypoint(lat, lon, name=f"Node {node}"))
                added_nodes.add(node)
    
    # Create track points from the route
    track = []
    for node in route_nodes:
        # Get node coordinates from graph
        if node in G.nodes:
            ndata = G.nodes[node]
            lat = ndata.get("lat", 0)
            lon = ndata.get("lon", 0)
            track.append((lat, lon))
    
    # Create a single route segment for the entire Eulerian circuit
    segment = RouteSegment(
        track=track,
        waypoints=waypoints,
        name="Eulerian Circuit"
    )
    return [segment]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Pure computation helper — used by the Celery task (async path)
# ---------------------------------------------------------------------------

def _run_optimize(body: OptimizeRequest) -> OptimizeResponse:
    """Execute Chinese Postman route optimisation without any HTTP context.

    Raises ``ValueError`` (not ``HTTPException``) for invalid / unroutable inputs
    so Celery tasks can propagate them cleanly as 400-class errors.

    Returns an ``OptimizeResponse`` (JSON-serialisable).  GPX export is NOT
    performed here; use the sync endpoint or a separate conversion step.
    """
    _t_start = time.perf_counter()
    features = body.geojson.features

    if body.clean_before_optimize:
        if body.clean_options is not None:
            opts = body.clean_options
        else:
            opts = CleanOptions(
                remove_selfloops=True,
                dedupe_edges=True,
                merge_parallel_edges=False,
                min_length_m=1.0,
                max_components=0,
            )
        cleaned_fc, _ = clean_geojson(body.geojson.model_dump(), opts)
        features = cleaned_fc.features
    _t_after_clean = time.perf_counter()

    allowed: set[str] = set(body.road_classes) if body.road_classes else set(DEFAULT_ROAD_CLASSES)
    features = [
        f for f in features
        if _get_road_class(f) in allowed and _get_road_class(f) not in NON_VEHICLE_CLASSES
    ]
    features = [
        f for f in features
        if f.geometry.get("type") in ("LineString", "MultiLineString")
    ]

    if not features:
        raise ValueError("No LineString/MultiLineString features found in the GeoJSON")

    oneway_mode = _normalize_oneway_mode(body.oneway_mode)
    resolved_dem_path = body.dem_path or os.getenv("DEM_PATH")
    plugins: list[RoutingCostPlugin] | None = None
    if resolved_dem_path or body.use_turn_penalty_plugin:
        plugins = []
        if resolved_dem_path:
            plugins.append(FuelAwarePlugin(resolved_dem_path))
        if body.use_turn_penalty_plugin:
            plugins.append(TurnPenaltyPlugin())
    G = _build_graph(features, oneway_mode, plugins=plugins)
    _t_after_graph = time.perf_counter()

    if body.service_both_sides and not G.is_directed():
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
        raise ValueError(f"Graph has only {G.number_of_nodes()} node(s) — need at least 2")

    if G.number_of_edges() == 0:
        raise ValueError("Graph has no edges — cannot compute route")

    n_components = (
        len(list(nx.weakly_connected_components(G)))
        if G.is_directed()
        else len(list(nx.connected_components(G)))
    )

    odd_degree = sum(1 for n in G.nodes() if G.degree(n) % 2 != 0)
    total_edge_dist = sum(data.get("length_km", 0) for _, _, data in G.edges(data=True))

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

    _t_before_cpp = time.perf_counter()
    route_nodes = _solve_cpp(G, turn_penalties=body.turn_penalties)
    _t_after_cpp = time.perf_counter()

    if not route_nodes:
        raise ValueError("Could not compute route — graph may be empty or disconnected")

    if start_node and start_node in route_nodes and route_nodes[0] == route_nodes[-1]:
        idx = route_nodes.index(start_node)
        route_nodes = route_nodes[idx:] + route_nodes[1:idx + 1]

    route_points: list[RoutePoint] = []
    route_coords: list[list[float]] = []
    instructions: list[Instruction] = []
    total_distance_km = 0.0
    deadhead_distance_km = 0.0
    right_turns = left_turns = u_turns = straight = dead_ends = 0
    total_traversals = 0
    prev_bearing: float | None = None
    consumed_edge_keys: set[tuple[str, str, int]] = set()

    for i in range(len(route_nodes) - 1):
        u = route_nodes[i]
        v = route_nodes[i + 1]
        edge_data = G.get_edge_data(u, v) or G.get_edge_data(v, u)
        chosen_key: int | None = None
        edge_coords: list[list[float]] = []
        is_deadhead = False
        reversed_coords = False
        is_component_bridge = False
        edge_name: str | None = None
        edge_osm_id: str | None = None
        edge_dist_km: float = 0.0

        if edge_data:
            for ek, edata in edge_data.items():
                canon = (u, v, ek) if G.is_directed() else (min(u, v), max(u, v), ek)
                if canon not in consumed_edge_keys:
                    chosen_key = ek
                    consumed_edge_keys.add(canon)
                    is_deadhead = bool(edata.get("deadhead"))
                    raw_coords = edata.get("coords") or []
                    edge_name = edata.get("name")
                    edge_osm_id = edata.get("osm_id")
                    edge_dist_km = edata.get("length_km", 0)
                    if raw_coords:
                        start_nid = _node_id(raw_coords[0][0], raw_coords[0][1])
                        reversed_coords = (start_nid != u)
                        edge_coords = list(reversed(raw_coords)) if reversed_coords else raw_coords
                    break

        if not is_component_bridge and edge_coords and len(edge_coords) >= 2:
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
                elif turn == "left":
                    maneuver = "turn_left"
                elif turn == "u_turn":
                    maneuver = "u_turn"
            maneuver_text = maneuver.replace("_", " ").capitalize()
            text = maneuver_text
            if edge_name:
                text += f" onto {edge_name}" if maneuver != "continue" else f" on {edge_name}"
            instructions.append(Instruction(
                text=text,
                distance_km=round(edge_dist_km, 4),
                way_id=edge_osm_id,
                type=maneuver,
            ))
            prev_bearing = end_bearing

        if not edge_coords:
            is_component_bridge = True
            u_data = G.nodes[u]
            v_data = G.nodes[v]
            edge_coords = [
                [u_data.get("lon", 0), u_data.get("lat", 0)],
                [v_data.get("lon", 0), v_data.get("lat", 0)],
            ]

        start_k = 0 if i == 0 else 1
        for k, c in enumerate(edge_coords):
            if k < start_k:
                continue
            lon, lat = c[0], c[1]
            route_points.append(RoutePoint(latitude=lat, longitude=lon, node_id=u if k == 0 else v))
            route_coords.append([lon, lat])

        for k in range(1, len(edge_coords)):
            c0 = edge_coords[k - 1]
            c1 = edge_coords[k]
            seg_dist = _haversine_km(c0[0], c0[1], c1[0], c1[1])
            total_distance_km += seg_dist
            if is_deadhead or is_component_bridge:
                deadhead_distance_km += seg_dist
            if not is_component_bridge:
                curr_bearing = calculate_bearing(c0[0], c0[1], c1[0], c1[1])
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

        if not is_component_bridge:
            total_traversals += 1

    if route_nodes and not route_points:
        node = route_nodes[0]
        ndata = G.nodes[node]
        route_points.append(RoutePoint(
            latitude=ndata.get("lat", 0),
            longitude=ndata.get("lon", 0),
            node_id=node,
        ))
        route_coords.append([ndata.get("lon", 0), ndata.get("lat", 0)])

    if len(route_points) > 1:
        first_p = route_points[0]
        last_p = route_points[-1]
        COORD_TOL = 1e-6
        if (
            abs(first_p.latitude - last_p.latitude) < COORD_TOL
            and abs(first_p.longitude - last_p.longitude) < COORD_TOL
        ):
            route_points.pop()
            if route_coords:
                route_coords.pop()

    _t_after_route_build = time.perf_counter()
    dead_ends = sum(1 for n in G.nodes() if G.degree(n) == 1)

    if total_distance_km <= 0 or not math.isfinite(total_distance_km):
        total_distance_km = 0.0
        efficiency = 100.0
    else:
        efficiency = total_edge_dist / total_distance_km * 100
        efficiency = 100.0 if not math.isfinite(efficiency) else max(0.0, min(100.0, efficiency))

    total_distance_km = max(0.0, total_distance_km) if math.isfinite(total_distance_km) else 0.0
    deadhead_distance_km = max(0.0, deadhead_distance_km) if math.isfinite(deadhead_distance_km) else 0.0

    msg = (
        f"Route computed: {total_traversals} traversals, "
        f"{round(total_distance_km, 2)} km, {round(efficiency, 1)}% efficiency"
    )
    if n_components > 1:
        msg += f" (disconnected graph: {n_components} components solved independently)"

    path_for_analytics: list[tuple[float, float]] = [(c[0], c[1]) for c in route_coords]
    active_plugins: list[RoutingCostPlugin] = plugins or []
    route_metrics = calculate_route_metrics(path_for_analytics, active_plugins)
    route_metrics, msg = _merge_extractor_bbox_verification(
        features, route_coords, route_metrics, msg
    )
    _t_after_analytics = time.perf_counter()

    route_geojson = GeoJSONFeatureCollection(
        type="FeatureCollection",
        features=[
            GeoJSONFeature(
                type="Feature",
                geometry={"type": "LineString", "coordinates": route_coords},
                properties={
                    "total_distance_km": round(total_distance_km, 4),
                    "total_traversals": total_traversals,
                    "metrics": route_metrics,
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

    _t_end = time.perf_counter()

    def _ms(a: float, b: float) -> float:
        return round((b - a) * 1000, 2)

    return OptimizeResponse(
        route=route_points,
        route_geojson=route_geojson,
        instructions=instructions,
        total_distance_km=round(total_distance_km, 4),
        message=msg,
        stats=stats,
        metrics=route_metrics,
        timing_ms={
            "clean_ms": _ms(_t_start, _t_after_clean),
            "graph_build_ms": _ms(_t_after_clean, _t_after_graph),
            "cpp_solve_ms": _ms(_t_before_cpp, _t_after_cpp),
            "route_build_ms": _ms(_t_after_cpp, _t_after_route_build),
            "analytics_ms": _ms(_t_after_route_build, _t_after_analytics),
            "total_ms": _ms(_t_start, _t_end),
        },
    )


# ---------------------------------------------------------------------------
# Async endpoint — enqueue task, return 202 immediately
# ---------------------------------------------------------------------------

@router.post("/api/optimize")
def optimize_route_async(body: OptimizeRequest) -> Response:
    """Enqueue a Chinese Postman optimisation job.

    Returns HTTP 202 Accepted with ``{"task_id": "<uuid>", "status": "PENDING"}``.
    Poll ``GET /api/optimize/status/{task_id}`` for progress and the final result.

    Falls back to HTTP 503 when the Redis broker is unreachable.
    """
    from .tasks.optimize_task import optimize_route_task
    import json as _json

    try:
        task = optimize_route_task.delay(body.model_dump())
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


@router.get("/api/optimize/status/{task_id}")
def get_optimize_status(task_id: str) -> Response:
    """Poll optimisation task status.

    State machine:
      PENDING    → job is waiting in the Redis queue
      PROCESSING → worker has picked it up and is solving
      SUCCESS    → result is ready; ``result`` key contains the OptimizeResponse
      FAILURE    → solver error; ``error`` key contains the message

    HTTP status codes:
      200   for PENDING / PROCESSING / SUCCESS
      400   for FAILURE caused by invalid / unroutable input (ValueError)
      500   for FAILURE caused by an unexpected solver error
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
        exc = ar.result  # The raised exception instance stored by Celery
        error_msg = str(exc) if exc else "Unknown optimisation error"
        # ValueError = client error (bad GeoJSON / unroutable); anything else = server error
        http_status = 400 if isinstance(exc, ValueError) else 500
        payload = {"task_id": task_id, "status": "FAILURE", "error": error_msg}
        return Response(
            content=_json.dumps(payload),
            status_code=http_status,
            media_type="application/json",
        )

    # Celery can surface REVOKED or custom states
    payload = {"task_id": task_id, "status": state}
    return Response(content=_json.dumps(payload), media_type="application/json")


# ---------------------------------------------------------------------------
# Sync endpoint — kept for GPX export and backward-compat testing
# ---------------------------------------------------------------------------

@router.post("/api/optimize/sync", response_model=OptimizeResponse)
def optimize_route_sync(request: Request, body: OptimizeRequest):
    """Synchronous Chinese Postman optimisation — blocks until complete.

    Supports GPX export via ``Accept: application/gpx+xml``.
    Prefer ``POST /api/optimize`` (async) for large payloads to avoid timeouts.
    """
    _t_start = time.perf_counter()
    features = body.geojson.features

    if body.clean_before_optimize:
        if body.clean_options is not None:
            opts = body.clean_options
        else:
            # Default: light cleaning to remove true noise (self-loops, exact duplicates)
            # without dropping disconnected road segments (max_components=0 keeps all components).
            # merge_parallel_edges is intentionally False: collapsing parallel edges between the
            # same two endpoints would silently discard roads that share endpoints but differ in path.
            opts = CleanOptions(
                remove_selfloops=True,
                dedupe_edges=True,
                merge_parallel_edges=False,
                min_length_m=1.0,
                max_components=0,
            )
        cleaned_fc, _ = clean_geojson(body.geojson.model_dump(), opts)
        features = cleaned_fc.features
    _t_after_clean = time.perf_counter()

    # Road class filtering:
    # 1. If caller supplies road_classes, use that allowlist exactly.
    # 2. Otherwise apply DEFAULT_ROAD_CLASSES (residential / secondary / tertiary / unclassified).
    # 3. Always strip NON_VEHICLE_CLASSES (footway, railway, etc.) regardless of (1) or (2).
    allowed: set[str] = set(body.road_classes) if body.road_classes else set(DEFAULT_ROAD_CLASSES)
    features = [f for f in features if _get_road_class(f) in allowed and _get_road_class(f) not in NON_VEHICLE_CLASSES]

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

    # Build graph (directed with plugin costs when dem_path or turn penalty plugin set, else undirected / oneway-aware)
    oneway_mode = _normalize_oneway_mode(body.oneway_mode)
    resolved_dem_path = body.dem_path or os.getenv("DEM_PATH")
    plugins: list[RoutingCostPlugin] | None = None
    if resolved_dem_path or body.use_turn_penalty_plugin:
        plugins = []
        if resolved_dem_path:
            plugins.append(FuelAwarePlugin(resolved_dem_path))
        if body.use_turn_penalty_plugin:
            plugins.append(TurnPenaltyPlugin())
    G = _build_graph(features, oneway_mode, plugins=plugins)
    _t_after_graph = time.perf_counter()

    # When service_both_sides is True and graph is undirected, convert to directed so each
    # segment is traversed in BOTH directions (u→v and v→u = both curbs). Skip when G is
    # already directed (e.g. from routing plugins).
    if body.service_both_sides and not G.is_directed():
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

    if G.number_of_edges() == 0:
        raise HTTPException(
            status_code=400,
            detail="Graph has no edges — cannot compute route",
        )

    # Detect disconnected components for user-facing message
    n_components = (
        len(list(nx.weakly_connected_components(G)))
        if G.is_directed()
        else len(list(nx.connected_components(G)))
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
    _t_before_cpp = time.perf_counter()
    route_nodes = _solve_cpp(G, turn_penalties=body.turn_penalties)
    _t_after_cpp = time.perf_counter()

    if not route_nodes:
        raise HTTPException(status_code=400, detail="Could not compute route — graph may be empty or disconnected")

    # If start node specified, rotate circuit to start there.
    # Only apply rotation when the route is circular (first == last), i.e. a single Eulerian circuit.
    # Concatenated multi-component routes are non-circular (e.g. [A,B,C,A, X,Y,Z,X]); using
    # route_nodes[idx:] + route_nodes[1:idx+1] would drop the first segment and add a phantom
    # hop from the last node into the middle, losing coverage. So we rotate only when circular.
    if start_node and start_node in route_nodes and route_nodes[0] == route_nodes[-1]:
        idx = route_nodes.index(start_node)
        route_nodes = route_nodes[idx:] + route_nodes[1:idx + 1]

    # Build route points and stats
    route_points: list[RoutePoint] = []
    route_coords: list[list[float]] = []  # for route GeoJSON
    instructions: list[Instruction] = []
    total_distance_km = 0.0
    deadhead_distance_km = 0.0
    right_turns = left_turns = u_turns = straight = dead_ends = 0
    total_traversals = 0

    prev_bearing: float | None = None

    # Track which graph edge key was consumed for each hop to avoid re-using
    # the same multi-edge twice in a row (Eulerian traversal can have parallel edges).
    consumed_edge_keys: set[tuple[str, str, int]] = set()

    for i in range(len(route_nodes) - 1):
        u = route_nodes[i]
        v = route_nodes[i + 1]

        # Retrieve the edge between u and v
        edge_data = G.get_edge_data(u, v) or G.get_edge_data(v, u)
        chosen_key: int | None = None
        edge_coords: list[list[float]] = []
        is_deadhead = False
        reversed_coords = False
        is_component_bridge = False
        
        # New: attributes for instructions
        edge_name: str | None = None
        edge_osm_id: str | None = None
        edge_dist_km: float = 0.0

        if edge_data:
            for ek, edata in edge_data.items():
                # Directed: (u,v) and (v,u) are different edges; undirected: canonical (min,max)
                canon = (u, v, ek) if G.is_directed() else (min(u, v), max(u, v), ek)
                if canon not in consumed_edge_keys:  # Only use UNCONSUMED
                    chosen_key = ek
                    consumed_edge_keys.add(canon)
                    is_deadhead = bool(edata.get("deadhead"))
                    raw_coords = edata.get("coords") or []
                    edge_name = edata.get("name")
                    edge_osm_id = edata.get("osm_id")
                    edge_dist_km = edata.get("length_km", 0)
                    
                    if raw_coords:
                        start_nid = _node_id(raw_coords[0][0], raw_coords[0][1])
                        # If the edge in G is stored u->v (or v->u), check if we traverse it backwards relative to geometry
                        # The node IDs are rounded coordinates.
                        # raw_coords[0] is start. 
                        # If 'u' (current start) matches raw_coords[0], we are forward.
                        reversed_coords = (start_nid != u)
                        edge_coords = list(reversed(raw_coords)) if reversed_coords else raw_coords
                    break
        
        # -----------------------------------------------------------
        # Instruction Generation (Simple)
        # -----------------------------------------------------------
        if not is_component_bridge and edge_coords and len(edge_coords) >= 2:
            start_bearing = calculate_bearing(edge_coords[0][0], edge_coords[0][1], edge_coords[1][0], edge_coords[1][1])
            end_bearing = calculate_bearing(edge_coords[-2][0], edge_coords[-2][1], edge_coords[-1][0], edge_coords[-1][1])

            # Decide on maneuver based on previous bearing
            maneuver = "continue"
            if prev_bearing is not None:
                turn = _classify_turn(prev_bearing, start_bearing)
                if turn == "right": maneuver = "turn_right"
                elif turn == "left": maneuver = "turn_left"
                elif turn == "u_turn": maneuver = "u_turn"
            
            # Text construction
            maneuver_text = maneuver.replace("_", " ").capitalize()
            text = f"{maneuver_text}"
            if edge_name:
                text += f" onto {edge_name}" if maneuver != "continue" else f" on {edge_name}"
            
            # Simple instruction append (can be improved by collapsing 'continue' segments)
            instructions.append(Instruction(
                text=text,
                distance_km=round(edge_dist_km, 4),
                way_id=edge_osm_id,
                type=maneuver
            ))

            prev_bearing = end_bearing
        # -----------------------------------------------------------

        if not edge_coords:
            is_component_bridge = True
            u_data = G.nodes[u]
            v_data = G.nodes[v]
            edge_coords = [
                [u_data.get("lon", 0), u_data.get("lat", 0)],
                [v_data.get("lon", 0), v_data.get("lat", 0)],
            ]

        # Emit route points
        start_k = 0 if i == 0 else 1
        for k, c in enumerate(edge_coords):
            if k < start_k:
                continue
            lon, lat = c[0], c[1]
            route_points.append(RoutePoint(latitude=lat, longitude=lon, node_id=u if k == 0 else v))
            route_coords.append([lon, lat])

        # Accumulate distance and turn stats using the full edge geometry
        for k in range(1, len(edge_coords)):
            c0 = edge_coords[k - 1]
            c1 = edge_coords[k]
            seg_dist = _haversine_km(c0[0], c0[1], c1[0], c1[1])
            total_distance_km += seg_dist
            if is_deadhead or is_component_bridge:
                deadhead_distance_km += seg_dist

            # Turn stats only for real graph edges; component-bridge hops have no road geometry
            if not is_component_bridge:
                curr_bearing = calculate_bearing(c0[0], c0[1], c1[0], c1[1])
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

        if not is_component_bridge:
            total_traversals += 1

    # Ensure the last node is emitted when there are route nodes but the loop above produced nothing
    if route_nodes and not route_points:
        node = route_nodes[0]
        ndata = G.nodes[node]
        route_points.append(RoutePoint(latitude=ndata.get("lat", 0), longitude=ndata.get("lon", 0), node_id=node))
        route_coords.append([ndata.get("lon", 0), ndata.get("lat", 0)])

    # Hierholzer closes the circuit: route_nodes[0] == route_nodes[-1].
    # The last emitted route_point therefore duplicates the first, drawing a
    # straight "return to start" line on the map.  Strip it.
    if len(route_points) > 1:
        first_p = route_points[0]
        last_p = route_points[-1]
        COORD_TOL = 1e-6
        if (
            abs(first_p.latitude - last_p.latitude) < COORD_TOL
            and abs(first_p.longitude - last_p.longitude) < COORD_TOL
        ):
            route_points.pop()
            if route_coords:
                route_coords.pop()

    _t_after_route_build = time.perf_counter()

    # Count dead ends (degree-1 nodes)
    dead_ends = sum(1 for n in G.nodes() if G.degree(n) == 1)

    # Efficiency = minimum possible distance / actual distance; guard against NaN and overflow
    if total_distance_km <= 0 or not math.isfinite(total_distance_km):
        total_distance_km = 0.0
        efficiency = 100.0
    else:
        efficiency = (total_edge_dist / total_distance_km * 100)
        efficiency = 100.0 if not math.isfinite(efficiency) else max(0.0, min(100.0, efficiency))

    # Ensure response totals are finite and non-negative
    total_distance_km = max(0.0, total_distance_km) if math.isfinite(total_distance_km) else 0.0
    deadhead_distance_km = max(0.0, deadhead_distance_km) if math.isfinite(deadhead_distance_km) else 0.0

    # Message: mention disconnected components when applicable
    msg = f"Route computed: {total_traversals} traversals, {round(total_distance_km, 2)} km, {round(efficiency, 1)}% efficiency"
    if n_components > 1:
        msg += f" (disconnected graph: {n_components} components solved independently)"

    # Analytics: compute plugin-aware metrics for the full solved route.
    # route_coords is [[lon, lat], ...]; convert to (lon, lat) tuples for analytics.
    path_for_analytics: list[tuple[float, float]] = [
        (c[0], c[1]) for c in route_coords
    ]
    active_plugins: list[RoutingCostPlugin] = plugins or []
    route_metrics = calculate_route_metrics(path_for_analytics, active_plugins)
    route_metrics, msg = _merge_extractor_bbox_verification(
        features, route_coords, route_metrics, msg
    )
    _t_after_analytics = time.perf_counter()

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
                    "metrics": route_metrics,
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

    _t_end = time.perf_counter()

    def _ms(a: float, b: float) -> float:
        return round((b - a) * 1000, 2)

    timing_ms = {
        "clean_ms": _ms(_t_start, _t_after_clean),
        "graph_build_ms": _ms(_t_after_clean, _t_after_graph),
        "cpp_solve_ms": _ms(_t_before_cpp, _t_after_cpp),
        "route_build_ms": _ms(_t_after_cpp, _t_after_route_build),
        "analytics_ms": _ms(_t_after_route_build, _t_after_analytics),
        "total_ms": _ms(_t_start, _t_end),
    }

    response = OptimizeResponse(
        route=route_points,
        route_geojson=route_geojson,
        instructions=instructions,
        total_distance_km=round(total_distance_km, 4),
        message=msg,
        stats=stats,
        metrics=route_metrics,
        timing_ms=timing_ms,
    )
    
    # Dual-path: return GPX when client requests application/gpx+xml
    accept = request.headers.get("Accept", "")
    if ACCEPT_GPX in accept and route_nodes and GPX_EXPORT_AVAILABLE:
        try:
            segments = cpp_solution_to_gpx_segments(G, route_nodes)
            if segments:
                gpx_str = build_gpx(segments)
                return Response(
                    content=gpx_str,
                    media_type=ACCEPT_GPX,
                    headers={"Content-Disposition": "attachment; filename=route.gpx"},
                )
        except Exception as e:
            print(f"Warning: Failed to export to GPX: {e}", file=sys.stderr)
    
    return response
