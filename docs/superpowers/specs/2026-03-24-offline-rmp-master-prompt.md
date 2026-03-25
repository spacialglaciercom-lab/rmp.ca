# RouteMaster Pro — Fully Offline Rebuild: Master Prompt for Gemini App Builder

> This document is a complete natural-language specification for rebuilding the RouteMaster Pro (rmp.ca) collection route optimization app as a 100% offline application. Hand this entire document to Gemini App Builder as the prompt. Each section builds on the previous one.

---

## Section 1: App Identity & Purpose

Build an app called **RouteMaster Pro** — an offline-first collection route optimization tool.

**Who it's for:** Municipal waste collection crews, recycling haulers, and any fleet that needs to drive every street in a zone or visit every stop efficiently.

**Core problem:** Given a set of streets or stops in a geographic area, compute the most efficient driving route that covers them all — minimizing deadheading (driving the same street without collecting), fuel consumption, and total time.

**The offline premise:** The app downloads a region's map data, road network, and optional elevation data once while the user has internet access. After that initial download, everything — map display, route solving, navigation, data import/export — works with zero network connectivity. The user can work in areas with no cell service, in truck cabs, or in rural regions indefinitely.

**Key constraint:** No server, no cloud database, no external API calls during normal operation. All computation, storage, and rendering happens on-device. The only network activity is the initial region data download and optional data updates.

**Relationship to the existing system:** This is a **standalone, clean-room rebuild**. The existing RouteMaster Pro uses PostgreSQL/PostGIS, a Python FastAPI backend with OR-Tools and Celery, tRPC client-server communication, and Firebase. None of that carries over. This offline app has its own SQLite schema, its own on-device solvers, and no sync protocol with any server. It is a self-contained product that shares the domain logic and algorithms of the original but is architecturally independent.

**Minimum platform requirements:** The app must support SQLite for local storage, local filesystem access for storing map and road data files, GPS for navigation and location, a camera for optional QR scanning, and a GPU-capable map renderer (MapLibre GL). Target mobile (Android and iOS) as the primary platform. Web/PWA is acceptable as a secondary target if the builder supports it.

---

## Section 2: Domain Concepts

These are the core objects and algorithms the app works with. Understand these before building anything.

### Stop / Waste Point

A geographic point (latitude, longitude) representing a collection location — a bin, a dumpster, a curbside address. Each stop has metadata:

- **Type:** residential bin, commercial dumpster, recycling container.
- **Capacity:** size or volume rating.
- **Condition:** good, damaged, missing.
- **Address:** street address text.
- **Bin number:** identifier printed on the physical container.

### Route

An ordered sequence of stops or street segments that a truck follows. A route has computed stats:

- Total distance (meters).
- Estimated duration (seconds).
- Number of stops.
- Efficiency percentage (productive distance / total distance).

A route has a **source** indicating how it was created: manually, imported from a file, or computed by a solver (CPP, VRP, TSP).

### Depot

The start and end point for a vehicle — typically a yard or transfer station. Every solved route begins and ends at the depot.

### Zone

A geographic polygon that groups stops or streets into a logical collection area. A city might be divided into 5 zones, one per weekday. Each zone has:

- A name.
- A color (for map display).
- A boundary polygon.

### Chinese Postman Problem (CPP)

The street-coverage algorithm. Given a road network represented as a graph of street segments, find the shortest closed walk that traverses every edge at least once. This is the core algorithm for "drive every street" curbside waste collection. The solution is an Eulerian circuit with minimal added deadhead distance.

### Vehicle Routing Problem (VRP) / Travelling Salesman Problem (TSP)

The stop-visiting algorithm. Given a set of discrete stops and a depot, find the shortest route that visits every stop exactly once and returns to the depot. TSP is the single-vehicle case. VRP extends it to multiple vehicles, each with a capacity constraint. Used when collection is stop-by-stop (dumpsters at specific addresses) rather than street-by-street (curbside).

### Zone Partitioning

Dividing a large area's stops into balanced zones — each zone gets roughly equal work measured by distance, stop count, or estimated time. Uses spatial clustering algorithms. The output is a set of zone polygons with assigned stops and a balance metric showing how evenly work is distributed.

### Deadheading

