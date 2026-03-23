"""
Zones partition API: spectral clustering (no GNN).
POST /api/zones/partition — partition graph into truck zones with balanced
total edge length × complexity factor.
"""
from __future__ import annotations

from pathlib import Path

# Load backend/.env so DEM_PATH etc. are set when running from any cwd
try:
    from dotenv import load_dotenv
    _backend_dir = Path(__file__).resolve().parent.parent
    load_dotenv(_backend_dir / ".env")
except ImportError:
    pass

import logging
import os
from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException


class _SuppressHealthLogs(logging.Filter):
    """Drop uvicorn access log lines for GET /health (Docker healthcheck spam)."""

    def filter(self, record: logging.LogRecord) -> bool:
        return "GET /health" not in record.getMessage()


logging.getLogger("uvicorn.access").addFilter(_SuppressHealthLogs())
from shapely.geometry import MultiPoint
from pydantic import BaseModel, Field
from scipy import sparse
from scipy.spatial import KDTree
from scipy.sparse.linalg import eigsh
from sklearn.cluster import KMeans

app = FastAPI(title="RouteMasterPro Optimizer API", version="1.1.0")

# Register sub-routers for other endpoints
from .geojson_ops import (
    GeoJSONFeatureCollection,
    geojson_to_partition_graph,
    _haversine_km,
    router as geojson_router,
)
from .optimize import router as optimize_router
from .overture import router as overture_router
from .postgis_cpp import router as postgis_cpp_router
from .vector_clean import CleanOptions, clean_geojson, router as vector_clean_router
from .vrp import router as vrp_router
from .vrp_osrm import router as vrp_osrm_router

app.include_router(geojson_router)
app.include_router(optimize_router)
app.include_router(overture_router)
app.include_router(postgis_cpp_router)
app.include_router(vector_clean_router)
app.include_router(vrp_router)
app.include_router(vrp_osrm_router)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class EdgeInput(BaseModel):
    """One edge in the graph. Node ids must be in [0, node_count - 1]."""

    u: int = Field(..., ge=0, description="Tail node id")
    v: int = Field(..., ge=0, description="Head node id")
    length: float = Field(1.0, gt=0, description="Edge length (e.g. km)")
    intersection_density: float = Field(1.0, gt=0, description="Complexity: intersection density factor")
    cul_de_sac_penalty: float = Field(1.0, gt=0, description="Complexity: cul-de-sac penalty factor")
    width_penalty: float = Field(1.0, gt=0, description="Complexity: width penalty factor")


class PartitionRequest(BaseModel):
    edges: list[EdgeInput]
    node_count: int = Field(..., gt=0, le=100_000, description="Number of nodes (ids 0 .. node_count-1)")
    truck_count: int = Field(..., gt=0, le=100, description="Number of zones (partitions)")
    balance_metric: Literal["time", "distance"] = Field(
        "time",
        description=(
            '"time" balances zones by length * complexity '
            "(intersection_density * cul_de_sac_penalty * width_penalty). "
            '"distance" balances zones by raw edge length, ignoring complexity.'
        ),
    )


class PointInput(BaseModel):
    """One point (e.g. delivery address or stop)."""

    lat: float = Field(..., description="Latitude")
    lon: float = Field(..., description="Longitude")
    weight: float = Field(1.0, gt=0, description="Optional workload, e.g. delivery time or packages; used when balance_metric is 'weight'.")


class PartitionFromPointsRequest(BaseModel):
    """Request for partition-from-points: build KNN graph from points and partition into zones."""

    points: list[PointInput]
    truck_count: int = Field(..., gt=0, le=100, description="Number of zones (partitions)")
    balance_metric: Literal["count", "weight", "distance"] = Field(
        "weight",
        description=(
            '"count" = equal number of points per zone; '
            '"weight" = balance by point weight; '
            '"distance" = balance by spatial spread (edge length).'
        ),
    )
    knn_neighbors: int = Field(
        5, ge=0, le=50,
        description="Neighbors for KNN graph; 0 = pure KMeans (no graph). Higher = denser connections.",
    )
    include_polygons: bool = Field(True, description="Include convex hull polygon per zone.")


