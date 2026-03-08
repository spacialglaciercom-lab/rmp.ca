# Plan: Full Offline Map Tiles Overlay

## Goal

Make the **map tiles overlay** (base map drawn on top of R2 / Overture) work **fully offline** when the user has downloaded offline data (MapLibre tile pack and/or R2 PMTiles). Today, with "Map tiles on top" enabled, the overlay uses `tile.openstreetmap.org`, which requires network.

---

## Current State

| Piece | Behavior |
|-------|----------|
| **Base style (no Overture)** | `mapStyle={MAPLIBRE_STYLE_OSM}` (demotiles.maplibre.org). Offline pack is keyed by this URL → tiles served from pack when downloaded. |
| **Overture on (any mode)** | `mapStyle={buildOvertureStyleUri(...)}` → inline style (data URI). Base raster = `tile.openstreetmap.org` → always network. Offline pack is **not** used because the map never loads the pack’s style URL. |
| **Map tiles as overlay** | Inline style layer order: R2 layers first, then `osm-raster` (OSM tiles) on top with opacity. Same network dependency. |
| **R2 PMTiles** | Can be downloaded to local file; inline style still uses remote `pmtiles://https://...`. Local file path not used in style today. |

So for full offline we need:

1. **Offline base/overlay tiles** – either use the existing MapLibre offline pack for the overlay, or add a local raster source.
2. **Offline R2 when downloaded** – use local PMTiles path in the style or in a dynamic source when the file exists.

---

## Options

### A. Base style URL + dynamic layers (recommended)

**Idea:** When Overture (and optionally “map tiles on top”) is on, **stop using the inline style**. Use the same **style URL** as when Overture is off (`MAPLIBRE_STYLE_OSM` or `MAPLIBRE_STYLE_OSM_DARK`) so the **offline pack is used** for all tiles that come from that style. Add R2 and, if needed, the overlay raster as **dynamic sources/layers** (e.g. `VectorSource`, `RasterSource`) on top.

**Pros**

- Reuses existing offline pack; no new download type.
- One style URL for “base” and “overlay” tiles (demotiles) → pack applies.
- Clear separation: style = base + optional overlay raster, dynamic = R2.

**Cons**

- Depends on MapLibre React Native supporting:
  - `VectorSource` with `url="pmtiles://..."` (or equivalent) so R2 works.
  - `RasterSource` with `tileUrlTemplates` pointing at demotiles so the overlay uses the same tile set (and thus the same pack when offline).
- May require registering a **pmtiles protocol** (or using a local PMTiles URL) so R2 works from a downloaded file.

**Steps (high level)**

1. When `showOverture` is true, set `mapStyle` to **base style URL** (not inline style).
2. Ensure **pmtiles protocol** is registered (e.g. in app layout or map container) so `pmtiles://` is resolved (remote or, if supported, local file).
3. Add **VectorSource** (id e.g. `overture-transportation`) with `url={getPMTilesUrl(city)}` and, when R2 is downloaded for that city, prefer **local PMTiles path** (e.g. `file://...` or a custom `pmtiles://file/...` if the stack supports it). Add existing Overture line/symbol layers as children.
4. If **mapTilesAsOverlay** is true, add a **RasterSource** (and one **RasterLayer**) that uses the **same tile URLs as the base style** (demotiles.maplibre.org), with the desired opacity, so the overlay is drawn on top of R2. Rely on the native cache/offline pack for those URLs when offline.
5. Verify offline: create pack for `MAPLIBRE_STYLE_OSM`, then open map with Overture on + “map tiles on top” and confirm base and overlay tiles load from pack and R2 from local file (or from cache if only remote PMTiles).

---

### B. Local raster tile pipeline (custom protocol)

**Idea:** Download **raster tiles** (e.g. `{z}/{x}/{y}.png`) for a region/bbox and zoom range into app storage. Register a **custom protocol** (e.g. `offline-raster://`) that serves tiles from that storage. In the Overture inline style, when “map tiles as overlay” is on and a matching offline region exists, set the raster source to `tileUrlTemplates: ["offline-raster://.../{z}/{x}/{y}.png"]` (or whatever the native SDK allows).

**Pros**

- Full control over overlay tiles; can use OSM or other raster sources.
- Works with current inline style; no need to switch to base style URL + dynamic layers.

