# GeoJSON/OSM Cleaning: Review vs Current Code & Code Changes

This document compares the current `geojson_ops.py` and `vector_clean.py` implementation against the plan and the external review (Donna's plan + GIS best practices). It lists **concrete code changes** to align with or improve the pipeline.

---

## 1. What Already Matches the Plan

| Plan / review item | Current code | Status |
|--------------------|-------------|--------|
| Pipeline stages | Ingest → Geometry repair → Graph → Topology clean → Export | ✅ Implemented in `clean_geojson()` |
| `POST /api/geojson/clean` | `vector_clean.post_geojson_clean` | ✅ |
| CleanOptions / CleanStats | Pydantic models in `vector_clean.py` | ✅ |
| Geometry repair (make_valid) | Shapely `make_valid`; GeoPandas batch path when `len(fc) >= 10k` | ✅ |
| Self-loops first | `_remove_selfloops` before short edges / node merge | ✅ |
| Node merging by distance | STRtree + **Haversine** (`_haversine_km_vectorized`) | ✅ Already Haversine, not Euclidean |
| MultiLineString → LineStrings | Loop path: `shp.geoms` for MultiLineString; GeoPandas: `explode()` | ✅ |
| Short edges, dedupe edges, required_attrs | `_remove_short_edges`, `_dedupe_edges`, `_remove_edges_missing_attrs` | ✅ |
| Parallel edge merge + property merge | `_merge_parallel_edges` with `_merge_property_values` | ✅ |
| Optional simplify | `simplify_tolerance_m` + `_simplify_coords_m` (Douglas–Peucker) | ✅ |
| `clean_before_optimize` | Used in main optimize/partition-from-geojson | ✅ |
| ogr2ogr script | `scripts/osm_to_geojson.py` with `-makevalid` | ✅ |

---

## 2. Gaps vs Plan / Review — Code Changes

### 2.1 CRS (Coordinate Reference System)

**Review:** "Add CRS check/reprojection; default to EPSG:4326. GDAL `-t_srs EPSG:4326` or pyproj/Shapely."

**Current:** No CRS handling. GeoJSON is assumed to be WGS84 (lon/lat).

**Code changes:**

1. **`scripts/osm_to_geojson.py`**  
   - Add `-t_srs EPSG:4326` to the `ogr2ogr` command so output is always WGS84.  
   - Optionally add `-s_srs` if the OSM source has a known different CRS (often OSM is already WGS84).

2. **`vector_clean.py` (optional, Phase 2)**  
   - Add an optional "ingest" step or docstring: "Input GeoJSON is assumed to be EPSG:4326 (WGS84). If you have GeoJSON in another CRS, reproject before calling this API (e.g. with GDAL or pyproj)."  
   - If you later add Fiona/GDAL in the loop: when reading from file/URL, detect CRS and reproject to 4326 before processing.

---

### 2.2 MultiLineString in `geojson_ops.py`

**Review:** "Explicitly explode MultiLineString to LineStrings in geometry repair."

**Current:**  
- `geojson_ops._extract_coords()` for MultiLineString flattens all rings into one list (correct for bbox/centroid/length), but **`extract_roads` and `geojson_to_partition_graph`** treat MultiLineString as multiple lines (they iterate `coords_list`). So behavior is correct.  
- One subtlety: in `_extract_coords`, for `MultiLineString` the code does `for ring in (coords or []): result.extend(ring)`. So it flattens; it does **not** return one list per line. That’s only used for centroid/bbox/length and validate, so OK. No change strictly required for the cleaning pipeline.

**Code change (optional):**  
- In `geojson_ops.py`, add a short comment above `_extract_coords` that for MultiLineString it returns flattened coords (for bbox/centroid), and that per-line handling is in `geojson_to_partition_graph` and in `vector_clean` (explode to LineStrings).

---

### 2.3 Attribute merging rules (parallel edges / node merges)

**Review:** "Define rules: e.g. speed_limit = mean; oneway = most restrictive; store originals in `merged_from` if needed."

**Current:**  
- `_merge_property_values` uses: average for numbers, joined strings, merged lists. No source-specific rules (e.g. oneway, speed_limit).

**Code changes:**

1. **`vector_clean.py`**  
   - Add an optional strategy or small rules map for known keys, e.g.:
     - `oneway`: take most restrictive (e.g. if any is `"yes"`, result is `"yes"`).
     - `speed_limit` / `maxspeed`: take mean (or max), and document in docstring.
   - Optionally add a `merged_from: list[dict]` (or similar) to merged edge properties when `merge_parallel_edge_properties` is True, so downstream can inspect originals.  
   - Keep current generic behavior as default; add these as documented overrides or options.

2. **`CleanOptions`**  
   - Add an optional `property_merge_rules: dict[str, Literal["mean","max","min","most_restrictive_oneway","first"]]` (or similar) so callers can override per-key behavior without code changes.

---

### 2.4 required_attrs per data source (OSM vs Overture)

**Review:** "Make required_attrs configurable per source (e.g. OSM: 'highway', Overture: 'class')."

**Current:**  
- `required_attrs` is already a list; callers can pass `["highway"]` or `["class"]`. No presets.

**Code changes:**

1. **`vector_clean.py`**  
   - Add a preset or helper, e.g.:
     - `CleanOptions(required_attrs=["highway"])` for OSM-style;
     - `CleanOptions(required_attrs=["class"])` for Overture-style.
   - In the API docstring or OpenAPI description for `CleanOptions`, document: "For OSM use e.g. `['highway']`; for Overture use e.g. `['class']`."

2. **Optional:** Add `required_attrs_preset: Literal["osm", "overture", "none"] | None = None`. When set, ignore `required_attrs` and use `["highway"]`, `["class"]`, or `None` respectively. Keeps API simple for common cases.

---

### 2.5 Input size limit (API body cap) — DoS

**Review:** "Add input size limits (e.g. FastAPI body size cap) to prevent DoS from huge GeoJSON payloads."

**Current:** No explicit body size limit on `/api/geojson/clean`.

**Code changes:**

1. **`backend/app/main.py`**  
   - When creating the FastAPI app, or on the route that receives the clean request, set a maximum request body size. For example:
     - Use a custom dependency or middleware that checks `Content-Length` (or read body and check length) and returns 413 if above a limit (e.g. 50MB).
     - Or use Starlette/FastAPI mechanism for body size limit if available in your version.
   - Document the limit in the API docs (e.g. "Max request body size 50MB for GeoJSON").

2. **`vector_clean.py`**  
   - At the start of `clean_geojson()`, optionally check `len(fc)` (or total serialized size if you have it) and raise a clear HTTP 413 or 400 if above a configured maximum (e.g. 100k features). This protects the pipeline even if the body passed the global limit.

---

### 2.6 Warn when many features are dropped (e.g. >10% invalid)

**Review:** "Add logging/stats to monitor common drops; if >10% invalid, warn in response."

**Current:**  
- Stats are returned (e.g. `invalid_dropped`); no explicit "warning" in the response and no logging.

**Code changes:**

1. **`vector_clean.py`**  
   - After computing stats, if `invalid_dropped / input_features > 0.10` (and `input_features > 0`), set a response warning, e.g.:
     - Add an optional `warnings: list[str]` to `CleanStats` or to `CleanResponse`.
     - Append a message like: `"Over 10% of features were dropped as invalid; consider checking CRS and geometry validity."`

2. **`CleanResponse`**  
   - Add `warnings: list[str] = []` to the response model and populate it in `post_geojson_clean` from the same logic.

3. **Logging**  
   - In `post_geojson_clean`, log at warning level when `invalid_dropped / input_features > 0.10` (and input_features > 0), including a short message and the ratio.

---

### 2.7 OSM script: CRS and layer docs

**Review:** "Ensure output is EPSG:4326; document layer and CRS."

**Code changes:**

1. **`scripts/osm_to_geojson.py`**  
   - Add `-t_srs EPSG:4326` to the `ogr2ogr` command.
   - In the script docstring, state: "Output is GeoJSON in WGS84 (EPSG:4326). Input is assumed to be OSM (typically WGS84)."
   - Optionally add a short comment that for other source CRSs you could add `-s_srs`.

---

### 2.8 Large graphs (batching / components)

**Review:** "Process components separately with `nx.connected_components`; avoid rebuilding graph multiple times; consider batching for very large datasets."

**Current:**  
- Graph is built once; topology steps run in place; `_keep_largest_components` already uses `nx.connected_components`. No multiple full rebuilds.

**Code changes (optional, for very large graphs):**

1. **`vector_clean.py`**  
   - Add a short comment in `clean_geojson` or `_keep_largest_components`: "For very large graphs (e.g. 100k+ edges), consider processing components in batches (e.g. iterate `nx.connected_components`, clean each subgraph, then recombine) to bound memory."  
   - No immediate code change required unless you hit memory issues; then you can add a path that processes each component separately and merges results.

---

### 2.9 GDAL/OGR makevalid in the loop (Phase 2)

**Review:** "If GDAL is available, use OGR makevalid in the iteration path; otherwise keep Shapely fallback."

**Current:**  
- Only Shapely `make_valid` (and GeoPandas in the batch path, which uses the same `_make_valid_geom`). No GDAL/OGR.

**Code changes (Phase 2):**

1. **`vector_clean.py`**  
   - Add a helper, e.g. `_make_valid_geom_ogr(geom)` that uses `osgeo.ogr` (or Fiona) if available to call OGR’s makevalid; on import error or failure, fall back to `_make_valid_geom` (Shapely).  
   - In the loop path (non-batch), when `makevalid` is True, try GDAL first and fall back to Shapely so behavior is consistent and one code path is used per run.  
   - Document in the module docstring: "Geometry repair uses Shapely; optional GDAL/OGR path when available."

---

## 3. Summary Table of Code Changes

| Priority | File | Change |
|----------|------|--------|
| High | `scripts/osm_to_geojson.py` | Add `-t_srs EPSG:4326`; document CRS in docstring. |
| High | `backend/app/main.py` (or FastAPI app) | Enforce max request body size for `/api/geojson/clean` (e.g. 50MB) and document. |
| High | `vector_clean.py` | Add `warnings: list[str]` to CleanStats or CleanResponse; when `invalid_dropped / input_features > 0.10`, add warning and log. |
| Medium | `vector_clean.py` | Document required_attrs: OSM vs Overture in CleanOptions docstring; optional `required_attrs_preset`. |
| Medium | `vector_clean.py` | Optional property merge rules (oneway = most restrictive, speed_limit = mean) and optional `merged_from` on merged edges. |
| Medium | `vector_clean.py` | In `clean_geojson`, optional check on `len(fc)` (or size) and raise 413/400 if above limit. |
| Low | `geojson_ops.py` | Comment in `_extract_coords` that MultiLineString is flattened for bbox/centroid; per-line handling is elsewhere. |
| Low | `vector_clean.py` | Comment that input is assumed EPSG:4326; document optional future CRS reprojection. |
| Phase 2 | `vector_clean.py` | Optional GDAL/OGR makevalid in the loop with Shapely fallback. |

---

## 4. Files to Touch (Checklist)

- [ ] `backend/scripts/osm_to_geojson.py` — CRS + docstring  
- [ ] `backend/app/main.py` (or app creation) — body size limit  
- [ ] `backend/app/vector_clean.py` — warnings, optional merge rules, optional size check, docstrings, optional preset  
- [ ] `backend/app/geojson_ops.py` — optional comment on MultiLineString  

This gives you a concrete, ordered list of code changes that align the current geojson_ops and vector_clean implementation with the plan and the review.