Driving a street segment without performing collection — the inefficiency that CPP minimizes. The ratio of productive distance to total distance is the route's efficiency percentage.

### Road Network Graph

Streets represented as edges and intersections as nodes. Derived from OpenStreetMap or Overture Maps data. The graph respects one-way streets, filters out non-vehicle road classes (footpaths, cycleways, railways), and optionally incorporates elevation grade for fuel-aware edge weighting.

---

## Section 3: Data Architecture

All data lives in a local SQLite database on the device. There is no server database.

### Routes Table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| name | TEXT | User-assigned route name |
| status | TEXT | draft, optimized, in_progress, completed |
| route_source | TEXT | manual, imported, cpp, vrp, tsp |
| depot_lat | REAL | Depot latitude |
| depot_lon | REAL | Depot longitude |
| total_distance_m | REAL | Total route distance in meters |
| estimated_duration_s | REAL | Estimated duration in seconds |
| stop_count | INTEGER | Number of stops in the route |
| efficiency_percent | REAL | Productive distance / total distance |
| created_at | TEXT (ISO 8601) | Creation timestamp |
| updated_at | TEXT (ISO 8601) | Last modification timestamp |

### Route Stops Table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| route_id | TEXT (UUID) | Foreign key to routes |
| sequence_number | INTEGER | Order in the route |
| lat | REAL | Latitude |
| lon | REAL | Longitude |
| address | TEXT | Street address |
| type | TEXT | waypoint, collection, depot |
| waste_point_id | TEXT (UUID) | Optional FK to waste_points |
| collected | INTEGER (boolean) | Whether collection was completed |
| skipped | INTEGER (boolean) | Whether stop was skipped |
| collection_timestamp | TEXT (ISO 8601) | When collection occurred |
| notes | TEXT | Driver notes |

### Waste Points Table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| lat | REAL | Latitude |
| lon | REAL | Longitude |
| type | TEXT | residential_bin, commercial_dumpster, recycling_container |
| capacity | TEXT | Size/volume rating |
| condition | TEXT | good, damaged, missing |
| address | TEXT | Street address |
| bin_number | TEXT | Physical container identifier |
| zone_id | TEXT (UUID) | Optional FK to zones |
| created_at | TEXT (ISO 8601) | Creation timestamp |

### Zones Table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| name | TEXT | Zone name |
| color | TEXT | Hex color code |
| boundary | TEXT | GeoJSON Polygon geometry as JSON string |
| stop_count | INTEGER | Number of stops in the zone |
| created_at | TEXT (ISO 8601) | Creation timestamp |

### Saved Solutions Table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| name | TEXT | User-assigned name |
| zone_id | TEXT (UUID) | Optional FK to zones |
| solver_type | TEXT | cpp, vrp, tsp |
| solver_config | TEXT | JSON — parameters used for the solve |
| result_data | TEXT | JSON — ordered points, stats, metrics |
| truck_count | INTEGER | Number of vehicles in solution |
| balance_metric | REAL | Workload balance score |
| created_at | TEXT (ISO 8601) | Creation timestamp |

### Offline Regions Table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key |
| region_name | TEXT | City or custom region name |
| bounds | TEXT | JSON bounding box [south, west, north, east] |
| download_date | TEXT (ISO 8601) | When data was downloaded |
| data_version | TEXT | Overture release or PMTiles version |
| tile_file_path | TEXT | Path to PMTiles file on device |
| road_network_file_path | TEXT | Path to GeoJSON road network file |
| elevation_file_path | TEXT | Optional path to GeoTIFF elevation data |
| size_bytes | INTEGER | Total storage used |
| status | TEXT | downloading, ready, stale |

### File Formats

**Import formats supported:** CSV/TSV (flexible column detection for lat/lon/address/type), GeoJSON (FeatureCollection of Points or LineStrings), GPX (waypoints and tracks), JSON (CVRP-style with depot, stops, and vehicle definitions).

**Export formats supported:** GeoJSON, GPX, KML, CSV, JSON.

### On-Device File Storage

