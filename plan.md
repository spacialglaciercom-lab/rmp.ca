# Plan: Port Backend CPP Logic to v2 Offline Optimizer

## Problem
The v2 offline optimizer (`routeOptimizerSimple.ts`) produces messier routes in dense grids compared to the backend Python optimizer (`optimize.py`). The root cause is **three key algorithmic differences** between them.

## Key Differences Found

### 1. Graph construction: intersection-based splitting vs every-node edges
- **Backend**: Splits ways only at **intersection nodes** (shared coordinates appearing in 2+ ways or at way endpoints). Each edge spans intersection-to-intersection with full intermediate `coords` geometry stored on the edge.
- **v2**: Creates one edge per **consecutive OSM node pair**. Every shape-point along a curved road becomes a graph node, bloating the graph and creating many trivial edges that the Hierholzer circuit must traverse individually.

**Impact**: The backend graph has ~5-10x fewer nodes/edges for the same road network. Fewer nodes means Hierholzer makes fewer decisions, producing cleaner circuits with less opportunity for grid-crossing.

### 2. CPP solver: minimum-weight matching vs greedy Dijkstra augmentation
- **Backend**: Uses **Blossom algorithm** (`nx.min_weight_matching`) to find the minimum-weight perfect matching on odd-degree nodes. This minimizes deadhead (duplicate traversal) distance globally.
- **v2**: Uses **greedy Dijkstra pairing** — sorts deficit/surplus nodes by cost and greedily matches them. Greedy matching can pair distant nodes, creating long deadhead paths that cross the grid.

**Impact**: Blossom matching produces optimal augmentation with minimum extra distance. Greedy matching can add 20-40% more deadhead distance, which shows as unnecessary grid-crossing.

### 3. Route building: edge geometry vs node-to-node straight lines
- **Backend**: Iterates the circuit and emits all `coords` points from each edge (the full road polyline). The output follows road curves naturally.
- **v2**: Maps each circuit node to a single lat/lon point. No intermediate road geometry. OSRM re-routing is needed but picks wrong streets.

**Impact**: Backend routes follow roads perfectly without OSRM. V2 routes need OSRM which introduces its own routing decisions.

## Plan

### Step 1: Add intersection-based graph splitting to v2
**File**: `lib/offline-optimizer-v2/routeOptimizerSimple.ts`

In `buildGraph()`:
1. **First pass**: Scan all ways and count how many ways reference each node ID. Collect endpoints of each way as split nodes.
2. **Mark split nodes**: Any node referenced by 2+ ways OR at the start/end of a way is an intersection.
3. **Second pass**: For each way, iterate nodes and split into runs at intersection nodes (same as backend lines 477-516). Each run becomes one edge with:
   - `geometry`: Array of `[lat, lon]` for all nodes in the run
   - `length`: Sum of haversine distances along the run (not just endpoint-to-endpoint)
   - Existing fields: `oneway`, `dualCarriageway`, `wayId`
4. Only add intersection nodes to `this.nodes` map (not intermediate shape points). Keep the full node map separately for geometry lookup.

### Step 2: Add edge geometry to route point building
**File**: `lib/offline-optimizer-v2/routeOptimizerSimple.ts`

Replace the simple `nodeCircuit.map(id => nodes.get(id))` with a `buildRoutePointsFromCircuit()` method (similar to the full optimizer at line 1556):
1. For each consecutive pair `(fromId, toId)` in the circuit, look up the graph edge.
2. If `edge.geometry` exists, emit all intermediate points along the road.
3. Skip the first point on non-initial edges to avoid duplicates.
4. Fallback to node coordinates when no geometry.

### Step 3: Implement minimum-weight matching for odd-degree balancing
**File**: `lib/offline-optimizer-v2/routeOptimizerSimple.ts`

Replace the greedy matching in `makeEulerianDirected()` with a proper minimum-weight perfect matching:
1. After computing all-pairs shortest paths between odd/unbalanced nodes (already done via Dijkstra), build a complete weighted graph on these nodes.
2. Implement a **greedy-improved matching**: sort all pairs by distance, match closest first (current behavior), then do **2-opt swaps** — for each pair of matched edges (a-b, c-d), check if swapping (a-c, b-d) or (a-d, b-c) reduces total cost. Repeat until no improvement.
3. This is simpler than full Blossom but much better than pure greedy for small numbers of odd nodes.

### Step 4: Restore skipSnapToRoads for v2 (already done)
**File**: `components/planner-content.tsx`

Already committed — v2/backend routes skip OSRM re-routing since they carry their own edge geometry.

### Step 5: Update mid-block detection
**File**: `lib/offline-optimizer-v2/routeOptimizerSimple.ts`

After Step 1, `buildMidBlockNodes()` may need updating since the graph now has fewer nodes (only intersections). Mid-block nodes in the new graph would be intersection nodes with degree 2 on the same way — the existing logic should still work but should be verified.

## Files to Modify
1. `lib/offline-optimizer-v2/routeOptimizerSimple.ts` — Steps 1, 2, 3, 5
2. `components/planner-content.tsx` — Step 4 (already done)

## Testing
- Generate routes for the same Ahuntsic dense-grid zone with both old and new v2
- Compare visually: new v2 should produce cleaner circuits with fewer grid crossings
- Compare stats: new v2 should have better efficiency % (less deadhead)
- Verify all edges are still covered (efficiency should stay near 100%)
