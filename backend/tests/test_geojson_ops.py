"""
GeoJSON operations tests.

Covers:
  - /api/geojson/validate   — valid/invalid inputs, bbox, road class counts, warnings
  - /api/geojson/filter     — by road class, by polygon, combined
  - /api/geojson/roads      — LineString extraction, length, class counts
  - Internal helpers        — _haversine_km, _get_road_class, _feature_length_km
  - Fuel-aware helpers      — _haversine_m, grade_percent, fuel_multiplier
  - geojson_to_fuel_aware_partition_graph (directed edges, weight)
"""
from __future__ import annotations

import math
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.geojson_ops import (
    GeoJSONFeature,
    GeoJSONFeatureCollection,
    _get_road_class,
    _haversine_km,
    _haversine_m,
    fuel_multiplier,
    geojson_to_fuel_aware_partition_graph,
    geojson_to_partition_graph,
    grade_percent,
)

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _line(lon0, lat0, lon1, lat1, road_class="residential", props=None):
    p = {"class": road_class}
    if props:
        p.update(props)
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[lon0, lat0], [lon1, lat1]]},
        "properties": p,
    }


def _point(lon, lat, props=None):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": props or {},
    }


def _fc(*features):
    return {"type": "FeatureCollection", "features": list(features)}


def _feat(props: dict, lon0=-73.57, lat0=45.50, lon1=-73.56, lat1=45.51) -> GeoJSONFeature:
    return GeoJSONFeature(
        type="Feature",
        geometry={"type": "LineString", "coordinates": [[lon0, lat0], [lon1, lat1]]},
        properties=props,
    )


# ===========================================================================
# /api/geojson/validate
# ===========================================================================


def test_validate_valid_linestring_collection() -> None:
    fc = _fc(
        _line(-73.57, 45.50, -73.56, 45.51),
        _line(-73.56, 45.51, -73.55, 45.52),
    )
    r = client.post("/api/geojson/validate", json=fc)
    assert r.status_code == 200
    data = r.json()
    assert data["valid"] is True
    assert data["feature_count"] == 2
    assert data["has_linestrings"] is True
    assert data["warnings"] == []


def test_validate_empty_collection_is_invalid() -> None:
    r = client.post("/api/geojson/validate", json=_fc())
    assert r.status_code == 200
    data = r.json()
    assert data["valid"] is False
    assert data["feature_count"] == 0
    assert any("empty" in w.lower() for w in data["warnings"])


def test_validate_no_linestrings_warns() -> None:
    fc = _fc(_point(-73.57, 45.50))
    r = client.post("/api/geojson/validate", json=fc)
    assert r.status_code == 200
    data = r.json()
    assert data["valid"] is False
    assert data["has_linestrings"] is False
    assert any("linestring" in w.lower() for w in data["warnings"])


def test_validate_bbox_computed_correctly() -> None:
    fc = _fc(
        _line(-73.57, 45.50, -73.56, 45.51),
        _line(-73.56, 45.51, -73.55, 45.52),
    )
    r = client.post("/api/geojson/validate", json=fc)
    data = r.json()
    bbox = data["bbox"]
    assert bbox is not None
    assert len(bbox) == 4
    min_lon, min_lat, max_lon, max_lat = bbox
    assert abs(min_lon - (-73.57)) < 1e-9
    assert abs(min_lat - 45.50) < 1e-9
    assert abs(max_lon - (-73.55)) < 1e-9
    assert abs(max_lat - 45.52) < 1e-9


def test_validate_bbox_none_for_empty_collection() -> None:
    r = client.post("/api/geojson/validate", json=_fc())
    assert r.json()["bbox"] is None


def test_validate_road_classes_counted() -> None:
    fc = _fc(
        _line(-73.57, 45.50, -73.56, 45.51, road_class="residential"),
        _line(-73.56, 45.51, -73.55, 45.52, road_class="residential"),
        _line(-73.55, 45.52, -73.54, 45.53, road_class="secondary"),
    )
    r = client.post("/api/geojson/validate", json=fc)
    data = r.json()
    assert data["road_classes"]["residential"] == 2
    assert data["road_classes"]["secondary"] == 1


