# RouteMaster Pro — Missing Features: Follow-Up Prompt for Gemini App Builder

> This is a follow-up to the original master prompt. The first build implemented a solid foundation but is missing several critical features from the specification. This document lists exactly what was missed, why each piece matters, and how to implement it within the existing codebase.

---

## What Was Built Successfully

The current build has these features working — do not rebuild or break them:

- Offline-first SQLite database (via Express backend simulating device storage) with routes, stops, waste points, and zones.
- TSP solver using nearest-neighbor heuristic + 2-opt local search.
- Balanced k-means zone partitioning.
- MapLibre GL map engine with PMTiles infrastructure ready.
- Mobile-first UI with large, high-contrast touch targets.
- Navigation mode with GPS tracking, segment highlighting, turn-by-turn context, and one-tap stop collection.
- CSV, GeoJSON, and GPX import with auto-detection of coordinate columns.
- Export of routes and collection logs as GeoJSON, GPX, or CSV.
- Offline pipeline download manager for regional map data and road networks.
- Sample Montreal data with waste points and an optimized "Morning Run" route.
- Tech stack: React 19, Tailwind CSS, MapLibre GL, Motion, Lucide Icons, Express.js, SQLite3, Multer, Turf.js.

---

## What Is Missing

### Missing Feature 1: Chinese Postman Problem (CPP) Solver

**This is the single most important missing feature.** The CPP solver is the core algorithm that differentiates this app from a basic TSP route planner. Without it, the app cannot solve the primary use case: drive every street in a zone with minimum wasted distance.

**Why it matters:** The TSP solver visits discrete stops. The CPP solver covers every street. Curbside residential waste collection — the app's primary use case — requires driving down every street, not visiting specific addresses. These are fundamentally different problems with different algorithms.

**What to build:**

The CPP solver takes a road network (GeoJSON LineString features) and returns the shortest closed walk that traverses every edge at least once.

**Step 1 — Graph construction:**
- Input: array of GeoJSON LineString/MultiLineString features with properties `class` (road type) and `oneway` (boolean).
- Build a graph: each unique coordinate pair is a node (round lat/lon to 6 decimal places to merge nearby intersections). Each LineString segment is an edge with weight = its length in meters (compute with Turf.js `length()`).
- Filter out non-vehicle road classes: remove any edge with class in [footway, path, cycleway, steps, pedestrian, track, bridleway, rail, subway, tram].
- For one-way streets: create a single directed edge. For two-way streets: create an undirected edge (or two directed edges, one per direction).

**Step 2 — Service both sides (optional, configurable):**
- If the user enables "service both sides" (for curbside collection where both curbs need a pass), convert every undirected edge into two directed edges (forward and reverse). This forces the solver to traverse each street in both directions.
- Default: off.

**Step 3 — Find odd-degree nodes:**
- In an undirected graph: find all nodes with an odd number of edges (odd degree). An Eulerian circuit exists only if all nodes have even degree.
- In a directed graph: find all nodes where in-degree ≠ out-degree (unbalanced nodes).

