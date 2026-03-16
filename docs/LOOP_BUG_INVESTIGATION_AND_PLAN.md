# Repetitive Looping Bug – Investigation & Remediation Plan

This document lists all identified places that could cause infinite or repetitive loops, and the remediation status.

---

## 1. **Extract tab – Map init effect (FIXED)**

**File:** `components/extract-content.tsx`

**Cause:** The MapLibre init `useEffect` depended on `[dimensions]`. `handleContainerLayout` runs on every layout and calls `setDimensions({ width: w, height: h })`, creating a **new object every time**. So:
- Layout fires → `setDimensions(newObject)` → effect runs → cleanup **removes the map** → effect body creates a new map.
- When the bottom sheet appears (after drawing a polygon), layout changes again → same cycle.
- If the map container’s layout is reported again after map creation, the cycle could repeat → **repetitive loop** (map constantly destroyed and recreated).

**Fix applied:**
- **Stabilize layout updates:** `handleContainerLayout` now only calls `setDimensions` when `width` or `height` actually change (using a ref to compare with previous values).
- **Stabilize effect deps:** Effect depends on `[dimensions?.width, dimensions?.height]` (primitives) instead of `[dimensions]`, so it only runs when size really changes, not when the same values are set with a new object reference.

---

## 2. **Tab screens – redirect effect (router in deps)**

**Files:**
- `app/(tabs)/record.tsx` – `useEffect(() => { if (!overtureExtractionEnabled) router.replace("/(tabs)"); }, [overtureExtractionEnabled, router]);`
- `app/(tabs)/zones.tsx` – same pattern with `zonesEnabled`
- `app/(tabs)/route.tsx` – same with `collectionRouteEnabled`
- `app/(tabs)/planner.tsx` – same with `routeOptimizerEnabled`

**Risk:** If `useRouter()` returns a new `router` reference on every render (or when the tab re-mounts), the effect runs every time and calls `router.replace("/(tabs)")`. That can cause a **navigation loop**: replace → unmount → remount → effect runs again → replace again.

**Remediation applied (Option A):** In all four tab screens, `router` is stored in a ref (`routerRef.current = router`) and the effect depends only on the plugin-enabled flag. The effect calls `routerRef.current.replace("/(tabs)")` so it no longer re-runs when the router reference changes.

**Status:** Fixed in `record.tsx`, `zones.tsx`, `route.tsx`, `planner.tsx`.

---

## 3. **PluginProvider – plugin reload effect**

**File:** `context/PluginProvider.tsx`

**Code:** `useEffect(() => { ... loadAndRegisterPlugins(ctx, ac.signal); return () => ac.abort(); }, [trpcClient, enabledPlugins]);`

**Risk:** `enabledPlugins` is the full object from `usePluginStore((s) => s.enabledPlugins)`. In Zustand, selecting the whole object can return a new reference when the store updates. So any plugin toggle could re-run this effect and **reload all plugins**. That is at most one extra run per toggle, not an infinite loop, unless plugin registration triggers another store update.

**Remediation:** If plugin reloads are observed too often, either:
- Depend on a serialized value, e.g. `JSON.stringify(enabledPlugins)`, or
- Use a ref to store the previous `enabledPlugins` and only run when the set of enabled plugin IDs actually changes.

**Status:** Low priority unless repeated reloads are observed.

---

## 4. **Root layout – safe area subscription**

**File:** `app/_layout.tsx`

**Code:** `subscribeSafeAreaInsets(handleSafeAreaUpdate)` where `handleSafeAreaUpdate` calls `setInsets(metrics.insets)` and `setFrame(metrics.frame)`.

**Risk:** If the parent (e.g. Manus runtime iframe) sends safe area messages repeatedly (e.g. on every frame or on every resize), this would trigger **frequent re-renders** of the root layout. That could look like a loop or severe jank.

**Remediation:** In `handleSafeAreaUpdate`, compare new `metrics.insets` and `metrics.frame` with current state (or refs) and only call `setInsets`/`setFrame` when values actually change.

**Status:** Check `lib/_core/manus-runtime.ts` and how often the message is sent. If in iframe and parent sends often, add a guard in the callback.

---

## 5. **Map content – actions dependency**

**File:** `components/map-content.tsx`

**Code:** `useEffect(() => { actions.loadRoute(); actions.loadImportedPoints(); }, [actions]);`

**Risk:** If `actions` is a new reference every render (e.g. an object created in the component or from a selector that returns a new object), this effect runs every render and repeatedly calls `loadRoute()` and `loadImportedPoints()` → repeated state updates → **possible loop**.

**Remediation:** Ensure `actions` is stable (e.g. from a store with a stable selector, or wrapped in `useCallback` / single reference). If it’s from a hook, that hook should return a stable `actions` object (same reference across renders unless the underlying data must change).

**Status:** Verify where `actions` comes from and that it’s stable.

---

## 6. **Extract – Partition button double fire (already guarded)**

**File:** `components/extract-content.tsx`

**Code:** `sendToZones` uses `zonePartitionInProgressRef` to prevent double-invoke; web also has `onClick` in addition to `onPress`.

**Status:** Already guarded; no further change needed for loop prevention.

---

## 7. **Native extract fallback – polygon from drawPoints**

**File:** `components/extract-content.tsx` (NativeExtractFallback)

**Code:** `useEffect(() => { if (drawPoints.length >= 3) { setPolygon(feat); setMetrics(...); } else { setPolygon(null); setMetrics(null); } }, [drawPoints]);`

**Risk:** This effect only runs when `drawPoints` changes. It does not by itself cause a loop unless something else (e.g. a parent or sibling effect) updates `drawPoints` on every render. No change needed unless a loop is traced to this path.

**Status:** No action unless evidence points here.

---

## 8. **General patterns to avoid**

- **Unstable effect deps:** Prefer primitive or stable refs in dependency arrays (e.g. `dimensions?.width` instead of `dimensions`).
- **setState in render:** Never call setState unconditionally during render (only in event handlers, useEffect, or conditional guards that can’t re-trigger render in a cycle).
- **Router in effect deps:** If the router object is not guaranteed stable, avoid putting it in deps for effects that perform navigation; use a ref or run only when a specific condition (e.g. “plugin just became disabled”) changes.
- **Layout → setState → layout:** If `onLayout` calls setState and that state is used in effect deps that do heavy work (e.g. create/destroy map), ensure setState is only called when layout values actually change (e.g. compare with previous in a ref).

---

## Summary

| Location                    | Risk level | Status / action                          |
|----------------------------|-----------|------------------------------------------|
| extract-content map effect | High      | **Fixed** – stable dimensions + primitive deps |
| Tab redirect effects       | Medium    | **Fixed** – router ref, deps only on plugin flag     |
| PluginProvider             | Low       | Optional: stabilize enabledPlugins deps  |
| Root safe area             | Low–Med   | Optional: guard in callback if messages are frequent |
| map-content actions effect | Medium    | Verify `actions` is stable               |
| Partition button           | -         | Already guarded                          |

If the loop persists after the extract-content fix, the next places to instrument or fix are: tab redirect effects (router in deps) and map-content `actions` stability.
