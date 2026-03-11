# Zone partitioning from points — UI integration

The backend exposes **`POST /api/zones/partition-from-points`** and the app has **`partitionZonesFromPoints()`** in `services/overtureOptimizerService.ts`. Use this to create equal(ish), compact zones from a list of points (e.g. delivery addresses).

## API summary

- **Input:** `points: { lat, lon, weight? }[]`, `truck_count`, `balance_metric`, `knn_neighbors`, `include_polygons`.
- **Output:** Same as other zone APIs: `zones[]` with `zone_id`, `node_ids`, `estimated_time`, `zone_polygon` (convex hull when `include_polygons=true`).
- **Balance metrics:** `"count"` = equal number of points per zone; `"weight"` = balance by point weight (e.g. delivery time); `"distance"` = balance by spatial spread (edge length).

## UI integration suggestions

### Input (top toolbar / sidebar)

1. **Upload CSV/JSON**
   - Columns: `address` and/or `lat`/`lon`, optional `weight`.
   - Parse and build `PointInput[]`; if only addresses, show a "Geocode" step (see below).

2. **Geocoding (addresses)**
   - Backend has no internet; do geocoding **client-side** (e.g. Google Maps Geocoding API in the UI, or Nominatim).
   - For Montréal, support French addresses and normalize before calling the geocoder.

3. **Sliders**
   - **Truck count** (zones).
   - **KNN neighbors** (e.g. 1–20) with short hint: "More neighbors = smoother zones, more graph edges."

4. **Balance metric**
   - Dropdown or segmented control: "Equal count" | "By weight" | "By distance".

5. **Run**
   - Call `partitionZonesFromPoints({ points, truck_count, balance_metric, knn_neighbors, include_polygons })`, then `addSavedZone()` with a name and `polygon` derived from the union of zone polygons or the bounding box.

### Map

- **Points:** Plot as markers; if >100, consider clustering (e.g. Leaflet.markercluster or similar).
- **Zones:** Draw `zone_polygon` (convex hull) per zone with distinct colors; optional Voronoi overlay (e.g. `turf.voronoi`) for a "territory" feel.
- **Hover:** Show zone summary (e.g. point count or total weight).
- **Mode toggle:** "Point view" (markers only) vs "Zone view" (polygons + points).

### Sidebar

- **Zone list:** For each zone, list addresses/coords in that zone (using `node_ids` to index into the original points).
- **Sortable table:** Columns: address/lat/lon/weight; sort by weight or distance to zone centroid.
- **Balance:** Bar chart of zone weights; show a warning if imbalance >10% (e.g. `max(weights) / mean(weights) > 1.1`).
- **Edit mode (optional):** Drag a point to another zone and re-run partition or apply a local reassignment and recompute polygons.

### Saving

- Reuse existing Zones store: `addSavedZone({ name, polygon, zones, truck_count, balance_metric, ... })`.
- For partition-from-points, set `balance_metric` to `"count"` | `"weight"` (store type already allows this).

## Minimal hook in ZonePage

To add a "Partition from points" flow:

1. Add state for `points: PointInput[]` (and optional file/address input).
2. On "Run", call `partitionZonesFromPoints(...)`, then `addSavedZone({ name: "Points partition", polygon: boundsFromZones(result), zones: result.zones, truck_count, balance_metric })`.
3. Map and sidebar already work with `zones` and `zone_polygon`; no change needed for display.

## Geocoding (addresses only)

- **Client-side:** Use Google Maps Geocoding API (key from server `/api/config`) or Nominatim (no key).
- **Flow:** User pastes or uploads addresses → "Geocode" → spinner → replace addresses with `{ lat, lon, weight }` → enable "Partition" button.