**Step 4 — Minimum-weight matching:**
- Compute shortest paths between all pairs of odd-degree nodes (use Dijkstra's algorithm on the graph).
- Find the minimum-weight perfect matching — pair up the odd nodes so that the total shortest-path distance between paired nodes is minimized.
- For small inputs (fewer than 200 odd nodes): use the Blossom algorithm for an exact solution.
- For larger inputs: use a greedy nearest-neighbor matching — repeatedly pair the two closest unpaired odd nodes. This is approximate but fast.

**Step 5 — Augment and solve:**
- Add the matching edges to the graph (these represent the deadhead segments — streets that must be driven twice).
- The augmented graph now has all even-degree nodes, so an Eulerian circuit exists.
- Extract the Eulerian circuit using Hierholzer's algorithm: start at any node, follow edges (removing them as traversed), and when stuck, backtrack to a node with remaining edges.

**Step 6 — Handle disconnected graphs:**
- If the road network has multiple disconnected components (common when filtering to a small zone), solve each component independently.
- Connect the components by ordering them: start with the component nearest to the user's specified start point, then add the nearest unvisited component.
- The connection between components is deadhead (non-collection driving).

**Step 7 — Output:**
- Ordered list of coordinates forming the complete route (the Eulerian circuit flattened to a coordinate sequence).
- Turn-by-turn instructions: at each node, compute the bearing change from the incoming edge to the outgoing edge. Classify as straight (< 30°), right turn (30°–149°), U-turn (150°–210°), or left turn (211°–330°). Generate text: "Turn left onto {street name}" or "Continue straight on {street name}".
- Stats: total distance (meters), deadhead distance (meters), efficiency percentage (1 - deadhead/total), turn counts by type.

**Performance budget:** Must complete within 10 seconds for up to 5,000 edges. For larger inputs, show a warning and suggest the user filter to a smaller zone.

**Error handling:**
- No edges in input → show "No road segments found. Import a road network file or download region data."
- Solver timeout (> 10 seconds) → return the best partial solution with a warning.
- Memory exhaustion → catch the error and suggest reducing the input area.

**UI integration:**
- In the Route Detail / Solve Flow, the **Optimize** button currently only offers TSP/VRP. Add **CPP (Street Coverage)** as a third option in the solver picker.
- When CPP is selected, the user must either: (a) have a road network GeoJSON loaded for the current region, or (b) import a GeoJSON file with LineString features. If neither exists, show "No road data available — import a GeoJSON road network file or download region data."
- CPP results display the same way as TSP results: route polyline on map, stats in bottom sheet, Accept/Re-solve/Discard actions.
- Add a "Service Both Sides" toggle in the solver options when CPP is selected.

---

### Missing Feature 2: Turn Penalty Weighting for CPP

**What it is:** A cost modifier applied to the CPP solver that makes certain turn types more expensive, producing routes with fewer difficult maneuvers.

**Why it matters:** In waste collection, left turns are dangerous (cross oncoming traffic), U-turns are slow and sometimes illegal, and straight-through is ideal. Without turn penalties, the solver may produce theoretically shortest routes that are impractical to drive.

**How to implement:**

When building the CPP graph (Step 1 above), compute the compass bearing of each edge using Turf.js `bearing()`. At each intersection node, for every pair of (incoming edge, outgoing edge), compute the turn angle and assign a transition cost multiplier:

- Straight (angle < 30° or > 330°): 1.0x (no penalty)
- Right turn (30°–149°): 1.2x
- U-turn (150°–210°): 3.0x
- Left turn (211°–330°): 1.4x

These multipliers are applied during the shortest-path computation in Step 4 (minimum-weight matching). When computing Dijkstra shortest paths between odd nodes, the edge cost at each transition includes the turn penalty.

**UI integration:** Add a "Turn Penalties" toggle in Solver Preferences (Settings tab). When enabled, show the four multiplier values as editable fields so users can tune them for their local regulations.

---

### Missing Feature 3: Fuel-Aware Elevation Weighting for CPP

**What it is:** When elevation data (GeoTIFF) is available for the region, adjust edge weights in the CPP graph so uphill segments cost more (more fuel) and downhill segments cost less.

**Why it matters:** In hilly cities, two routes with the same total flat distance can have very different fuel costs. A route that goes uphill loaded and downhill empty is cheaper than the reverse.

**How to implement:**

- During graph construction, for each edge, sample the elevation at both endpoints from the on-device GeoTIFF file (using geotiff.js or a pre-processed elevation grid).
- Compute grade percentage: `(elevation_end - elevation_start) / edge_length * 100`.
- Apply a fuel multiplier to the edge weight:
  - Steep uphill (grade > 8%): 2.0x
  - Moderate uphill (4–8%): 1.5x
  - Slight uphill (1–4%): 1.2x
  - Flat (-1% to 1%): 1.0x
  - Slight downhill (-4% to -1%): 0.9x
  - Moderate downhill (-8% to -4%): 0.8x
  - Steep downhill (< -8%): 0.7x
- Clamp all multipliers to the range [0.7, 2.0].

**UI integration:** The "Fuel-Aware Routing" toggle already exists in Solver Preferences. It should only be enabled when the current region has elevation data downloaded. When enabled, the CPP and TSP solvers apply elevation weights. When disabled, all edges use flat-distance weights.

---

### Missing Feature 4: VRP Multi-Vehicle Solver

**What is built:** TSP (single vehicle) is implemented.

**What is missing:** VRP with multiple vehicles and capacity constraints.

**How to implement:**

The VRP solver divides stops among multiple vehicles, each with an optional capacity limit.

**Step 1 — Input:**
- All TSP inputs, plus: number of vehicles, capacity per vehicle (optional), demand per stop (optional, defaults to 1).

**Step 2 — Initial assignment (Clarke-Wright savings algorithm):**
1. Start with each stop as its own single-stop route served by its own vehicle.
2. For every pair of stops (i, j), compute the "savings" of merging their routes: `savings(i,j) = distance(depot,i) + distance(depot,j) - distance(i,j)`.
3. Sort all savings in descending order.
4. Iterate through the savings list. For each pair (i, j), merge their routes if: (a) i and j are in different routes, (b) i is the first or last stop in its route and j is the first or last stop in its route, (c) the merged route does not exceed vehicle capacity.
5. Continue until no more merges are possible or the number of routes equals the target vehicle count.

**Step 3 — Optimize each vehicle's route:**
- Apply 2-opt local search to each vehicle's sub-route independently (same as current TSP 2-opt).

**Step 4 — Balance workload (optional):**
- If the user selects "balance workload" objective: compute the total distance of each vehicle's route. Move border stops from the longest route to the shortest route if it reduces the max-min gap. Re-optimize affected routes with 2-opt.

**Step 5 — Output:**
- Per-vehicle: ordered stop list, total distance, estimated duration.
- Unassigned stops (if total demand exceeds total capacity across all vehicles).
- Overall: total distance, total time, vehicle count, balance metric (coefficient of variation of route distances).

**UI integration:**
- When the user selects TSP/VRP in the solver picker, add a "Number of Vehicles" input. If set to 1, run TSP. If > 1, run VRP.
- Add an optional "Vehicle Capacity" input and "Stop Demand" column in the import data.
- Add an objective picker: "Minimize Total Distance" (default) or "Balance Workload".
- Multi-vehicle results display as separate colored polylines on the map, one color per vehicle. The stats bottom sheet shows per-vehicle breakdowns.

---

### Missing Feature 5: CVRP JSON Import Format

**What is built:** CSV, GeoJSON, and GPX import.

**What is missing:** Structured JSON import for Capacitated Vehicle Routing Problem (CVRP) instances.

**Expected JSON format:**

```json
{
  "depot": { "lat": 45.5017, "lon": -73.5673, "address": "Transfer Station" },
  "stops": [
    { "id": "s1", "lat": 45.5087, "lon": -73.5540, "demand": 2, "address": "123 Main St" },
    { "id": "s2", "lat": 45.5120, "lon": -73.5610, "demand": 1, "address": "456 Oak Ave" }
  ],
  "vehicles": [
    { "id": "v1", "capacity": 20 },
    { "id": "v2", "capacity": 20 }
  ]
}
```

**How to implement:**
- In the import parser, detect JSON files. Check for the presence of `depot` and `stops` keys.
- Map `depot` to the route's depot lat/lon.
- Map each entry in `stops` to a route stop with the given coordinates, demand, and address.
- Map `vehicles` to VRP solver configuration (vehicle count and capacities).
- If `vehicles` is absent, treat as TSP (single vehicle, no capacity).

---

### Missing Feature 6: KML Export

**What is built:** GeoJSON, GPX, and CSV export.

**What is missing:** KML export for routes and zones.

**How to implement:**

KML is an XML format used by Google Earth. Generate it by building XML strings:

**Route KML:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>{route_name}</name>
    <Placemark>
      <name>Route Path</name>
      <LineString>
        <coordinates>{lon1},{lat1},0 {lon2},{lat2},0 ...</coordinates>
      </LineString>
    </Placemark>
    <!-- One Placemark per stop -->
    <Placemark>
      <name>{stop_address}</name>
      <Point><coordinates>{lon},{lat},0</coordinates></Point>
    </Placemark>
  </Document>
</kml>
```

**Zone KML:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>{partition_name}</name>
    <!-- One Placemark per zone -->
    <Placemark>
      <name>{zone_name}</name>
      <Style><PolyStyle><color>{kml_color}</color></PolyStyle></Style>
      <Polygon>
        <outerBoundaryIs><LinearRing>
          <coordinates>{lon1},{lat1},0 {lon2},{lat2},0 ...</coordinates>
        </LinearRing></outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>
```

Note: KML colors use `aaBBGGRR` format (alpha, blue, green, red) — not hex RGB.

---

### Missing Feature 7: Saved Solutions Table

**What is built:** Routes and zones are persisted.

**What is missing:** A dedicated Saved Solutions table for storing and recalling solver results with their configuration.

**Why it matters:** Users need to compare different solver runs — "What if I use 3 trucks instead of 4?" or "How does the CPP solution differ with turn penalties enabled?" Without saved solutions, each new solve overwrites the previous result.

**Schema (add to SQLite):**

```sql
CREATE TABLE IF NOT EXISTS saved_solutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id TEXT,
  solver_type TEXT NOT NULL, -- 'cpp', 'vrp', 'tsp'
  solver_config TEXT NOT NULL, -- JSON: parameters used
  result_data TEXT NOT NULL, -- JSON: ordered points, stats, metrics
  truck_count INTEGER,
  balance_metric REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (zone_id) REFERENCES zones(id)
);
```

**UI integration:**
- After a solve completes and the user taps "Accept," prompt for a solution name. Save to `saved_solutions` with the full solver configuration and result.
- In the Routes tab or a new "Solutions" sub-tab, list saved solutions. Tap to reload onto the map. Allow side-by-side stat comparison of two solutions.
- In the Zones tab, when viewing a zone, show its associated saved solutions.

---

### Missing Feature 8: Import History

**What is built:** File import works.

**What is missing:** A record of past imports.

**How to implement:**

Add a table:

```sql
CREATE TABLE IF NOT EXISTS import_history (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL, -- 'csv', 'geojson', 'gpx', 'json'
  point_count INTEGER NOT NULL,
  warning_count INTEGER DEFAULT 0,
  skipped_count INTEGER DEFAULT 0,
  imported_at TEXT NOT NULL
);
```

After each successful import, insert a row. Display in the Data tab under an "Import History" sub-tab: file name, type, point count, warnings, date. Tapping a history row highlights those points on the map.

---

### Missing Feature 9: Off-Route Deviation Indicator in Navigation

**What is built:** Navigation mode with segment highlighting and progress tracking.

**What is missing:** Visual feedback when the vehicle deviates from the planned route.

**How to implement:**

During navigation, on each GPS position update:
1. Compute the distance from the current position to the nearest point on the active route polyline (use Turf.js `nearestPointOnLine()`).
2. If the distance exceeds 50 meters (configurable in navigation preferences as "off-route threshold"):
   - Show a red banner at the top: "Off route — {distance}m from planned path."
   - Draw a dashed line from the current position to the nearest route point.
   - Show the bearing/direction back to the route: "Head northeast to rejoin route."
3. When the vehicle comes back within 50 meters of the route, dismiss the banner and resume normal navigation.

Do not attempt rerouting — there is no routing engine. Simply indicate the deviation.

---

### Missing Feature 10: Route Resume After Partial Completion

**What is built:** Navigation saves completion state.

**What is missing:** Ability to resume a partially completed route in a new navigation session.

**How to implement:**

The route already tracks which stops are `collected` or `skipped` and which segments are covered. When the user opens a route with status `in_progress`:
- Show a "Resume Navigation" button (in addition to "Start Navigation").
- When resumed, skip to the first uncovered segment or uncollected stop. Show the previously completed portion as muted on the map.
- Update the progress bar to reflect the partial completion from the previous session.

---

## Implementation Priority

Add these features in this order:

1. **CPP Solver** (Feature 1) — the core missing algorithm. This is the highest priority.
2. **Turn Penalties** (Feature 2) — makes CPP solutions practical for real-world driving.
3. **VRP Multi-Vehicle** (Feature 4) — extends the existing TSP to fleet use cases.
4. **Saved Solutions** (Feature 7) — enables comparing solver runs.
5. **CVRP JSON Import** (Feature 5) — completes the import format support.
6. **KML Export** (Feature 6) — completes the export format support.
7. **Off-Route Indicator** (Feature 9) — navigation quality improvement.
8. **Route Resume** (Feature 10) — navigation quality improvement.
9. **Import History** (Feature 8) — data management polish.
10. **Fuel-Aware Elevation** (Feature 3) — advanced optimization, depends on elevation data availability.

Do not break any existing functionality while adding these features. Each feature should be additive — new code, new UI elements, new database tables — integrated into the existing architecture.
