# Next-Phase Report & Architectural Roadmap

**Context**: Python routing backend with CVRP (Clarke–Wright + 2-Opt, EUC_2D), CPP (Hierholzer), and tooling (`benchmark.py` → CSV, `visualize.py`). This document covers benchmark KPIs, algorithmic upgrades, and the pipeline to mobile (GPX & Android).

---

## 1. Benchmark Analysis & Reporting Strategy

### Command and output

When you run:

```bash
python benchmark.py --data-dir /home/drone/Desktop/algorithm_testing/A
```

the script writes **`benchmark_results.csv`** in the script directory. The CSV currently has:

| Column         | Description |
|----------------|-------------|
| Instance Name  | Basename of the .vrp file (e.g. A-n32-k5) |
| Optimal Cost   | From .sol file if present; blank otherwise |
| CW Cost        | Clarke–Wright solution cost (EUC_2D integer sum) |
| CW Gap %       | `100 * (CW Cost - Optimal Cost) / Optimal Cost` |
| CW Time        | Seconds for CW only |
| 2-Opt Cost     | Cost after 2-Opt (EUC_2D integer sum) |
| 2-Opt Gap %    | `100 * (2-Opt Cost - Optimal Cost) / Optimal Cost` |
| Total Time     | CW Time + 2-Opt time (seconds) |

**Recommendation**: Add a **Dimension** column (and optionally **Routes count**) so you can segment and interpret results by instance size. In `run_benchmark()`, set e.g. `row["Dimension"] = problem.dimension` and `row["Routes Count"] = len(routes_2opt)`.

---

### Key performance indicators (KPIs)

| KPI | Definition | How to use |
|-----|------------|------------|
| **Optimality gap (%)** | `100 * (algo_cost - optimal_cost) / optimal_cost` using EUC_2D integer costs for both. | Main quality metric. Aim &lt;5% on small instances; monitor how it degrades as dimension grows. |
| **Execution time (s)** | Wall-clock per instance (CW Time, Total Time). | Trade-off vs gap: more time can justify stronger heuristics. |
| **Gap vs dimension** | Gap and time grouped by `dimension` (e.g. 32, 33, 50, 100). | Shows where 2-Opt hits a ceiling (gap flattens or worsens as n increases). |
| **Routes count** | Number of vehicle routes. | Check capacity feasibility; compare to optimal route count when available. |

---

### Detecting the 2-Opt performance ceiling

- **2-Opt ceiling**: If **gap flattens or increases with dimension** while **Total Time** grows (e.g. O(n²) per route), 2-Opt alone has hit its ceiling. Extra CPU on 2-Opt gives diminishing returns.
- **Action**: When gap is &gt;~5–10% on instances with **n &gt; 50**, prioritize **algorithmic upgrades** (Section 2) rather than more 2-Opt iterations.
- **Reporting**: In CSV or dashboards, include `dimension`, `optimal_cost`, `algo_cost_euc2d`, `gap_pct`, `time_s`. Optionally add dimension buckets (e.g. 1–50, 51–100, 101+) and report **median gap** and **p95 time** per bucket.

---

### Interpreting time vs gap for instances &gt; 50 nodes

- **Time**: 2-Opt is O(n²) per route per pass; total time scales with number of routes and nodes. For n &gt; 50, total time can become noticeable (e.g. hundreds of ms to a few seconds per instance).
- **Gap**: On larger instances, 2-Opt often leaves 5–15% gap. If you see:
  - **Gap still falling** as n grows → 2-Opt is still helping; you can consider 3-Opt or metaheuristics for extra gain.
  - **Gap flat or rising** as n grows → 2-Opt ceiling; invest in Tabu Search or other metaheuristics.
- **Trade-off**: Accept slightly higher runtime (e.g. 2–5×) in exchange for 3-Opt or Tabu Search if the goal is to push gap toward 0% on larger datasets.

---

## 2. Algorithmic Improvement Strategies (Backend)

Three concrete upgrades: better local search for CVRP, a metaheuristic for CVRP, and mixed open/closed routing for CPP.

---

### 2.1 3-Opt local search (CVRP)

- **What**: After 2-Opt, apply 3-Opt: remove three edges, recombine the three segments in all valid ways, keep the best improvement. Repeat until no improvement. Apply per route (depot → route → depot).
- **Time complexity**: O(n³) per route per pass vs 2-Opt’s O(n²). Multiple routes multiply cost.
- **Accuracy**: Typically reduces gap by **1–3%** over 2-Opt on medium instances; can close more on structured instances.
- **Trade-off**: Use selectively (e.g. only for routes above a length threshold, or only for instances with n ≤ 100) to avoid prohibitive runtime. Optionally run 3-Opt only on the longest k routes.

---

### 2.2 Tabu Search (CVRP)

- **What**: Metaheuristic with a solution and a **tabu list** (recent moves forbidden for a short tenure). Each iteration: evaluate neighbor moves (e.g. relocate, 2-Opt, swap), choose best non-tabu (or best-so-far if aspiration), update solution and tabu list. Run for a fixed time or iteration limit. Start from Clarke–Wright + 2-Opt.
- **Time complexity**: Per iteration O(n²) or O(n) for neighborhood size; total cost = iterations × neighborhood. Typical runs: 1e3–1e5 iterations.
- **Accuracy**: Can reach **&lt;2%** gap on many instances; with tuning, often **&lt;1%**. Much better than 2-Opt alone for n &gt; 50.
- **Trade-off**: More parameters (tenure, neighborhood, stopping). Use a small default config and an optional “quality” mode that runs longer. Ensure all cost and gap reporting use EUC_2D integer sums.