class ZoneOutput(BaseModel):
    zone_id: int
    node_ids: list[int]
    estimated_time: float = Field(
        ...,
        description="Total zone weight (length * complexity factors). Always present.",
    )
    estimated_distance: float | None = Field(
        None,
        description='Total raw edge length without complexity. Only set when balance_metric is "distance".',
    )
    zone_polygon: list[list[float]] | None = Field(
        None,
        description="Exterior ring [lon, lat] for this zone (convex hull of zone nodes). Enables sector division on the map.",
    )


class PartitionResponse(BaseModel):
    zones: list[ZoneOutput]
    warnings: list[str] = []


# ---------------------------------------------------------------------------
# Spectral clustering + balance
# ---------------------------------------------------------------------------


def _complexity_factor(e: EdgeInput) -> float:
    return e.intersection_density * e.cul_de_sac_penalty * e.width_penalty


def _edge_weight(e: EdgeInput, balance_metric: str) -> float:
    if balance_metric == "distance":
        return e.length
    return e.length * _complexity_factor(e)


def _build_adjacency(
    edges: list[EdgeInput],
    n: int,
    balance_metric: str,
) -> sparse.csr_matrix:
    """Build symmetric weighted adjacency matrix (n x n)."""
    row, col, data = [], [], []
    seen: set[tuple[int, int]] = set()
    for e in edges:
        u, v = e.u, e.v
        if u == v:
            continue
        if u >= n or v >= n:
            raise ValueError(f"Edge ({u}, {v}) references node >= node_count={n}")
        key = (min(u, v), max(u, v))
        if key in seen:
            continue
        seen.add(key)
        w = _edge_weight(e, balance_metric)
        row.extend([u, v])
        col.extend([v, u])
        data.extend([w, w])
    A = sparse.csr_matrix((data, (row, col)), shape=(n, n))
    return A


def _normalized_laplacian(A: sparse.csr_matrix) -> sparse.csr_matrix:
    """L_norm = I - D^{-1/2} A D^{-1/2}."""
    d = np.array(A.sum(axis=1)).ravel()
    d[d == 0] = 1
    d_inv_sqrt = np.power(d, -0.5)
    D_inv_sqrt = sparse.diags(d_inv_sqrt)
    L = sparse.eye(A.shape[0]) - D_inv_sqrt @ A @ D_inv_sqrt
    return L


# Above this node count, skip spectral clustering (eigsh can exceed 30s). Use degree-based.
_SPECTRAL_MAX_NODES = 8000


def _spectral_partition(
    A: sparse.csr_matrix,
    k: int,
) -> np.ndarray:
    """
    Partition nodes into k zones using normalized Laplacian spectral clustering.
    Returns label array of shape (n,) with values in 0..k-1.
    For very large graphs (n > _SPECTRAL_MAX_NODES) uses degree-based clustering to avoid timeout.
    """
    n = A.shape[0]
    if k >= n:
        return np.arange(n)  # one node per zone, pad with zeros for extra zones

    # Fast path: avoid expensive eigsh on very large graphs (keeps response under ~30s).
    if n > _SPECTRAL_MAX_NODES:
        degrees = np.array(A.sum(axis=1)).ravel().reshape(-1, 1)
        kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
        return kmeans.fit_predict(degrees)

    L = _normalized_laplacian(A)
    U = None

    # Smallest k eigenvalues (excluding 0). Use dense for small n, sparse for large.
    if n <= 1500:
        try:
            L_dense = L.toarray()
            eigenvalues, eigenvectors = np.linalg.eigh(L_dense)
            # smallest k+1 (first is ~0), take 1..k
            idx = np.argsort(eigenvalues)[1 : k + 1]
            U = eigenvectors[:, idx]
        except Exception:
            pass  # fall through to degree-based fallback
    else:
        # Attempt 1: default eigsh
        try:
            eigenvalues, eigenvectors = eigsh(L.astype(float), k=k, which="SM")
            U = eigenvectors
        except Exception:
            pass

        # Attempt 2: shift-invert with more iterations
        if U is None:
            try:
                eigenvalues, eigenvectors = eigsh(
                    L.astype(float), k=k, sigma=0.0, which="LM", maxiter=n * 20,
                )
                U = eigenvectors
            except Exception:
                pass

    if U is not None:
        # Normalize rows of U (Ng et al. normalized spectral clustering)
        row_norms = np.linalg.norm(U, axis=1, keepdims=True)
        row_norms[row_norms == 0] = 1
        U = U / row_norms

        kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = kmeans.fit_predict(U)
        return labels

    # Fallback: cluster using node degrees when spectral decomposition fails
    degrees = np.array(A.sum(axis=1)).ravel().reshape(-1, 1)
    kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = kmeans.fit_predict(degrees)
    return labels