def test_validate_geometry_types_counted() -> None:
    fc = _fc(
        _line(-73.57, 45.50, -73.56, 45.51),
        _point(-73.55, 45.50),
    )
    r = client.post("/api/geojson/validate", json=fc)
    data = r.json()
    assert data["geometry_types"]["LineString"] == 1
    assert data["geometry_types"]["Point"] == 1


def test_validate_mixed_geom_has_linestrings_true() -> None:
    fc = _fc(
        _line(-73.57, 45.50, -73.56, 45.51),
        _point(-73.55, 45.50),
    )
    r = client.post("/api/geojson/validate", json=fc)
    assert r.json()["has_linestrings"] is True


def test_validate_single_feature_valid() -> None:
    fc = _fc(_line(-73.57, 45.50, -73.56, 45.51))
    r = client.post("/api/geojson/validate", json=fc)
    data = r.json()
    assert data["valid"] is True
    assert data["feature_count"] == 1


def test_validate_response_schema_complete() -> None:
    fc = _fc(_line(-73.57, 45.50, -73.56, 45.51))
    r = client.post("/api/geojson/validate", json=fc)
    data = r.json()
    required = {"valid", "feature_count", "geometry_types", "road_classes",
                "has_linestrings", "bbox", "warnings"}
    assert required.issubset(data.keys())


# ===========================================================================
# /api/geojson/filter
# ===========================================================================


