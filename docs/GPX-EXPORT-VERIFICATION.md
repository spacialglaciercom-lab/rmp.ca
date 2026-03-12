# GPX Export / Formatting Verification

This document records verification of export and formatting behavior for GPX generation, including risks of dropped segments, simplification, and serialization errors.

## Summary

- **GPX serialization** does not drop segments: the export uses the full point list passed in. No point-cap or density-based filtering is applied in `generateGPXString` or `generateMultiTrackGPXString`.
- **Simplification** is optional and **off by default**. All current call sites call `generateGPXString(name, points)` with two arguments only, so `simplify` is always `false`. If simplification were enabled, Douglas–Peucker (default tolerance 0.01 km) could remove points on very short segments.
- **Route name / track name** are now XML-escaped in GPX output so characters like `&`, `<`, `>`, `"` do not break the file or parsers.

## Pipeline Points That Affect Geometry Before GPX

1. **Planner → GPX**
   - **Optimizer (v2)**
     - Returns full edge geometry from `buildRoutePointsFromCircuit` when available, so curves and short edges are represented by multiple points.
     - Consecutive duplicate points are removed with a 1e-6 degree threshold (~0.1 m); this only collapses true duplicates (e.g. same node twice), not distinct short streets.
   - **Map-matching (`routeThroughWaypoints`)**
     - Uses OSRM `overview=full` and `geometries=geojson` (or Google step polylines). Full geometry is concatenated; boundary points are deduplicated when stitching chunks. No intentional simplification.
   - **Gap repair (`repairRouteGaps`)**
     - Replaces large gaps with routed segments; repaired geometry is full segment geometry, not simplified.
   - **Storage vs GPX**
     - Douglas–Peucker (5 m tolerance) is applied only to `pointsForStorage` (stats, saved route). GPX is generated from `gpxPoints` (full matched geometry), so export is not simplified.

2. **Downsampling**
   - `downsamplePoints` is used only in **map-matching** for the public demo server (`matchGPXToRoads`) and for Google waypoint limits. The **planner** uses `routeThroughWaypoints` (not `matchGPXToRoads`) for the route that is then exported. So downsampling does not affect the GPX generated from the Planner flow.

3. **Graph / optimizer merging**
   - `routeOptimizer` (v2) uses `mergeNearbyNodes` (default 2 m) to coalesce nodes at the same intersection. This preserves road geometry (consecutive nodes on the same way are not merged). Short streets are not merged or omitted at the graph level; they appear as edges and their geometry is included in `buildRoutePointsFromCircuit`.

## Possible Future Risks

- If any caller passes `generateGPXString(..., true)` or a large tolerance, Douglas–Peucker could remove points on short or curved segments.
- If a future change caps the number of points for performance (e.g. max points per track), short segments could be under-represented or dropped. No such cap exists today.

## Files Touched in Verification

- `lib/routing-context.tsx` — `generateGPXString`, `generateMultiTrackGPXString` (XML escaping + comments).
- `lib/mapMatching.ts` — `routeThroughWaypoints`, `matchGPXToRoads`, `downsamplePoints`.
- `lib/routeGapFilter.ts` — `repairRouteGaps`.
- `lib/route-optimizer-v2/routeOptimizer.ts` — `buildRoutePointsFromCircuit`, `mergeNearbyNodes`.
- `components/planner-content.tsx` — GPX generation from `gpxPoints` vs `pointsForStorage`, v2 dedupe threshold.
