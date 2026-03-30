"""
NASA Earthdata SRTM tile downloader.

Auto-downloads SRTM 1-arc-second (~30 m) DEM tiles from LP DAAC when the
local GeoTIFF is missing. Requires a free NASA Earthdata bearer token:
  1. Create account at https://urs.earthdata.nasa.gov/
  2. Generate token at https://urs.earthdata.nasa.gov/users/find_or_create_token
  3. Set EARTHDATA_TOKEN=<token> in backend/.env

Tile naming: the southwest corner defines the tile.
  N45W074 → latitude 45 N, longitude 74 W → covers (45,−74) to (46,−73).
"""
from __future__ import annotations

import io
import logging
import math
import os
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)

# LP DAAC SRTM v3 1-arc-second (HGT in .zip)
_SRTM_BASE = (
    "https://e4ftl01.cr.usgs.gov/MEASURES/SRTMGL1.003/2000.02.11"
)


def _tile_name(lat: int, lon: int) -> str:
    """Convert integer lat/lon of the tile's SW corner to SRTM tile name.

    >>> _tile_name(45, -74)
    'N45W074'
    >>> _tile_name(-12, 3)
    'S12E003'
    """
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"{ns}{abs(lat):02d}{ew}{abs(lon):03d}"


def tiles_for_bounds(
    min_lat: float, min_lon: float, max_lat: float, max_lon: float,
) -> list[str]:
    """Return SRTM tile names covering the given bounding box."""
    lat_lo = int(math.floor(min_lat))
    lat_hi = int(math.floor(max_lat))
    lon_lo = int(math.floor(min_lon))
    lon_hi = int(math.floor(max_lon))
    tiles: list[str] = []
    for lat in range(lat_lo, lat_hi + 1):
        for lon in range(lon_lo, lon_hi + 1):
            tiles.append(_tile_name(lat, lon))
    return tiles


def tile_for_point(lat: float, lon: float) -> str:
    """Return the single SRTM tile name that contains the given point."""
    return _tile_name(int(math.floor(lat)), int(math.floor(lon)))


def _local_path(tile: str, dest_dir: str | Path) -> Path:
    """Expected local GeoTIFF path for a tile."""
    ns = tile[0].lower()
    lat_str = tile[1:3]
    ew = tile[3].lower()
    lon_str = tile[4:7]
    filename = f"{ns}{lat_str}_{ew}{lon_str}_1arc_v3.tif"
    return Path(dest_dir) / filename


def download_tile(
    tile: str,
    dest_dir: str | Path,
    token: str | None = None,
) -> Path:
    """Download an SRTM tile and convert the HGT to GeoTIFF.

    Args:
        tile: SRTM tile name, e.g. ``"N45W074"``.
        dest_dir: Directory to save the GeoTIFF into.
        token: NASA Earthdata bearer token. Falls back to ``EARTHDATA_TOKEN`` env var.

    Returns:
        Path to the local GeoTIFF file.

    Raises:
        EnvironmentError: If no token is available.
        RuntimeError: If the download or conversion fails.
    """
    import requests

    token = token or os.getenv("EARTHDATA_TOKEN")
    if not token:
        raise EnvironmentError(
            "EARTHDATA_TOKEN not set. Get one at "
            "https://urs.earthdata.nasa.gov/users/find_or_create_token"
        )

    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)

    out_tif = _local_path(tile, dest)
    if out_tif.exists():
        logger.info("SRTM tile already cached: %s", out_tif)
        return out_tif

    url = f"{_SRTM_BASE}/{tile}.SRTMGL1.hgt.zip"
    logger.info("Downloading SRTM tile %s from %s", tile, url)

    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
        allow_redirects=True,
        timeout=120,
    )
    if resp.status_code == 401:
        raise EnvironmentError(
            "Earthdata token rejected (401). Refresh at "
            "https://urs.earthdata.nasa.gov/users/find_or_create_token"
        )
    resp.raise_for_status()

    # The response is a zip containing a single .hgt file
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        hgt_names = [n for n in zf.namelist() if n.endswith(".hgt")]
        if not hgt_names:
            raise RuntimeError(f"No .hgt file found in {tile} zip archive")
        hgt_bytes = zf.read(hgt_names[0])

    # Write .hgt to a temp file, then convert to GeoTIFF with GDAL
    hgt_tmp = dest / f"{tile}.hgt"
    hgt_tmp.write_bytes(hgt_bytes)

    try:
        _hgt_to_geotiff(hgt_tmp, out_tif)
    finally:
        hgt_tmp.unlink(missing_ok=True)

    logger.info("SRTM GeoTIFF saved: %s", out_tif)
    return out_tif


