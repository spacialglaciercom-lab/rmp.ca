# Plan: GeoJSON/OSM Cleaning Before Python Optimizer

Integrate **Fiona** (GDAL/OGR), **GDAL/OGR**, and **NetworkX** in the backend to clean GeoJSON and OSM-derived data **before** it is used by the existing Python optimizer (Chinese Postman, zones partition, Overture). This keeps geometry valid, schemas consistent, and transport networks routable.

---

## 1. Current Data Flow

| Entry point | Source | Consumer |
|-------------|--------|----------|
| `POST /api/geojson/validate` | GeoJSON body | Validation only |
| `POST /api/geojson/filter` | GeoJSON + polygon/road_classes | Filtered GeoJSON |
| `POST /api/geojson/roads` | Raw GeoJSON | Road FeatureCollection |
| `POST /api/optimize` | GeoJSON road segments | Chinese Postman (NetworkX graph) |
| `POST /api/zones/partition-from-geojson` | GeoJSON LineStrings | Spectral partition graph |
| `POST /overture/optimize` | Optional `geojson` in body | Overture route optimization |

All consumers assume **valid LineString/MultiLineString** features. Invalid geometries, wrong CRS, or disconnected segments can cause failures or suboptimal routes.

---

## 2. Cleaning Pipeline (Three Layers)

Run in this order:

1. **Ingest / Normalize** — Accept GeoJSON (or OSM→GeoJSON); optionally convert OSM XML to GeoJSON.
2. **Geometry repair (Fiona + GDAL/OGR or Shapely)** — Validate and fix geometries (e.g. `makevalid`), filter out malformed features, normalize schema.
3. **Topology clean (NetworkX, optional)** — Remove isolated nodes/edges, prune dangling segments for routable transport networks.
4. **Output** — Clean GeoJSON (in-memory for API; optionally write file for batch).

---

## 3. Where to Integrate in the Backend

### Option A (recommended): New module + endpoint

- **New module:** `backend/app/vector_clean.py` (or `geojson_clean.py`).
- **New endpoint:** `POST /api/geojson/clean`.
  - **Request:** `{ "geojson": GeoJSONFeatureCollection, "options": { "makevalid": true, "remove_isolates": true, "min_length_m": 0 } }`.
  - **Response:** `{ "geojson": GeoJSONFeatureCollection, "stats": { "input_features", "output_features", "invalid_dropped", "isolates_removed" } }`.
- **Call site:** Frontend or Extract flow calls `/api/geojson/clean` first, then passes result to `/api/optimize`, `/api/zones/partition-from-geojson`, or `/overture/optimize`.

**Pros:** Explicit step; easy to test; supports batch (e.g. file URL or large payload) later.  
**Cons:** Client must call two endpoints unless we add a “clean then optimize” convenience endpoint.

### Option B: Cleaning inside existing endpoints

- In `optimize.py` and `main.py` (partition-from-geojson), run the same cleaning logic **before** building the graph.
- No new endpoint; cleaning is implicit.

**Pros:** Single request for clients.  
**Cons:** Harder to expose “clean only” or inspect cleaning stats; mixing concerns.

### Recommendation

- Implement **Option A** (`POST /api/geojson/clean`) as the main integration.
- Optionally add a **query param** or body flag on `/api/optimize` and `/api/zones/partition-from-geojson`: e.g. `clean_before_optimize: true` that runs the same cleaning in-process when set (so power users can skip an extra round-trip).

---

## 4. Implementation Details by Layer

### 4.1 Fiona (read/filter/write, schema)

- **Role:** Stream large GeoJSON (or other vector formats) without loading everything into memory; enforce schema; iterate and filter/repair.
- **Use when:** Input is file path or very large payload; need to support other drivers (e.g. GeoPackage) later.
- **API sketch:**
  ```python
  # In-memory: use fiona.MemoryFile or pass dict to Shapely/cleaner
  # File-based (batch):
  with fiona.open('input.json', 'r') as src:
      for feat in src:
          if is_valid(feat):  # or OGR/Shapely makevalid
              write_feature(feat)
  ```
