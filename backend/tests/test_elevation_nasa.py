"""
Tests for NASA Earthdata SRTM tile downloader (elevation_nasa.py).

Covers:
  - Tile naming: lat/lon → SRTM tile name
  - Bounding box → tile list
  - Point → single tile
  - Local path generation from tile name
  - Filename parsing in ensure_dem_for_path
  - Token requirement enforcement
  - Download skipped when file already exists
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from app.elevation_nasa import (
    _tile_name,
    _local_path,
    tiles_for_bounds,
    tile_for_point,
    download_tile,
    ensure_dem_for_path,
)


# ===========================================================================
# Tile naming
# ===========================================================================


class TestTileName:
    def test_north_west(self):
        assert _tile_name(45, -74) == "N45W074"

    def test_south_east(self):
        assert _tile_name(-12, 3) == "S12E003"

    def test_equator_prime_meridian(self):
        assert _tile_name(0, 0) == "N00E000"

    def test_negative_both(self):
        assert _tile_name(-1, -1) == "S01W001"

    def test_large_longitude(self):
        assert _tile_name(60, 179) == "N60E179"

    def test_large_negative_longitude(self):
        assert _tile_name(10, -180) == "N10W180"


# ===========================================================================
# Bounding box → tiles
# ===========================================================================


class TestTilesForBounds:
    def test_single_tile(self):
        """A bbox within one 1×1 degree cell → one tile."""
        tiles = tiles_for_bounds(45.3, -73.8, 45.7, -73.2)
        assert tiles == ["N45W074"]

    def test_two_tiles_lon(self):
        """Bbox crossing a longitude boundary."""
        tiles = tiles_for_bounds(45.3, -74.1, 45.7, -73.2)
        assert set(tiles) == {"N45W075", "N45W074"}

    def test_four_tiles(self):
        """Bbox crossing both lat and lon boundaries."""
        tiles = tiles_for_bounds(44.8, -74.1, 45.3, -73.5)
        assert len(tiles) == 4
        assert set(tiles) == {"N44W075", "N44W074", "N45W075", "N45W074"}

    def test_exact_boundary(self):
        """Bbox exactly at integer lat/lon."""
        tiles = tiles_for_bounds(45.0, -74.0, 45.0, -74.0)
        assert tiles == ["N45W074"]


# ===========================================================================
# Point → tile
# ===========================================================================


class TestTileForPoint:
    def test_montreal(self):
        assert tile_for_point(45.5, -73.6) == "N45W074"

    def test_negative_lat(self):
        assert tile_for_point(-33.9, 18.4) == "S34E018"

    def test_on_boundary(self):
        """Point exactly on tile boundary → floor gives the tile."""
        assert tile_for_point(45.0, -74.0) == "N45W074"


# ===========================================================================
# Local path generation
# ===========================================================================


class TestLocalPath:
    def test_north_west(self):
        p = _local_path("N45W074", "/data/dem")
        assert p == Path("/data/dem/n45_w074_1arc_v3.tif")

    def test_south_east(self):
        p = _local_path("S12E003", "/tmp")
        assert p == Path("/tmp/s12_e003_1arc_v3.tif")


# ===========================================================================
# Token enforcement
# ===========================================================================


class TestTokenEnforcement:
    def test_no_token_raises(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)
        with pytest.raises(EnvironmentError, match="EARTHDATA_TOKEN"):
            download_tile("N45W074", "/tmp/dem", token=None)

    def test_explicit_token_used(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
        monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)
        import requests as requests_mod
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.raise_for_status.side_effect = Exception("401")
        with patch.object(requests_mod, "get", return_value=mock_resp) as mock_get:
            with pytest.raises(EnvironmentError, match="rejected"):
                download_tile("N45W074", tmp_path, token="my-token")
            call_kwargs = mock_get.call_args
            assert "Bearer my-token" in call_kwargs.kwargs["headers"]["Authorization"]


# ===========================================================================
# Skip download when cached
# ===========================================================================


class TestCaching:
    def test_existing_file_skipped(self, tmp_path: Path):
        """If the GeoTIFF already exists, download is skipped."""
        tif = tmp_path / "n45_w074_1arc_v3.tif"
        tif.write_text("fake tif data")
        import requests as requests_mod
        with patch.object(requests_mod, "get") as mock_get:
            result = download_tile("N45W074", tmp_path, token="tok")
            mock_get.assert_not_called()
            assert result == tif


# ===========================================================================
# ensure_dem_for_path: filename parsing
# ===========================================================================


class TestEnsureDemForPath:
    def test_existing_file_returned_as_is(self, tmp_path: Path):
        tif = tmp_path / "n45_w074_1arc_v3.tif"
        tif.write_text("data")
        assert ensure_dem_for_path(str(tif)) == str(tif)

    def test_unparseable_name_returned_as_is(self):
        result = ensure_dem_for_path("/nonexistent/weird-name.tif")
        assert result == "/nonexistent/weird-name.tif"

    def test_missing_file_triggers_download(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("EARTHDATA_TOKEN", "test-token")
        target = tmp_path / "n45_w074_1arc_v3.tif"
        with patch("app.elevation_nasa.download_tile") as mock_dl:
            mock_dl.return_value = target
            result = ensure_dem_for_path(str(target), token="test-token")
            mock_dl.assert_called_once_with("N45W074", target.parent, "test-token")

    def test_download_failure_returns_original(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("EARTHDATA_TOKEN", "test-token")
        target = tmp_path / "n45_w074_1arc_v3.tif"
        with patch("app.elevation_nasa.download_tile", side_effect=RuntimeError("fail")):
            result = ensure_dem_for_path(str(target))
            assert result == str(target)
