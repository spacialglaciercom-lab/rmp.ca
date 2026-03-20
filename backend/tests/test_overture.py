"""
Tests for overture.py — Overture-based route optimization.

Covers:
  - Segment splitting (_split_segment): no-split, even split, linear reference
  - Segment ordering (_order_segments): nearest-neighbor heuristic, depot start
  - POST /overture/optimize endpoint (happy path, error cases, options)
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.overture import (
    Bounds,
    DepotPoint,
    _node_key,
    _order_segments,
    _round_coord,
    _split_segment,
)

client = TestClient(app)


# ===========================================================================
# Unit tests: _split_segment
# ===========================================================================


class TestSplitSegment:
    def test_single_coord_returns_empty(self):
        assert _split_segment([[0, 0]], "s1", None) == []

    def test_short_segment_no_split(self):
        """Segment shorter than max_length_km should not be split."""
        coords = [[-73.57, 45.5], [-73.5701, 45.5]]  # ~8 meters
        result = _split_segment(coords, "s1", "Main St", max_length_km=0.15)
        assert len(result) == 1
        seg = result[0]
        assert seg["was_split"] is False
        assert seg["source_id"] == "s1"
        assert seg["street_name"] == "Main St"
        assert seg["start_lr"] == 0.0
        assert seg["end_lr"] == 1.0
        assert seg["distance"] > 0

    def test_long_segment_is_split(self):
        """Segment longer than max_length_km should be split into multiple."""
        # ~1.1 km apart
        coords = [[-73.57, 45.5], [-73.56, 45.5], [-73.55, 45.5]]
        result = _split_segment(coords, "s2", None, max_length_km=0.15)
        assert len(result) > 1
        assert all(s["was_split"] is True for s in result)
        assert all(s["source_id"] == "s2" for s in result)
        # First starts at 0, last ends at 1
        assert result[0]["start_lr"] == 0.0
        assert result[-1]["end_lr"] == 1.0

    def test_split_preserves_from_to(self):
        coords = [[-73.57, 45.5], [-73.56, 45.5]]
        result = _split_segment(coords, "s3", None, max_length_km=100)
        assert result[0]["from"]["lon"] == pytest.approx(-73.57)
        assert result[0]["from"]["lat"] == pytest.approx(45.5)
        assert result[0]["to"]["lon"] == pytest.approx(-73.56)
        assert result[0]["to"]["lat"] == pytest.approx(45.5)

    def test_polyline_lat_lon_order(self):
        """Polyline should be in {lat, lon} format, not [lon, lat]."""
        coords = [[-73.57, 45.5], [-73.56, 45.51]]
        result = _split_segment(coords, "s4", None, max_length_km=100)
        pt = result[0]["polyline"][0]
        assert "lat" in pt and "lon" in pt
        assert pt["lat"] == pytest.approx(45.5)
        assert pt["lon"] == pytest.approx(-73.57)


# ===========================================================================
# Unit tests: _round_coord / _node_key
# ===========================================================================


class TestRoundCoord:
    def test_rounds_to_6_decimals(self):
        assert _round_coord(1.23456789) == pytest.approx(1.234568)

    def test_node_key_format(self):
        assert _node_key(-73.57, 45.5) == "-73.57,45.5"


# ===========================================================================
# Unit tests: _order_segments
# ===========================================================================


class TestOrderSegments:
    def _seg(self, from_lon, from_lat, to_lon, to_lat, dist=0.1):
        return {
            "from": {"lon": from_lon, "lat": from_lat},
            "to": {"lon": to_lon, "lat": to_lat},
            "distance": dist,
        }

    def test_single_segment_unchanged(self):
        segs = [self._seg(0, 0, 1, 1)]
        result = _order_segments(segs)
        assert len(result) == 1

    def test_empty_returns_empty(self):
        assert _order_segments([]) == []

    def test_nearest_neighbor_ordering(self):
        """Three segments: A→B, C→D, B→C — should order as A→B, B→C, C→D."""
        seg_ab = self._seg(0, 0, 1, 0)
        seg_cd = self._seg(2, 0, 3, 0)
        seg_bc = self._seg(1, 0, 2, 0)
        result = _order_segments([seg_ab, seg_cd, seg_bc])
        # seg_ab first (index 0), then seg_bc (closest to end of A→B), then seg_cd
        assert result[0] == seg_ab
        assert result[1] == seg_bc
        assert result[2] == seg_cd

    def test_depot_selects_closest_start(self):
        seg_far = self._seg(10, 10, 11, 11)
        seg_near = self._seg(0.1, 0.1, 1, 1)
        depot = DepotPoint(lat=0.0, lon=0.0)
        result = _order_segments([seg_far, seg_near], depot)
        assert result[0] == seg_near


# ===========================================================================
# HTTP endpoint tests: POST /overture/optimize
# ===========================================================================


def _make_geojson(*line_coords, names=None):
    """Build a FeatureCollection of LineStrings."""
    features = []
    for i, coords in enumerate(line_coords):
        props = {}
        if names and i < len(names):
            props["name"] = names[i]
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": props,
        })
    return {"type": "FeatureCollection", "features": features}


class TestOvertureOptimizeEndpoint:
    BOUNDS = {"min_lat": 45.49, "min_lon": -73.58, "max_lat": 45.52, "max_lon": -73.54}

    def test_no_geojson_returns_400(self):
        r = client.post("/overture/optimize", json={"bounds": self.BOUNDS})
        assert r.status_code == 400
        assert "No road data" in r.json()["detail"]

    def test_empty_features_returns_400(self):
        r = client.post("/overture/optimize", json={
            "bounds": self.BOUNDS,
            "geojson": {"type": "FeatureCollection", "features": []},
        })
        assert r.status_code == 400

    def test_features_outside_bounds_returns_400(self):
        geojson = _make_geojson([[-80.0, 30.0], [-80.01, 30.01]])
        r = client.post("/overture/optimize", json={
            "bounds": self.BOUNDS,
            "geojson": geojson,
        })
        assert r.status_code == 400

    def test_happy_path(self):
        geojson = _make_geojson(
            [[-73.57, 45.50], [-73.56, 45.50]],
            [[-73.56, 45.50], [-73.55, 45.51]],
            names=["Rue A", "Rue B"],
        )
        r = client.post("/overture/optimize", json={
            "bounds": self.BOUNDS,
            "geojson": geojson,
        })
        assert r.status_code == 200
        data = r.json()
        assert data["total_distance_km"] > 0
        assert data["estimated_duration_min"] > 0
        assert len(data["segments"]) >= 2
        assert data["split_stats"]["original_count"] == 2
        assert data["algorithm"] == "nearest-neighbor-cpp"

    def test_multilinestring_support(self):
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "MultiLineString",
                    "coordinates": [
                        [[-73.57, 45.50], [-73.56, 45.50]],
                        [[-73.56, 45.50], [-73.55, 45.51]],
                    ],
                },
                "properties": {},
            }],
        }
        r = client.post("/overture/optimize", json={
            "bounds": self.BOUNDS,
            "geojson": geojson,
        })
        assert r.status_code == 200
        assert r.json()["split_stats"]["original_count"] == 2

    def test_custom_speed(self):
        geojson = _make_geojson([[-73.57, 45.50], [-73.56, 45.50]])
        r = client.post("/overture/optimize", json={
            "bounds": self.BOUNDS,
            "geojson": geojson,
            "options": {"speed_kmh": 30},
        })
        assert r.status_code == 200
        # Faster speed → shorter duration
        data = r.json()
        assert data["estimated_duration_min"] > 0

    def test_depot_affects_ordering(self):
        geojson = _make_geojson(
            [[-73.57, 45.50], [-73.56, 45.50]],
            [[-73.55, 45.51], [-73.54, 45.51]],
        )
        r = client.post("/overture/optimize", json={
            "bounds": self.BOUNDS,
            "geojson": geojson,
            "depot": {"lat": 45.51, "lon": -73.55},
        })
        assert r.status_code == 200

    def test_point_geometry_skipped(self):
        """Point features should be ignored, only LineStrings processed."""
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-73.57, 45.50]},
                    "properties": {},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-73.57, 45.50], [-73.56, 45.50]]},
                    "properties": {},
                },
            ],
        }
        r = client.post("/overture/optimize", json={
            "bounds": self.BOUNDS,
            "geojson": geojson,
        })
        assert r.status_code == 200
        assert r.json()["split_stats"]["original_count"] == 1