def _zone_weights_from_labels(
    labels: np.ndarray,
    edge_weights: list[tuple[int, int, float]],
    k: int,
) -> np.ndarray:
    """Total weight per zone. Boundary edges split half-weight to each zone."""
    zone_weights = np.zeros(k)
    for u, v, w in edge_weights:
        zu, zv = labels[u], labels[v]
        if zu == zv:
            zone_weights[zu] += w
        else:
            zone_weights[zu] += w * 0.5
            zone_weights[zv] += w * 0.5
    return zone_weights


def _zone_weights_from_node_weights(
    labels: np.ndarray,
    node_weights: list[float],
    k: int,
) -> np.ndarray:
    """Total node weight per zone (for point-based balance)."""
    zone_weights = np.zeros(k)
    for i, w in enumerate(node_weights):
        if i < len(labels):
            z = labels[i]
            if 0 <= z < k:
                zone_weights[z] += w
    return zone_weights


def _balance_postprocess_node_weights(
    labels: np.ndarray,
    node_weights: list[float],
    k: int,
    max_iters: int = 50,
    time_limit: float = 5.0,
) -> np.ndarray:
    """
    Greedy node moves for point-based balance: move nodes from heavy to light zones
    to minimize sum of squared deviations from target node weight per zone.
    """
    import time as _time

    n = labels.shape[0]
    deadline = _time.monotonic() + time_limit
    weights = np.array(node_weights, dtype=float) if len(node_weights) >= n else np.ones(n)

    zone_weights = _zone_weights_from_node_weights(labels, weights.tolist(), k)
    target = float(zone_weights.sum()) / k

    def _imbalance() -> float:
        return float(np.sum((zone_weights - target) ** 2))

    for _ in range(max_iters):
        if _time.monotonic() >= deadline:
            break
        improved = False
        for u in range(n):
            if _time.monotonic() >= deadline:
                break
            wu = weights[u]
            if wu <= 0:
                continue
            z_old = int(labels[u])

            trial_old = zone_weights[z_old] - wu
            best_z = z_old
            best_imb = _imbalance()

            for z_new in range(k):
                if z_new == z_old:
                    continue
                trial_new = zone_weights[z_new] + wu
                imb = best_imb
                imb -= (zone_weights[z_old] - target) ** 2
                imb -= (zone_weights[z_new] - target) ** 2
                imb += (trial_old - target) ** 2
                imb += (trial_new - target) ** 2
                if imb < best_imb:
                    best_imb = imb
                    best_z = z_new

            if best_z != z_old:
                zone_weights[z_old] -= wu
                zone_weights[best_z] += wu
                labels[u] = best_z
                improved = True
        if not improved:
            break
    return labels


def _zone_weight_and_distance(
    labels: np.ndarray,
    zone_id: int,
    edge_weights: list[tuple[int, int, float]],
    edge_lengths: list[tuple[int, int, float]],
) -> tuple[float, float]:
    """
    For the given zone, compute total weight (time, with complexity) and total
    raw distance (without complexity).
    Boundary edges (one endpoint in zone) contribute half their weight.
    """
    weight_sum = 0.0
    dist_sum = 0.0
    for (u, v, w), (_, _, length) in zip(edge_weights, edge_lengths):
        zu, zv = labels[u], labels[v]
        if zu == zone_id and zv == zone_id:
            weight_sum += w
            dist_sum += length
        elif zu == zone_id or zv == zone_id:
            weight_sum += w * 0.5
            dist_sum += length * 0.5
    return weight_sum, dist_sum


