#!/usr/bin/env python3
"""Generate synthetic scale datasets: small_city (~100), medium_city (~500), large_city (~1000) segments."""
from __future__ import annotations

import json
from pathlib import Path


def _grid_geojson(
    rows: int,
    cols: int,
    origin_lon: float = -73.57,
    origin_lat: float = 45.50,
    cell_km: float = 0.05,
) -> dict:
    """Grid of horizontal and vertical LineStrings. Segments = (rows+1)*cols + (cols+1)*rows."""
    km_per_deg_lon = 111.0 * 0.7
    deg_per_km_lat = 1.0 / 111.0
    deg_per_km_lon = 1.0 / km_per_deg_lon
    dx = cell_km * deg_per_km_lon
    dy = cell_km * deg_per_km_lat
    features = []
    for r in range(rows + 1):
        y = origin_lat + r * dy
        for c in range(cols):
            x0, x1 = origin_lon + c * dx, origin_lon + (c + 1) * dx
            features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[x0, y], [x1, y]]},
                "properties": {"class": "residential"},
            })
    for c in range(cols + 1):
        x = origin_lon + c * dx
        for r in range(rows):
            y0, y1 = origin_lat + r * dy, origin_lat + (r + 1) * dy
            features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[x, y0], [x, y1]]},
                "properties": {"class": "residential"},
            })
    return {"type": "FeatureCollection", "features": features}


def segment_count(rows: int, cols: int) -> int:
    return (rows + 1) * cols + (cols + 1) * rows


def main() -> None:
    out_dir = Path(__file__).resolve().parent

    # ~100 segments: (rows+1)*cols + (cols+1)*rows = 100 -> rows=5, cols=9 -> 104
    small = _grid_geojson(rows=5, cols=9)
    small_path = out_dir / "small_city.json"
    small_path.write_text(json.dumps(small, indent=2))
    print(f"small_city.json: {len(small['features'])} segments -> {small_path}")

    # ~500 segments: rows=15, cols=16 -> 511
    medium = _grid_geojson(rows=15, cols=16)
    medium_path = out_dir / "medium_city.json"
    medium_path.write_text(json.dumps(medium, indent=2))
    print(f"medium_city.json: {len(medium['features'])} segments -> {medium_path}")

    # ~1000 segments: rows=22, cols=22 -> 1012
    large = _grid_geojson(rows=22, cols=22)
    large_path = out_dir / "large_city.json"
    large_path.write_text(json.dumps(large, indent=2))
    print(f"large_city.json: {len(large['features'])} segments -> {large_path}")


if __name__ == "__main__":
    main()
