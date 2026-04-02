# CLI Reference

RouteMaster Pro ships two CLI tools for working with road network data offline, without needing the full web/mobile stack running.

| Tool | Language | Location | Purpose |
|------|----------|----------|---------|
| **rmp-extract** | Node.js | `extract/cli.js` | Overture Maps extraction, schema validation, GeoJSON processing |
| **rmp-backend** | Python | `backend/cli.py` | Route optimization, VRP testing, benchmarking, GeoJSON cleaning |

---

## Extract CLI (`rmp-extract`)

Manages the Overture Maps extraction pipeline — process GeoJSON files, start the extraction server, and validate Overture schema compatibility before release upgrades.

### Setup

```bash
cd extract
npm install
```

### Commands

#### `process <input>` — Process GeoJSON files

Read a GeoJSON FeatureCollection and output it (optionally to a file).

```bash
# Print to stdout
node extract/cli.js process my-extract.geojson

# Write to file
node extract/cli.js process my-extract.geojson -o cleaned.geojson

# Specify format
node extract/cli.js process my-extract.geojson --format geojson -o output.geojson
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--format <fmt>` | Output format | `geojson` |
| `--output, -o <file>` | Write output to file | stdout |

**Notes:**
- Input must be a valid GeoJSON `FeatureCollection` with `type` and `features` fields.
- Polygon-based extraction (drawing a region to extract from Overture) requires the WebSocket server — use `serve` instead.

---

#### `serve` — Start the Overture extract server

Launches the full extraction service with DuckDB, WebSocket, and HTTP endpoints.

```bash
node extract/cli.js serve
```

This is equivalent to `pnpm dev:extract` from the project root. The server starts on port **9000** (configurable via `PORT` env var) and exposes:

| Endpoint | Protocol | Purpose |
|----------|----------|---------|
| `/ws/extract` | WebSocket | Send `{ polygon, theme }` to extract roads from Overture S3 |
| `/geojson/:hash` | HTTP GET | Retrieve cached extraction results |
| `/download/:hash` | HTTP GET | Download extraction as `.geojson` file |
| `/health` | HTTP GET | Health check (returns DuckDB status + Overture release) |

**Environment variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server listen port | `9000` |
| `OVERTURE_RELEASE` | Overture Maps release version | `2026-02-18.0` |

---

#### `schema` — Validate Overture schema

Queries a small bounding box from Overture S3 and checks that all required columns exist (`road_flags`, `access_restrictions`, `road_surface`, etc.). Run this **before** updating `OVERTURE_RELEASE` in `server.js`.

```bash
# Check current release
node extract/cli.js schema

# Check a specific release
node extract/check_schema.js 2026-03-15.0
```

**Why this matters:** Overture Maps schema changes between releases. If `road_flags` or `access_restrictions` columns are renamed or removed, the extraction will produce roads without oneway/roundabout data, leading to broken routing.

---

#### `sources` — Check data source licensing

Queries Overture segment data and reports which source datasets are used (e.g., OpenStreetMap), so you can ensure proper attribution.

```bash
node extract/cli.js sources
```

---

## Backend CLI (`rmp-backend`)

Python CLI for route optimization workflows — generate test data, compare optimization strategies, clean GeoJSON, test VRP solvers, and benchmark zone partitioning.

### Setup

```bash
cd backend
pip install -r requirements.txt
```

### Commands

#### `generate` — Generate synthetic road networks

Creates a grid city GeoJSON for testing the optimizer without needing real map data.

```bash
# Default 4x4 grid (40 segments)
python cli.py generate test-city.json

# Larger grid
python cli.py generate large-city.json --rows 10 --cols 10

# Small grid for quick tests
python cli.py generate small.json -r 2 -c 2
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--rows, -r` | Grid rows (horizontal streets) | `4` |
| `--cols, -c` | Grid columns (vertical streets) | `4` |

**Output:** GeoJSON FeatureCollection with `(rows+1)*cols + (cols+1)*rows` LineString segments. All segments have `"class": "residential"`.

---

#### `compare` — Compare optimization with different turn penalties

Runs the Chinese Postman optimizer twice with different turn penalty settings and displays a comparison table.

```bash
# Compare default baseline (no penalties) vs high penalties
python cli.py compare my-roads.geojson

# Custom penalty sets (format: left_turn,u_turn,right_turn)
python cli.py compare my-roads.geojson \
  --baseline-penalties "0,0,0" \
  --high-penalties "1.0,2.0,0.5"
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--baseline-penalties` | Comma-separated: left, u-turn, right | `0,0,0` |
| `--high-penalties` | Comma-separated: left, u-turn, right | `0.5,1.0,0.2` |

