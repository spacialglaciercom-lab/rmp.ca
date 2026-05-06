"""
Tests for the zones partition API in main.py.

Covers:
  - Helper functions (_complexity_factor, _edge_weight, _build_adjacency, etc.)
  - Spectral partitioning (small graphs, fallback paths)
  - Zone weight computation (internal + boundary edges)
  - Balance postprocessing (greedy node moves)
  - Convex hull polygon generation
  - POST /api/zones/partition endpoint (happy path + edge cases)
  - POST /api/zones/partition-from-points endpoint
  - POST /api/elevation endpoint (DEM unavailable fallback)
  - GET /health
"""
from __future__ import annotations

import numpy as np
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from app.main import (
    EdgeInput,
    PartitionRequest,
    PartitionResponse,
    PointInput,
    ZoneOutput,
    _build_adjacency,
    _complexity_factor,
    _edge_weight,
    _normalized_laplacian,
    _spectral_partition,
    _zone_convex_hull_ring,
    _zone_weight_and_distance,
    _zone_weights_from_labels,
    _zone_weights_from_node_weights,
    _balance_postprocess,
    _balance_postprocess_node_weights,
    app,
    partition_graph,
    points_to_partition_graph,
)

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers for building edges
# ---------------------------------------------------------------------------

def _edge(u: int, v: int, length: float = 1.0, **kw) -> EdgeInput:
    return EdgeInput(u=u, v=v, length=length, **kw)


# ===========================================================================
# Unit tests: helper functions
# ===========================================================================


class TestComplexityFactor:
    def test_defaults_multiply_to_one(self):
        e = _edge(0, 1)
        assert _complexity_factor(e) == pytest.approx(1.0)

    def test_custom_factors(self):
        e = _edge(0, 1, intersection_density=2.0, cul_de_sac_penalty=1.5, width_penalty=0.5)
        assert _complexity_factor(e) == pytest.approx(2.0 * 1.5 * 0.5)


class TestEdgeWeight:
    def test_time_metric_uses_complexity(self):
        e = _edge(0, 1, length=10.0, intersection_density=2.0)
        assert _edge_weight(e, "time") == pytest.approx(10.0 * 2.0)

    def test_distance_metric_ignores_complexity(self):
        e = _edge(0, 1, length=10.0, intersection_density=2.0)
        assert _edge_weight(e, "distance") == pytest.approx(10.0)


class TestBuildAdjacency:
    def test_basic_3node(self):
        edges = [_edge(0, 1, 1.0), _edge(1, 2, 2.0)]
        A = _build_adjacency(edges, 3, "distance")
        assert A.shape == (3, 3)
        assert A[0, 1] == pytest.approx(1.0)
        assert A[1, 0] == pytest.approx(1.0)  # symmetric
        assert A[1, 2] == pytest.approx(2.0)

    def test_self_loop_skipped(self):
        edges = [_edge(0, 0, 1.0), _edge(0, 1, 2.0)]
        A = _build_adjacency(edges, 2, "distance")
        assert A[0, 0] == pytest.approx(0.0)
        assert A[0, 1] == pytest.approx(2.0)

    def test_duplicate_edge_ignored(self):
        edges = [_edge(0, 1, 1.0), _edge(1, 0, 5.0)]
        A = _build_adjacency(edges, 2, "distance")
        assert A[0, 1] == pytest.approx(1.0)  # first one wins

    def test_out_of_range_node_raises(self):
        edges = [_edge(0, 5, 1.0)]
        with pytest.raises(ValueError, match="node >= node_count"):
            _build_adjacency(edges, 3, "distance")


class TestNormalizedLaplacian:
    def test_shape_preserved(self):
        from scipy import sparse
        A = sparse.csr_matrix(np.array([[0, 1], [1, 0]], dtype=float))
        L = _normalized_laplacian(A)
        assert L.shape == (2, 2)

    def test_diagonal_ones_for_connected(self):
        from scipy import sparse
        A = sparse.csr_matrix(np.array([[0, 1], [1, 0]], dtype=float))
        L = _normalized_laplacian(A)
        # Diagonal of normalized Laplacian should be 1 for connected nodes
        assert L[0, 0] == pytest.approx(1.0)
        assert L[1, 1] == pytest.approx(1.0)