**Cons**

- New download and storage pipeline (raster tiles per z/x/y).
- More storage and complexity (tile count can be large).
- Requires custom protocol support in MapLibre React Native and a stable path/layout for stored tiles.

**Steps (high level)**

1. Define storage layout for offline raster tiles (e.g. `{regionId}/{z}/{x}/{y}.png`).
2. Add a download flow (e.g. in Settings) to fetch tiles for a bbox/zoom range (e.g. from OSM or demotiles) and save to that layout.
3. Register a custom protocol that, for a request like `offline-raster://{regionId}/{z}/{x}/{y}.png`, reads from the same path under app storage and returns the image bytes.
4. In `buildOvertureStyle`, when `mapTilesAsOverlay` is true and a “current” offline raster region is known (e.g. from map center or last used region), use that region’s tile URL template for the raster source; otherwise keep using OSM/demotiles (network).
5. Persist “last used offline raster region” (or derive from viewport) so the map knows which pack to use.

---

### C. Hosted “combined” style + pack for it

**Idea:** Maintain a **combined style JSON** (base layers from demotiles + Overture source + layers + optional overlay raster) at a **stable URL** (e.g. your app’s backend or a CDN). Users create an **offline pack for that URL**. Map always loads that URL when Overture (and overlay) is on, so the pack serves all tiles when offline.

**What the combined style contains**

- **Sources:** Same raster source as demotiles (e.g. `https://demotiles.maplibre.org/...` for tiles), plus the Overture vector source with `url: "pmtiles://https://...R2.../montreal-v2026-02.pmtiles"` (or a placeholder city; see below).
- **Layers:** Base raster layer(s) from the demotiles style, then Overture road layers, then (if overlay mode) a second raster layer on top with opacity. So one JSON = base + R2 + optional map-tiles overlay.
- **City in style:** Either (1) one combined style per city (e.g. `https://your-cdn.com/styles/overture-overlay-montreal.json`) so the pack’s style URL includes the city, or (2) one style with a placeholder PMTiles URL and the app rewrites the source at load time (then pack is keyed by one URL but R2 is still dynamic).

**Where to host**

- Backend: e.g. `GET /api/map-style/overture-overlay?city=montreal` returns the combined JSON (build from `buildOvertureStyle` + demotiles base).
- Or static CDN: commit generated style JSON to the repo or a bucket, e.g. `https://your-app.com/styles/overture-overlay-montreal.json`.

**Pack creation**

- In Settings → Offline map tiles, add an option: “Download for Overture + map tiles on top.”
- When chosen, call `createPack({ name, styleURL: COMBINED_STYLE_URL, bounds, minZoom, maxZoom })` where `COMBINED_STYLE_URL` is the hosted combined style (e.g. per-city or single URL). The SDK will fetch that style and cache all tile URLs referenced in it (demotiles raster). R2 PMTiles are a separate source; the pack may or may not cache vector tiles depending on the SDK—often only raster/sprites/glyphs from the style are packed, so R2 would still need local download or protocol for full offline.

**Pros**

- Single style URL for the “Overture + overlay” mode; pack semantics stay simple.
- No need for dynamic sources in the map component when using this style.

**Cons**

- Requires hosting and versioning the style JSON.
- Pack creation must use that URL; need to document “download offline map for Overture+overlay” and pass that URL to `createPack`.
- R2 still needs to work offline (local PMTiles or cached); style alone doesn’t fix that. So you still need path A’s “local R2” or protocol behavior for full offline.

---

## Recommended path: A (base style URL + dynamic layers)

1. **Use base style URL when Overture is on**  
   In `MapLibreRouteMap`, when `showOverture` is true, set `mapStyle` to `MAPLIBRE_STYLE_OSM` or `MAPLIBRE_STYLE_OSM_DARK` (same as when Overture is off). Remove use of `buildOvertureStyleUri` for the main style so the **offline pack is always used** for base (and, in step 3, overlay) tiles.

2. **Register pmtiles protocol once**  
   Ensure the app registers the pmtiles custom protocol (e.g. in `_layout.tsx` or the map screen) so that `pmtiles://` URLs work. Extend the handler so that when the URL refers to a **local file** (e.g. after downloading R2), it uses the local path (e.g. `getRegionDir(cityId) + "/" + cityId + "-" + PMTILES_VERSION + ".pmtiles"`) and serves from that file.

