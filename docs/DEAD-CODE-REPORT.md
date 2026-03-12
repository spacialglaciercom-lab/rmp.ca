# Dead Code Analysis Report

**Scope:** Most utilized areas of the app (map, planner, extract, routing, stores, core services).  
**Date:** Analysis run on codebase snapshot.

---

## 1. `components/map-content.tsx`

| Item                                    | Location          | Type            | Reason                                                                                                                         |
| --------------------------------------- | ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `isMockRoute`, `isMockCollectionPoints` | Line ~27 (import) | Unused import   | Import from `@/lib/is-mock-route` is never used in the file.                                                                   |
| `route`                                 | Line ~126         | Unused variable | `useMapStateStore((s) => s.route)` is never read; only `routePoints`, `collectionPoints`, `displayRoutePoints`, etc. are used. |
| `toggleOverlay`                         | Line ~282         | Unused variable | `useMapLayerStore((s) => s.toggleOverlay)` is never called or referenced.                                                      |

---

## 2. `lib/routing-context.tsx`

| Item                         | Location  | Type          | Reason                                                       |
| ---------------------------- | --------- | ------------- | ------------------------------------------------------------ |
| `generateSampleStatistics()` | Line ~205 | Unused export | Exported function is never imported anywhere in the project. |

---

## 3. `stores/mapStateStore.ts`

| Item                         | Location       | Type            | Reason                                                                                                                                            |
| ---------------------------- | -------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useRouteData`               | Lines ~398–406 | Unused export   | Composite selector hook; never imported outside this file.                                                                                        |
| `useNavigationState`         | Lines ~408–419 | Unused export   | Same.                                                                                                                                             |
| `useMapInteraction`          | Lines ~421–431 | Unused export   | Same.                                                                                                                                             |
| `useMapillaryState`          | Lines ~433–440 | Unused export   | Same.                                                                                                                                             |
| `useOsmExtraction`           | Lines ~442–449 | Unused export   | Same.                                                                                                                                             |
| `useMapUI`                   | Lines ~451–458 | Unused export   | Same.                                                                                                                                             |
| `clearRouteData` assignments | Lines ~300–304 | Dead assignment | `geojsonOverlay`, `weatherAnalysis`, `aiRouteAnalysis` are set in `set()` but are not part of the store’s typed state / not read by any selector. |

---

## 4. `components/extract-content.tsx`

| Item        | Location         | Type            | Reason                                                                                             |
| ----------- | ---------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `getBBox()` | Lines ~2008–2025 | Unused function | Helper to compute bbox from a polygon feature; defined but never called in this file or elsewhere. |

---

## 5. `components/planner-content.tsx`

| Item                    | Location          | Type          | Reason                                                                                                       |
| ----------------------- | ----------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| `showMap`, `setShowMap` | Line ~70          | Unused state  | `useState(true)` is never read or called; no conditional render or handler uses it.                          |
| `RouteMap`              | Line ~23 (import) | Unused import | `RouteMap` is imported from `@/components/route-map` but never rendered in JSX (no `<RouteMap` in the file). |

---

## 6. `lib/overtureExtractService.ts`

| Item              | Location | Type          | Reason                                                              |
| ----------------- | -------- | ------------- | ------------------------------------------------------------------- |
| `httpDownloadUrl` | Line ~44 | Unused export | Exported; never imported elsewhere (only `httpGeoJSONUrl` is used). |
| `httpGraphUrl`    | Line ~46 | Unused export | Same.                                                               |
| `RoadSegment`     | Line ~76 | Unused export | Exported interface never imported elsewhere.                        |

---

## 7. `services/overtureOptimizerService.ts`

| Item                           | Location  | Type          | Reason                                                                                                                                                                                  |
| ------------------------------ | --------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `optimizeOvertureRoute`        | Line ~267 | Unused export | Exported function never imported in the app; `optimizeRoute` and related are used instead.                                                                                              |
| `extractRoads`                 | Line ~431 | Unused export | Exported function never imported elsewhere.                                                                                                                                             |
| `partitionZones` (edges-based) | Line ~441 | Unused export | The overload taking `ZonesPartitionRequest` (edges/node_count) is never imported; only `partitionZonesFromGeoJSON`, `partitionZonesByPolygon`, and `partitionZonesFromPoints` are used. |

---

## Summary

- **High-traffic components:** Unused imports and variables in `map-content`, `planner-content`, and `extract-content`; one unused helper `getBBox` in extract-content.
- **Routing:** One unused exported function in `routing-context`.
- **Stores:** Several unused composite selector hooks and questionable assignments in `mapStateStore`.
- **Services:** Several exported helpers/interfaces in the Overture extract and optimizer services that are not referenced by the app (may be kept for external or future API use).

**Recommendation:** Remove or use the items above where appropriate. For public service modules (`overtureExtractService`, `overtureOptimizerService`), either document exports as “reserved for external/future use” or un-export if they are not part of the intended API.