- **Docs:** [fiona.readthedocs.io](https://fiona.readthedocs.io/) — I/O, schema handling.
- **Dependency:** `pip install fiona` (requires GDAL; prefer `conda install gdal fiona` if system GDAL is problematic).

**Integration:** In `vector_clean.py`, use Fiona when input is a file path or when we add a “batch” mode that reads from disk/URL. For in-memory GeoJSON (current API), we can use the same **logic** (iterate features, validate, repair) without Fiona I/O; optionally use `fiona.MemoryFile` to get OGR validation on a JSON string.

### 4.2 GDAL/OGR (geometry validation and repair)

- **Role:** Industrial-strength geometry repair (e.g. self-intersections, slivers). `ogr2ogr -makevalid` or Python `osgeo.ogr` to validate/repair.
- **Use when:** Data has invalid polygons/linestrings that Shapely cannot fix, or we want one canonical repair path.
- **CLI (batch):** `ogr2ogr -makevalid -f GeoJSON cleaned.json input.json`
- **Python:** `osgeo.ogr` open layer → iterate → `geom.MakeValid()` (or equivalent) → write.
- **Docs:** [gdal.org](https://gdal.org) — OGR geometry methods.

**Integration:** In `vector_clean.py`, if GDAL is available, call OGR’s makevalid during iteration; otherwise fall back to Shapely `make_valid()`. Prefer one code path so behavior is consistent.

### 4.3 Shapely (in-process geometry repair)

- **Role:** Already in stack; use for `make_valid()`, buffer(0), and simple validation when GDAL is not used.
- **Use when:** No Fiona/GDAL or we want a pure-Python path for deployment (e.g. some serverless environments).

**Integration:** In `vector_clean.py`, for each feature geometry, try `shapely.make_valid(geom)` and drop features that remain invalid or collapse to empty.

### 4.4 NetworkX (transport topology)

- **Role:** Model road network as graph; remove isolated nodes/edges; optionally prune short dangling segments so the optimizer sees a connected, routable network.
- **Use when:** Overture/OSM segments or connectors produce disconnected components or dead ends we don’t want to route.
- **Steps:**
  - Build graph from cleaned LineStrings (same node-id strategy as `geojson_ops.geojson_to_partition_graph` / `optimize._build_graph`).
  - `G.remove_nodes_from(list(nx.isolates(G)))`.
  - Optionally remove edges that belong to components below a size threshold.
  - Re-export graph edges back to GeoJSON LineStrings (using stored feature metadata if needed).

**Integration:** In `vector_clean.py`, add an optional step “remove_isolates” (and optionally “min_component_size”) that builds a NetworkX graph from the repaired features, prunes it, then reconstructs a FeatureCollection from the remaining edges. Reuse existing helpers from `geojson_ops` / `optimize` for node keys and edge construction to avoid duplication.

### 4.5 Graph and geometry cleaning steps (detailed)

These steps run after geometry repair (4.2/4.3) and use the same NetworkX graph built from LineStrings. They remove redundancy, artifacts, and incomplete data so the optimizer gets a single, routable network.

| Step | Purpose | How |
|------|--------|-----|
| **Duplicate nodes/edges** | Merged Overture/OSM data often has duplicate geometries or attributes; duplicates add redundant paths and extra computation. | **Nodes:** Merge nodes within a distance tolerance (e.g. 1 m) using spatial indexing: build an R-tree (e.g. `strtree.STRtree` in Shapely) of node points, query by distance, assign a single canonical node id per cluster, then `nx.relabel_nodes(G, mapping)` or rebuild edges with canonical ids. **Edges:** Deduplicate by geometry (e.g. normalized coordinate tuple) or by (u, v) + length; keep one edge per distinct segment. |
| **Self-loops** | Edges from a node to itself (e.g. from invalid or zero-length LineStrings) add no routing value and can break shortest-path logic. | `G.remove_edges_from(nx.selfloop_edges(G))`. Run after geometry repair and before or after duplicate removal. |
| **Zero-length / very short edges** | Sub-meter or 0.1 m edges are often rounding or import artifacts; they clutter the graph without adding topology. | Store edge length in graph (e.g. `G[u][v][key]['length']`). Filter with a threshold: `min_length_m` (e.g. 0.1). Use `nx.get_edge_attributes(G, 'length')` and remove edges where `length < min_length_m`. Optionally drop edges that collapse to zero after coordinate snapping. |
| **Disconnected components** | After removing isolates, the graph may still have several components; if the optimizer assumes one network, keep only the largest. | `comps = list(nx.connected_components(G))`; sort by size (e.g. `len(c)`); keep top `max_components` (e.g. 1). `G = G.subgraph(comps[0]).copy()` (or union of top N). |
| **Edges with invalid/missing attributes** | Incomplete OSM/Overture data may lack `highway` type, speed, or one-way; such edges make routability inconsistent. | Define required or recommended attributes (e.g. `highway`, or `class` for Overture). **Option A:** Remove edges missing required keys: filter by `G.edges(keys=True, data=True)` and drop if `data.get('highway') is None` (or not in allowlist). **Option B:** Flag only: add `_missing_attrs` in properties and let the optimizer decide. Prefer remove (or configurable) so the optimizer sees consistent data. |
| **Overlapping / parallel edges** | Multi-lane or duplicate ways can create overlapping LineStrings; merge into one multi-edge or a single edge with aggregated attributes to avoid double-counting in routing. | **Detection:** Shapely `line1.intersects(line2)` (or buffer slightly and intersect) for pairs of edges; or group edges by (u, v) and treat as parallel. **Action:** Either keep as multi-edges (NetworkX MultiGraph) with combined length/attributes, or collapse to one edge with e.g. max speed, union of road class. Use edge geometry + optional `shapely.ops.unary_union` for a single line. |
| **Topological errors (crossing edges without nodes)** | When two road segments cross without a shared node, routing cannot turn at the intersection. Planarize by inserting nodes at crossings. | **Detection:** For each pair of edges (LineStrings), check `line1.crosses(line2)` or `line1.intersection(line2)`; if a point (or line) intersection exists and is not an endpoint, the graph is non-planar at that point. **Action:** Insert a new node at the intersection, split both edges into two segments each, and reconnect. Use Shapely `line.intersection(other)` and `split(line, point)` (Shapely 2.0 has `split`). Rebuild graph from split segments. Optional: use `nx.planar_layout` only for visualization; for routing, explicit node insertion is required. Libraries like **osmnx** do this (intersection nodes); we can replicate with Shapely or call out to osmnx in a dedicated step if needed. |

**Order in pipeline:** Apply 4.2/4.3 (geometry repair) first, then build the graph once and run: self-loops → short edges → duplicate nodes (merge by proximity) → duplicate edges → missing-attribute filter → overlapping/parallel merge → disconnect small components → (optional) planarize / add nodes at crossings. See §9 Implementation plan for the exact sequence and options.

---

## 5. OSM Handling and ogr2ogr Conversion

- **Current backend:** Consumes **GeoJSON** only. OSM XML is not read by the Python backend today.
- **Use ogr2ogr for optional OSM → GeoJSON conversion and cleaning:** Run GDAL’s `ogr2ogr` so conversion and basic repair happen in one step, then run the Python graph-cleaning pipeline on the resulting GeoJSON.

**Recommended CLI (conversion + geometry repair):**
```bash
# OSM XML → GeoJSON with makevalid (fix invalid geometries during conversion)
ogr2ogr -makevalid -f GeoJSON output.json input.osm

# Optional: simplify or segmentize for consistency
# ogr2ogr -makevalid -segmentize 1 -f GeoJSON output.json input.osm
```

- **Options:**
  1. **Client/Extract converts OSM → GeoJSON** (e.g. in app or Overpass). Backend receives GeoJSON and runs the cleaning pipeline.
  2. **Backend script/endpoint:** `scripts/osm_to_geojson.py` (or a batch endpoint) runs `ogr2ogr -makevalid -f GeoJSON ...` (subprocess or Python bindings), then runs the same GeoJSON graph cleaner.
  3. **Offline batch:** Script that runs `ogr2ogr` on OSM files, then the cleaner, and writes cleaned GeoJSON for upload or API use.

**Recommendation:** Keep the main API **GeoJSON-in, GeoJSON-out**. Use **ogr2ogr** for OSM→GeoJSON when needed, with `-makevalid` so conversion also cleans geometry; the rest of the pipeline (duplicate removal, self-loops, short edges, components, attributes, overlaps, topology) runs in Python on that GeoJSON.

---

## 6. Dependencies and Installation

| Package   | Purpose                    | Required | Notes                                      |
|----------|----------------------------|----------|--------------------------------------------|
| shapely  | Geometry repair, fallback  | Yes      | Already in `requirements.txt`              |
| networkx | Topology cleaning          | Yes      | Already in `requirements.txt`              |
| fiona    | Vector I/O, large files    | Optional | Requires GDAL; `pip install fiona` or conda |
| gdal     | OGR makevalid, OSM read    | Optional | `conda install gdal` often easiest         |

- **Minimal (no GDAL/Fiona):** Use Shapely for make_valid + NetworkX for isolates. Works everywhere.
- **Full (Fiona + GDAL):** For large files and strongest repair; document `conda install gdal fiona` (or system GDAL + `pip install fiona`) in backend README and Dockerfile.

**requirements.txt:** Add optional deps in a separate file or as extras, e.g. `requirements-geo.txt` with `fiona` and a note that GDAL may need to be installed at the system/conda level.

---

## 7. Suggested File Layout

```
backend/
  app/
    main.py              # Mount geojson_clean router if present
    geojson_ops.py       # Existing validate/filter/roads + geojson_to_partition_graph
    vector_clean.py      # NEW: clean endpoint + clean_geojson() used by optimize/partition
    optimize.py          # Optional: call vector_clean.clean_geojson() when clean_before_optimize=True
  requirements.txt       # Keep shapely, networkx
  requirements-geo.txt   # Optional: fiona, (gdal if pip-installable on target OS)
  docs/
    GEOJSON-OSM-CLEANING-PLAN.md  # This file
  scripts/
    osm_to_geojson.py    # Optional: OSM XML → GeoJSON for batch
```

---

## 8. Implementation Order (phases)

1. **Phase 1 — In-process cleaning (no new deps)**  
   - Add `vector_clean.py` with `clean_geojson(geojson_dict, options)` using **Shapely** (make_valid, drop invalid) and **NetworkX** (remove isolates, optional min_component_size).  
   - Add `POST /api/geojson/clean` that calls `clean_geojson` and returns cleaned GeoJSON + stats.  
   - Wire proxy in Node (`optimizerProxy.ts`) and optionally frontend (e.g. “Clean” before “Optimize” or “Partition”).

2. **Phase 2 — Optional Fiona + GDAL**  
   - Add `requirements-geo.txt` and document GDAL install.  
   - In `vector_clean.py`, if Fiona/GDAL available, use OGR makevalid in the iteration path; otherwise keep Shapely fallback.  
   - Optionally support file-path or URL input for large batch (e.g. read with Fiona, write cleaned GeoJSON).

3. **Phase 3 — OSM and batch**  
   - Optional script `scripts/osm_to_geojson.py` using **ogr2ogr** (subprocess or Python bindings) for OSM → GeoJSON with `-makevalid`.  
   - Optional “clean then optimize” single endpoint or `clean_before_optimize` flag on `/api/optimize` and `/api/zones/partition-from-geojson`.

---

## 9. Implementation plan (start here)

Concrete pipeline order, options schema, and code layout so implementation can start.

### 9.1 Pipeline stages (order of operations)

Run in this order. Each stage consumes the output of the previous one (GeoJSON → GeoJSON until graph stage; graph → graph; then graph → GeoJSON).

| Stage | Input | Action | Output |
|-------|--------|--------|--------|
| 1. Ingest | GeoJSON body or (batch) file/OSM | Normalize to FeatureCollection; optional ogr2ogr for OSM→GeoJSON. | GeoJSON |
| 2. Geometry repair | GeoJSON | make_valid (OGR or Shapely); drop empty/invalid; optional schema normalize. | GeoJSON |
| 3. Build graph | GeoJSON | LineStrings → NetworkX MultiGraph with node keys (e.g. rounded lon,lat), edge attr `length`, `geometry`, `properties`. | Graph + feature index |
| 4. Self-loops | Graph | `G.remove_edges_from(nx.selfloop_edges(G))`. | Graph |
| 5. Short edges | Graph | Remove edges with `length < min_length_m` (e.g. 0.1). | Graph |
| 6. Duplicate nodes | Graph | Merge nodes within `node_snap_m` (e.g. 1 m): R-tree (Shapely STRtree) on node coords → canonical id per cluster → relabel or rebuild edges. | Graph |
| 7. Duplicate edges | Graph | Dedupe by (u, v) + geometry hash or normalized coords; keep one edge per distinct segment, merge attributes if desired. | Graph |
| 8. Missing/invalid attributes | Graph | Remove (or flag) edges missing required keys, e.g. `required_attrs=['highway']` or `required_attrs=['class']` for Overture. | Graph |
| 9. Overlapping/parallel edges | Graph | Group edges by (u, v) or by geometry overlap (Shapely); merge into one edge (aggregate length/attrs) or keep as multi-edge. | Graph |
| 10. Isolates | Graph | `G.remove_nodes_from(list(nx.isolates(G)))`. | Graph |
| 11. Disconnected components | Graph | Keep largest `max_components` (e.g. 1); `G = G.subgraph(union_of_components).copy()`. | Graph |
| 12. (Optional) Planarize | Graph | Insert nodes at LineString crossings; split edges. Skip in Phase 1; add when needed. | Graph |
| 13. Export | Graph | Rebuild GeoJSON FeatureCollection from remaining edges (geometry + properties from edge data). | GeoJSON |

### 9.2 Clean options schema

```python
# Pydantic or TypedDict for POST /api/geojson/clean body.options
class CleanOptions(BaseModel):
    # Geometry
    makevalid: bool = True
    drop_invalid: bool = True

    # Graph topology
    remove_selfloops: bool = True
    min_length_m: float = 0.1
    node_snap_m: float = 1.0          # merge nodes within this distance (m)
    dedupe_edges: bool = True
    remove_isolates: bool = True
    max_components: int = 1           # keep largest N components (0 = keep all)

    # Attributes (routability)
    required_attrs: list[str] | None = None   # e.g. ["highway"] or ["class"]; drop edge if missing
    drop_incomplete_edges: bool = False       # alias: drop if missing required_attrs

    # Overlapping / parallel
    merge_parallel_edges: bool = False        # merge (u,v) multi-edges into one with aggregated attrs

    # Advanced (Phase 2+)
    planarize: bool = False           # insert nodes at crossings (Phase 2)
```

### 9.3 Response stats (for `/api/geojson/clean`)

Return counts so clients can see what was removed:

```python
class CleanStats(BaseModel):
    input_features: int
    output_features: int
    invalid_dropped: int
    selfloops_removed: int
    short_edges_removed: int
    nodes_merged: int
    duplicate_edges_removed: int
    incomplete_edges_removed: int
    parallel_edges_merged: int
    isolates_removed: int
    components_removed: int  # how many components were dropped (kept max_components)
```

### 9.4 Code layout in `vector_clean.py`

```text
# Module: app/vector_clean.py

# 1) Helpers (geometry)
def _geom_to_shapely(geom_dict) -> BaseGeometry | None
def _make_valid(geom) -> BaseGeometry | None   # Shapely or OGR if available
def _geojson_features_to_graph(fc) -> nx.MultiGraph  # + feature index edge -> original feature

# 2) Graph cleaning steps (each takes G, options, stats dict; mutate G and stats)
def _remove_selfloops(G, stats)
def _remove_short_edges(G, min_length_m, stats)
def _merge_duplicate_nodes(G, node_snap_m, stats)   # R-tree + relabel
def _dedupe_edges(G, stats)
def _remove_edges_missing_attrs(G, required_attrs, stats)
def _merge_parallel_edges(G, stats)
def _remove_isolates(G, stats)
def _keep_largest_components(G, max_components, stats)

# 3) Export
def _graph_to_geojson(G, feature_index) -> GeoJSONFeatureCollection

# 4) Main entry
def clean_geojson(geojson: dict, options: CleanOptions) -> tuple[GeoJSONFeatureCollection, CleanStats]
    # Run stages 2–13 in order; return cleaned fc + stats.

# 5) FastAPI
@router.post("/api/geojson/clean")
def post_geojson_clean(body: CleanRequest) -> CleanResponse
```

### 9.5 Implementation checklist

- [x] **Stage 2:** Geometry repair — Shapely `make_valid`, drop null/empty; optional OGR path when available.
- [x] **Stage 3:** Build graph from LineStrings (reuse node-id logic from `geojson_ops` / `optimize`); store `length` (m or km), `geometry`, `properties` on each edge.
- [x] **Stage 4:** Self-loops: `nx.selfloop_edges(keys=True)` + remove.
- [x] **Stage 5:** Short edges: filter by `min_length_m` using edge `length` attribute.
- [x] **Stage 6:** Duplicate nodes: Shapely STRtree for points, cluster by `node_snap_m`, build mapping, relabel graph (or rebuild edges with canonical ids).
- [x] **Stage 7:** Duplicate edges: same (u,v) or same geometry → keep one.
- [x] **Stage 8:** Required attributes: if `required_attrs` set, drop edges missing any key.
- [x] **Stage 9:** Parallel edges: optional merge (u,v) multi-edges into one.
- [x] **Stage 10–11:** Isolates then largest component(s).
- [x] **Stage 13:** Graph → GeoJSON (reconstruct features from edge data).
- [x] **Endpoint:** `POST /api/geojson/clean` with CleanOptions and CleanStats in response.
- [x] **Proxy:** Add `/api/geojson/clean` to `server/optimizerProxy.ts`.
- [x] **Script:** `scripts/osm_to_geojson.py` — subprocess `ogr2ogr -makevalid -f GeoJSON out.json in.osm` (optional).
- [x] **Tests:** Fixtures with self-loops, short edges, duplicates, missing attrs; assert stats and cleaned feature count.
- [x] **clean_before_optimize:** Optional flag on `POST /api/optimize` and `POST /api/zones/partition-from-geojson` to run cleaning in-process.

---

## 10. Testing

- **Unit:** Feed known bad GeoJSON (self-intersecting line, empty geom, wrong type) into `clean_geojson()`; assert valid output and expected stats.  
- **Integration:** Call `POST /api/geojson/clean` then `POST /api/optimize` (or partition-from-geojson) and assert no errors and sane route/partitions.  
- **Regression:** Keep a small fixture of “dirty” Overture/OSM-derived GeoJSON in `tests/fixtures/` and run cleaning + optimizer in CI.

---

## 11. References

- **Fiona:** [fiona.readthedocs.io](https://fiona.readthedocs.io/) — I/O and schema.  
- **GDAL/OGR:** [gdal.org](https://gdal.org) — Geometry validation/repair, ogr2ogr.  
- **NetworkX:** [networkx.org](https://networkx.org) — Graph cleaning (e.g. isolates, selfloop_edges, connected_components).  
- **Shapely:** [shapely.readthedocs.io](https://shapely.readthedocs.io/) — `make_valid`, `split`; **STRtree** for spatial indexing (merge duplicate nodes by proximity).  
- **osmnx** (optional): Intersection node insertion and planarization for street networks.

This plan keeps the optimizer unchanged in contract; cleaning is an explicit step (and optionally an internal step) so GeoJSON and OSM-derived data are valid and routable before use.