3. **Add Overture as dynamic layers**  
   When `showOverture` is true, render:
   - **VectorSource** with `id="overture-transportation"` and `url` = remote PMTiles URL or, if a local R2 file exists for the current city, a URL that the pmtiles handler understands (e.g. `pmtiles://file/...` or a custom scheme pointing at the local path).
   - Same Overture line/symbol layers as today (as children of this source or via layer config that references this source).

4. **Add “map tiles overlay” as dynamic raster layer**  
   When `mapTilesAsOverlay` is true, render:
   - **RasterSource** with tile URL template(s) that match the **demotiles.maplibre.org** tile endpoints used by `MAPLIBRE_STYLE_OSM` (or the dark style). Use the same tile URL pattern the style uses so the **same offline pack** that was created for that style URL serves these tiles.
   - **RasterLayer** on top with the desired opacity (e.g. 0.55).

5. **Local R2 when downloaded**  
   - Add a helper e.g. `getOverturePmtilesUrl(cityId: string): Promise<string>` that checks for a downloaded R2 file under `getRegionDir(cityId)` and returns either a **local** URL (for the custom protocol) or the remote `pmtiles://https://...` URL.
   - Use that in the VectorSource so that when the user has downloaded R2 for the current city, the map uses the local file and works offline.

6. **Settings / UX**  
   - In **Offline tile pack** (or Map Layers), clarify: “For offline map with Overture and ‘Map tiles on top’, download both: (1) MapLibre offline tiles (this section) and (2) R2 tiles for your region (Offline Map Download).”
   - Optionally: when Overture is on and “Map tiles on top” is on, show a small hint if no pack or no R2 is downloaded (“Download offline tiles and R2 for full offline”).

7. **Fallback**  
   If dynamic VectorSource with `pmtiles://` fails on some platforms (e.g. protocol not invoked), keep a **fallback** to the current inline style when offline detection or a feature flag says so, so the map still shows something (e.g. base only or inline style with network).

---

## File touch list (for path A)

| File / area | Change |
|-------------|--------|
| `app/_layout.tsx` or map screen | Register pmtiles protocol once; extend for local file when URL indicates local path. |
| `lib/offline-map-download.ts` | Add `getOverturePmtilesUrl(cityId)` (or similar) returning remote URL or local file URL for current city. |
| `components/maplibre/MapLibreRouteMap.tsx` | When `showOverture`: use base style URL; render VectorSource + Overture layers; when `mapTilesAsOverlay`, render RasterSource + RasterLayer (demotiles URLs, opacity). Use `getOverturePmtilesUrl(resolvedCity)` for VectorSource url. |
| `components/maplibre/overture-style.ts` | Keep `buildOvertureStyle` for web or fallback; optional: export demotiles tile URL template for the overlay RasterSource. |
| `components/maplibre/constants.ts` | Optional: export demotiles tile template for overlay (e.g. from style or a constant). |
| `components/settings/OfflineTilePackSection.tsx` | Short copy update: “Also download R2 in Offline Map Download for full offline with Overture and map tiles on top.” |
| `components/mapTab/layers/LayerPicker.tsx` | Optional: when “Map tiles on top” is on, show hint “Download offline tiles + R2 for offline.” |

---

## Verification

- **Offline pack only:** Overture off → map uses base style URL → tiles from pack. ✓ (already works when Overture is off.)
- **Offline pack + R2, Overture on, overlay off:** Base style URL + VectorSource (local R2) → base from pack, R2 from file. ✓
- **Offline pack + R2, Overture on, overlay on:** Base style URL + VectorSource (local R2) + RasterSource (demotiles) + RasterLayer on top → all from pack + local R2. ✓
- **No pack, no R2:** Map still loads; base and R2 from network (or graceful degradation). ✓

---

## Out of scope for this plan

- **Web:** Map tab on web uses Leaflet; this plan targets native MapLibre (iOS/Android). Web offline would need a separate approach (e.g. Leaflet offline tile layer or MapLibre GL JS + service worker / cache).
- **OSM PBF as visual layer:** OSM PBF is used for extraction/routing, not as a map layer. “Map tiles overlay” here is raster (or style-based) tiles on top of R2; no change to OSM PBF rendering in this plan.