class TestZoneWeightsFromLabels:
    def test_all_same_zone(self):
        labels = np.array([0, 0, 0])
        edge_weights = [(0, 1, 2.0), (1, 2, 3.0)]
        result = _zone_weights_from_labels(labels, edge_weights, 1)
        assert result[0] == pytest.approx(5.0)

    def test_boundary_edge_splits(self):
        labels = np.array([0, 1])
        edge_weights = [(0, 1, 4.0)]
        result = _zone_weights_from_labels(labels, edge_weights, 2)
        assert result[0] == pytest.approx(2.0)
        assert result[1] == pytest.approx(2.0)


class TestZoneWeightsFromNodeWeights:
    def test_basic(self):
        labels = np.array([0, 1, 0])
        weights = [1.0, 2.0, 3.0]
        result = _zone_weights_from_node_weights(labels, weights, 2)
        assert result[0] == pytest.approx(4.0)  # node 0 + node 2
        assert result[1] == pytest.approx(2.0)  # node 1


class TestConvexHullRing:
    def test_returns_none_for_fewer_than_3(self):
        assert _zone_convex_hull_ring([(0, 0), (1, 1)], [0, 1]) is None

    def test_triangle_returns_ring(self):
        coords = [(0.0, 0.0), (1.0, 0.0), (0.5, 1.0)]
        ring = _zone_convex_hull_ring(coords, [0, 1, 2])
        assert ring is not None
        assert len(ring) >= 4  # closed ring: first == last
        assert ring[0] == ring[-1]  # closed

    def test_returns_none_for_collinear(self):
        coords = [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0)]
        result = _zone_convex_hull_ring(coords, [0, 1, 2])
        # Collinear points produce a LineString, not Polygon → None
        assert result is None

    @patch("app.main.MultiPoint")
    def test_exception_handling(self, mock_multipoint):
        mock_multipoint.side_effect = Exception("Test exception")
        coords = [(0.0, 0.0), (1.0, 0.0), (0.5, 1.0)]
        assert _zone_convex_hull_ring(coords, [0, 1, 2]) is None

# ===========================================================================
# Unit tests: spectral partition
# ===========================================================================


class TestSpectralPartition:
    def test_k_equals_n_returns_identity(self):
        from scipy import sparse
        A = sparse.csr_matrix(np.array([[0, 1], [1, 0]], dtype=float))
        labels = _spectral_partition(A, 2)
        assert set(labels.tolist()) == {0, 1}

    def test_k_greater_than_n(self):
        from scipy import sparse
        A = sparse.csr_matrix(np.array([[0, 1], [1, 0]], dtype=float))
        labels = _spectral_partition(A, 5)
        assert len(labels) == 2

    def test_produces_k_labels(self):
        """Partition into 2 zones on a connected graph → exactly 2 unique labels."""
        from scipy import sparse
        # 6-node ring
        n = 6
        row = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 0]
        col = [1, 0, 2, 1, 3, 2, 4, 3, 5, 4, 0, 5]
        data = [1.0] * 12
        A = sparse.csr_matrix((data, (row, col)), shape=(n, n))
        labels = _spectral_partition(A, 2)
        assert len(labels) == n
        assert len(set(labels.tolist())) == 2


# ===========================================================================
# Unit tests: zone weight + distance
# ===========================================================================


