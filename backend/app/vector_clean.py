"""
GeoJSON/OSM cleaning pipeline before optimizer.

  POST /api/geojson/clean — validate, repair geometry, dedupe nodes/edges,
  remove self-loops/short edges/isolates, keep largest component(s); return cleaned GeoJSON + stats.
"""
from __future__ import annotations

import hashlib
from typing import Any

import networkx as nx
from fastapi import APIRouter
from pydantic import BaseModel, Field
from shapely.geometry import LineString, Point, shape
from shapely import make_valid
from shapely.strtree import STRtree

from .geojson_ops import (
    GeoJSONFeature,
    GeoJSONFeatureCollection,
    _extract_coords,
    _haversine_km,
)

router = APIRouter()

# Approx meters per degree at equator (for bbox query)
_M_PER_DEG = 111_320.0


def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Haversine distance in meters."""
    return _haversine_km(lon1, lat1, lon2, lat2) * 1000.0


def _round_key(lon: float, lat: float, decimals: int = 6) -> tuple[float, float]:
    return (round(lon, decimals), round(lat, decimals))


def _node_id(lon: float, lat: float, decimals: int = 6) -> str:
    return f"{round(lon, decimals)},{round(lat, decimals)}"


# ---------------------------------------------------------------------------
# Options and stats
# ---------------------------------------------------------------------------


class CleanOptions(BaseModel):
    """Options for POST /api/geojson/clean."""

    makevalid: bool = True
    drop_invalid: bool = True
    remove_selfloops: bool = True
    min_length_m: float = 0.1
    node_snap_m: float = 1.0
    dedupe_edges: bool = True
    remove_isolates: bool = True
    max_components: int = 1
    required_attrs: list[str] | None = None
    merge_parallel_edges: bool = False


class CleanStats(BaseModel):
    """Counts returned after cleaning."""

    input_features: int = 0
    output_features: int = 0
    invalid_dropped: int = 0
    selfloops_removed: int = 0
    short_edges_removed: int = 0
    nodes_merged: int = 0
    duplicate_edges_removed: int = 0
    incomplete_edges_removed: int = 0
    parallel_edges_merged: int = 0
    isolates_removed: int = 0
    components_removed: int = 0


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------


def _geom_to_shapely(geom: dict[str, Any]) -> LineString | Point | None:
    """Convert GeoJSON geometry dict to Shapely. Returns LineString, Point, or None."""
    if not geom or not geom.get("coordinates"):
        return None
    try:
        return shape(geom)
    except Exception:
        return None


def _make_valid_geom(geom: LineString | Point | None) -> LineString | Point | None:
    """Repair invalid geometry; return None if empty or still invalid."""
    if geom is None or geom.is_empty:
        return None
    try:
        fixed = make_valid(geom)
        if fixed is None or fixed.is_empty:
            return None
        if fixed.geom_type == "GeometryCollection":
            # Take first line-like part
            for g in fixed.geoms:
                if g.geom_type in ("LineString", "Point") and not g.is_empty:
                    return g
            return None
        return fixed
    except Exception:
        return None


def _shapely_to_geojson_geom(geom: LineString | Point) -> dict[str, Any]:
    """Convert Shapely geometry to GeoJSON dict (coordinates only for LineString/Point)."""
    if geom.geom_type == "Point":
        return {"type": "Point", "coordinates": list(geom.coords[0])}
    if geom.geom_type == "LineString":
        return {"type": "LineString", "coordinates": [list(c) for c in geom.coords]}
    return {"type": "LineString", "coordinates": []}


# ---------------------------------------------------------------------------
# GeoJSON -> Graph (with geometry + properties on edges)
# ---------------------------------------------------------------------------


def _geojson_features_to_graph(
    features: list[dict[str, Any]],
    decimals: int = 6,
) -> tuple[nx.MultiGraph, list[dict[str, Any]]]:
    """
    Build MultiGraph from LineString features. Node id = "lon,lat" (rounded).
    Each edge has: length_m, coords, properties.
    Returns (G, edge_records) where edge_records[i] = {coords, properties} for export.
    """
    G = nx.MultiGraph()
    edge_records: list[dict[str, Any]] = []

    for feat in features:
        geom = feat.get("geometry") or {}
        gtype = geom.get("type", "")
        coords_list: list[list[list[float]]] = []
        if gtype == "LineString":
            coords_list = [geom.get("coordinates", [])]
        elif gtype == "MultiLineString":
            coords_list = geom.get("coordinates", [])
        else:
            continue

        props = feat.get("properties") or {}

        for line_coords in coords_list:
            if not line_coords or len(line_coords) < 2:
                continue

            length_m = 0.0
            for i in range(1, len(line_coords)):
                c0, c1 = line_coords[i - 1], line_coords[i]
                length_m += _haversine_m(c0[0], c0[1], c1[0], c1[1])

            start, end = line_coords[0], line_coords[-1]
            u = _node_id(start[0], start[1], decimals)
            v = _node_id(end[0], end[1], decimals)

            if u not in G.nodes:
                G.add_node(u, lon=round(start[0], decimals), lat=round(start[1], decimals))
            if v not in G.nodes:
                G.add_node(v, lon=round(end[0], decimals), lat=round(end[1], decimals))

            key = len(edge_records)
            G.add_edge(u, v, key=key, length_m=length_m, coords=line_coords, properties=props)
            edge_records.append({"coords": line_coords, "properties": props})

    return G, edge_records


# ---------------------------------------------------------------------------
# Graph cleaning steps
# ---------------------------------------------------------------------------


def _remove_selfloops(G: nx.MultiGraph, stats: dict[str, int]) -> None:
    selfloops = list(nx.selfloop_edges(G, keys=True))
    if selfloops:
        for u, v, k in selfloops:
            G.remove_edge(u, v, k)
        stats["selfloops_removed"] += len(selfloops)


def _remove_short_edges(
    G: nx.MultiGraph,
    min_length_m: float,
    stats: dict[str, int],
) -> None:
    to_remove = []
    for u, v, key in list(G.edges(keys=True)):
        data = G.edges[u, v, key]
        if data.get("length_m", 0) < min_length_m:
            to_remove.append((u, v, key))
    for u, v, key in to_remove:
        G.remove_edge(u, v, key)
        stats["short_edges_removed"] += 1


def _merge_duplicate_nodes(
    G: nx.MultiGraph,
    node_snap_m: float,
    stats: dict[str, int],
    decimals: int = 6,
) -> None:
    """Merge nodes within node_snap_m using spatial proximity (STRtree + haversine)."""
    if G.number_of_nodes() == 0:
        return

    nodes = list(G.nodes())
    # Build points (lon, lat) for STRtree; Shapely uses (x,y) = (lon, lat)
    points = []
    for nid in nodes:
        data = G.nodes[nid]
        lon = data.get("lon", 0.0)
        lat = data.get("lat", 0.0)
        points.append(Point(lon, lat))

    tree = STRtree(points)
    # Approx degrees for node_snap_m (conservative)
    delta_deg = node_snap_m / _M_PER_DEG

    # Union-find: each node -> canonical representative (smallest node id by string order)
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        if x not in parent:
            parent[x] = x
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            # canonical = min by string order
            parent[ra] = parent[rb] = min(ra, rb)

    node_to_idx = {n: i for i, n in enumerate(nodes)}
    for i, nid in enumerate(nodes):
        pt = points[i]
        lon, lat = pt.x, pt.y
        # Bbox in degrees
        env = pt.buffer(delta_deg).envelope
        candidates = tree.query(env)
        if candidates is None:
            continue
        for j in candidates:
            j = int(j)
            if j < 0 or j >= len(nodes):
                continue
            other_id = nodes[j]
            if other_id == nid:
                continue
            other_pt = points[j]
            dist_m = _haversine_m(lon, lat, other_pt.x, other_pt.y)
            if dist_m <= node_snap_m:
                union(nid, other_id)

    # Relabel: old_id -> canonical_id
    mapping = {nid: find(nid) for nid in nodes}
    merged_count = sum(1 for n in nodes if mapping[n] != n)
    if merged_count > 0:
        stats["nodes_merged"] += merged_count
        nx.relabel_nodes(G, mapping, copy=False)


def _dedupe_edges(G: nx.MultiGraph, stats: dict[str, int]) -> None:
    """Remove duplicate edges: same (u, v) and same geometry hash; keep first."""
    seen: dict[tuple[str, str], set[str]] = {}
    to_remove = []
    for u, v, key in list(G.edges(keys=True)):
        data = G.edges[u, v, key]
        coords = data.get("coords", [])
        h = hashlib.sha256(str(tuple(tuple(c) for c in coords)).encode()).hexdigest()[:16]
        edge_key = (min(u, v), max(u, v))
        if edge_key not in seen:
            seen[edge_key] = set()
        if h in seen[edge_key]:
            to_remove.append((u, v, key))
            stats["duplicate_edges_removed"] += 1
        else:
            seen[edge_key].add(h)

    for u, v, key in to_remove:
        G.remove_edge(u, v, key)


def _remove_edges_missing_attrs(
    G: nx.MultiGraph,
    required_attrs: list[str] | None,
    stats: dict[str, int],
) -> None:
    if not required_attrs:
        return
    to_remove = []
    for u, v, key in list(G.edges(keys=True)):
        data = G.edges[u, v, key]
        props = data.get("properties") or {}
        for attr in required_attrs:
            if attr not in props or props[attr] is None:
                to_remove.append((u, v, key))
                stats["incomplete_edges_removed"] += 1
                break
    for u, v, key in to_remove:
        G.remove_edge(u, v, key)


def _merge_parallel_edges(G: nx.MultiGraph, stats: dict[str, int]) -> None:
    """Collapse multi-edges between same (u,v) into one edge (first geometry, summed length)."""
    merged = 0
    for u, v in list(G.edges(keys=False)):
        keys = list(G[u][v].keys())
        if len(keys) <= 1:
            continue
        # Keep first, merge rest into it
        k0 = keys[0]
        data0 = G.edges[u, v, k0]
        length_m = data0.get("length_m", 0.0)
        for k in keys[1:]:
            data = G.edges[u, v, k]
            length_m += data.get("length_m", 0.0)
            G.remove_edge(u, v, k)
            merged += 1
        G.edges[u, v, k0]["length_m"] = length_m
    stats["parallel_edges_merged"] += merged


def _remove_isolates(G: nx.MultiGraph, stats: dict[str, int]) -> None:
    isolates = list(nx.isolates(G))
    if isolates:
        G.remove_nodes_from(isolates)
        stats["isolates_removed"] += len(isolates)


def _keep_largest_components(
    G: nx.MultiGraph,
    max_components: int,
    stats: dict[str, int],
) -> None:
    if max_components <= 0 or G.number_of_nodes() == 0:
        return
    comps = list(nx.connected_components(G))
    if len(comps) <= max_components:
        return
    comps_sorted = sorted(comps, key=len, reverse=True)
    keep = set()
    for c in comps_sorted[:max_components]:
        keep.update(c)
    remove = set(G.nodes) - keep
    stats["components_removed"] += len(comps) - max_components
    G.remove_nodes_from(remove)


# ---------------------------------------------------------------------------
# Graph -> GeoJSON
# ---------------------------------------------------------------------------


def _graph_to_geojson(G: nx.MultiGraph) -> GeoJSONFeatureCollection:
    """Rebuild FeatureCollection from graph edges (coords + properties on each edge)."""
    features: list[GeoJSONFeature] = []
    for u, v, key in G.edges(keys=True):
        data = G.edges[u, v, key]
        coords = data.get("coords")
        if not coords or len(coords) < 2:
            continue
        props = data.get("properties") or {}
        geom = {"type": "LineString", "coordinates": coords}
        features.append(
            GeoJSONFeature(type="Feature", geometry=geom, properties=props)
        )
    return GeoJSONFeatureCollection(type="FeatureCollection", features=features)


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def clean_geojson(
    geojson: dict[str, Any],
    options: CleanOptions,
) -> tuple[GeoJSONFeatureCollection, CleanStats]:
    """
    Run full cleaning pipeline: geometry repair -> graph -> topology clean -> export.
    """
    stats = CleanStats(
        input_features=0,
        output_features=0,
        invalid_dropped=0,
        selfloops_removed=0,
        short_edges_removed=0,
        nodes_merged=0,
        duplicate_edges_removed=0,
        incomplete_edges_removed=0,
        parallel_edges_merged=0,
        isolates_removed=0,
        components_removed=0,
    )
    stats_dict = stats.model_dump()

    fc = geojson.get("features") or []
    stats_dict["input_features"] = len(fc)

    # Stage 2: Geometry repair (make_valid, drop invalid)
    repaired: list[dict[str, Any]] = []
    for f in fc:
        geom = (f or {}).get("geometry")
        if not geom or geom.get("type") not in ("LineString", "MultiLineString"):
            continue
        shp = _geom_to_shapely(geom)
        if shp is None:
            stats_dict["invalid_dropped"] += 1
            continue
        if options.makevalid:
            shp = _make_valid_geom(shp)
        if shp is None or shp.is_empty:
            stats_dict["invalid_dropped"] += 1
            continue
        # Normalize to LineString(s)
        if shp.geom_type == "LineString":
            lines = [shp]
        elif shp.geom_type == "MultiLineString":
            lines = list(shp.geoms)
        else:
            continue
        props = (f or {}).get("properties") or {}
        for line in lines:
            if line.is_empty or len(line.coords) < 2:
                continue
            coords = [list(c) for c in line.coords]
            repaired.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": props,
            })

    if not repaired:
        return GeoJSONFeatureCollection(type="FeatureCollection", features=[]), CleanStats(**stats_dict)

    # Stage 3: Build graph
    G, _ = _geojson_features_to_graph(repaired)

    # Stages 4–11
    if options.remove_selfloops:
        _remove_selfloops(G, stats_dict)
    if options.min_length_m > 0:
        _remove_short_edges(G, options.min_length_m, stats_dict)
    if options.node_snap_m > 0:
        _merge_duplicate_nodes(G, options.node_snap_m, stats_dict)
    if options.dedupe_edges:
        _dedupe_edges(G, stats_dict)
    if options.required_attrs:
        _remove_edges_missing_attrs(G, options.required_attrs, stats_dict)
    if options.merge_parallel_edges:
        _merge_parallel_edges(G, stats_dict)
    if options.remove_isolates:
        _remove_isolates(G, stats_dict)
    if options.max_components > 0:
        _keep_largest_components(G, options.max_components, stats_dict)

    out_fc = _graph_to_geojson(G)
    stats_dict["output_features"] = len(out_fc.features)
    return out_fc, CleanStats(**stats_dict)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


class CleanRequest(BaseModel):
    geojson: GeoJSONFeatureCollection
    options: CleanOptions = Field(default_factory=CleanOptions)


class CleanResponse(BaseModel):
    geojson: GeoJSONFeatureCollection
    stats: CleanStats


@router.post("/api/geojson/clean", response_model=CleanResponse)
def post_geojson_clean(body: CleanRequest) -> CleanResponse:
    """Clean GeoJSON: repair geometry, remove self-loops/short edges/duplicates, keep largest component."""
    geojson_dict = body.geojson.model_dump()
    options = body.options
    cleaned_fc, clean_stats = clean_geojson(geojson_dict, options)
    return CleanResponse(geojson=cleaned_fc, stats=clean_stats)
