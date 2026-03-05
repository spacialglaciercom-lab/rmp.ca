"""
GeoJSON utility endpoints:
  POST /api/geojson/validate — validate structure
  POST /api/geojson/filter   — filter by polygon + road classes
  POST /api/geojson/roads    — extract road features from raw Overture GeoJSON
"""
from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()


# ---------------------------------------------------------------------------
# Shared types
# ---------------------------------------------------------------------------


class GeoJSONFeature(BaseModel):
    type: str = "Feature"
    geometry: dict[str, Any]
    properties: dict[str, Any] = Field(default_factory=dict)

    class Config:
        extra = "allow"


class GeoJSONFeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: list[GeoJSONFeature]

    class Config:
        extra = "allow"


# ---------------------------------------------------------------------------
# /api/geojson/validate
# ---------------------------------------------------------------------------


class ValidateResponse(BaseModel):
    valid: bool
    feature_count: int
    geometry_types: dict[str, int]
    road_classes: dict[str, int]
    has_linestrings: bool
    bbox: list[float] | None
    warnings: list[str]


@router.post("/api/geojson/validate", response_model=ValidateResponse)
def validate_geojson(body: GeoJSONFeatureCollection):
    """Validate a GeoJSON FeatureCollection and return summary statistics."""
    warnings: list[str] = []
    geometry_types: dict[str, int] = {}
    road_classes: dict[str, int] = {}
    has_linestrings = False

    min_lon = min_lat = float("inf")
    max_lon = max_lat = float("-inf")
    has_coords = False

    for feat in body.features:
        geom = feat.geometry
        gtype = geom.get("type", "Unknown")
        geometry_types[gtype] = geometry_types.get(gtype, 0) + 1

        if gtype in ("LineString", "MultiLineString"):
            has_linestrings = True

        # Road class from properties (Overture convention)
        props = feat.properties
        rc = props.get("class") or props.get("road_class") or props.get("highway") or "unknown"
        road_classes[str(rc)] = road_classes.get(str(rc), 0) + 1

        # Update bbox
        coords = _extract_coords(geom)
        for lon, lat, *_ in coords:
            has_coords = True
            min_lon = min(min_lon, lon)
            max_lon = max(max_lon, lon)
            min_lat = min(min_lat, lat)
            max_lat = max(max_lat, lat)

    if not body.features:
        warnings.append("FeatureCollection is empty (0 features)")

    if not has_linestrings:
        warnings.append("No LineString or MultiLineString geometries found — route optimization requires line geometries")

    bbox = [min_lon, min_lat, max_lon, max_lat] if has_coords else None

    # Check for suspiciously large bbox (covers entire world)
    if bbox and (bbox[2] - bbox[0] > 180 or bbox[3] - bbox[1] > 90):
        warnings.append("Bounding box spans more than half the globe — data may include invalid coordinates")

    return ValidateResponse(
        valid=len(warnings) == 0,
        feature_count=len(body.features),
        geometry_types=geometry_types,
        road_classes=road_classes,
        has_linestrings=has_linestrings,
        bbox=bbox,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# /api/geojson/filter
# ---------------------------------------------------------------------------


class FilterRequest(BaseModel):
    geojson: GeoJSONFeatureCollection
    polygon: list[dict[str, float]] | None = None  # [{lat, lon}, ...]
    road_classes: list[str] | None = None


class FilterResponse(BaseModel):
    geojson: GeoJSONFeatureCollection
    feature_count: int
    road_class_counts: dict[str, int]


@router.post("/api/geojson/filter", response_model=FilterResponse)
def filter_geojson(body: FilterRequest):
    """Filter GeoJSON features by polygon and/or road classes."""
    features = body.geojson.features

    # Filter by road classes
    if body.road_classes:
        allowed = set(body.road_classes)
        features = [
            f for f in features
            if _get_road_class(f) in allowed
        ]

    # Filter by polygon (point-in-polygon for feature centroids)
    if body.polygon and len(body.polygon) >= 3:
        try:
            from shapely.geometry import Polygon, Point

            ring = [(p["lon"], p["lat"]) for p in body.polygon]
            poly = Polygon(ring)
            filtered = []
            for feat in features:
                centroid = _feature_centroid(feat)
                if centroid and poly.contains(Point(centroid)):
                    filtered.append(feat)
            features = filtered
        except ImportError:
            # Fallback: simple bounding-box filter if shapely not available
            lats = [p["lat"] for p in body.polygon]
            lons = [p["lon"] for p in body.polygon]
            min_lat, max_lat = min(lats), max(lats)
            min_lon, max_lon = min(lons), max(lons)
            filtered = []
            for feat in features:
                centroid = _feature_centroid(feat)
                if centroid:
                    lon, lat = centroid
                    if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
                        filtered.append(feat)
            features = filtered

    # Count road classes in result
    road_class_counts: dict[str, int] = {}
    for f in features:
        rc = _get_road_class(f)
        road_class_counts[rc] = road_class_counts.get(rc, 0) + 1

    result_geojson = GeoJSONFeatureCollection(type="FeatureCollection", features=features)
    return FilterResponse(
        geojson=result_geojson,
        feature_count=len(features),
        road_class_counts=road_class_counts,
    )


# ---------------------------------------------------------------------------
# /api/geojson/roads
# ---------------------------------------------------------------------------


class RoadExtractResponse(BaseModel):
    roads: GeoJSONFeatureCollection
    road_count: int
    road_class_counts: dict[str, int]
    total_length_km: float


@router.post("/api/geojson/roads", response_model=RoadExtractResponse)
def extract_roads(body: GeoJSONFeatureCollection):
    """Extract road (LineString/MultiLineString) features from raw GeoJSON."""
    road_features: list[GeoJSONFeature] = []
    road_class_counts: dict[str, int] = {}
    total_length_km = 0.0

    for feat in body.features:
        gtype = feat.geometry.get("type", "")
        if gtype not in ("LineString", "MultiLineString"):
            continue

        road_features.append(feat)

        rc = _get_road_class(feat)
        road_class_counts[rc] = road_class_counts.get(rc, 0) + 1

        # Compute length
        total_length_km += _feature_length_km(feat)

    return RoadExtractResponse(
        roads=GeoJSONFeatureCollection(type="FeatureCollection", features=road_features),
        road_count=len(road_features),
        road_class_counts=road_class_counts,
        total_length_km=round(total_length_km, 4),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_road_class(feat: GeoJSONFeature) -> str:
    """Extract road class from feature properties (multiple naming conventions)."""
    props = feat.properties
    return str(
        props.get("class")
        or props.get("road_class")
        or props.get("highway")
        or "unknown"
    )


def _extract_coords(geom: dict[str, Any]) -> list[list[float]]:
    """Flatten all coordinates from a GeoJSON geometry."""
    gtype = geom.get("type", "")
    coords = geom.get("coordinates", [])

    if gtype == "Point":
        return [coords] if coords else []
    elif gtype in ("LineString", "MultiPoint"):
        return coords or []
    elif gtype in ("Polygon", "MultiLineString"):
        result = []
        for ring in (coords or []):
            result.extend(ring)
        return result
    elif gtype == "MultiPolygon":
        result = []
        for polygon in (coords or []):
            for ring in polygon:
                result.extend(ring)
        return result
    elif gtype == "GeometryCollection":
        result = []
        for g in geom.get("geometries", []):
            result.extend(_extract_coords(g))
        return result
    return []


def _feature_centroid(feat: GeoJSONFeature) -> tuple[float, float] | None:
    """Compute a rough centroid of a feature as (lon, lat)."""
    coords = _extract_coords(feat.geometry)
    if not coords:
        return None
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return (sum(lons) / len(lons), sum(lats) / len(lats))


def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Haversine distance in km."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _feature_length_km(feat: GeoJSONFeature) -> float:
    """Compute the total length of a LineString or MultiLineString in km."""
    geom = feat.geometry
    gtype = geom.get("type", "")
    coords_list: list[list[list[float]]] = []

    if gtype == "LineString":
        coords_list = [geom.get("coordinates", [])]
    elif gtype == "MultiLineString":
        coords_list = geom.get("coordinates", [])
    else:
        return 0.0

    total = 0.0
    for line_coords in coords_list:
        for i in range(1, len(line_coords)):
            c0 = line_coords[i - 1]
            c1 = line_coords[i]
            total += _haversine_km(c0[0], c0[1], c1[0], c1[1])

    return total


# ---------------------------------------------------------------------------
# GeoJSON -> graph for zones partition
# ---------------------------------------------------------------------------

def _round_key(lon: float, lat: float, decimals: int = 6) -> tuple[float, float]:
    """Round coordinates for use as node key (avoids duplicate nodes from float noise)."""
    return (round(lon, decimals), round(lat, decimals))


def geojson_to_partition_graph(
    body: GeoJSONFeatureCollection,
) -> tuple[list[dict[str, Any]], int]:
    """
    Build (edges, node_count) from a FeatureCollection of LineStrings.
    Each unique coordinate (rounded to 6 decimals) is a node; each segment is an edge.
    Returns (list of dicts with u, v, length, intersection_density, cul_de_sac_penalty, width_penalty), node_count.
    """
    node_key_to_id: dict[tuple[float, float], int] = {}
    edges_raw: list[tuple[int, int, float]] = []  # (u, v, length_km)

    for feat in body.features:
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
            for i in range(1, len(line_coords)):
                c0 = line_coords[i - 1]
                c1 = line_coords[i]
                lon0, lat0 = c0[0], c0[1]
                lon1, lat1 = c1[0], c1[1]
                k0 = _round_key(lon0, lat0)
                k1 = _round_key(lon1, lat1)
                if k0 not in node_key_to_id:
                    node_key_to_id[k0] = len(node_key_to_id)
                if k1 not in node_key_to_id:
                    node_key_to_id[k1] = len(node_key_to_id)
                u = node_key_to_id[k0]
                v = node_key_to_id[k1]
                length_km = _haversine_km(lon0, lat0, lon1, lat1)
                if length_km <= 0:
                    continue
                edges_raw.append((u, v, length_km))

    node_count = len(node_key_to_id)
    if node_count == 0:
        return [], 0

    edges: list[dict[str, Any]] = [
        {
            "u": u,
            "v": v,
            "length": length_km,
            "intersection_density": 1.0,
            "cul_de_sac_penalty": 1.0,
            "width_penalty": 1.0,
        }
        for u, v, length_km in edges_raw
    ]
    return edges, node_count