- **Map tiles:** PMTiles files on the device filesystem. One file per region containing vector road tiles. Queried directly by the map renderer with no tile server.
- **Road network:** GeoJSON file per region containing street segments with properties (road class, one-way flag, name). Loaded into memory and converted to a graph when the solver runs.
- **Elevation data (optional):** GeoTIFF raster tiles on the device filesystem. Sampled during route solving to compute grade percentages for fuel-aware edge weighting.

---

## Section 4: Offline Data Pipeline

The app follows a "download then offline" model: the user downloads a region's data once while they have internet, then works fully offline forever after.

### Region Selection

The user picks a city from a predefined list or draws a custom bounding box on the map. The app shows the estimated download size and what data types will be fetched. The predefined list is loaded from a JSON config file. Seed it with these cities and their bounding boxes (south, west, north, east):

- Montreal: [45.40, -73.98, 45.70, -73.47]
- Toronto: [43.58, -79.64, 43.86, -79.12]
- Vancouver: [49.15, -123.27, 49.35, -123.02]
- Ottawa: [45.25, -75.90, 45.50, -75.55]
- Calgary: [50.88, -114.27, 51.18, -113.90]
- Quebec City: [46.73, -71.38, 46.90, -71.15]
- Edmonton: [53.42, -113.72, 53.65, -113.32]
- Winnipeg: [49.75, -97.35, 49.98, -97.05]

Additional cities can be added to the config file without code changes.

### Map Tiles Download

Fetch a PMTiles file for the selected region. These files are pre-built per city from Overture Maps GeoParquet data using tippecanoe, containing the `transportation` layer (road segments and connectors). They are hosted on a Cloudflare R2 bucket at a public URL (e.g., `https://pub-914a188759fd40078f51e48f31a76dba.r2.dev/tiles/{city}-{version}.pmtiles`). The tile schema contains a single layer named `transportation` with properties: `type`, `class`, `subclass`, `name`. Store the file on the device filesystem. Support resumable downloads — if interrupted, pick up where it left off.

### Road Network Download

Fetch Overture transportation data (road segments and connectors) as GeoJSON for the region's bounding box from public cloud storage. Filter to drivable road classes only — drop footpaths, cycleways, railways, and pedestrian ways. This file becomes the graph that the CPP and VRP solvers operate on.

Alternatively, fetch OpenStreetMap data via the Overpass API as an XML file for the bounding box, then extract road segments locally.

### Elevation Data (Optional)

Fetch ASTER GDEM GeoTIFF tiles from NASA Earthdata for the region. Each tile covers 1° x 1° and is approximately 25 MB. A typical city may span 4–9 tiles (100–225 MB total). This requires a free NASA Earthdata account — the user must provide their Earthdata credentials in the app settings before downloading elevation data. To read GeoTIFF files on-device, use a lightweight raster library (e.g., `geotiff.js` for web/JS targets, or pre-process the GeoTIFF into a simpler binary elevation grid during download). This step is entirely optional — all solvers work without it, they just use flat-earth Haversine distance instead of grade-adjusted cost.

### Raster Basemap Tiles (Optional)

Download OpenStreetMap raster tile images for the region at zoom levels 12 through 15 using a tile-caching mechanism. For a mid-size city, this is roughly 5,000–8,000 tiles at ~20 KB each (100–160 MB). Higher zoom levels (16+) are optional and significantly increase storage. These tiles provide the visual basemap (land, water, buildings, labels) underneath the vector road overlay. Note: the vector road tiles from PMTiles may be sufficient for many use cases — the raster basemap is a cosmetic enhancement, not a requirement.

### Download Manager

Track download progress for each data type independently. Store download state so it can resume after app restart or connectivity loss. Mark a region as "ready" only when all required data (map tiles and road network at minimum) is complete. Show per-region status: downloading, ready, stale (outdated version), incomplete.

### Data Versioning

Each downloaded region records the data version (Overture release date, PMTiles version, elevation dataset identifier). When the user is online, the app can check if newer data exists and offer an update. Updates are never required — the existing data continues to work.

### Storage Cleanup

Users can delete downloaded regions to reclaim device storage. Show storage used per region. Allow selective deletion — for example, delete elevation data but keep map tiles and road network.

---

## Section 5: Feature Modules

### 5A. Data Import

Accept files from device storage in these formats: CSV, TSV, GeoJSON, GPX, JSON.

