import pytest
from app.vrp_osrm import _haversine_matrix, VrpLocation

def test_haversine_matrix():
    locs = [
        VrpLocation(id="0", lat=0.0, lon=0.0),
        VrpLocation(id="1", lat=0.0, lon=1.0),
    ]
    dist, dur = _haversine_matrix(locs)

    # 1 degree of longitude at equator is approx 111.32 km
    assert len(dist) == 2
    assert len(dur) == 2

    assert dist[0][0] == 0.0
    assert dur[0][0] == 0.0

    assert dist[1][1] == 0.0
    assert dur[1][1] == 0.0

    assert dist[0][1] == pytest.approx(111.19, abs=0.1)
    assert dist[1][0] == pytest.approx(111.19, abs=0.1)

    # duration = dist / 30 * 60 = dist * 2
    assert dur[0][1] == pytest.approx(222.38, abs=0.2)
    assert dur[1][0] == pytest.approx(222.38, abs=0.2)

def test_haversine_matrix_empty():
    dist, dur = _haversine_matrix([])
    assert dist == []
    assert dur == []

def test_haversine_matrix_single():
    locs = [VrpLocation(id="0", lat=0.0, lon=0.0)]
    dist, dur = _haversine_matrix(locs)
    assert dist == [[0.0]]
    assert dur == [[0.0]]
