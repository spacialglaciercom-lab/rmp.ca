# Changes Report: Past 24 Hours & Local Folder

**Generated:** Wednesday, March 11, 2026  
**Repository:** `rmp.ca` (workspace root: `c:\Users\Space\OneDrive\Desktop\rmp.ca\rmp.ca`)

---

## 1. Summary

- **Commits in past 24 hours:** 3  
- **Author:** spacialglaciercom-lab (with Co-Author: Claude Sonnet 4.6)  
- **Focus:** Extractor/Overture panel visibility and pointer events, pre-optimization intersection avoidance, extract backend proxy and Metro bundler crash fix.  
- **Local state:** Working tree has **588** files in `git status` (mix of modified and untracked). No staged changes. Many untracked files under `app/`, `components/`, `docs/`, etc., and several modified tracked files (e.g. `README.md`, `app.config.ts`, `babel.config.js`, `cloudbuild.yaml`, `drizzle.config.ts`, `eas.json`, `docker-compose.yml`, `global.css`, config files, and various components).

---

## 2. Commits (Last 24 Hours)

### Commit 1 — `08da1f1` (Wed Mar 11, 2026 11:48:24 -0400)

**Subject:** fix(extractor): restore panel visibility, fix pointer events, and misc improvements

**Message:**
- OvertureExtractorGlobalSheet: restore `top: 0` so the absolute overlay has full-screen height — percentage heights on children (BottomSheet's 45%) resolved to 0 after top was removed, making the panel invisible.
- BottomSheet: replace full-screen inline overlay with bottom-anchored `overlayInlineBottomOnly` (height 45%) and add `pointerEvents=box-none` throughout so the map receives touches while the extractor panel is open.
- useOvertureOptimizeRoute: switch to full display mode after optimization (was minimal); clear preview route on failure to avoid stale map state.
- displayModeStore: default initial mode to full instead of minimal.
- overtureOptimizerService: surface hint field in 503 errors; add 5s AbortSignal timeout to healthCheck; parse error.error field.
- offline-extract: check any coordinate inside polygon (not just first); prioritize Overture class/road_class property over OSM highway tag.
- planner-content: show correct graph-source log message based on optimizer.
- oauth: treat ports 8081 and 8080 as dev ports that proxy to :3000.
- docs: add DOCKER.md.

**Files changed (15):**  
`backend/app/vector_clean.py` · `components/extract-content.tsx` · `components/mapTab/overture/OvertureExtractorGlobalSheet.tsx` · `components/osm-import.tsx` · `components/planner-content.tsx` · `components/shared/BottomSheet.tsx` · `docs/DOCKER.md` (new) · `hooks/useOvertureOptimizeRoute.ts` · `hooks/useRouteOptimization.ts` · `lib/geojsonToOsmData.ts` · `lib/offline-extract.ts` · `lib/turnAwareGraph.ts` · `services/overtureOptimizerService.ts` · `shared/oauth.ts` · `stores/displayModeStore.ts`  
**Diff summary:** +115 / -253 lines.

---

### Commit 2 — `672e6d4` (Tue Mar 10, 2026 17:57:16 -0400)

**Subject:** feat(extract): avoid intersections by clicking nodes before optimizing

**Message:**  
Add pre-optimization intersection filtering to the Overture extract tab. After previewing roads, users can click intersection nodes on the map to mark them as avoided (red); the optimizer then skips those junctions.

- geojsonToOsmData: export IntersectionNode + computeIntersectionNodes().
- turnAwareGraph: accept avoidedIntersections set, apply 999999 penalty.
- useRouteOptimization: thread avoidedIntersections option to graph builder.
- extract-content: render clickable circle layer after preview, pre-filter avoided segments before sending to remote partitionZonesFromGeoJSON, show badge with count + Clear button.

**Files changed (4):**  
`components/extract-content.tsx` · `hooks/useRouteOptimization.ts` · `lib/geojsonToOsmData.ts` · `lib/turnAwareGraph.ts`  
**Diff summary:** +229 / -8 lines.

---

### Commit 3 — `63c629a` (Tue Mar 10, 2026 17:00:21 -0400)

**Subject:** fix: proxy /geojson/:hash and /download/:hash to extract backend, fix Metro _moduleResolver crash

**Message:**
- server/wsExtractProxy: add `registerExtractHttpProxyRoutes()` proxying GET `/geojson/:hash` and GET `/download/:hash` to UPSTREAM_HTTP (same extract service as the WebSocket proxy); fixes "Not found" 404 when the client fetches extraction results after WebSocket completes.
- server/_core/index: register extract HTTP proxy routes; document new endpoints in GET / listing.
- patches/metro+0.83.3: extend patch to re-throw in Bundler.js `.catch` (so DependencyGraph init errors are not swallowed) and add a guard in DependencyGraph.resolveDependency for undefined `_moduleResolver`.
- components/VRPPlanner: open Advanced options panel by default on web.

**Files changed (6):**  
`README.md` · `components/VRPPlanner.tsx` · `docker-compose.yml` · `patches/metro+0.83.3.patch` (new/extended) · `server/_core/index.ts` · `server/wsExtractProxy.ts` (new)  
**Diff summary:** +95 / -11 lines.

---

## 3. Local Folder Overview

### 3.1 Git state

- **Branch:** (from initial snapshot; run `git branch -v` for current.)
- **Staged changes:** None.
- **Working tree:** 588 files reported by `git status --porcelain` (modified and/or untracked).
- **Line endings:** Many files show “LF will be replaced by CRLF” warnings (Windows).

### 3.2 Top-level directories (local)

Present at repo root:

- **App / UI:** `.agents`, `.claude`, `.expo`, `.idea`, `.snapshots`, `.zai`, `app`, `assets`, `components`, `constants`, `context`
- **Data / config:** `data`, `drizzle`, `docs`, `patches`, `plugins`, `scripts`, `shared`, `stores`, `types`, `utils`
- **Backend / services:** `backend`, `server`, `services`, `modules`, `stubs`
- **Frontend / libs:** `hooks`, `lib`, `src`
- **Build / env:** `dist`, `node_modules`

### 3.3 Notable local (uncommitted) areas

From the initial git status snapshot:

- **Modified (M):** e.g. `README.md`, `app.config.ts`, `app.json`, `babel.config.js`, `cloudbuild.yaml`, `drizzle.config.ts`, `eas.json`, `docker-compose.yml`, `global.css`, `google-services.json`, and files under `components/` (e.g. `extract-content.tsx`, `planner-content.tsx`).
- **Untracked (??):** Many under `app/`, `components/`, `docs/`, `lib/`, `hooks/`, `context/`, `constants/`, `drizzle/`, plus config/agent/snapshot files (`.agents/`, `.claude/`, `.env.server`, `.snapshots/`, `.zai/`), and backend/test/fixture files.

So locally you have both committed history (the 3 commits above) and a large set of modified/untracked files that are not in the “past 24 hours” commits.

---

## 4. Technical Highlights from Commits

| Area | Change |
|------|--------|
| **Extractor UI** | Overture panel visible again via `top: 0` and bottom-only overlay; map stays touchable with `pointerEvents="box-none"`. |
| **BottomSheet** | New `overlayInlineBottomOnly` (45% height, bottom-anchored) for inline mode so map can receive touches. |
| **Intersection avoidance** | Click-to-avoid nodes before optimize; `avoidedIntersections` passed through to turn-aware graph (999999 penalty). |
| **Extract API** | Dev server proxies `/geojson/:hash` and `/download/:hash` to extract backend; fixes 404 after WebSocket completion. |
| **Metro** | Patch rethrows transformer/init errors and guards `_moduleResolver` in DependencyGraph to avoid silent crash. |
| **Docs** | `docs/DOCKER.md` added: run full stack from parent folder with Docker Compose; env vars for local API/optimizer/extract URLs. |

---

## 5. Files Touched by Commits (Past 24h)

| File | Commits |
|------|--------|
| `components/extract-content.tsx` | 08da1f1, 672e6d4 |
| `hooks/useRouteOptimization.ts` | 08da1f1, 672e6d4 |
| `lib/geojsonToOsmData.ts` | 08da1f1 (removed code), 672e6d4 (added) |
| `lib/turnAwareGraph.ts` | 08da1f1, 672e6d4 |
| All others | One commit each |

---

*End of report. For exact current branch and latest diff, run `git branch -v` and `git status` / `git diff` in the repo.*
