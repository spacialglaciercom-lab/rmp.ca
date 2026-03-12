# Dead Code Report — Other Components

**Scope:** Components not covered in `DEAD-CODE-REPORT.md` (i.e. excluding `map-content.tsx`, `planner-content.tsx`, `extract-content.tsx`).  
**Focus:** `components/mapTab/*`, root-level components, `components/neo/*`, route-map.

**Verification (codebase check):** Each item below was verified by search; removing or changing the listed code would **not** affect app behavior. No other files import or reference these exports/imports.

---

## 1. `components/mapTab/navigation/QuickDestinations.tsx`

| Item                            | Line(s) | Type          | Reason                                                                                                                |
| ------------------------------- | ------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `QuickDestinations` (component) | ~25     | Unused export | Never imported; `NavigationPanel` uses `EnhancedQuickDestinations` only.                                              |
| `QuickDestinationType`          | ~11     | Unused export | Type only used in this file; consumers use `enhancedQuickDestinationsStore` types.                                    |
| `QuickDestination` (interface)  | ~13     | Unused export | Same; `AddDestinationModal` imports `QuickDestination` from `@/stores/enhancedQuickDestinationsStore`, not this file. |

**Note:** The whole file is effectively dead; navigation uses `EnhancedQuickDestinations` and the store. **Safe to remove:** no imports reference this file.

---

## 2. `components/mapTab/osm/OSMExtractorGlobalSheet.tsx`

| Item                      | Line(s) | Type          | Reason                                                                 |
| ------------------------- | ------- | ------------- | ---------------------------------------------------------------------- |
| `OSMExtractorGlobalSheet` | ~12     | Unused export | Never imported; app layout mounts `OvertureExtractorGlobalSheet` only. |

**Note:** Implemented but never mounted; layout mounts `OvertureExtractorGlobalSheet` only (`app/(tabs)/_layout.tsx`). **Safe to remove:** no imports reference this file.

---

## 3. `components/neo/ProcessorStyleDemo.tsx`

| Item                             | Line(s)  | Type          | Reason                                                                                                                             |
| -------------------------------- | -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ProcessorStyleDemo`             | ~12      | Unused export | Exported function never imported anywhere.                                                                                         |
| `processorHint` (StyleSheet key) | ~183–187 | Dead code     | Style key defined in this file but never used in this file’s JSX. (ProcessorHomeScreen has its own `processorHint` in its styles.) |

**Note:** **Safe to remove:** no imports reference this file. Removing the component or the dead `processorHint` style does not affect the app.

---

## 4. `components/MapsMeTest.tsx`

| Item         | Line(s) | Type          | Reason                                      |
| ------------ | ------- | ------------- | ------------------------------------------- |
| `MapsMeTest` | ~11     | Unused export | Exported component never imported anywhere. |

**Note:** **Safe to remove:** no imports reference this file.

---

## 5. `components/route-map.web.tsx`

| Item              | Line(s) | Type                          | Reason                                                                                                                                             |
| ----------------- | ------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FitBoundsButton` | ~1178   | Unused export / dead function | Exported function not used in this file and never imported elsewhere; `route-map-impl` only re-exports `RouteMap`, `RouteMapProps`, `RouteMapRef`. |

**Note:** Not re-exported from `route-map-impl.web.tsx` (only `RouteMap`, `RouteMapProps`, `RouteMapRef` are). **Safe to remove** the function; no callers.

---

## 6. `components/mapTab/controls/RouteActionChips.tsx`

| Item      | Line(s)     | Type          | Reason                                               |
| --------- | ----------- | ------------- | ---------------------------------------------------- |
| `Alert`   | ~2 (import) | Unused import | Imported from `react-native` but never used in file. |
| `Linking` | ~2 (import) | Unused import | Same.                                                |

**Note:** **Safe to remove** both imports; no effect on behavior.

---

## 7. `components/mapTab/PlaceInfoSheet.tsx`

| Item            | Line(s) | Type          | Reason                                                           |
| --------------- | ------- | ------------- | ---------------------------------------------------------------- | ---------------------------------- |
| `PlaceInfoData` | ~28     | Unused export | Exported interface only used internally (`useState<PlaceInfoData | null>`); no other file imports it. |

**Note:** **Safe to un-export:** change to a non-exported interface; no other file imports it.

---

## 8. `components/NavigationView.tsx`

| Item              | Line(s) | Type            | Reason                                                                                                                                                            |
| ----------------- | ------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullRoutePoints` | ~101    | Unused variable | Prop destructured (e.g. as `_fullRoutePoints`) and never read; native `NavigationView` accepts it but does not use it (web `NavigationView.web.tsx` does use it). |

**Note:** `map-content.tsx` passes `fullRoutePoints` to `NavigationView`; the web implementation (`NavigationView.web.tsx`) uses it. Only the native implementation ignores it. Safe to stop destructuring it in the native file (or use it there); do not remove the prop from the parent or the interface, or web would break.

---

## Summary Table

| File                                      | Item(s)                                                         | Type                       |
| ----------------------------------------- | --------------------------------------------------------------- | -------------------------- |
| `mapTab/navigation/QuickDestinations.tsx` | `QuickDestinations`, `QuickDestinationType`, `QuickDestination` | Unused exports             |
| `mapTab/osm/OSMExtractorGlobalSheet.tsx`  | `OSMExtractorGlobalSheet`                                       | Unused export              |
| `neo/ProcessorStyleDemo.tsx`              | `ProcessorStyleDemo`, `processorHint` (styles)                  | Unused export + dead style |
| `MapsMeTest.tsx`                          | `MapsMeTest`                                                    | Unused export              |
| `route-map.web.tsx`                       | `FitBoundsButton`                                               | Unused export              |
| `mapTab/controls/RouteActionChips.tsx`    | `Alert`, `Linking`                                              | Unused imports             |
| `mapTab/PlaceInfoSheet.tsx`               | `PlaceInfoData`                                                 | Unused export              |
| `NavigationView.tsx`                      | `fullRoutePoints`                                               | Unused variable (prop)     |

---

## Recommendations

- **QuickDestinations.tsx / OSMExtractorGlobalSheet / ProcessorStyleDemo / MapsMeTest:** Remove files or exports if not planned for use.
- **route-map.web.tsx:** Remove `FitBoundsButton` or implement and use it.
- **RouteActionChips.tsx:** Remove `Alert` and `Linking` imports.
- **PlaceInfoSheet.tsx:** Un-export `PlaceInfoData` if it stays internal only.
- **NavigationView.tsx:** In the native file only, omit destructuring `fullRoutePoints` (or use it). Do not remove the prop from the parent or the interface, or the web view will break.