**CSV/TSV parsing:** Auto-detect the delimiter (comma, tab, semicolon). Match column headers flexibly — recognize lat/latitude/y, lon/longitude/lng/x, combined coordinate columns (e.g. "coords" containing "lat,lon"), address, type, capacity, condition, bin_number. Handle quoted fields correctly. Skip malformed rows and collect warnings.

**GeoJSON parsing:** Extract Point features as stops with their properties mapped to waste point metadata. Extract LineString and MultiLineString features as road segments for CPP input.

**GPX parsing:** Extract waypoints as stops/waste points with their name and description mapped to address and notes. Extract tracks as route paths — track points define the route's ordered coordinate sequence, not individual waste points. Parse name and description from waypoint metadata.

**JSON (CVRP) parsing:** Recognize structured input containing a depot object, a stops array, and optional vehicle definitions with capacities. Map directly to the route and stops data model.

**Validation:** Reject any point with latitude outside -90 to 90 or longitude outside -180 to 180. Warn on duplicate coordinates. After import, show a summary: N points imported, M warnings, K rows skipped with reasons.

**Output:** An array of normalized import points ready for display on the map, persistence to the SQLite database, or feeding into a solver.

### 5B. Map Display & Interaction

Use **MapLibre GL** as the map engine — an open-source renderer that runs on web and native platforms using GPU-accelerated WebGL/OpenGL. No Mapbox token or cloud dependency needed. MapLibre reads vector tiles directly from local PMTiles files using a custom protocol handler (e.g., `pmtiles://local-{regionId}/`). No network tile requests occur during map use.

**Basemap layer:** OpenStreetMap raster tiles from the cached offline pack, providing land, water, buildings, and labels.

**Road overlay layer:** Overture transportation vector data from the PMTiles file, styled by road class:
- Highways and motorways: thick lines, muted color (rarely used for collection).
- Primary and secondary roads: medium lines, neutral color.
- Residential, tertiary, and unclassified roads: standard lines, slightly emphasized — these are the main collection streets.
- Service roads and alleys: thin lines, subtle color.
- Road name labels at appropriate zoom levels.

**Data layers drawn on top of roads:**
- **Stops and waste points:** Circle markers or icons, color-coded by type. Blue for residential, orange for commercial, green for recycling. Tappable — shows detail popup.
- **Depot:** Distinct marker (flag or warehouse icon), larger than stop markers.
- **Solved route:** Thick colored polyline in solution order with directional arrows showing travel direction. Multi-vehicle solutions use a different color per vehicle.
- **Zones:** Semi-transparent filled polygons with colored borders. Zone name label at centroid. Each zone uses a distinct hue.
- **Navigation active segment:** Current segment highlighted brighter and thicker. Completed segments shown muted. Upcoming segments in original color.

**Interactions:**
- Pan and pinch-zoom with standard touch gestures.
- Tap a stop marker to show a detail card (address, type, collection status).
- Long-press on the map to add a manual stop at that location.
- Tap a zone polygon to show zone stats or enter zone routing mode.
- Layer toggle to show/hide road overlay, stops, zones, or route.

**Performance:** Vector tile rendering handles large regions efficiently. The road network graph used by solvers is a separate GeoJSON file loaded into memory only during solving, not during map browsing.

### 5C. Chinese Postman Problem (CPP) Solver

The core street-coverage algorithm, running entirely on-device.

**Input:** A set of GeoJSON road segments — either from an imported file or from the downloaded road network filtered to a specific zone or bounding box.

**Graph construction:** Build a graph where intersections are nodes and street segments are edges. Round coordinates to a fixed precision to merge nearby intersections. Filter out non-vehicle road classes (footpaths, cycleways, railways). For one-way streets, create directed edges.

**Optional fuel-aware weighting:** If elevation data is available on-device, sample elevation at each endpoint of every segment. Compute the grade percentage (rise over run). Apply a fuel multiplier to the edge weight — uphill segments cost more, downhill segments cost less. Clamp multipliers to reasonable bounds (e.g., 0.7x to 2.0x).

