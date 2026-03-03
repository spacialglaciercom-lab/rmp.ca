"""
Zones partition API: spectral clustering (no GNN).
POST /api/zones/partition — partition graph into truck zones with balanced
total edge length × complexity factor.
"""
from __future__ import annotations

from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from scipy import sparse
from sklearn.cluster import KMeans

app = FastAPI(title="Zones Partition API", version="1.0.0")


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
    balance_metric: Literal["time", "distance"] = "time"


class ZoneOutput(BaseModel):
    zone_id: int
    node_ids: list[int]
    estimated_time: float
    estimated_distance: float | None = None


class PartitionResponse(BaseModel):
    zones: list[ZoneOutput]


# ---------------------------------------------------------------------------
# Spectral clustering + balance
# ---------------------------------------------------------------------------


def _complexity_factor(e: EdgeInput) -> float:
    return e.intersection_density * e.cul_de_sac_penalty * e.width_penalty


def _edge_weight(e: EdgeInput, balance_metric: str) -> float:
    w = e.length * _complexity_factor(e)
    return w


def _build_adjacency(
    edges: list[EdgeInput],
    n: int,
    balance_metric: str,
) -> sparse.csr_matrix:
    """Build symmetric weighted adjacency matrix (n x n)."""
    row, col, data = [], [], []
    for e in edges:
        u, v = e.u, e.v
        if u >= n or v >= n:
            raise ValueError(f"Edge ({u}, {v}) references node >= node_count={n}")
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


def _spectral_partition(
    A: sparse.csr_matrix,
    k: int,
) -> np.ndarray:
    """
    Partition nodes into k zones using normalized Laplacian spectral clustering.
    Returns label array of shape (n,) with values in 0..k-1.
    """
    n = A.shape[0]
    if k >= n:
        return np.arange(n)  # one node per zone, pad with zeros for extra zones

    L = _normalized_laplacian(A)
    # Smallest k eigenvalues (excluding 0). Use dense for small n, sparse for large.
    try:
        if n <= 2000:
            L_dense = L.toarray()
            eigenvalues, eigenvectors = np.linalg.eigh(L_dense)
            # smallest k+1 (first is ~0), take 1..k
            idx = np.argsort(eigenvalues)[1 : k + 1]
            U = eigenvectors[:, idx]
        else:
            from scipy.sparse.linalg import eigsh

            eigenvalues, eigenvectors = eigsh(L.astype(float), k=k, which="SM")
            U = eigenvectors
    except Exception as e:
        raise RuntimeError(f"Spectral decomposition failed: {e}") from e

    # Normalize rows of U (Ng et al. normalized spectral clustering)
    row_norms = np.linalg.norm(U, axis=1, keepdims=True)
    row_norms[row_norms == 0] = 1
    U = U / row_norms

    kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = kmeans.fit_predict(U)
    return labels


def _zone_weights_from_labels(
    labels: np.ndarray,
    edge_weights: list[tuple[int, int, float]],
    k: int,
) -> np.ndarray:
    """Total weight per zone (edges with both endpoints in the zone)."""
    zone_weights = np.zeros(k)
    for u, v, w in edge_weights:
        zu, zv = labels[u], labels[v]
        if zu == zv:
            zone_weights[zu] += w
    return zone_weights


def _zone_weight_and_distance(
    labels: np.ndarray,
    zone_id: int,
    edge_weights: list[tuple[int, int, float]],
) -> tuple[float, float]:
    """
    For the given zone, compute total weight (time) and total distance
    for edges whose both endpoints are in the zone.
    """
    weight_sum = 0.0
    dist_sum = 0.0
    for u, v, w in edge_weights:
        if labels[u] == zone_id and labels[v] == zone_id:
            weight_sum += w
            dist_sum += w
    return weight_sum, dist_sum


def _balance_postprocess(
    labels: np.ndarray,
    edge_weights: list[tuple[int, int, float]],
    k: int,
    max_iters: int = 50,
) -> np.ndarray:
    """
    Greedy node moves: move nodes from heavy zones to light zones if it reduces
    imbalance (sum of squared deviations from target weight per zone).
    """
    n = labels.shape[0]
    target = sum(w for _, _, w in edge_weights) / k

    for _ in range(max_iters):
        zone_weights = _zone_weights_from_labels(labels, edge_weights, k)
        imbalance_before = np.sum((zone_weights - target) ** 2)
        improved = False
        for u in range(n):
            z_old = labels[u]
            best_z = z_old
            best_imbalance = imbalance_before
            for z_new in range(k):
                if z_new == z_old:
                    continue
                labels[u] = z_new
                zw = _zone_weights_from_labels(labels, edge_weights, k)
                imb = float(np.sum((zw - target) ** 2))
                if imb < best_imbalance:
                    best_imbalance = imb
                    best_z = z_new
                labels[u] = z_old
            if best_z != z_old:
                labels[u] = best_z
                improved = True
                imbalance_before = best_imbalance
        if not improved:
            break
    return labels


def partition_graph(
    edges: list[EdgeInput],
    node_count: int,
    truck_count: int,
    balance_metric: str,
) -> PartitionResponse:
    """Run spectral clustering and return zones with estimated_time (and optional distance)."""
    n = node_count
    k = min(truck_count, n)

    A = _build_adjacency(edges, n, balance_metric)
    edge_weights = [(e.u, e.v, _edge_weight(e, balance_metric)) for e in edges]

    labels = _spectral_partition(A, k)
    labels = _balance_postprocess(labels, edge_weights, k)

    zones_out: list[ZoneOutput] = []
    for z in range(k):
        node_ids = np.where(labels == z)[0].tolist()
        weight_sum, dist_sum = _zone_weight_and_distance(labels, z, edge_weights)
        zones_out.append(
            ZoneOutput(
                zone_id=z,
                node_ids=node_ids,
                estimated_time=round(weight_sum, 6),
                estimated_distance=round(dist_sum, 6),
            )
        )

    return PartitionResponse(zones=zones_out)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/zones/partition", response_model=PartitionResponse)
def post_zones_partition(body: PartitionRequest):
    """
    Partition a graph into truck_count zones using spectral clustering.
    Balance is by total edge length × complexity factor per zone.
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