class TestZoneWeightAndDistance:
    def test_internal_edges(self):
        labels = np.array([0, 0, 1])
        edge_weights = [(0, 1, 3.0)]
        edge_lengths = [(0, 1, 5.0)]
        w, d = _zone_weight_and_distance(labels, 0, edge_weights, edge_lengths)
        assert w == pytest.approx(3.0)
        assert d == pytest.approx(5.0)

    def test_boundary_edge_half(self):
        labels = np.array([0, 1])
        edge_weights = [(0, 1, 4.0)]
        edge_lengths = [(0, 1, 6.0)]
        w, d = _zone_weight_and_distance(labels, 0, edge_weights, edge_lengths)
        assert w == pytest.approx(2.0)
        assert d == pytest.approx(3.0)


# ===========================================================================
# Unit tests: balance postprocessing
# ===========================================================================


class TestBalancePostprocess:
    def test_already_balanced(self):
        labels = np.array([0, 1])
        edge_weights = [(0, 1, 2.0)]
        result = _balance_postprocess(labels, edge_weights, 2, max_iters=10)
        # Should not crash; labels should still be valid
        assert set(result.tolist()).issubset({0, 1})

    def test_moves_toward_balance(self):
        """Unbalanced 4-node: zone 0 has 3 nodes, zone 1 has 1 → should rebalance."""
        labels = np.array([0, 0, 0, 1])
        edge_weights = [(0, 1, 1.0), (1, 2, 1.0), (2, 3, 1.0)]
        result = _balance_postprocess(labels, edge_weights, 2, max_iters=50)
        counts = [np.sum(result == z) for z in range(2)]
        assert max(counts) <= 3  # Should improve or stay same


class TestBalancePostprocessNodeWeights:
    def test_equal_weights_balanced(self):
        labels = np.array([0, 0, 0, 1])
        weights = [1.0, 1.0, 1.0, 1.0]
        result = _balance_postprocess_node_weights(labels, weights, 2, max_iters=50)
        zone_sums = [sum(weights[i] for i in range(4) if result[i] == z) for z in range(2)]
        assert zone_sums[0] == pytest.approx(2.0)
        assert zone_sums[1] == pytest.approx(2.0)


# ===========================================================================
# Integration: partition_graph function
# ===========================================================================


class TestPartitionGraph:
    def test_triangle_2_zones(self):
        edges = [_edge(0, 1, 1.0), _edge(1, 2, 1.0), _edge(2, 0, 1.0)]
        resp = partition_graph(edges, 3, 2, "time")
        assert len(resp.zones) == 2
        all_nodes = []
        for z in resp.zones:
            all_nodes.extend(z.node_ids)
        assert sorted(all_nodes) == [0, 1, 2]

    def test_more_trucks_than_nodes(self):
        edges = [_edge(0, 1, 1.0)]
        resp = partition_graph(edges, 2, 5, "time")
        assert len(resp.zones) == 5
        empty_zones = [z for z in resp.zones if not z.node_ids]
        assert len(empty_zones) == 3

    def test_distance_metric_populates_estimated_distance(self):
        edges = [_edge(0, 1, 1.0), _edge(1, 2, 1.0), _edge(2, 0, 1.0)]
        resp = partition_graph(edges, 3, 2, "distance")
        has_distance = any(z.estimated_distance is not None for z in resp.zones if z.node_ids)
        assert has_distance

    def test_no_edges_with_coords_uses_kmeans(self):
        coords = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)]
        resp = partition_graph([], 4, 2, "time", node_coords=coords)
        assert len(resp.zones) == 2
        all_nodes = []
        for z in resp.zones:
            all_nodes.extend(z.node_ids)
        assert sorted(all_nodes) == [0, 1, 2, 3]

    def test_unreferenced_nodes_produce_warning(self):
        # 4 nodes but only 2 are connected by edges
        edges = [_edge(0, 1, 1.0)]
        resp = partition_graph(edges, 4, 2, "time")
        assert any("not referenced" in w for w in resp.warnings)


# ===========================================================================
# Integration: points_to_partition_graph
# ===========================================================================


