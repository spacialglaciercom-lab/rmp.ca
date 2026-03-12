# Plan Review: Basic Software Maintenance

**Plan file:** `basic_software_maintenance_4ae60ff8.plan.md`  
**Reviewed:** 2025-03-11  
**Verdict:** **Safe to execute** — The plan is conservative and will not break existing code **if followed as written**. Below are verifications and explicit safeguards.

---

## 1. Scripts and Versions (Verified)

| Item                | Status                                                                |
| ------------------- | --------------------------------------------------------------------- |
| `pnpm check`        | Exists — `tsc --noEmit`                                               |
| `pnpm build`        | Exists — `expo export -p web`                                         |
| `pnpm build:server` | Exists — esbuild server bundle                                        |
| `pnpm lint`         | Exists — `expo lint`                                                  |
| `pnpm format`       | Exists — `prettier --write .`                                         |
| `pnpm test`         | Exists — `vitest run`                                                 |
| README commands     | Match `package.json` (dev, check, lint, format, test, build)          |
| app.json version    | `1.1.6` — plan says bump to `1.1.7` (patch only)                      |
| backend main.py     | `version="1.1.0"` — plan says optional bump to `1.1.1` or leave as-is |

No breaking changes introduced by script or version assumptions.

---

## 2. Dead Code: What the Plan Allows vs. Reports

### 2.1 Safe to remove (plan Section 4 — do these only)

- **components/map-content.tsx**
  - Remove **unused imports:** `isMockRoute`, `isMockCollectionPoints` (from `@/lib/is-mock-route`).
  - Remove **unused variables:** `route` (from `useMapStateStore((s) => s.route)`), `toggleOverlay` (from `useMapLayerStore`).
  - **Verified:** These are not read or called elsewhere in the file; removal does not affect behavior.

- **components/planner-content.tsx**
  - Remove **unused import:** `RouteMap` from `@/components/route-map` (not used in JSX).
  - **Note:** `showMap` / `setShowMap` from the dead-code report are not present in the current file; no change needed for them.

- **components/extract-content.tsx**
  - Remove **unused helper:** `getBBox()` (lines ~2008–2025).
  - **Verified:** `getBBox` is defined only in this file and never called anywhere in the repo; safe to remove.

### 2.2 Do NOT remove (plan is explicit)

- **lib/overtureExtractService.ts**  
  Unused exports `httpDownloadUrl`, `httpGraphUrl`, `RoadSegment` — **do not remove**.  
  Optionally add a short comment that they are reserved for external/future use.

- **services/overtureOptimizerService.ts**  
  Unused exports `optimizeOvertureRoute`, `extractRoads`, edges-based `partitionZones` — **do not remove**.  
  Optionally add a short comment that they are reserved for external/future use.

- **lib/routing-context.tsx**  
  Unused export `generateSampleStatistics()` — treat as “lib”; **do not remove** per plan (no removal of unused exports from services/libs without approval).

- **stores/mapStateStore.ts**  
  Unused selector hooks and dead assignments — **do not remove**; plan does not list stores in the safe-to-remove list.

### 2.3 DEAD-CODE-REPORT-OTHER-COMPONENTS.md vs. plan

The “other components” report suggests **deleting whole files** (e.g. `QuickDestinations.tsx`, `OSMExtractorGlobalSheet.tsx`, `ProcessorStyleDemo.tsx`, `MapsMeTest.tsx`) and other edits outside the three components above.

- **Plan rule:** “Do **not** delete files or refactor large logic blocks.”
- **Therefore:** For this maintenance pass, **do not delete any files** and **do not** apply the “other components” report’s file deletions or un-export changes (e.g. `PlaceInfoSheet.tsx`, `NavigationView.tsx`, `route-map.web.tsx`, etc.).
- Only perform the low-risk removals explicitly listed in Section 2.1 above.

This keeps the maintenance pass minimal and non-breaking.

---

## 3. Dependency and Test Safety

- **Dependencies:** Patch/minor only; no major bumps without approval. Run `pnpm install` after changes and then `pnpm check` and `pnpm build` to confirm nothing breaks.
- **Tests:** Fix only trivial, safe failures (e.g. snapshots after format, obvious assertions). Do not refactor test or production logic to make tests pass.
- **Lint/format:** Auto-fix and trivial fixes only; document any remaining violations and reasons.

---

## 4. Summary: Will This Break Existing Code?

| Area                  | Risk     | Mitigation                                                                                        |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| Dependency updates    | Low      | Patch/minor only; verify with `pnpm check` and `pnpm build`                                       |
| Lint/format/typecheck | Low      | Auto-fix + trivial fixes only; no logic refactors                                                 |
| Tests                 | Low      | Only trivial/snapshot fixes; report remaining failures                                            |
| Dead code removal     | **None** | Only the three components + `getBBox`; no file deletions; no removal of service/lib/store exports |
| Version bump          | None     | Patch only in package.json and app.json                                                           |
| CHANGELOG / README    | None     | Add/update docs only                                                                              |

**Conclusion:** If the plan is followed as written — especially “no file deletions,” “no removal of unused exports from services/libs,” and “only the listed dead-code items in map-content, planner-content, extract-content” — **existing code will not be broken**. This review confirms that and restricts the scope of dead-code changes to the items verified in Section 2.1.