def _hgt_to_geotiff(hgt_path: Path, tif_path: Path) -> None:
    """Convert an SRTM .hgt to WGS84 GeoTIFF using GDAL (via rasterio)."""
    try:
        import rasterio
        from rasterio.transform import from_bounds
        from rasterio.crs import CRS
        import numpy as np
    except ImportError:
        raise ImportError(
            "rasterio (with GDAL) is required to convert HGT → GeoTIFF. "
            "Install with: pip install rasterio numpy"
        )

    raw = hgt_path.read_bytes()
    # SRTM 1-arc-second: 3601×3601 signed 16-bit big-endian
    size = 3601
    expected = size * size * 2
    if len(raw) != expected:
        # Might be 3-arc-second (1201×1201)
        size = 1201
        expected = size * size * 2
        if len(raw) != expected:
            raise RuntimeError(
                f"Unexpected HGT size: {len(raw)} bytes "
                f"(expected {3601*3601*2} for 1-arc-sec or {1201*1201*2} for 3-arc-sec)"
            )

    data = np.frombuffer(raw, dtype=">i2").reshape((size, size)).astype(np.int16)

    # Parse tile SW corner from filename
    name = hgt_path.stem  # e.g. "N45W074"
    lat_sign = 1 if name[0] == "N" else -1
    lon_sign = 1 if name[3] == "E" else -1
    sw_lat = lat_sign * int(name[1:3])
    sw_lon = lon_sign * int(name[4:7])

    transform = from_bounds(
        sw_lon, sw_lat, sw_lon + 1, sw_lat + 1, size, size,
    )

    with rasterio.open(
        str(tif_path),
        "w",
        driver="GTiff",
        height=size,
        width=size,
        count=1,
        dtype="int16",
        crs=CRS.from_epsg(4326),
        transform=transform,
        nodata=-32768,
        compress="deflate",
    ) as dst:
        dst.write(data, 1)


def ensure_dem_for_bounds(
    min_lat: float, min_lon: float, max_lat: float, max_lon: float,
    dest_dir: str | Path = "data/dem",
    token: str | None = None,
) -> list[Path]:
    """Download all SRTM tiles needed for a bounding box.

    Returns list of local GeoTIFF paths (one per tile).
    """
    tiles = tiles_for_bounds(min_lat, min_lon, max_lat, max_lon)
    paths: list[Path] = []
    for tile in tiles:
        paths.append(download_tile(tile, dest_dir, token))
    return paths


def ensure_dem_for_path(
    dem_path: str,
    token: str | None = None,
) -> str:
    """If the DEM file at ``dem_path`` doesn't exist, try to download the
    matching SRTM tile from NASA Earthdata.

    Returns the (possibly unchanged) dem_path.
    """
    p = Path(dem_path)
    if p.exists():
        return dem_path

    # Parse the expected tile from the filename convention: n45_w074_1arc_v3.tif
    stem = p.stem  # e.g. "n45_w074_1arc_v3"
    parts = stem.split("_")
    if len(parts) < 2:
        return dem_path  # Can't parse, don't try

    lat_part = parts[0]  # e.g. "n45"
    lon_part = parts[1]  # e.g. "w074"

    try:
        lat_sign = 1 if lat_part[0].lower() == "n" else -1
        lat = lat_sign * int(lat_part[1:])
        lon_sign = 1 if lon_part[0].lower() == "e" else -1
        lon = lon_sign * int(lon_part[1:])
    except (ValueError, IndexError):
        return dem_path

    tile = _tile_name(lat, lon)
    try:
        result = download_tile(tile, p.parent, token)
        return str(result)
    except Exception as exc:
        logger.warning("Failed to auto-download SRTM tile %s: %s", tile, exc)
        return dem_path
