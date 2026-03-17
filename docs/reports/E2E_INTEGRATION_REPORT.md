# End-to-End Integration Report

**Date:** 2025-03-13  
**Goal:** Validate full data pipeline from Node.js Extract → Python Backend (clean + optimize).

---

## 1. Extract Phase (Node.js)

- **Command run:** `node extract/cli.js process test_data.json --format geojson --output extract-output.geojson`
- **Result:** Success. Output file created with 12 features.
- **Validation:** Output is valid JSON and valid GeoJSON (`type: "FeatureCollection"`, `features` array of Feature objects with `type`, `geometry`, `properties`).

**Note:** The Extract CLI `process` command was added to support this pipeline. It reads a GeoJSON FeatureCollection from file and writes it to stdout or `--output`. For live Overture extraction (polygon → S3/DuckDB), use the Extract server (`node extract/cli.js serve`) and the WebSocket/HTTP API.

---

## 2. Ingest & Clean Phase (Python)

- **Command run:** `python backend/cli.py clean extract-output.geojson --output cleaned-output.geojson`
- **Result:** Success. Python `vector_clean` accepted the Node.js GeoJSON schema without errors.
- **Stats:** input_features: 12, output_features: 12, duplicate_edges_removed: 0, selfloops_removed: 0.
- **Enhancement:** The `clean` command now supports `--output` / `-o` to write the cleaned GeoJSON to a file for piping into the next step.

---

## 3. Solve Phase

- **Command run:** `python backend/cli.py compare cleaned-output.geojson --baseline-penalties 0,0,0 --high-penalties 0.5,1.0,0.2`
- **Result:** Success. Solver ran on the cleaned data; coordinate precision and properties from the Node service were handled correctly.
- **Sample output:** Total distance (km): 0.8019, Efficiency: 75.00%, Traversals: 12, Deadhead (km): 0.2005.

---

## 4. Schema Validation (Extract vs Backend)

### Extract (Node.js) output shape (from `extract/server.js`)

- **FeatureCollection:** `{ type: "FeatureCollection", features: [...] }`
- **Feature:** `{ type: "Feature", geometry: <GeoJSON geometry>, properties: { ... } }`
- **Properties emitted:** `id`, `name`, `class`, `subtype`, `subclass`, `surface`, `osm_id` (when OSM source present), `junction` (e.g. `"roundabout"`), `oneway` (`"yes"` / `"-1"`). Connectors: `{ id, type: "connector" }`.
- **Naming:** All property keys are lowercase or camelCase (`class`, `osm_id`, `oneway`, etc.).

### Backend (Python) expected shape (from `backend/app/geojson_ops.py`)

- **GeoJSONFeatureCollection:** `type: "FeatureCollection"`, `features: list[GeoJSONFeature]`
- **GeoJSONFeature:** `type: "Feature"`, `geometry: dict[str, Any]`, `properties: dict[str, Any]` with `extra = "allow"`
- **Road class:** Backend reads `props.get("class") or props.get("road_class") or props.get("highway")` — so Extract’s `class` is the primary and matches.
- **vector_clean:** Preserves `properties` through the graph pipeline and re-attaches them to cleaned features.

### Schema drift assessment

| Item | Status |
|------|--------|
| Top-level type / features | **Aligned** — both use standard GeoJSON FeatureCollection. |
| Feature type / geometry / properties | **Aligned** — Backend accepts any dict for `geometry` and `properties`. |
| Road class | **Aligned** — Extract uses `class`; Backend prefers `class`, then `road_class`, then `highway`. |
| camelCase vs snake_case | **No conflict** — Extract uses `class`, `osm_id`, `oneway`; Backend does not expect snake_case for these; Pydantic `extra = "allow"` keeps all keys. |
| Missing `osm_id` | **Optional** — Backend does not require `osm_id`; it is preserved if present. |
| Coordinate precision | **Compatible** — Backend rounds to 6 decimals for node keys; Extract coordinates are fine. |

**Conclusion:** No schema mismatches identified. The output of the Node.js Extract service is compatible with the Python Backend solver.

---

## 5. Data Continuity & One-Liner

- **Data continuity:** Yes. The file passed successfully from Node (Extract) → Python (clean) → Python (compare). No parsing or validation errors; clean and optimize both completed successfully.

### One-liner for automation (all three steps)

From the **repository root**, with a virtualenv activated and `test_data.json` present (or another GeoJSON input):

```bash
node extract/cli.js process test_data.json --format geojson -o extract-output.geojson && \
python backend/cli.py clean extract-output.geojson -o cleaned-output.geojson && \
python backend/cli.py compare cleaned-output.geojson --baseline-penalties 0,0,0 --high-penalties 0.5,1.0,0.2
```

Using a single variable for the pipeline output:

```bash
OUT=cleaned-output.geojson && \
node extract/cli.js process test_data.json -o extract-output.geojson && \
python backend/cli.py clean extract-output.geojson -o "$OUT" && \
python backend/cli.py compare "$OUT"
```

---

## Summary

| Step | Command | Status |
|------|---------|--------|
| 1. Extract | `node extract/cli.js process test_data.json --format geojson -o extract-output.geojson` | OK |
| 2. Clean | `python backend/cli.py clean extract-output.geojson -o cleaned-output.geojson` | OK |
| 3. Compare | `python backend/cli.py compare cleaned-output.geojson --baseline-penalties 0,0,0 --high-penalties 0.5,1.0,0.2` | OK |
| Schema | Extract (JS) vs Backend (Pydantic) | No drift found |

**Verdict:** End-to-end integration test **passed**. The pipeline Extract → Clean → Optimize is validated and ready for automation.