**Optional turn penalty weighting:** Compute the compass bearing of each edge. At intersection nodes, calculate the turn angle between connected edges. Classify turns by angle threshold and apply cost multipliers:
- Straight (angle < 30° or > 330°): 1.0x
- Right turn (30°–149°): 1.2x
- U-turn (150°–210°): 3.0x
- Left turn (211°–330°): 1.4x (crosses oncoming traffic)

These multipliers are configurable in solver preferences.

**Service both sides:** A solver option, defaulting to off. When enabled, it applies to all non-one-way streets in the input — each undirected edge is duplicated as two directed edges (one per direction) so the solver forces the route to cover both curbs. Typical use: curbside residential waste collection where the truck must pass each side of the street.

**Solving algorithm:**
1. Identify odd-degree nodes (in undirected mode) or unbalanced nodes (in directed mode).
2. Compute shortest paths between all pairs of odd-degree nodes.
3. Find the minimum-weight perfect matching to pair them. For small inputs (< 200 odd nodes), use the exact Blossom algorithm. For larger inputs, use a greedy nearest-neighbor matching as an approximation — this trades optimality for speed.
4. Augment the graph with the matching edges (these are the deadhead segments).
5. Extract the Eulerian circuit from the augmented graph.
6. If the graph is disconnected, solve each connected component separately and concatenate them. Start with the component nearest the user's specified start point.

**Performance budgets:** The solver should complete within 10 seconds on-device for typical inputs. Maximum supported input size: 5,000 edges (street segments). For inputs exceeding this, warn the user and suggest filtering to a smaller zone. WASM-compiled libraries (e.g., a C++ matching implementation compiled to WebAssembly) are acceptable for performance-critical graph algorithms.

**Output:**
- Ordered list of coordinates forming the complete route.
- Turn-by-turn instructions: simple direction text like "Turn left onto Main St", "Continue straight on Oak Ave".
- Stats: total distance, deadhead distance, efficiency percentage, number of turns by type (left, right, U-turn).

**Error handling:** If the graph has no edges, show "No road segments found — import road data or select a region with downloaded roads." If the solver exceeds the 10-second timeout, return the best partial solution found so far with a warning. If memory is exhausted on very large inputs, catch the error and suggest reducing the input area.

### 5D. VRP / TSP Solver

For stop-by-stop collection such as dumpsters at specific addresses.

**Input:** Array of stops with lat/lon, depot location, number of vehicles (1 for TSP), optional vehicle capacities and per-stop demands.

**Distance matrix:** Compute Haversine (great-circle) distances between all pairs of points (stops plus depot). Store as a symmetric matrix. Note: Haversine distances are straight-line approximations and will underestimate actual road distances by 20–60% depending on the street grid. For improved accuracy, if the road network graph is loaded for the region, optionally compute shortest-path road distances via Dijkstra on the graph — this is more expensive (O(n^2 * E)) but produces better route ordering.

**TSP solving (single vehicle):**
1. Build an initial solution using nearest-neighbor heuristic — start at depot, always go to the closest unvisited stop.
2. Improve with 2-opt local search — repeatedly try swapping pairs of edges; keep any swap that reduces total distance. Continue until no improving swap exists.
3. This runs fast on-device for up to several hundred stops.

**Performance budgets:** TSP should solve within 5 seconds for up to 500 stops. VRP should solve within 10 seconds for up to 500 stops across up to 10 vehicles. For larger inputs, warn the user and suggest partitioning into zones first.

**VRP solving (multiple vehicles):**
1. Assign stops to vehicles using a savings algorithm (Clarke-Wright) or nearest-insertion heuristic, respecting capacity constraints.
2. Optimize each vehicle's sub-route independently with 2-opt.
3. If the objective is to balance workload, apply a global span cost that penalizes the difference between the longest and shortest routes.

**Objective options:** Minimize total distance (default), minimize the longest single route (balance workload), minimize vehicle count.

**Output:**
- Per-vehicle ordered stop list with sequence numbers.
- Per-vehicle distance and estimated duration.
- Unassigned stops (if total demand exceeds total capacity).
- Overall stats: total distance, total time, number of vehicles used.

### 5E. Zone Partitioning

Dividing a large set of stops into balanced collection zones.

**Input:** A set of stops or waste points with lat/lon coordinates. A target number of zones (typically equal to the number of trucks or collection weekdays).

