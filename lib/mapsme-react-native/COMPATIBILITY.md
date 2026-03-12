# MAPS.ME Offline – Compatibility & Dependencies

This document summarizes compatibility of the MAPS.ME offline integration with the current trashroute-mobile stack and any dependency requirements.

## Verified compatibility (Feb 2025)

| Item                     | Status   | Notes                                                                                                                                                                     |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **React 19 / RN 0.81**   | ✅ Fixed | Removed deprecated `ViewPropTypes` and `PropTypes` from `MapsMeView.tsx` (RN dropped these; types are covered by TypeScript).                                             |
| **Expo 54**              | ✅       | Plugin uses `expo/config-plugins`; no known conflicts.                                                                                                                    |
| **Web / Metro**          | ✅       | `MapsMeModule.web.ts` and try/catch in `MapsMeView.tsx` provide a safe fallback so web builds do not require the native module.                                           |
| **TypeScript**           | ✅       | `MapsMeModule.web.ts` return type for `search()` corrected.                                                                                                               |
| **iOS plugin copy**      | ✅ Fixed | Plugin now copies `lib/mapsme-react-native/ios/MapsMeReactNative/` into `ios/MapsMeReactNative/` so the podspec is at the path root for `:path => './MapsMeReactNative'`. |
| **Podspec source_files** | ✅ Fixed | Updated from `MapsMeReactNative/**/*.{h,m,mm}` to `**/*.{h,m,mm}` to match the actual layout after copy.                                                                  |

## Dependency requirements

### JavaScript

- **Main app:** React 19.1.0, React Native 0.81.5, Expo ~54 – no extra npm packages required for MAPS.ME.
- **lib/mapsme-react-native/package.json:** Declares peer deps `react` and `react-native`; the app uses newer versions. This may produce peer dependency warnings but is acceptable; no `prop-types` or `ViewPropTypes` usage remains.

### iOS native (MAPS.ME framework)

The native bridge **depends on the MAPS.ME (OMIM) framework**:

1. **Pod dependency**  
   `lib/mapsme-react-native/ios/MapsMeReactNative/MapsMeReactNative.podspec` has:

   ```ruby
   s.dependency 'CoreApi'
   ```

   `CoreApi` is not on the public CocoaPods spec repo; it comes from the MAPS.ME/OMIM ecosystem.

2. **Header/framework paths**  
   `plugins/withMapsMe.js` adds to the Xcode project:
   - `FRAMEWORK_SEARCH_PATHS`: `$(PROJECT_DIR)/../iphone/Maps`
   - `HEADER_SEARCH_PATHS`: `$(PROJECT_DIR)/../iphone/Maps/include`

   So the build expects the MAPS.ME framework (or equivalent) at **project_root/iphone/Maps**. That directory is **not** in the repo; it must be supplied (e.g. from [mapsme/omim](https://github.com/mapsme/omim) or a vendored SDK).

3. **Native code imports**  
   `MapsMeViewManager.mm` imports MAPS.ME headers, e.g.:
   - `MapViewController.h`, `Framework.h`, `MWMFrameworkHelper.h`, `EAGLView.h`
   - `map/framework.hpp`, `map/framework_light.hpp`

Until the MAPS.ME framework (or a compatible build that provides these headers and the `CoreApi` pod) is present at the expected location and in the Podfile, **iOS builds that use the MAPS.ME native module will fail**. The JS/Expo side is compatible; the blocker is the native SDK.

## Summary

- **JS/Expo/TypeScript:** Compatible with current trashroute-mobile; known issues (ViewPropTypes, PropTypes, web module, plugin copy, podspec) are addressed.
- **iOS native:** Requires the MAPS.ME framework and `CoreApi` (or equivalent) to be installed and configured; without them, only the web/fallback path runs.
