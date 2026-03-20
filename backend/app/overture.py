"""
Overture-based route optimization endpoint:
  POST /overture/optimize — optimize route from Overture transportation data

Accepts a bounding box, fetches road segments within bounds from the provided
GeoJSON (or in the future from Overture Maps directly), splits long segments
for balanced traversal, and returns an ordered route.
"""
from __future__ import annotations

import math
from typing import Any

import networkx as nx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .geojson_ops import _haversine_km

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class Bounds(BaseModel):
    min_lat: float
    min_lon: float
    max_lat: float
    max_lon: float


class DepotPoint(BaseModel):
    lat: float
    lon: float


class OvertureSegment(BaseModel):
    """An ordered road segment in the optimized route."""
    from_: dict[str, float] = Field(..., alias="from")
    to: dict[str, float]
    polyline: list[dict[str, float]]
    distance: float
    start_lr: float
    end_lr: float
    source_id: str
    was_split: bool
    street_name: str | None = None

    class Config:
        populate_by_name = True


class SplitStats(BaseModel):
    original_count: int
    split_count: int
    avg_splits_per_segment: float


class OptimizeRouteRequest(BaseModel):
    bounds: Bounds
    depot: DepotPoint | None = None
    options: dict[str, Any] | None = None
    # Optional: client can provide GeoJSON directly instead of relying on
    # server-side Overture data fetch
    geojson: dict[str, Any] | None = None


class OptimizeRouteResponse(BaseModel):
    segments: list[dict[str, Any]]
    total_distance_km: float
    estimated_duration_min: float
    split_stats: SplitStats
    algorithm: str
    metadata: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Segment splitting
# ---------------------------------------------------------------------------


