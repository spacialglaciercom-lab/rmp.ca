"""
Unit tests for vector_clean pipeline.

Fixtures: self-loop, short edge, duplicate edges, missing attrs, two components.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.vector_clean import (
    CleanOptions,
    CleanStats,
    clean_geojson,
    post_geojson_clean,
)
from app.geojson_ops import GeoJSONFeatureCollection
from fastapi.testclient import TestClient

from app.main import app


# ---------------------------------------------------------------------------
# Fixtures (in-memory)
# ---------------------------------------------------------------------------


@pytest.fixture
def geojson_self_loop() -> dict:
    """LineString with same start/end (3 points: A -> B -> A) -> self-loop in graph."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-73.5, 45.5], [-73.501, 45.501], [-73.5, 45.5]],
                },
                "properties": {"highway": "residential"},
            }
        ],
    }


@pytest.fixture
def geojson_short_edge() -> dict:
    """Edge shorter than 0.1 m (two distinct points, ~0.01 m apart)."""
    # ~0.0000002 deg ≈ 0.02 m at mid-lat
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-73.0, 45.0], [-73.0000002, 45.0000002]],
                },
                "properties": {"highway": "service"},
            }
        ],
    }


@pytest.fixture
def geojson_duplicate_edges() -> dict:
    """Two identical LineStrings (duplicate geometry)."""
    coords = [[-73.6, 45.6], [-73.601, 45.601]]
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": {"highway": "primary"}},
            {"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": {"highway": "primary"}},
        ],
    }


@pytest.fixture
def geojson_two_components() -> dict:
    """Two disconnected line segments (two components)."""
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[-73.0, 45.0], [-73.01, 45.01]]}, "properties": {"highway": "primary"}},
            {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[-74.0, 46.0], [-74.01, 46.01]]}, "properties": {"highway": "primary"}},
        ],
    }


@pytest.fixture
def geojson_valid_single() -> dict:
    """One valid LineString."""
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[-73.5, 45.5], [-73.51, 45.51]]}, "properties": {"highway": "residential"}},
        ],
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_clean_removes_self_loop(geojson_self_loop: dict) -> None:
    opts = CleanOptions(remove_selfloops=True)
    fc, stats = clean_geojson(geojson_self_loop, opts)
    assert stats.selfloops_removed >= 1
    assert stats.output_features == 0
    assert len(fc.features) == 0


def test_clean_removes_short_edge(geojson_short_edge: dict) -> None:
    opts = CleanOptions(min_length_m=0.1)
    fc, stats = clean_geojson(geojson_short_edge, opts)
    # With 6-decimal node rounding, a very short edge may become a self-loop and be removed there
    assert stats.output_features == 0
    assert len(fc.features) == 0
    assert stats.short_edges_removed >= 1 or stats.selfloops_removed >= 1


def test_clean_dedupes_edges(geojson_duplicate_edges: dict) -> None:
    opts = CleanOptions(dedupe_edges=True)
    fc, stats = clean_geojson(geojson_duplicate_edges, opts)
    assert stats.duplicate_edges_removed >= 1
    assert stats.output_features == 1
    assert len(fc.features) == 1


def test_clean_keeps_largest_component(geojson_two_components: dict) -> None:
    opts = CleanOptions(max_components=1)
    fc, stats = clean_geojson(geojson_two_components, opts)
    assert stats.components_removed >= 1
    assert stats.output_features == 1
    assert len(fc.features) == 1


def test_clean_preserves_valid_single(geojson_valid_single: dict) -> None:
    opts = CleanOptions()
    fc, stats = clean_geojson(geojson_valid_single, opts)
    assert stats.input_features == 1
    assert stats.output_features == 1
    assert len(fc.features) == 1
    assert fc.features[0].geometry["type"] == "LineString"
    assert len(fc.features[0].geometry["coordinates"]) == 2


def test_clean_required_attrs_drops_incomplete() -> None:
    gj = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[0, 0], [0.01, 0.01]]}, "properties": {"highway": "primary"}},
            {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[0.02, 0.02], [0.03, 0.03]]}, "properties": {}},
        ],
    }
    opts = CleanOptions(required_attrs=["highway"])
    fc, stats = clean_geojson(gj, opts)
    assert stats.incomplete_edges_removed >= 1
    assert stats.output_features == 1


def test_clean_empty_feature_collection() -> None:
    gj = {"type": "FeatureCollection", "features": []}
    opts = CleanOptions()
    fc, stats = clean_geojson(gj, opts)
    assert stats.input_features == 0
    assert stats.output_features == 0
    assert len(fc.features) == 0


def test_clean_skips_non_linestring() -> None:
    gj = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {}},
        ],
    }
    opts = CleanOptions()
    fc, stats = clean_geojson(gj, opts)
    assert stats.output_features == 0


# ---------------------------------------------------------------------------
# API endpoint
# ---------------------------------------------------------------------------


def test_post_geojson_clean_returns_geojson_and_stats(geojson_valid_single: dict) -> None:
    client = TestClient(app)
    body = {"geojson": geojson_valid_single, "options": {}}
    r = client.post("/api/geojson/clean", json=body)
    assert r.status_code == 200
    data = r.json()
    assert "geojson" in data
    assert data["geojson"]["type"] == "FeatureCollection"
    assert "features" in data["geojson"]
    assert "stats" in data
    assert "input_features" in data["stats"]
    assert "output_features" in data["stats"]