def _balance_postprocess(
    labels: np.ndarray,
    edge_weights: list[tuple[int, int, float]],
    k: int,
    max_iters: int = 50,
    time_limit: float = 5.0,
) -> np.ndarray:
    """
    Greedy node moves: move nodes from heavy zones to light zones if it reduces
    imbalance (sum of squared deviations from target weight per zone).

    Uses incremental weight tracking so each candidate move is O(degree(u))
    instead of O(|edges|).
    """
    import time as _time

    n = labels.shape[0]
    deadline = _time.monotonic() + time_limit

    # Build per-node adjacency list: adj[u] = [(v, w), ...]
    adj: list[list[tuple[int, float]]] = [[] for _ in range(n)]
    for u, v, w in edge_weights:
        adj[u].append((v, w))
        adj[v].append((u, w))

    # Initialise zone weights from current labels
    zone_weights = _zone_weights_from_labels(labels, edge_weights, k)
    target = float(zone_weights.sum()) / k

    def _imbalance() -> float:
        return float(np.sum((zone_weights - target) ** 2))

    for _ in range(max_iters):
        if _time.monotonic() >= deadline:
            break
        improved = False
        for u in range(n):
            if _time.monotonic() >= deadline:
                break
            z_old = labels[u]

            # With half-weight boundary edges, moving u from z_old to
            # any z_new shifts exactly half the total incident weight:
            #   z_old loses 0.5 * total_adj_w
            #   z_new gains 0.5 * total_adj_w
            half_total = sum(w for _, w in adj[u]) * 0.5
            if half_total == 0:
                continue

            trial_old = zone_weights[z_old] - half_total
            best_z = z_old
            best_imb = _imbalance()

            for z_new in range(k):
                if z_new == z_old:
                    continue
                trial_new = zone_weights[z_new] + half_total
                imb = best_imb
                imb -= (zone_weights[z_old] - target) ** 2
                imb -= (zone_weights[z_new] - target) ** 2
                imb += (trial_old - target) ** 2
                imb += (trial_new - target) ** 2
                if imb < best_imb:
                    best_imb = imb
                    best_z = z_new

            if best_z != z_old:
                # Commit the move: update zone_weights incrementally
                zone_weights[z_old] -= half_total
                zone_weights[best_z] += half_total
                labels[u] = best_z
                improved = True
        if not improved:
            break
    return labels


def _zone_convex_hull_ring(
    node_coords: list[tuple[float, float]],
    node_ids: list[int],
) -> list[list[float]] | None:
    """Return exterior ring [lon, lat] for the convex hull of the given nodes, or None if too few points."""
    if len(node_ids) < 3:
        return None
    points = [node_coords[i] for i in node_ids if i < len(node_coords)]
    if len(points) < 3:
        return None
    try:
        hull = MultiPoint(points).convex_hull
        if hull.is_empty or hull.geom_type != "Polygon":
            return None
        # exterior.coords is (lon, lat) per point; return closed ring as list of [lon, lat]
        coords = list(hull.exterior.coords)
        return [[float(c[0]), float(c[1])] for c in coords]
    except Exception:
        return None