**Example output:**

```
         Optimization comparison
┏━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━┓
┃ Metric              ┃ Baseline ┃ High Penalty ┃
┡━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━┩
│ Total distance (km) │   1.2029 │       1.2029 │
│ Efficiency (%)      │   100.00 │       100.00 │
│ Traversals          │       24 │           24 │
│ Deadhead (km)       │   0.0000 │       0.0000 │
└─────────────────────┴──────────┴──────────────┘
```

---

#### `clean` — Clean and validate GeoJSON

Removes self-loops, duplicate edges, and short segments from a road network GeoJSON.

```bash
# Print stats only
python cli.py clean my-roads.geojson

# Write cleaned output to file
python cli.py clean my-roads.geojson -o cleaned.geojson
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--output, -o` | Write cleaned GeoJSON to file | Print stats only |

**Cleaning operations applied:**
- Remove self-loops (edges that start and end at the same node)
- Deduplicate edges (same start/end pair)
- Filter segments shorter than 1 meter

---

#### `solve-vrp-test` — Smoke test OR-Tools

Verifies that Google OR-Tools is installed and functional by solving a trivial 3-node VRP.

```bash
python cli.py solve-vrp-test
```

**Output:** `solve-vrp-test passed: OR-Tools VRP solved a trivial problem.`

Use this to quickly verify your Python environment has OR-Tools working before running full VRP solves.

---

#### `stress-partition` — Benchmark global vs. partitioned optimization

Compares solving the entire road network as one graph (global) against splitting it into zones first (partitioned). Useful for determining when zone partitioning provides a speedup.

```bash
# Basic stress test
python cli.py stress-partition my-roads.geojson

# Custom settings
python cli.py stress-partition large-city.geojson --timeout 60 --zones 8
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--timeout, -t` | Abort global solve after N seconds | `30` |
| `--zones, -k` | Number of zones for partitioned solve | `4` |

**Output includes:**
- **Benchmark A:** Global solve — time, distance, efficiency, deadhead
- **Benchmark B:** Partitioned solve — same metrics summed across zones
- **Boundary analysis:** Deadhead delta between approaches
- **Verdict:** Speed gain factor, efficiency loss, and recommendation

---

## Common Workflows

### Quick test: generate data and optimize

```bash
cd backend

# 1. Generate a test grid
python cli.py generate grid.json --rows 6 --cols 6

# 2. Clean it
python cli.py clean grid.json -o grid-clean.json

# 3. Compare optimization strategies
python cli.py compare grid-clean.json

# 4. Stress test partitioning
python cli.py stress-partition grid-clean.json --zones 4
```

### Extract roads and optimize

```bash
# 1. Start the extract server
node extract/cli.js serve &

# 2. Connect via WebSocket (or use the web UI) to draw a polygon
#    and extract roads — result saved as /geojson/:hash

# 3. Download the extract
curl http://localhost:9000/geojson/<hash> -o my-area.geojson

# 4. Process through extract CLI
node extract/cli.js process my-area.geojson -o roads.geojson

# 5. Clean and optimize
cd backend
python cli.py clean ../roads.geojson -o roads-clean.json
python cli.py compare roads-clean.json
```

### Validate before Overture release upgrade

```bash
# Check schema columns exist in the new release
node extract/check_schema.js 2026-04-01.0

# Check source attribution
node extract/cli.js sources

# If both pass, update OVERTURE_RELEASE in extract/server.js
```

---

## Docker

Both services are available as Docker containers. See the root `docker-compose.yml` and `docker-compose.optimizer.yml`.

```bash
# Extract service only (default stack)
docker compose up extract

# Full stack with Python optimizer
docker compose -f docker-compose.yml -f docker-compose.optimizer.yml \
  --profile optimizer up

# Backend CLI inside container
docker compose exec optimizer python cli.py generate /tmp/test.json
docker compose exec optimizer python cli.py solve-vrp-test
```

| Service | Port | Description |
|---------|------|-------------|
| `extract` | 4000 | Overture extraction (WebSocket + HTTP) |
| `backend` | 3000 | Node.js API server (proxies to extract + optimizer) |
| `optimizer` | 8000 (via nginx) | Python FastAPI optimizer |
| `redis` | internal | Celery broker + result backend |
| `celery-worker` | internal | Async task execution (OR-Tools) |