def test_filter_by_road_class_keeps_matching() -> None:
    fc = _fc(
        _line(-73.57, 45.50, -73.56, 45.51, "residential"),
        _line(-73.56, 45.51, -73.55, 45.52, "secondary"),
        _line(-73.55, 45.52, -73.54, 45.53, "motorway"),
    )
    body = {"geojson": fc, "road_classes": ["residential"]}
    r = client.post("/api/geojson/filter", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["feature_count"] == 1
    assert data["road_class_counts"] == {"residential": 1}


def test_filter_by_multiple_road_classes() -> None:
    fc = _fc(
        _line(-73.57, 45.50, -73.56, 45.51, "residential"),
        _line(-73.56, 45.51, -73.55, 45.52, "secondary"),
        _line(-73.55, 45.52, -73.54, 45.53, "motorway"),
    )
    body = {"geojson": fc, "road_classes": ["residential", "secondary"]}
    r = client.post("/api/geojson/filter", json=body)
    assert r.status_code == 200
    assert r.json()["feature_count"] == 2


def test_filter_no_matching_road_class_returns_empty() -> None:
    fc = _fc(_line(-73.57, 45.50, -73.56, 45.51, "residential"))
    body = {"geojson": fc, "road_classes": ["motorway"]}
    r = client.post("/api/geojson/filter", json=body)
    assert r.status_code == 200
    assert r.json()["feature_count"] == 0
    assert r.json()["geojson"]["features"] == []


def test_filter_no_criteria_returns_all() -> None:
    fc = _fc(
        _line(-73.57, 45.50, -73.56, 45.51, "residential"),
        _line(-73.56, 45.51, -73.55, 45.52, "secondary"),
    )
    body = {"geojson": fc}
    r = client.post("/api/geojson/filter", json=body)
    assert r.status_code == 200
    assert r.json()["feature_count"] == 2


def test_filter_by_polygon_keeps_inside() -> None:
    fc = _fc(
        _line(-73.565, 45.505, -73.560, 45.510),
        _line(-73.400, 45.600, -73.390, 45.610),
    )
    polygon = [
        {"lat": 45.49, "lon": -73.58},
        {"lat": 45.52, "lon": -73.58},
        {"lat": 45.52, "lon": -73.54},
        {"lat": 45.49, "lon": -73.54},
    ]
    body = {"geojson": fc, "polygon": polygon}
    r = client.post("/api/geojson/filter", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["feature_count"] == 1


def test_filter_by_polygon_excludes_outside() -> None:
    fc = _fc(_line(-73.400, 45.600, -73.390, 45.610))
    polygon = [
        {"lat": 45.49, "lon": -73.58},
        {"lat": 45.52, "lon": -73.58},
        {"lat": 45.52, "lon": -73.54},
        {"lat": 45.49, "lon": -73.54},
    ]
    body = {"geojson": fc, "polygon": polygon}
    r = client.post("/api/geojson/filter", json=body)
    assert r.status_code == 200
    assert r.json()["feature_count"] == 0


def test_filter_combined_class_and_polygon() -> None:
    fc = _fc(
        _line(-73.565, 45.505, -73.560, 45.510, "residential"),
        _line(-73.565, 45.505, -73.560, 45.510, "motorway"),
        _line(-73.400, 45.600, -73.390, 45.610, "residential"),
    )
    polygon = [
        {"lat": 45.49, "lon": -73.58},
        {"lat": 45.52, "lon": -73.58},
        {"lat": 45.52, "lon": -73.54},
        {"lat": 45.49, "lon": -73.54},
    ]
    body = {"geojson": fc, "road_classes": ["residential"], "polygon": polygon}
    r = client.post("/api/geojson/filter", json=body)
    assert r.status_code == 200
    assert r.json()["feature_count"] == 1
    assert r.json()["road_class_counts"] == {"residential": 1}


def test_filter_empty_input_returns_empty() -> None:
    body = {"geojson": _fc()}
    r = client.post("/api/geojson/filter", json=body)
    assert r.status_code == 200
    assert r.json()["feature_count"] == 0


def test_filter_response_schema_complete() -> None:
    fc = _fc(_line(-73.57, 45.50, -73.56, 45.51))
    r = client.post("/api/geojson/filter", json={"geojson": fc})
    data = r.json()
    assert "geojson" in data
    assert "feature_count" in data
    assert "road_class_counts" in data
    assert data["geojson"]["type"] == "FeatureCollection"


# ===========================================================================
# /api/geojson/roads
# ===========================================================================


def test_roads_extracts_only_linestrings() -> None:
    fc = _fc(
        _line(-73.57, 45.50, -73.56, 45.51),
        _point(-73.55, 45.50),
    )
    r = client.post("/api/geojson/roads", json=fc)
    assert r.status_code == 200
    data = r.json()
    assert data["road_count"] == 1
    assert all(
        f["geometry"]["type"] in ("LineString", "MultiLineString")
        for f in data["roads"]["features"]
    )


def test_roads_total_length_positive() -> None:
    fc = _fc(
        _line(-73.57, 45.50, -73.56, 45.51),
        _line(-73.56, 45.51, -73.55, 45.52),
    )
    r = client.post("/api/geojson/roads", json=fc)
    assert r.status_code == 200
    assert r.json()["total_length_km"] > 0


def test_roads_empty_collection_returns_zero() -> None:
    r = client.post("/api/geojson/roads", json=_fc())
    assert r.status_code == 200
    data = r.json()
    assert data["road_count"] == 0
    assert data["total_length_km"] == 0.0


def test_roads_class_counts_accurate() -> None:
    fc = _fc(
        _line(-73.57, 45.50, -73.56, 45.51, "residential"),
        _line(-73.56, 45.51, -73.55, 45.52, "residential"),
        _line(-73.55, 45.52, -73.54, 45.53, "secondary"),
    )
    r = client.post("/api/geojson/roads", json=fc)
    data = r.json()
    assert data["road_count"] == 3
    assert data["road_class_counts"]["residential"] == 2
    assert data["road_class_counts"]["secondary"] == 1


def test_roads_returns_geojson_feature_collection() -> None:
    fc = _fc(_line(-73.57, 45.50, -73.56, 45.51))
    r = client.post("/api/geojson/roads", json=fc)
    data = r.json()
    assert data["roads"]["type"] == "FeatureCollection"
    assert "features" in data["roads"]


def test_roads_point_only_collection() -> None:
    fc = _fc(_point(-73.57, 45.50), _point(-73.56, 45.51))
    r = client.post("/api/geojson/roads", json=fc)
    assert r.status_code == 200
    data = r.json()
    assert data["road_count"] == 0
    assert data["total_length_km"] == 0.0


def test_roads_length_matches_haversine() -> None:
    """Single segment: API-reported length should match haversine calculation."""
    lon0, lat0 = -73.570, 45.500
    lon1, lat1 = -73.560, 45.510
    fc = _fc(_line(lon0, lat0, lon1, lat1))
    r = client.post("/api/geojson/roads", json=fc)
    assert r.status_code == 200
    api_km = r.json()["total_length_km"]
    expected_km = _haversine_km(lon0, lat0, lon1, lat1)
    assert abs(api_km - expected_km) < 0.001


def test_roads_schema_fields_present() -> None:
    fc = _fc(_line(-73.57, 45.50, -73.56, 45.51))
    r = client.post("/api/geojson/roads", json=fc)
    data = r.json()
    assert {"roads", "road_count", "road_class_counts", "total_length_km"}.issubset(data.keys())


# ===========================================================================
# Internal helper: _haversine_km
# ===========================================================================


def test_haversine_same_point_is_zero() -> None:
    assert _haversine_km(-73.57, 45.50, -73.57, 45.50) == 0.0


def test_haversine_symmetry() -> None:
    d1 = _haversine_km(-73.57, 45.50, -73.56, 45.51)
    d2 = _haversine_km(-73.56, 45.51, -73.57, 45.50)
    assert abs(d1 - d2) < 1e-10


def test_haversine_montreal_to_quebec_city() -> None:
    """Montreal (45.5017, -73.5673) to Quebec City (46.8139, -71.2080) ≈ 233 km."""
    d = _haversine_km(-73.5673, 45.5017, -71.2080, 46.8139)
    assert 220 < d < 250


def test_haversine_approx_100m_segment() -> None:
    """~0.001° longitude at lat 45° ≈ 0.078 km (78 m)."""
    d = _haversine_km(-73.570, 45.500, -73.569, 45.500)
    assert 0.070 < d < 0.090


def test_haversine_positive_for_distinct_points() -> None:
    d = _haversine_km(-73.57, 45.50, -73.56, 45.51)
    assert d > 0
    assert math.isfinite(d)


# ===========================================================================
# Internal helper: _get_road_class
# ===========================================================================


def test_get_road_class_overture_class_key() -> None:
    feat = _feat({"class": "residential"})
    assert _get_road_class(feat) == "residential"


def test_get_road_class_road_class_key() -> None:
    feat = _feat({"road_class": "secondary"})
    assert _get_road_class(feat) == "secondary"


def test_get_road_class_osm_highway_key() -> None:
    feat = _feat({"highway": "tertiary"})
    assert _get_road_class(feat) == "tertiary"


def test_get_road_class_class_takes_priority_over_highway() -> None:
    feat = _feat({"class": "residential", "highway": "motorway"})
    assert _get_road_class(feat) == "residential"


def test_get_road_class_fallback_unknown() -> None:
    feat = _feat({})
    assert _get_road_class(feat) == "unknown"


def test_get_road_class_none_value_falls_back() -> None:
    feat = _feat({"class": None, "highway": "residential"})
    assert _get_road_class(feat) == "residential"


def test_get_road_class_returns_string() -> None:
    feat = _feat({"class": "primary"})
    assert isinstance(_get_road_class(feat), str)


# ===========================================================================
# Fuel-aware helpers: _haversine_m
# ===========================================================================


def test_haversine_m_same_point_is_zero() -> None:
    assert _haversine_m(-73.57, 45.50, -73.57, 45.50) == 0.0


def test_haversine_m_equals_haversine_km_times_1000() -> None:
    lon1, lat1, lon2, lat2 = -73.57, 45.50, -73.56, 45.51
    km = _haversine_km(lon1, lat1, lon2, lat2)
    m = _haversine_m(lon1, lat1, lon2, lat2)
    assert abs(m - (km * 1000.0)) < 1e-6


def test_haversine_m_symmetry() -> None:
    d1 = _haversine_m(-73.57, 45.50, -73.56, 45.51)
    d2 = _haversine_m(-73.56, 45.51, -73.57, 45.50)
    assert abs(d1 - d2) < 1e-6


def test_haversine_m_positive_for_distinct_points() -> None:
    d = _haversine_m(-73.57, 45.50, -73.56, 45.51)
    assert d > 0
    assert math.isfinite(d)


# ===========================================================================
# Fuel-aware helpers: grade_percent
# ===========================================================================


def test_grade_percent_zero_distance_returns_zero() -> None:
    """distance_m < 1.0 must return 0.0 to avoid extreme grade spikes."""
    assert grade_percent(0.0, 10.0, 0.0) == 0.0
    assert grade_percent(0.0, 10.0, 0.5) == 0.0


def test_grade_percent_flat_road_is_zero() -> None:
    assert grade_percent(50.0, 50.0, 100.0) == 0.0


def test_grade_percent_uphill_positive() -> None:
    """10 m gain over 100 m = 10%."""
    assert abs(grade_percent(0.0, 10.0, 100.0) - 10.0) < 1e-9


def test_grade_percent_downhill_negative() -> None:
    """10 m drop over 100 m = -10%."""
    assert abs(grade_percent(10.0, 0.0, 100.0) - (-10.0)) < 1e-9


def test_grade_percent_reversed_direction_negates() -> None:
    g_ab = grade_percent(0.0, 5.0, 50.0)
    g_ba = grade_percent(5.0, 0.0, 50.0)
    assert abs(g_ab + g_ba) < 1e-9


# ===========================================================================
# Fuel-aware helpers: fuel_multiplier
# ===========================================================================


def test_fuel_multiplier_zero_grade_is_one() -> None:
    assert fuel_multiplier(0.0) == 1.0


def test_fuel_multiplier_uphill_positive_grade_increases() -> None:
    """+5% grade -> 1.0 + 0.5 = 1.5."""
    assert abs(fuel_multiplier(5.0) - 1.5) < 1e-9


def test_fuel_multiplier_downhill_negative_grade_decreases() -> None:
    """-5% grade -> 1.0 + (-0.2) = 0.8."""
    assert abs(fuel_multiplier(-5.0) - 0.8) < 1e-9


def test_fuel_multiplier_extreme_downhill_clamped_to_min() -> None:
    """Large negative grade must be clamped to min_multiplier (default 0.5)."""
    mult = fuel_multiplier(-100.0)
    assert mult == 0.5
    mult_custom = fuel_multiplier(-100.0, min_multiplier=0.3)
    assert mult_custom == 0.3


def test_fuel_multiplier_uphill_formula() -> None:
    """Uphill: mult = 1.0 + (grade_pct * 0.1)."""
    assert abs(fuel_multiplier(10.0) - 2.0) < 1e-9


def test_fuel_multiplier_downhill_formula() -> None:
    """Downhill: mult = 1.0 + (grade_pct * 0.04); -25% -> 0.0 raw, clamped to 0.5."""
    # 1.0 + (-25 * 0.04) = 0.0, then max(0.5, 0.0) = 0.5
    assert fuel_multiplier(-25.0) == 0.5


# ===========================================================================
# geojson_to_fuel_aware_partition_graph (mocked DEM)
# ===========================================================================


@patch("app.geojson_ops.sample_elevation_from_dem")
def test_fuel_aware_partition_graph_two_directed_edges_per_segment(
    mock_sample_dem: object,
) -> None:
    """One segment (A->B) must produce two directed edges (A->B and B->A) with asymmetrical weights."""
    # Small payload: one LineString, two nodes, one segment
    fc = GeoJSONFeatureCollection(
        type="FeatureCollection",
        features=[
            GeoJSONFeature(
                type="Feature",
                geometry={
                    "type": "LineString",
                    "coordinates": [[-73.57, 45.50], [-73.57, 45.501]],
                },
                properties={"class": "residential"},
            )
        ],
    )
    # Node 0 at 0 m, node 1 at 10 m -> uphill 0->1, downhill 1->0
    mock_sample_dem.return_value = [0.0, 10.0]

    edges, node_count, id_to_coords = geojson_to_fuel_aware_partition_graph(
        fc, dem_path="dummy.tif"
    )

    mock_sample_dem.assert_called_once()
    assert mock_sample_dem.call_args[0][1] == "dummy.tif"
    assert len(mock_sample_dem.call_args[0][0]) == 2  # two nodes

    assert node_count == 2
    assert len(id_to_coords) == 2
    # One segment -> two directed edges
    assert len(edges) == 2

    edge_0_to_1 = next(e for e in edges if e["u"] == 0 and e["v"] == 1)
    edge_1_to_0 = next(e for e in edges if e["u"] == 1 and e["v"] == 0)

    # Same geometric length for both directions
    assert edge_0_to_1["length"] == edge_1_to_0["length"]
    length_km = edge_0_to_1["length"]
    assert length_km > 0

    # Uphill 0->1 (gain 10 m) has higher weight than downhill 1->0
    assert edge_0_to_1["weight"] > edge_1_to_0["weight"]
    assert edge_0_to_1["weight"] > length_km
    assert edge_1_to_0["weight"] < length_km

    # Both edges have required keys
    for e in edges:
        assert "u" in e and "v" in e and "length" in e and "weight" in e
        assert e["intersection_density"] == 1.0
        assert e["cul_de_sac_penalty"] == 1.0
        assert e["width_penalty"] == 1.0


@patch("app.geojson_ops.sample_elevation_from_dem")
def test_fuel_aware_partition_graph_flat_road_symmetric_weights(
    mock_sample_dem: object,
) -> None:
    """When elevation is equal, both directions get the same weight (1.0 multiplier)."""
    fc = GeoJSONFeatureCollection(
        type="FeatureCollection",
        features=[
            GeoJSONFeature(
                type="Feature",
                geometry={
                    "type": "LineString",
                    "coordinates": [[-73.57, 45.50], [-73.56, 45.51]],
                },
                properties={"class": "residential"},
            )
        ],
    )
    mock_sample_dem.return_value = [50.0, 50.0]  # flat

    edges, node_count, id_to_coords = geojson_to_fuel_aware_partition_graph(
        fc, dem_path="dummy.tif"
    )

    assert len(edges) == 2
    edge_0_to_1 = next(e for e in edges if e["u"] == 0 and e["v"] == 1)
    edge_1_to_0 = next(e for e in edges if e["u"] == 1 and e["v"] == 0)

    # Same weight when flat (grade 0% -> multiplier 1.0)
    assert abs(edge_0_to_1["weight"] - edge_1_to_0["weight"]) < 1e-9
    assert abs(edge_0_to_1["weight"] - edge_0_to_1["length"]) < 1e-9


@patch("app.geojson_ops.sample_elevation_from_dem")
def test_fuel_aware_partition_graph_none_elevation_treated_as_zero(
    mock_sample_dem: object,
) -> None:
    """None elevations (e.g. no-data) are treated as 0.0 so grade still computes."""
    fc = GeoJSONFeatureCollection(
        type="FeatureCollection",
        features=[
            GeoJSONFeature(
                type="Feature",
                geometry={
                    "type": "LineString",
                    "coordinates": [[-73.57, 45.50], [-73.56, 45.51]],
                },
                properties={"class": "residential"},
            )
        ],
    )
    mock_sample_dem.return_value = [None, None]

    edges, node_count, id_to_coords = geojson_to_fuel_aware_partition_graph(
        fc, dem_path="dummy.tif"
    )

    assert len(edges) == 2
    edge_0_to_1 = next(e for e in edges if e["u"] == 0 and e["v"] == 1)
    edge_1_to_0 = next(e for e in edges if e["u"] == 1 and e["v"] == 0)
    # Grade 0 both ways -> symmetric weights
    assert abs(edge_0_to_1["weight"] - edge_1_to_0["weight"]) < 1e-9


@patch("app.geojson_ops.sample_elevation_from_dem")
def test_fuel_aware_partition_graph_matches_partition_graph_structure(
    mock_sample_dem: object,
) -> None:
    """Return shape matches geojson_to_partition_graph: (edges, node_count, id_to_coords)."""
    fc = GeoJSONFeatureCollection(
        type="FeatureCollection",
        features=[
            GeoJSONFeature(
                type="Feature",
                geometry={
                    "type": "LineString",
                    "coordinates": [[-73.57, 45.50], [-73.56, 45.51]],
                },
                properties={"class": "residential"},
            )
        ],
    )
    mock_sample_dem.return_value = [0.0, 10.0]

    edges_fuel, node_count_fuel, id_to_coords_fuel = geojson_to_fuel_aware_partition_graph(
        fc, dem_path="dummy.tif"
    )
    edges_base, node_count_base, id_to_coords_base = geojson_to_partition_graph(fc)

    assert node_count_fuel == node_count_base
    assert id_to_coords_fuel == id_to_coords_base
    # Fuel-aware has 2x edges (directed)
    assert len(edges_fuel) == 2 * len(edges_base)
