# MAPS.ME / Offline Maps Setup

The project supports two ways to use offline maps:

1. **Open in app (default)** – Open a location in Organic Maps or MAPS.ME via URL. No native framework required.
2. **Embedded MAPS.ME** – Native map view inside the app. Requires the OMIM framework (advanced).

---

## 1. Open in Organic Maps / MAPS.ME (recommended)

No extra setup. The app can open the user’s installed **Organic Maps** or **MAPS.ME** with a location.

### Usage

```ts
import {
  openInOfflineMap,
  openInOrganicMaps,
  openInMapsMe,
  canOpenOrganicMaps,
} from "@/lib/offline-map-url";

// Open a location in the best available offline map app (Organic Maps preferred)
await openInOfflineMap(45.5, -73.5, "Collection point");

// Or target a specific app
await openInOrganicMaps(45.5, -73.5, "My pin");
await openInMapsMe(45.5, -73.5, "My pin");

// Check availability (iOS needs LSApplicationQueriesSchemes in Info.plist – already set)
const hasOrganic = await canOpenOrganicMaps();
```

### iOS

`LSApplicationQueriesSchemes` is already set in `app.config.ts` for `om`, `mapswithme`, and `mapswithmepro` so `Linking.canOpenURL` works.

### Android

Opening `om://` or `mapswithme://` uses the system handler; no extra config needed.

---

## 2. Embedded MAPS.ME (optional, advanced)

To show the MAPS.ME map **inside** the app on iOS, you must provide the **OMIM framework** (MAPS.ME’s native engine). It is not distributed as a CocoaPod; you have to build it from the [mapsme/omim](https://github.com/mapsme/omim) repo.

### Steps (summary)

1. **Clone OMIM** (large repo, use submodules):

   ```bash
   git clone --recursive https://github.com/mapsme/omim.git
   cd omim && ./configure.sh
   ```

2. **Build the iOS app/framework**  
   Follow [docs/INSTALL.md](https://github.com/mapsme/omim/tree/master/docs) and the iOS build instructions in the OMIM repo. This produces the native framework/artifacts.

3. **Place the framework in the project**  
   The current plugin expects the MAPS.ME framework at:

   ```text
   <project_root>/iphone/Maps
   ```

   So you need to copy or symlink the built framework so that path exists (e.g. put the `Maps` product from OMIM’s `iphone` build into `trashroute-mobile/iphone/Maps`).

4. **Enable the embedded plugin**  
   Set the env var so the Expo config includes the MAPS.ME native module:

   ```bash
   set EXPO_MAPME_EMBED=1
   npm run dev:metro
   ```

   For EAS/CI, set `EXPO_MAPME_EMBED=1` in the build environment.

5. **Prebuild and run**
   ```bash
   npx expo prebuild
   cd ios && pod install && cd ..
   npx expo run:ios
   ```

### When `EXPO_MAPME_EMBED` is not set

- The withMapsMe Expo plugin is **not** applied.
- The app builds and runs without the OMIM framework.
- `MapsMeMap` / `initializeMapsMeFramework()` still run but the native module is absent; the JS layer handles that and does not crash. Use **Open in app** (option 1) for offline maps in that case.

---

## Summary

| Mode             | Setup                   | Use case                         |
| ---------------- | ----------------------- | -------------------------------- |
| Open in app      | None                    | “Open in Organic Maps” / MAPS.ME |
| Embedded MAPS.ME | OMIM built + path + env | In-app native offline map (iOS)  |

For most users, **option 1** (URL API in `@/lib/offline-map-url`) is enough and does not require the MAPS.ME framework.