---

### 2.3 Mixed open/closed routing (CPP / general)

- **What**: Support both **closed** (start = end, classic CPP) and **open** (start ≠ end, or multiple vehicles). Hierholzer stays for the Eulerian part; add:
  - **Open CPP**: Shortest path from start to end that visits all required edges; model deadhead with flow/min-cost matching.
  - **Multi-route**: Partition edges by zone or balance, then solve one CPP per vehicle with open start/end.
- **Time complexity**: Eulerian step remains O(V+E); extra cost in matching/shortest paths (e.g. Dijkstra per component or small matching graph).
- **Accuracy**: Matches the problem definition; correctness is binary. No “optimality gap” in the CVRP sense. Improves applicability to “start at depot, end at home” and multi-driver scenarios.

---

## 3. Pipeline to Mobile Integration (GPX & Android)

### 3.1 GPX generation from route arrays

**Inputs**:

- **CVRP**: Validated route arrays from your benchmark/API — ordered list of customer node IDs per vehicle, plus `problem.coords` and `problem.depot` to resolve (lat, lon). One track per vehicle.
- **CPP**: From `POST /api/optimize` — `OptimizeResponse.route` (list of `RoutePoint`: `latitude`, `longitude`, `node_id`) and/or `route_geojson` (LineString coordinates). Single continuous path.

**Output**: GPX 1.1 (WGS84, decimal degrees).

- **Waypoints** (`<wpt>`): Every stop (CVRP) or key decision points (CPP). Use `<name>` and optional `<cmt>` for turn instructions or segment metadata.
- **Tracks** (`<trk>`): One `<trk>` per CVRP route or one for the full CPP path. Each with `<trkseg>` and a sequence of `<trkpt lat="..." lon="...">`; optionally `<ele>`, `<time>`.

**Implementation**:

- Use a small GPX writer (e.g. **gpxpy**) or a minimal XML builder.
- **CVRP**: One `<trk>` per vehicle; waypoints = depot + stops in order; track = depot → stop₁ → … → stopₖ → depot (one `<trkpt>` per node from coords).
- **CPP**: One `<trk>` for the full path; waypoints = start/end and optional turn points; track = dense path from `route` or `route_geojson` (one point per `RoutePoint` or per coordinate in the LineString).
- Ensure enough point density along edges so mobile maps render smooth paths. If the backend stores graph edges, emit a `<trkpt>` per edge endpoint or interpolate along the edge.

**Validation**: Load generated GPX in QGIS or an Android app and confirm waypoints and track line match the intended route.

---

### 3.2 Native Android handoff (Kotlin, Jetpack Compose)

**Data flow**:

- **Backend**: Expose an API that returns either:
  - **GPX**: `application/gpx+xml` (file download or XML string), or
  - **JSON**: e.g. `{ "routes": [ { "vehicleId": 1, "waypoints": [{ "lat", "lon", "name" }], "track": [[lat, lon], ...] } ] }` with optional metadata (vehicleId, ETA, segment labels).
- Prefer **one endpoint** that returns GPX or JSON via `Accept` (e.g. `Accept: application/gpx+xml` vs `Accept: application/json`).

**Architecture**:

- **Repository**: Single source of truth for “current route(s)” from the backend (GPX or JSON). Expose as `Flow`/`StateFlow` for reactive UI.
- **Compose UI**:
  - **Map**: Use a map composable (Google Maps Compose, Mapbox SDK, or OSM e.g. OsmDroid) to draw polylines from track points and markers for waypoints. On route load, fit bounds to the track.
  - **Turn-by-turn list**: Parse waypoints/segments into steps (e.g. “Turn left onto X”, “Arrive at Y”). Show in a `LazyColumn`; optionally highlight current step from user location.
- **State**: Hold current route, selected route index (if multiple), and current step index. Use ViewModel + StateFlow so map and list stay in sync.

**Libraries**:

- **HTTP**: Retrofit + OkHttp or Ktor Client.
- **Maps**: Google Maps for Android (Compose), Mapbox Maps SDK, or OsmDroid.
- **GPX**: Custom XML pull parser or a light GPX library; avoid heavy GIS stacks unless needed.

**Recommendation**: Prefer **GPX** for compatibility with third-party apps and standard tooling; use **JSON** when the app needs extra metadata (vehicle id, capacity, ETA) that GPX doesn’t carry. Document the API contract (coordinate order lat/lon, units, and any extra fields) so backend and Android stay aligned.

**Suggested API contract**:

- `GET /api/routes/{jobId}` (or `POST` with job id in body):
  - `Accept: application/gpx+xml` → return GPX.
  - `Accept: application/json` → return `{ "routes": [ { "waypoints": [...], "track": [[lat, lon], ...] } ] }`.
- Document: coordinate order (lat, lon), units (degrees for coordinates, meters/km for distances), and optional fields (vehicleId, ETA, segment labels).

---

## Summary checklist

- **Section 1**: KPIs defined (gap %, time, dimension); how to detect 2-Opt ceiling from CSV; how to interpret time vs gap for n &gt; 50. Add `Dimension` (and optionally `Routes Count`) to the benchmark CSV.
- **Section 2**: Three algorithmic upgrades (3-Opt, Tabu Search, mixed open/closed CPP) with brief complexity vs accuracy for each.
- **Section 3**: GPX structure (waypoints + tracks) from CVRP/CPP outputs; Android stack (Kotlin, Compose, repository, map + turn-by-turn list); backend handoff via GPX and/or JSON with a clear API contract.