def _split_segment(
    coords: list[list[float]],
    source_id: str,
    street_name: str | None,
    max_length_km: float = 0.15,
) -> list[dict[str, Any]]:
    """
    Split a long road segment into sub-segments of max_length_km.
    Returns list of segment dicts with linear reference (start_lr, end_lr).
    """
    if len(coords) < 2:
        return []

    # Compute total length
    total_length = 0.0
    segment_lengths: list[float] = []
    for i in range(1, len(coords)):
        d = _haversine_km(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
        segment_lengths.append(d)
        total_length += d

    if total_length <= max_length_km or total_length == 0:
        # No split needed
        polyline = [{"lat": c[1], "lon": c[0]} for c in coords]
        return [{
            "from": {"lat": coords[0][1], "lon": coords[0][0]},
            "to": {"lat": coords[-1][1], "lon": coords[-1][0]},
            "polyline": polyline,
            "distance": round(total_length, 6),
            "start_lr": 0.0,
            "end_lr": 1.0,
            "source_id": source_id,
            "was_split": False,
            "street_name": street_name,
        }]

    # Split into sub-segments
    splits: list[dict[str, Any]] = []
    num_splits = max(2, math.ceil(total_length / max_length_km))
    target_length = total_length / num_splits

    current_split_coords: list[list[float]] = [coords[0]]
    accumulated = 0.0
    split_start_lr = 0.0
    split_idx = 0

    for i in range(len(segment_lengths)):
        seg_len = segment_lengths[i]
        accumulated += seg_len
        current_split_coords.append(coords[i + 1])

        if accumulated >= target_length or i == len(segment_lengths) - 1:
            lr_end = min(1.0, (split_start_lr + accumulated / total_length))
            if i == len(segment_lengths) - 1:
                lr_end = 1.0

            polyline = [{"lat": c[1], "lon": c[0]} for c in current_split_coords]
            splits.append({
                "from": {"lat": current_split_coords[0][1], "lon": current_split_coords[0][0]},
                "to": {"lat": current_split_coords[-1][1], "lon": current_split_coords[-1][0]},
                "polyline": polyline,
                "distance": round(accumulated, 6),
                "start_lr": round(split_start_lr, 6),
                "end_lr": round(lr_end, 6),
                "source_id": source_id,
                "was_split": True,
                "street_name": street_name,
            })

            split_start_lr = lr_end
            current_split_coords = [coords[i + 1]]
            accumulated = 0.0
            split_idx += 1

    return splits


# ---------------------------------------------------------------------------
# Graph construction + route ordering
# ---------------------------------------------------------------------------


def _round_coord(val: float, decimals: int = 6) -> float:
    return round(val, decimals)


def _node_key(lon: float, lat: float) -> str:
    return f"{_round_coord(lon)},{_round_coord(lat)}"


def _order_segments(
    segments: list[dict[str, Any]],
    depot: DepotPoint | None = None,
) -> list[dict[str, Any]]:
    """
    Order segments into a route using nearest-neighbor heuristic.
    """
    if len(segments) <= 1:
        return segments

    # Build a simple adjacency structure
    remaining = list(range(len(segments)))
    ordered: list[int] = []

    # Start from depot or first segment
    if depot:
        # Find segment closest to depot
        min_dist = float("inf")
        start_idx = 0
        for i, seg in enumerate(segments):
            d = _haversine_km(
                depot.lon, depot.lat,
                seg["from"]["lon"], seg["from"]["lat"],
            )
            if d < min_dist:
                min_dist = d
                start_idx = i
        ordered.append(start_idx)
        remaining.remove(start_idx)
    else:
        ordered.append(remaining.pop(0))

    # Nearest-neighbor greedy
    while remaining:
        last_seg = segments[ordered[-1]]
        last_end = last_seg["to"]

        min_dist = float("inf")
        best_idx = remaining[0]
        for idx in remaining:
            seg = segments[idx]
            d = _haversine_km(
                last_end["lon"], last_end["lat"],
                seg["from"]["lon"], seg["from"]["lat"],
            )
            if d < min_dist:
                min_dist = d
                best_idx = idx

        ordered.append(best_idx)
        remaining.remove(best_idx)

    return [segments[i] for i in ordered]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/overture/optimize", response_model=OptimizeRouteResponse)
def optimize_overture_route(body: OptimizeRouteRequest):
    """
    Optimize route from road data within the given bounding box.

    If `geojson` is provided in the request body, uses those features directly.
    Otherwise returns a descriptive error asking the client to provide GeoJSON
    data (server-side Overture data fetching is not yet implemented).
    """
    geojson = body.geojson

    if not geojson or not geojson.get("features"):
        raise HTTPException(
            status_code=400,
            detail=(
                "No road data provided. "
                "Include a 'geojson' field with a FeatureCollection of road LineStrings, "
                "or use the /api/optimize endpoint with pre-loaded GeoJSON data."
            ),
        )

    features = geojson.get("features", [])
    max_split_length = 0.15  # km
    if body.options and "max_segment_length_km" in body.options:
        max_split_length = float(body.options["max_segment_length_km"])

    # Process features into segments
    all_segments: list[dict[str, Any]] = []
    original_count = 0

    for idx, feat in enumerate(features):
        geom = feat.get("geometry", {})
        gtype = geom.get("type", "")
        props = feat.get("properties", {})

        coords_list: list[list[list[float]]] = []
        if gtype == "LineString":
            coords_list = [geom.get("coordinates", [])]
        elif gtype == "MultiLineString":
            coords_list = geom.get("coordinates", [])
        else:
            continue

        source_id = str(props.get("id", props.get("source_id", f"seg_{idx}")))
        street_name = props.get("name") or props.get("street_name") or props.get("names", {}).get("primary")

        for line_coords in coords_list:
            if len(line_coords) < 2:
                continue

            # Filter by bounds
            in_bounds = any(
                body.bounds.min_lon <= c[0] <= body.bounds.max_lon
                and body.bounds.min_lat <= c[1] <= body.bounds.max_lat
                for c in line_coords
            )
            if not in_bounds:
                continue

            original_count += 1
            split = _split_segment(line_coords, source_id, street_name, max_split_length)
            all_segments.extend(split)

    if not all_segments:
        raise HTTPException(
            status_code=400,
            detail="No road segments found within the specified bounds",
        )

    # Order segments into a route
    ordered_segments = _order_segments(all_segments, body.depot)

    # Compute totals
    total_distance_km = sum(s["distance"] for s in ordered_segments)
    # Estimate duration: average 15 km/h for trash collection routes
    speed_kmh = body.options.get("speed_kmh", 15) if body.options else 15
    estimated_duration_min = (total_distance_km / speed_kmh) * 60

    split_count = len(ordered_segments)
    avg_splits = split_count / original_count if original_count > 0 else 0

    return OptimizeRouteResponse(
        segments=ordered_segments,
        total_distance_km=round(total_distance_km, 4),
        estimated_duration_min=round(estimated_duration_min, 2),
        split_stats=SplitStats(
            original_count=original_count,
            split_count=split_count,
            avg_splits_per_segment=round(avg_splits, 2),
        ),
        algorithm="nearest-neighbor-cpp",
        metadata={
            "bounds": body.bounds.model_dump(),
            "max_segment_length_km": max_split_length,
        },
    )
