# Offline Optimizer v2

This module is a **clone** of the optimizer from:

**`C:\Users\Space\Videos\route-optimizer-mobile-v2\src`**

## Source mapping

| Videos file | Used? | In rmp.ca |
|-------------|-------|-----------|
| `routeOptimizerSimple.ts` | ✅ Yes (App uses this) | `routeOptimizerSimple.ts` → `RouteOptimizerSimpleV2` |
| `types.ts` | ✅ Yes (Node, Way, RoutePoint, OptimizationResult) | Uses `@/lib/route-optimizer-v2/types` (same shape) |
| `routeOptimizer.ts` | ❌ No (intersection-collapsing variant) | — |
| `routeOptimizerCPP.ts` | ❌ No | — |
| `osmParser.ts` | ❌ No (app parses OSM then calls optimizer) | rmp.ca has its own parser / stored OSM |
| `routeSimplifier.ts` | ❌ No | — |
| `gpxExporter.ts` | ❌ No | — |
| `LeafletMap.tsx` | ❌ No | — |

So the **exact optimizer** the Videos app runs is `RouteOptimizerSimple` (here: `RouteOptimizerSimpleV2`). Logic and turn costs match; we only add `nodeId` on route points for rmp.ca and use the existing type imports.

## Usage

On the **Planner** page, turn on **"Use offline optimizer (v2)"** to run this optimizer instead of the default backend/local path.

## GeoJSON support

The offline v2 optimizer supports **both OSM and GeoJSON** input:

- **OSM:** Use `new RouteOptimizerSimpleV2(nodes, ways).optimize(customLat?, customLon?)` with nodes/ways from the OSM parser or stored OSM data (same as today).
- **GeoJSON:** Use `optimizeFromGeoJSON(geojson, { customLat?, customLon?, ... })` from this module. It converts the GeoJSON to nodes/ways via `geojsonToOsmData`, then runs the same optimizer. Accepts `FeatureCollection` of LineString/MultiLineString (e.g. from Overture or OSM export).

When **"Use offline optimizer (v2)"** is on and you import a **GeoJSON** file via the planner’s **OSM Import** file picker, the app uses `optimizeFromGeoJSON` instead of the backend.
