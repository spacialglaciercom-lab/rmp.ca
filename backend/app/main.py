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
from scipy.sparse.linalg import eigsh
from sklearn.cluster import KMeans

app = FastAPI(title="RouteMasterPro Optimizer API", version="1.1.0")

# Register sub-routers for other endpoints
from .geojson_ops import router as geojson_router
from .optimize import router as optimize_router
from .overture import router as overture_router

app.include_router(geojson_router)
app.include_router(optimize_router)
app.include_router(overture_router)


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
    U = None

    # Smallest k eigenvalues (excluding 0). Use dense for small n, sparse for large.
    if n <= 2000:
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


def partition_graph(
    edges: list[EdgeInput],
    node_count: int,
    truck_count: int,
    balance_metric: str,
) -> PartitionResponse:
    """Run spectral clustering and return zones with estimated_time (and optional distance)."""
    n = node_count
    # Effective cluster count is capped at n; extra zones are emitted empty.
    k_eff = min(truck_count, n)
    warnings: list[str] = []

    # Validate node coverage: detect nodes never referenced by any edge
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
        # No edges or all-zero weights — round-robin assignment
        labels = np.array([i % k_eff for i in range(n)])
    else:
        # Detect isolated nodes (degree 0) and exclude from spectral clustering
        degrees = np.array(A.sum(axis=1)).ravel()
        isolates = np.where(degrees == 0)[0]
        connected = np.where(degrees > 0)[0]

        if connected.size == 0:
            labels = np.array([i % k_eff for i in range(n)])
        elif connected.size < n:
            # Build a sub-matrix for connected nodes only
            A_sub = A[np.ix_(connected, connected)]
            idx_map = {orig: compact for compact, orig in enumerate(connected)}
            sub_edge_weights = [
                (idx_map[u], idx_map[v], w)
                for u, v, w in edge_weights
                if u in idx_map and v in idx_map
            ]
            sub_k = min(k_eff, connected.size)
            sub_labels = _spectral_partition(A_sub, sub_k)
            sub_labels = _balance_postprocess(sub_labels, sub_edge_weights, sub_k)

            # Map labels back and assign isolates to smallest zones
            labels = np.zeros(n, dtype=int)
            for compact, orig in enumerate(connected):
                labels[orig] = sub_labels[compact]

            zone_counts = np.bincount(labels[connected], minlength=k_eff)
            for i, iso_node in enumerate(isolates):
                lightest = int(np.argmin(zone_counts))
                labels[iso_node] = lightest
                zone_counts[lightest] += 1
        else:
            labels = _spectral_partition(A, k_eff)
            labels = _balance_postprocess(labels, edge_weights, k_eff)

    # Build output for all requested zones (truck_count), not just k_eff
    zones_out: list[ZoneOutput] = []
    for z in range(truck_count):
        if z < k_eff:
            node_ids = np.where(labels == z)[0].tolist()
            weight_sum, dist_sum = _zone_weight_and_distance(
                labels, z, edge_weights, edge_lengths,
            )
        else:
            # Extra zones beyond node count are empty
            node_ids = []
            weight_sum, dist_sum = 0.0, 0.0
        zones_out.append(
            ZoneOutput(
                zone_id=z,
                node_ids=node_ids,
                estimated_time=round(weight_sum, 6),
                estimated_distance=round(dist_sum, 6) if balance_metric == "distance" else None,
            )
        )

    return PartitionResponse(zones=zones_out, warnings=warnings)


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
