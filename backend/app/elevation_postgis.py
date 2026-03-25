"""
PostGIS-based elevation sampling for DEM data stored in the database.

This module provides an alternative to file-based DEM sampling (rasterio)
by querying elevation data directly from a PostGIS raster table.

Benefits:
  - Single source of truth for both road network and terrain
  - Spatial indexing for fast queries (milliseconds)
  - Batch queries for entire routes in one round-trip
  - No file I/O or DEM_PATH configuration needed
"""

from __future__ import annotations

import os
from typing import Any

try:
    import psycopg2
except ImportError:
    psycopg2 = None  # type: ignore[assignment]

try:
    from psycopg2.extras import execute_values
except ImportError:
    execute_values = None  # type: ignore[assignment]


def get_database_url() -> str | None:
    """Get the database URL from environment."""
    return os.getenv("DATABASE_URL")


def sample_elevation_from_postgis(
    nodes_2d: list[tuple[float, float]],
    database_url: str | None = None,
) -> list[float | None]:
    """
    Sample elevation in meters for each (lon, lat) from PostGIS DEM.
    
    Args:
        nodes_2d: List of (longitude, latitude) tuples in WGS84.
        database_url: PostgreSQL connection string. If None, uses DATABASE_URL env var.
    
    Returns:
        List of elevations (float) or None for no-data/out-of-extent points.
    
    Raises:
        ImportError: If psycopg2 is not installed.
        ConnectionError: If database is unreachable.
    """
    if psycopg2 is None:
        raise ImportError(
            "psycopg2 is required for PostGIS elevation sampling; "
            "install with pip install psycopg2-binary"
        )
    
    url = database_url or get_database_url()
    if not url:
        raise ValueError("DATABASE_URL not set; cannot connect to PostGIS")
    
    if not nodes_2d:
        return []
    
    # Single-point query (simpler, but more round-trips)
    if len(nodes_2d) == 1:
        lon, lat = nodes_2d[0]
        with psycopg2.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT ST_Value(rast, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                    FROM dem_elevation
                    WHERE ST_Intersects(rast, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                    LIMIT 1
                    """,
                    (lon, lat, lon, lat),
                )
                row = cur.fetchone()
                return [float(row[0]) if row and row[0] is not None else None]
    
    params = [(idx, lon, lat) for idx, (lon, lat) in enumerate(nodes_2d)]

    query = """
        WITH points(idx, lon, lat) AS (
            VALUES %s
        ),
        indexed_points AS (
            SELECT idx::int, ST_SetSRID(ST_MakePoint(lon::float8, lat::float8), 4326) AS pt
            FROM points
        )
        SELECT ip.idx, ST_Value(d.rast, ip.pt) AS elevation
        FROM indexed_points ip
        LEFT JOIN LATERAL (
            SELECT rast
            FROM dem_elevation
            WHERE ST_Intersects(rast, ip.pt)
            LIMIT 1
        ) d ON true
        ORDER BY ip.idx
    """

    with psycopg2.connect(url) as conn:
        with conn.cursor() as cur:
            if execute_values:
                execute_values(cur, query, params, page_size=len(params))
            else:
                args_str = ",".join(
                    cur.mogrify("(%s,%s,%s)", p).decode("utf-8") for p in params
                )
                cur.execute(query.replace("VALUES %s", f"VALUES {args_str}"))

            rows = cur.fetchall()
            results: list[float | None] = [None] * len(nodes_2d)

            for row in rows:
                idx, elevation = row[0], row[1]
                if elevation is not None:
                    results[idx] = float(elevation)

            return results


def dem_is_available(database_url: str | None = None) -> bool:
    """
    Check if DEM data is available in PostGIS.
    
    Returns True if the dem_elevation table/view exists and has data.
    """
    url = database_url or get_database_url()
    if not url or psycopg2 is None:
        return False
    
    try:
        with psycopg2.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM dem_elevation LIMIT 1")
                return cur.fetchone() is not None
    except Exception:
        return False


def get_dem_coverage(database_url: str | None = None) -> dict[str, Any] | None:
    """
    Get the coverage extent of the DEM data.
    
    Returns a dict with:
      - bounds: (min_lon, min_lat, max_lon, max_lat)
      - tile_count: number of raster tiles
      - srid: spatial reference ID (should be 4326)
    """
    url = database_url or get_database_url()
    if not url:
        return None
    
    if psycopg2 is None:
        return None
    
    try:
        with psycopg2.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        ST_XMin(ext) AS min_lon,
                        ST_YMin(ext) AS min_lat,
                        ST_XMax(ext) AS max_lon,
                        ST_YMax(ext) AS max_lat,
                        cnt AS tile_count,
                        srid
                    FROM (
                        SELECT
                            ST_Extent(rast::geometry) AS ext,
                            COUNT(*) AS cnt,
                            MAX(ST_SRID(rast)) AS srid
                        FROM dem_elevation
                    ) sub
                    """
                )
                row = cur.fetchone()
                if row and row[0] is not None:
                    return {
                        "bounds": (row[0], row[1], row[2], row[3]),
                        "tile_count": row[4],
                        "srid": row[5],
                    }
                return None
    except Exception:
        return None