def points_to_partition_graph(
    points: list[PointInput],
    knn_neighbors: int,
) -> tuple[list[EdgeInput], int, list[tuple[float, float]], list[float]]:
    """
    Build (edges, node_count, id_to_coords, node_weights) from a list of points.
    Uses KNN graph with Haversine edge lengths. id_to_coords[i] = (lon, lat).
    If knn_neighbors < 1, returns empty edges (caller can use KMeans fallback).
    """
    node_count = len(points)
    if node_count == 0:
        return [], 0, [], []

    # (lon, lat) for Shapely / output; (lat, lon) for KDTree (x,y ~ lat,lon for neighbor search)
    id_to_coords: list[tuple[float, float]] = [(p.lon, p.lat) for p in points]
    node_weights = [p.weight for p in points]

    if knn_neighbors < 1:
        return [], node_count, id_to_coords, node_weights

    # KDTree on (lat, lon) for neighbor lookup; we'll use Haversine for edge length
    points_array = np.array([(p.lat, p.lon) for p in points])
    k_query = min(knn_neighbors + 1, node_count)  # +1 includes self
    tree = KDTree(points_array)

    edges: list[EdgeInput] = []
    seen: set[tuple[int, int]] = set()

    for i in range(node_count):
        dists, indices = tree.query(points_array[i], k=k_query)
        # Handle single-point or scalar query result
        if np.isscalar(dists):
            dists = [dists]
            indices = [indices]
        for j, d in zip(indices, dists):
            j = int(j)
            if i == j:
                continue
            key = (min(i, j), max(i, j))
            if key in seen:
                continue
            seen.add(key)
            lon_i, lat_i = id_to_coords[i][0], id_to_coords[i][1]
            lon_j, lat_j = id_to_coords[j][0], id_to_coords[j][1]
            length_km = _haversine_km(lon_i, lat_i, lon_j, lat_j)
            if length_km <= 0:
                continue
            edges.append(
                EdgeInput(
                    u=i, v=j,
                    length=length_km,
                    intersection_density=1.0,
                    cul_de_sac_penalty=1.0,
                    width_penalty=1.0,
                )
            )

    return edges, node_count, id_to_coords, node_weights