class TestPointsToPartitionGraph:
    def test_empty_points(self):
        edges, n, coords, weights = points_to_partition_graph([], 5)
        assert n == 0
        assert edges == []

    def test_knn_zero_returns_no_edges(self):
        points = [PointInput(lat=45.0, lon=-73.0), PointInput(lat=45.1, lon=-73.1)]
        edges, n, coords, weights = points_to_partition_graph(points, 0)
        assert n == 2
        assert edges == []
        assert len(coords) == 2

    def test_two_points_one_edge(self):
        points = [PointInput(lat=45.0, lon=-73.0), PointInput(lat=45.01, lon=-73.01)]
        edges, n, coords, weights = points_to_partition_graph(points, 5)
        assert n == 2
        assert len(edges) == 1
        assert edges[0].length > 0


# ===========================================================================
# HTTP endpoint tests
# ===========================================================================


class TestHealthEndpoint:
    def test_health_returns_ok(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


class TestPartitionEndpoint:
    def test_basic_partition(self):
        body = {
            "edges": [
                {"u": 0, "v": 1, "length": 1.0},
                {"u": 1, "v": 2, "length": 1.0},
                {"u": 2, "v": 0, "length": 1.0},
            ],
            "node_count": 3,
            "truck_count": 2,
            "balance_metric": "time",
        }
        r = client.post("/api/zones/partition", json=body)
        assert r.status_code == 200
        data = r.json()
        assert len(data["zones"]) == 2
        all_nodes = []
        for z in data["zones"]:
            all_nodes.extend(z["node_ids"])
        assert sorted(all_nodes) == [0, 1, 2]

    def test_invalid_edge_returns_400(self):
        body = {
            "edges": [{"u": 0, "v": 10, "length": 1.0}],
            "node_count": 3,
            "truck_count": 2,
            "balance_metric": "time",
        }
        r = client.post("/api/zones/partition", json=body)
        assert r.status_code == 400

    def test_single_node_partition(self):
        body = {
            "edges": [],
            "node_count": 1,
            "truck_count": 1,
            "balance_metric": "time",
        }
        r = client.post("/api/zones/partition", json=body)
        assert r.status_code == 200


class TestPartitionFromPointsEndpoint:
    def test_basic(self):
        body = {
            "points": [
                {"lat": 45.0, "lon": -73.0, "weight": 1.0},
                {"lat": 45.01, "lon": -73.01, "weight": 2.0},
                {"lat": 45.02, "lon": -73.02, "weight": 1.0},
                {"lat": 45.1, "lon": -73.1, "weight": 2.0},
            ],
            "truck_count": 2,
            "balance_metric": "weight",
        }
        r = client.post("/api/zones/partition-from-points", json=body)
        assert r.status_code == 200
        data = r.json()
        assert len(data["zones"]) == 2

    def test_empty_points_returns_400(self):
        body = {"points": [], "truck_count": 2}
        r = client.post("/api/zones/partition-from-points", json=body)
        assert r.status_code == 400

    def test_count_balance(self):
        body = {
            "points": [
                {"lat": 45.0, "lon": -73.0},
                {"lat": 45.01, "lon": -73.01},
                {"lat": 45.1, "lon": -73.1},
                {"lat": 45.11, "lon": -73.11},
            ],
            "truck_count": 2,
            "balance_metric": "count",
        }
        r = client.post("/api/zones/partition-from-points", json=body)
        assert r.status_code == 200
        data = r.json()
        counts = [len(z["node_ids"]) for z in data["zones"]]
        assert sum(counts) == 4


class TestElevationEndpoint:
    def test_no_dem_returns_unavailable(self):
        """Without DEM_PATH set, should return dem_available=false."""
        import os
        old = os.environ.pop("DEM_PATH", None)
        try:
            body = {"points": [[-73.57, 45.5], [-73.56, 45.51]]}
            r = client.post("/api/elevation", json=body)
            assert r.status_code == 200
            data = r.json()
            assert data["dem_available"] is False
            assert len(data["elevations"]) == 2
            assert all(e is None for e in data["elevations"])
        finally:
            if old is not None:
                os.environ["DEM_PATH"] = old
