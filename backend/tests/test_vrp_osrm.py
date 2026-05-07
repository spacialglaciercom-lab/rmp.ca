import pytest
from app.vrp_osrm import _haversine_km


def test_haversine_km_same_point():
    """Test distance between the same point is 0."""
    assert _haversine_km(0.0, 0.0, 0.0, 0.0) == 0.0
    assert _haversine_km(10.0, 20.0, 10.0, 20.0) == 0.0


def test_haversine_km_equator():
    """Test distance along the equator."""
    # 1 degree of longitude at the equator is approx 111.32 km
    dist = _haversine_km(0.0, 0.0, 1.0, 0.0)
    assert pytest.approx(dist, rel=1e-3) == 111.195  # 6371 * pi / 180 = 111.19


def test_haversine_km_meridian():
    """Test distance along a meridian."""
    # 1 degree of latitude is approx 111.32 km anywhere
    dist = _haversine_km(0.0, 0.0, 0.0, 1.0)
    assert pytest.approx(dist, rel=1e-3) == 111.195


def test_haversine_km_known_points():
    """Test distance between known cities."""
    # London (approx)
    lon1, lat1 = -0.1278, 51.5074
    # Paris (approx)
    lon2, lat2 = 2.3522, 48.8566

    # Distance is roughly 344 km
    dist = _haversine_km(lon1, lat1, lon2, lat2)
    assert pytest.approx(dist, rel=1e-2) == 343.5


def test_haversine_km_antipodes():
    """Test distance between antipodal points."""
    # Equator, prime meridian vs 180 degrees
    dist = _haversine_km(0.0, 0.0, 180.0, 0.0)
    # Half the circumference = pi * R = 3.14159 * 6371 = 20015
    assert pytest.approx(dist, rel=1e-3) == 20015.0

    # North pole vs South pole
    dist2 = _haversine_km(0.0, 90.0, 0.0, -90.0)
    assert pytest.approx(dist2, rel=1e-3) == 20015.0