def partition_graph(
    edges: list[EdgeInput],
    node_count: int,
    truck_count: int,
    balance_metric: str,
    node_coords: list[tuple[float, float]] | None = None,
    node_weights: list[float] | None = None,
    include_polygons: bool = True,
) -> PartitionResponse:
    """Run spectral clustering and return zones with estimated_time (and optional distance, zone_polygon).
    When node_weights is provided (e.g. from partition-from-points), zones are balanced by total node weight
    and estimated_time is the sum of node weights in that zone."""
    n = node_count
    k_eff = min(truck_count, n)
    warnings: list[str] = []
    use_node_weights = node_weights is not None and len(node_weights) >= n

    # Pure points path: no edges -> KMeans on coordinates
    if not edges and node_coords is not None and len(node_coords) == n:
        coords_array = np.array(node_coords, dtype=float)
        kmeans = KMeans(n_clusters=k_eff, random_state=42, n_init=10)
        labels = kmeans.fit_predict(coords_array)
        if use_node_weights:
            labels = _balance_postprocess_node_weights(
                labels, node_weights or [1.0] * n, k_eff,
            )
        # Build output
        zones_out = []
        for z in range(truck_count):
            if z < k_eff:
                node_ids = np.where(labels == z)[0].tolist()
                weight_sum = (
                    sum((node_weights or [1.0])[i] for i in node_ids)
                    if use_node_weights else float(len(node_ids))
                )
                zone_polygon = None
                if include_polygons and len(node_ids) >= 3 and node_coords:
                    zone_polygon = _zone_convex_hull_ring(node_coords, node_ids)
                zones_out.append(
                    ZoneOutput(
                        zone_id=z,
                        node_ids=node_ids,
                        estimated_time=round(weight_sum, 6),
                        estimated_distance=None,
                        zone_polygon=zone_polygon,
                    )
                )
            else:
                zones_out.append(
                    ZoneOutput(zone_id=z, node_ids=[], estimated_time=0.0, estimated_distance=None, zone_polygon=None)
                )
        return PartitionResponse(zones=zones_out, warnings=warnings)

    # Validate node coverage when we have edges
    referenced: set[int] = set()
    for e in edges:
        referenced.add(e.u)
        referenced.add(e.v)
    unreferenced = set(range(n)) - referenced
    if unreferenced:
        warnings.append(
            f"{len(unreferenced)} node(s) not referenced by any edge "
            f"(e.g. {sorted(unreferenced)[:5]}). "
            f"These will be distributed across zones but carry no weight."
        )

    A = _build_adjacency(edges, n, balance_metric)
    edge_weights = [(e.u, e.v, _edge_weight(e, balance_metric)) for e in edges]
    edge_lengths = [(e.u, e.v, e.length) for e in edges]
    total_weight = sum(w for _, _, w in edge_weights)

    if total_weight == 0:
        labels = np.array([i % k_eff for i in range(n)])
        if use_node_weights:
            labels = _balance_postprocess_node_weights(labels, node_weights or [1.0] * n, k_eff)
    else:
        degrees = np.array(A.sum(axis=1)).ravel()
        isolates = np.where(degrees == 0)[0]
        connected = np.where(degrees > 0)[0]

        if connected.size == 0:
            labels = np.array([i % k_eff for i in range(n)])
            if use_node_weights:
                labels = _balance_postprocess_node_weights(labels, node_weights or [1.0] * n, k_eff)
        elif connected.size < n:
            A_sub = A[np.ix_(connected, connected)]
            idx_map = {orig: compact for compact, orig in enumerate(connected)}
            sub_edge_weights = [
                (idx_map[u], idx_map[v], w)
                for u, v, w in edge_weights
                if u in idx_map and v in idx_map
            ]
            sub_k = min(k_eff, connected.size)
            if connected.size > _SPECTRAL_MAX_NODES:
                warnings.append(
                    f"Graph has {connected.size} connected nodes; using fast degree-based clustering to avoid timeout."
                )
            sub_labels = _spectral_partition(A_sub, sub_k)
            if use_node_weights:
                sub_node_weights = [node_weights[i] for i in connected]
                sub_labels = _balance_postprocess_node_weights(sub_labels, sub_node_weights, sub_k)
            else:
                sub_labels = _balance_postprocess(sub_labels, sub_edge_weights, sub_k)

            labels = np.zeros(n, dtype=int)
            for compact, orig in enumerate(connected):
                labels[orig] = sub_labels[compact]
            zone_counts = np.bincount(labels[connected], minlength=k_eff)
            for iso_node in isolates:
                lightest = int(np.argmin(zone_counts))
                labels[iso_node] = lightest
                zone_counts[lightest] += 1
        else:
            if n > _SPECTRAL_MAX_NODES:
                warnings.append(
                    f"Graph has {n} nodes; using fast degree-based clustering to avoid timeout."
                )
            labels = _spectral_partition(A, k_eff)
            if use_node_weights:
                labels = _balance_postprocess_node_weights(labels, node_weights or [1.0] * n, k_eff)
            else:
                labels = _balance_postprocess(labels, edge_weights, k_eff)

    # Build output
    zones_out = []
    for z in range(truck_count):
        if z < k_eff:
            node_ids = np.where(labels == z)[0].tolist()
            if use_node_weights:
                weight_sum = sum((node_weights or [1.0])[i] for i in node_ids)
                dist_sum = None
                if edges:
                    _, dist_sum = _zone_weight_and_distance(labels, z, edge_weights, edge_lengths)
            else:
                weight_sum, dist_sum = _zone_weight_and_distance(labels, z, edge_weights, edge_lengths)
            zone_polygon = None
            if include_polygons and node_coords and len(node_ids) >= 3:
                zone_polygon = _zone_convex_hull_ring(node_coords, node_ids)
            zones_out.append(
                ZoneOutput(
                    zone_id=z,
                    node_ids=node_ids,
                    estimated_time=round(weight_sum, 6),
                    estimated_distance=round(dist_sum, 6) if dist_sum is not None and balance_metric == "distance" else None,
                    zone_polygon=zone_polygon,
                )
            )
        else:
            zones_out.append(
                ZoneOutput(zone_id=z, node_ids=[], estimated_time=0.0, estimated_distance=None, zone_polygon=None)
            )

    return PartitionResponse(zones=zones_out, warnings=warnings)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# DEM elevation sampling endpoint
# ---------------------------------------------------------------------------

class ElevationRequest(BaseModel):
    """List of [lon, lat] coordinate pairs to sample elevation for."""
    points: list[list[float]]  # [[lon, lat], ...]


class ElevationResponse(BaseModel):
    """Elevation in metres for each input point (null = out-of-extent / no-data)."""
    elevations: list[float | None]
    dem_available: bool