**Algorithm:** Balanced k-means clustering on geographic (lat, lon) coordinates. Balance is measured by stop count — each zone's stop count should be within ±15% of the mean (total stops / number of zones). The algorithm iteratively reassigns border points between clusters until the balance constraint is met or a maximum of 100 iterations is reached. Spectral clustering (eigendecomposition of a spatial proximity graph) is a future enhancement — do not implement it in the initial version.

**Boundary generation:** Compute the convex hull around each cluster's assigned points to produce a zone polygon. Note: convex hulls can overlap when clusters interleave geographically. This is acceptable for the initial version. A future improvement could use Voronoi tessellation or concave hulls for tighter, non-overlapping boundaries.

**Output:**
- Array of zones, each with: polygon boundary as GeoJSON, list of assigned stop IDs, display color, summary stats (stop count, estimated area).
- A balance metric: the coefficient of variation of stop counts across zones (standard deviation / mean). A value of 0 means perfectly balanced; values above 0.15 indicate significant imbalance.

**Persistence:** Save partition results to the Saved Solutions table. Users can name, compare, and recall previous partitions.

### 5F. Navigation / Route Following

**Input:** A solved route — an ordered list of coordinates from the CPP or VRP solver.

**Display:** Show the full route polyline on the map. Highlight the current segment. Show the next turn instruction in a top banner.

**Progress tracking:** Use the device GPS to track the vehicle's position. Mark segments as covered when the vehicle drives within approximately 15 meters of the segment. Show: percentage complete, remaining distance, estimated time remaining.

**Stop collection:** At each stop, prompt the driver for confirmation — Collected, Skipped, or Add Note. Record the timestamp of each action.

**QR scan (stretch goal):** If the device has a camera, support QR code scanning for verified collection. The QR code contains the waste point's UUID as plain text. Scanning matches it to `waste_points.id` in the local database to confirm the correct stop. This is a stretch goal — implement it after all core features work.

**Off-route handling:** If the vehicle deviates from the planned route, show a visual indicator on the map. Do not attempt rerouting (there is no routing server). Simply highlight the deviation and show the direction back to the next uncovered segment.

**Completion:** When all segments or stops are covered, display a summary: total time elapsed, distance driven, stops collected vs skipped, efficiency percentage.

### 5G. Data Export

**Export solved routes as:**
- GeoJSON: FeatureCollection with LineString geometry and route properties.
- GPX: Track with ordered route points.
- KML: For viewing in Google Earth.
- CSV: Stop list with columns for sequence, latitude, longitude, address, collection status.

**Export zones as:**
- GeoJSON: Polygon features with zone name, color, and stats.
- KML: For viewing in Google Earth.

**Export collection records as:**
- CSV: Stop ID, address, timestamp, collected/skipped, driver notes.

**Sharing:** Use the device's native share sheet to send exported files via email, messaging, or file transfer.

---

## Section 6: UI/UX Flow

### App Launch / Home Screen

The map fills the screen. A bottom tab bar provides navigation between five tabs: **Map**, **Routes**, **Zones**, **Data**, **Settings**.

On first launch, the map shows a prompt: "No offline region downloaded" with a button to navigate to Settings > Download Region.

### Map Tab (Default)

Full-screen map with floating action buttons:
- **My Location** (GPS crosshair icon): center the map on the device's current position.
- **Import** (+ icon): trigger the file import flow.
- **Layers** (stack icon): toggle visibility of data layers — stops, zones, routes, road overlay.

When a route is loaded, a bottom sheet slides up showing route stats (distance, time, stop count) with a prominent "Start Navigation" button.

### Routes Tab

A scrollable list of all saved routes, sorted by most recent. Each row shows:
- Route name.
- Status badge: draft, optimized, in-progress, completed.
- Stop count, total distance, creation date.

Tap a route to load it on the map. Swipe a row to delete it.

Top actions: "New Route" (manual stop creation) and "Import Route" (file picker).

### Route Detail / Solve Flow

After importing or manually creating stops:

1. Stops appear on the map as markers. A bottom sheet shows "N stops imported" with action buttons.
2. User taps **Optimize**. A solver picker appears with two choices: **CPP** (street coverage) or **TSP/VRP** (stop visits). For VRP, the user sets vehicle count and optional capacity per vehicle.
3. The solver runs on-device. A progress indicator is shown — for large inputs this may take a few seconds.
4. The result appears as a route polyline on the map. Stats are displayed: total distance, estimated time, efficiency percentage, deadhead distance.
5. The user can **Accept** (saves to the Routes table), **Re-solve** with different parameters, or **Discard**.

### Zones Tab

A list of saved zone partitions. Each row shows:
- Partition name.
- Number of zones.
- Balance metric.
- Creation date.

Tap a partition to display its zones on the map as colored polygons.

Actions per partition:
- **View on map:** Show zone polygons with their assigned stops.
- **Route a zone:** Select one zone, run TSP/VRP for its stops, get a per-zone optimized route.
- **Export:** Download zone boundaries as GeoJSON or KML.

To create a new partition: select a set of stops, choose the target zone count, run the partitioning algorithm, preview the result on the map, name it, and save.

### Data Tab

Manage waste points and imported data.

- **Waste Points sub-tab:** Searchable, filterable list of all waste points. Filter by type, zone, or condition. Tap any point to view it on the map. Bulk import from CSV or GeoJSON.
- **Export sub-tab:** Export routes, zones, or collection records in supported formats. Uses the device's native share sheet.
- **Import History sub-tab:** List of past imports showing file name, date, and point count.

### Settings Tab

- **Offline Regions:** List of downloaded regions with status (ready / stale), size on disk, and download date. "Download New Region" flow: pick a city from the predefined list or draw a custom bounding box. Download progress bars for each data type. Delete a region to reclaim storage.
- **Solver Preferences:** Default solver type, turn penalty weight configuration, fuel-aware routing toggle (requires elevation data for the region).
- **Navigation Preferences:** Geofence radius for auto-marking stops as covered, distance units (kilometers or miles — display only, all stored values remain in meters), voice guidance toggle.
- **App Info:** App version, total storage used, data version per region.

### Navigation Mode

Entering navigation mode starts a focused full-screen view:

- The map auto-rotates to heading-up orientation. Heading is derived from consecutive GPS positions when speed exceeds 5 km/h. At lower speeds, the map falls back to north-up orientation.
- The current segment is highlighted. A top banner shows the next turn instruction: "Turn left onto Elm St — 120m".
- A bottom bar shows: progress (segments completed / total), distance remaining, time elapsed.
- Stop collection prompts appear as the vehicle approaches each stop: "Collected?" with buttons for Confirm, Skip, and Add Note.
- An "End Navigation" button exits navigation mode and saves progress. Partial completions are preserved — the user can resume the same route later.

### General UX Principles

- **Offline-first feedback:** Never show loading spinners waiting for a network response. All actions respond immediately from local data.
- **Truck-cab friendly:** Large, touch-friendly buttons suitable for use with work gloves or in a moving vehicle.
- **Sunlight readable:** High-contrast color scheme that remains legible in direct sunlight.
- **Destructive action safety:** Confirmation dialogs before deleting a route, deleting a region, or clearing all data.
- **Crash resilience:** All state is persisted in SQLite. The app can be killed and restarted at any time without losing work.

---

## Summary for Gemini

This is a standalone offline app — no server, no cloud database, no sync protocol. Build it with these priorities, in order:

1. **Local SQLite database** with the schema defined in Section 3. All data lives here.
2. **File import** (Section 5A) — the user must be able to load their stops and road data.
3. **Map display** (Section 5B) — show the data on an offline MapLibre GL map using local PMTiles.
4. **CPP solver** (Section 5C) — the primary algorithm for street-coverage route optimization. WASM libraries are acceptable for graph algorithms.
5. **TSP/VRP solver** (Section 5D) — for stop-based collection routing.
6. **Zone partitioning** (Section 5E) — for dividing large areas into balanced zones using balanced k-means.
7. **Navigation** (Section 5F) — GPS-based route following with progress tracking.
8. **Export** (Section 5G) — getting solved routes out of the app.
9. **Offline data pipeline** (Section 4) — downloading region data for offline use.

Target mobile (Android and iOS) as the primary platform. The app must support SQLite, local filesystem access, GPS, and a camera. Every feature must function without any network connectivity after the initial region data download.
