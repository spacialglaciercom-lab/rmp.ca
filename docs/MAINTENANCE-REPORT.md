# Basic Software Maintenance Report

**Project:** TrashRoute (RouteMaster Pro / rmp.ca)  
**Date:** 2025-03-11  
**Plan:** Basic Software Maintenance (patch/minor deps, lint, format, typecheck, tests, docs, dead code, security audit, version bump)

---

## 1. Updated / fixed

### Dependencies (Node / pnpm)

- Ran `pnpm update` to refresh within declared semver ranges (patch/minor only).
- **Updated (examples):** `@ai-sdk/openai-compatible` 2.0.30 → 2.0.35, `@react-navigation/elements` 2.9.2 → 2.9.10, `@react-navigation/native` 7.1.25 → 7.1.33, `@tanstack/react-query` 5.90.12 → 5.90.21, `@trpc/*` 11.9.0 → 11.12.0, `axios` 1.13.5 → 1.13.6, `expo-image-picker` 55.0.10 → 55.0.12, `firebase` 12.9.0 → 12.10.0, `firebase-admin` 13.6.1 → 13.7.0, `genkit` 1.28.0 → 1.29.0, `mysql2` 3.16.0 → 3.19.1, `nativewind` 4.2.1 → 4.2.2, `prettier` 3.7.4 → 3.8.1, `zod` 4.2.1 → 4.3.6, `drizzle-kit` 0.31.8 → 0.31.9, `esbuild` 0.27.1 → 0.27.3, `eslint` 9.39.2 → 9.39.4, `tailwind-merge` 2.6.0 → 2.6.1, and others.
- **Lock file:** `pnpm-lock.yaml` updated via `pnpm update`.
- **Left unchanged (major-only or pinned):** React 19.1.0, react-native 0.81.5, Expo SDK 54, and overrides; many packages have a “latest” that is a major bump (e.g. Expo 55, react 19.2.x) and were not updated per plan.

### Code quality

- **Format:** Ran `pnpm format` (Prettier) across the repo.
- **Lint:** Ran `pnpm lint` (expo lint); no blocking auto-fix sweep was applied beyond what format touched.
- **Typecheck:** `pnpm check` (tsc --noEmit) still reports pre-existing errors; see “Remaining issues” below. No new type errors introduced by this pass.

### Dead code removed (safe, low-risk only)

- **components/map-content.tsx:** Removed unused imports `isMockRoute`, `isMockCollectionPoints` from `@/lib/is-mock-route`. Removed unused variables: `route` (from `useMapStateStore`), `toggleOverlay` (from `useMapLayerStore`).
- **components/planner-content.tsx:** Removed unused import `RouteMap` from `@/components/route-map`.
- **components/extract-content.tsx:** Removed unused helper `getBBox()` (lines ~2008–2025).
- **Not removed (per plan):** Unused exports in `lib/overtureExtractService.ts`, `services/overtureOptimizerService.ts`, `lib/routing-context.tsx`, `stores/mapStateStore.ts`. No files deleted.

### Documentation

- **CHANGELOG:** Added `CHANGELOG.md` with an “Unreleased” section listing dependency updates, format, dead code removals, and version bump.
- **README:** Not modified; setup steps and script names match current `package.json`.

### Version bump

- **package.json:** `version` set to `1.1.7`.
- **app.json:** `expo.version` set to `1.1.7`.
- **Backend (backend/app/main.py):** Left at `version="1.1.0"`; not bumped in lockstep (noted here).

---

## 2. Remaining issues

### TypeScript (pre-existing)

- `pnpm check` still reports many errors, including:
  - `app/_layout.tsx`: `ErrorUtils` on globalThis.
  - `app/contribution.tsx`: `LocationSubscription` from expo-location.
  - `components/AIChatBubble.tsx`: style types, `speakText`/`stop`, `volume`, Error type, etc.
  - `components/extract-content.tsx`: `GeoJSONFeatureCollection` vs `FeatureCollection`, `unknown[]` vs `GeoJSONFeature[]`.
  - `components/error-boundaries/map-error-boundary.tsx`: icon name type.
  - `components/help-content.tsx`, `help/HelpPrompt.tsx`: font keys (`title`, `body`, `caption`) on theme type.
  - Additional files in the full tsc output.
- None of these were introduced by this maintenance pass; they are documented and left for a dedicated type-cleanup.

### Tests

- **Passing:** e.g. `lib/__tests__/cycleDetector.test.ts`, `lib/plugins/__tests__/route-optimization.test.ts`, `lib/plugins/__tests__/overture-extraction.test.ts`, and others.
- **Failing (not fixed in this pass):**
  - **lib/plugins/__tests__/config.test.ts:** 2 failed (plugin config shape expectations).
  - **lib/__tests__/overtureExtractService.test.ts:** 3 failed (cache-key / WebSocket behavior).
- Per plan, only trivial/safe test fixes were in scope; these were not refactored.

### Security (pnpm audit)

- **1 moderate:** `esbuild` (transitive via `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild@0.18.20`). Advisory: dev server request/response exposure; patched in esbuild >= 0.25.0. Resolution would require dependency chain or override changes.
- **1 low:** `@tootallnate/once` (transitive via genkit / Google Cloud deps). Advisory: incorrect control flow scoping; patched in >= 3.0.1.
- Both are transitive; no direct dependency changes were made in this pass. Documented for follow-up.

### Intentional leftovers

- Unused exports in `lib/overtureExtractService.ts`, `services/overtureOptimizerService.ts` (and similar) kept as reserved for external/future use per plan.
- No file deletions from DEAD-CODE-REPORT-OTHER-COMPONENTS (e.g. QuickDestinations.tsx, OSMExtractorGlobalSheet.tsx) per “no file deletions” rule.

---

## 3. Suggested next steps

- **TypeScript:** Plan a focused pass to fix or suppress the existing type errors (e.g. global types, expo-location types, theme/font types, GeoJSON typings).
- **Tests:** Fix or adjust `config.test.ts` and `overtureExtractService.test.ts` (expectations vs current plugin/extract behavior).
- **Security:** Evaluate upgrading or overriding the transitive chain that pulls in vulnerable `esbuild`; consider `pnpm overrides` or moving to a version of `drizzle-kit` that uses a patched esbuild. For `@tootallnate/once`, track genkit/Google Cloud updates.
- **Python:** Consider adding a lock file (e.g. pip-tools) for the backend; run `pip-audit` in the backend venv and document results.
- **Dependencies:** When ready, plan a separate pass for major upgrades (e.g. Expo 55, React 19.2, etc.) with explicit approval and testing.

---

## 4. Commits (suggested)

Commit in small, logical steps, for example:

1. `chore(deps): update dependencies (patch/minor)`
2. `style: prettier and dead code removal (map-content, planner-content, extract-content)`
3. `docs: add CHANGELOG and maintenance report`
4. `chore(release): bump patch version to 1.1.7`

(Combine or split as desired; security audit can be documented in the same or a separate chore commit.)
