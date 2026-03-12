# Basic Software Maintenance Report

**Project:** TrashRoute (RouteMaster Pro / rmp.ca)  
**Date:** 2026-03-11  
**Plan:** Basic Software Maintenance (patch/minor deps, lint, format, typecheck, tests, docs, dead code, security audit, version bump)

---

## 1. Updated / fixed

### Dependencies (Node / pnpm)

- Ran `pnpm update` to refresh within declared semver ranges (patch/minor only).
- **Updated (examples):** @ai-sdk/openai-compatible, @react-navigation/elements, @react-navigation/native, @tanstack/react-query, @trpc/*, axios, expo-image-picker, firebase, firebase-admin, genkit, mysql2, nativewind, prettier, zod, drizzle-kit, esbuild, eslint, tailwind-merge, react-native-css-interop, and others.
- **Lock file:** pnpm-lock.yaml updated. **Build:** `pnpm build:server` succeeds.

### Code quality

- **Lint:** Ran `pnpm lint --fix`; fixed remaining **errors** (not only warnings): unescaped entities (react/no-unescaped-entities) in NavigationView, gpx-export, gpx-simplification, settings-content, FeedbackSheet, OfflineTilePackSection, start-point-config, ZonePage; component display name (AIChatBubble); conditional hooks in NavigationView (moved useMemo and useMapLayerStore above early return); FileSystem.EncodingType in FeedbackSheet (use string `"base64"`); optional dynamic import (eslint-disable for leap-extract) in BetaFeaturesSection.
- **Format:** Ran `pnpm format` (Prettier) across the repo.
- **Typecheck:** `pnpm check` (tsc) and `pnpm build:server` run; server bundle builds.

### Dead code removed (per plan scope)

- **components/map-content.tsx:** Removed unused imports (Suspense, Route type, storage, MapStyleSheet, enrichRoute); removed unused lazy `ExtractContent` component.
- **components/planner-content.tsx:** Removed unused import `useFocusEffect`.
- **components/extract-content.tsx:** Removed unused import `ElevationStats`.
- **Not removed (per plan):** Unused exports in lib/overtureExtractService.ts, services/overtureOptimizerService.ts, lib/routing-context.tsx, stores/mapStateStore.ts. No files deleted.

### Tests

- **lib/plugins/__tests__/config.test.ts:** Updated to match current default plugin config (no longer expect overture/weather/gate plugins enabled by default); tests now assert config shape and routeOptimization.enabled only.
- **Still failing:** lib/__tests__/overtureExtractService.test.ts (3 tests, cache-key / WebSocket behavior). Not fixed (non-trivial).

### Documentation

- **CHANGELOG.md:** Created with Unreleased section (deps, lint/format fixes, test update, dead code, security audit) and [1.1.7] section.
- **README:** Not modified; already accurate.

### Version bump

- **package.json** and **app.json:** version set to **1.1.7**.
- **Backend (backend/app/main.py):** Left at 1.1.0 (not bumped in lockstep).

### Security (pnpm audit)

- **1 moderate:** esbuild (transitive via drizzle-kit chain); dev server request/response exposure; patched in esbuild >= 0.25.0.
- **1 low:** @tootallnate/once (transitive via genkit/Google Cloud); patched in >= 3.0.1.
- Both transitive; documented for follow-up. No direct dependency changes.

### Commits made

1. `chore(deps): update dependencies (patch/minor) and lockfile`
2. `style: lint and prettier fixes; fix ESLint errors (entities, display name, hooks); test: plugin config test; docs: CHANGELOG; chore: dead code removal; chore(release): bump to 1.1.7`
3. `style: prettier format (codebase)`

---

## 2. Remaining issues

- **Lint:** Many **warnings** remain (unused variables, array-type, react-hooks/exhaustive-deps, require() style imports, etc.). No blocking errors left after this pass.
- **Tests:** overtureExtractService.test.ts (3 failures) — cache-key / WebSocket expectations; would need implementation review to fix.
- **Security:** Two transitive vulnerabilities (esbuild, @tootallnate/once); require dependency chain or override changes.
- **Python:** pip-audit not run (backend); consider adding a lock file and running in venv.

---

## 3. Suggested next steps

- Address remaining ESLint warnings in batches (e.g. unused vars, array-type, exhaustive-deps).
- Fix or adjust overtureExtractService.test.ts to match current cache-key behavior.
- Plan transitive security fixes (esbuild / drizzle-kit; genkit deps).
- Run pip-audit in backend venv and add Python lock file if desired.
- When ready, plan major upgrades (Expo 55, React 19.2, etc.) with explicit approval and testing.