@app.post("/api/elevation", response_model=ElevationResponse)
def post_elevation(body: ElevationRequest):
    """
    Sample elevation (metres, WGS84) from the configured DEM for each [lon, lat] point.
    Returns dem_available=false when DEM_PATH is not set or rasterio is unavailable.
    Clients should treat null elevations as 0 m (flat-terrain fallback).
    """
    from .routing_plugins import sample_elevation_from_dem

    dem_path = os.getenv("DEM_PATH", "")
    if not dem_path:
        return ElevationResponse(
            elevations=[None] * len(body.points),
            dem_available=False,
        )

    try:
        coords = [(float(p[0]), float(p[1])) for p in body.points if len(p) >= 2]
        raw = sample_elevation_from_dem(coords, dem_path)
        return ElevationResponse(elevations=raw, dem_available=True)
    except Exception:
        return ElevationResponse(
            elevations=[None] * len(body.points),
            dem_available=False,
        )


class PartitionFromGeoJSONRequest(BaseModel):
    """Request for partition-from-geojson: use extracted road GeoJSON to build graph and partition."""

    geojson: GeoJSONFeatureCollection
    truck_count: int = Field(..., gt=0, le=100, description="Number of zones (partitions)")
    balance_metric: Literal["time", "distance"] = Field(
        "time",
        description='"time" or "distance" for zone balance.',
    )
    clean_before_optimize: bool = Field(False, description="Run vector_clean pipeline before building partition graph")
    clean_options: CleanOptions | None = None


@app.post("/api/zones/partition", response_model=PartitionResponse)
def post_zones_partition(body: PartitionRequest):
    """
    Partition a graph into truck_count zones using spectral clustering.

    - **balance_metric="time"**: zones are balanced by
      `length * intersection_density * cul_de_sac_penalty * width_penalty`.
      `estimated_time` reflects this weighted workload; `estimated_distance` is null.
    - **balance_metric="distance"**: zones are balanced by raw edge length.
      `estimated_time` still reflects complexity-weighted workload;
      `estimated_distance` gives the raw length sum.
    """
    try:
        return partition_graph(
            body.edges,
            body.node_count,
            body.truck_count,
            body.balance_metric,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/zones/partition-from-geojson", response_model=PartitionResponse)
def post_zones_partition_from_geojson(body: PartitionFromGeoJSONRequest):
    """
    Build a graph from road GeoJSON (LineStrings), then partition into truck_count zones.
    Use this after Extract & Process: fetch GeoJSON from the extract result URL, then POST here.
    """
    try:
        geojson_to_use = body.geojson
        if body.clean_before_optimize:
            opts = body.clean_options if body.clean_options is not None else CleanOptions()
            cleaned_fc, _ = clean_geojson(body.geojson.model_dump(), opts)
            geojson_to_use = cleaned_fc
        edges_dict, node_count, id_to_coords = geojson_to_partition_graph(geojson_to_use)
        if node_count == 0:
            raise HTTPException(
                status_code=400,
                detail="GeoJSON produced no nodes (no LineString/MultiLineString features with valid segments).",
            )
        edges = [EdgeInput(**d) for d in edges_dict]
        return partition_graph(
            edges,
            node_count,
            body.truck_count,
            body.balance_metric,
            node_coords=id_to_coords,
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/zones/partition-from-points", response_model=PartitionResponse)
def post_zones_partition_from_points(body: PartitionFromPointsRequest):
    """
    Build a KNN graph from points (lat/lon/weight), then partition into truck_count zones.
    balance_metric: "count" = equal points per zone, "weight" = by point weight, "distance" = by spatial spread.
    Use knn_neighbors=0 for pure KMeans (no graph). Set include_polygons=False to skip convex hulls.
    """
    if not body.points:
        raise HTTPException(status_code=400, detail="At least one point is required.")
    try:
        edges, node_count, id_to_coords, node_weights = points_to_partition_graph(
            body.points, body.knn_neighbors
        )
        # For balance: "count" and "weight" use node_weights; "distance" uses edge length (pass node_weights=None).
        use_node_weights = body.balance_metric in ("count", "weight")
        if body.balance_metric == "count":
            weights_for_balance = [1.0] * node_count
        elif body.balance_metric == "weight":
            weights_for_balance = node_weights
        else:
            weights_for_balance = None

        return partition_graph(
            edges,
            node_count,
            body.truck_count,
            "distance",  # graph built from Haversine lengths
            node_coords=id_to_coords,
            node_weights=weights_for_balance,
            include_polygons=body.include_polygons,
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
