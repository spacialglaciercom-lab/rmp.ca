# Plugin development

This doc describes the app’s plugin system (OsmAnd-style): how to add plugins, configure them, and test/deploy.

## Overview

- **Registry**: Built-in plugins are in `lib/plugins/` (weather, routeOptimization, overture, overture-extraction). Each plugin implements the `Plugin` interface (`lib/plugins/types.ts`).
- **Settings**: Users enable/disable plugins in **Settings → Plugins**. State is stored in Zustand and persisted to AsyncStorage. Optional Firestore sync can be added for cross-device (e.g. `settings.plugins` in a user doc).
- **Config**: Defaults come from `lib/plugins/default-config.json`. Per-plugin overrides (apiKeys, endpoints) live in `lib/plugins/[id]/config.json` and are merged at load time.

## Plugin layout

```
lib/plugins/
├── types.ts           # Plugin, PluginContext, ExtractResult, etc.
├── registry.ts        # registerPlugin, getPlugin, unloadPlugin
├── config.ts          # loadPluginConfig (merges default + per-plugin config.json)
├── load.ts            # BUILTIN_PLUGINS, createPluginContext, loadAndRegisterPlugins
├── default-config.json
├── weather/
│   ├── index.ts
│   └── config.json    # apiKey, endpoint
├── overture-extraction/
│   ├── index.ts
│   └── config.json    # extractUrl, wsBase
├── overture/
├── route-optimization/
└── dev/               # Dev-only plugin for logging (see Debugging)
```

## Adding a plugin

1. **Implement** a module in `lib/plugins/[id]/index.ts`:

   ```ts
   import type { Plugin } from "../types";
   export const myPlugin: Plugin = {
     id: "my-plugin",
     name: "My Plugin",
     description: "…",
     version: "1.0.0",
     initialize(context) {
       /* optional */
     },
     destroy() {
       /* optional */
     },
     getFeatures() {
       // Return a record of feature keys → implementations. Known keys: mapLayer, dataProvider, widget, routeOptimizer, extractService (see types.ts).
       return {
         /* e.g. widget: { ... } */
       };
     },
   };
   ```

2. **Register** in `lib/plugins/load.ts`: add to `BUILTIN_PLUGINS` and ensure the plugin id is present in `default-config.json` (and optionally in a per-plugin `config.json`).
3. **Config** (optional): add `lib/plugins/[id]/config.json` with `enabled`, `apiKey`, endpoints, etc. If you add a per-plugin config, add the id to `PLUGIN_CONFIG_MAP` in `config.ts` and add the corresponding import so it’s loaded and merged.

## Configuration (OsmAnd-style)

- **Default**: `lib/plugins/default-config.json` defines `plugins[id].enabled` and shared defaults.
- **Per-plugin**: `lib/plugins/[id]/config.json` overrides for that plugin (apiKeys, endpoints). Loaded at build time and merged in `loadPluginConfig()`.
- **Runtime**: User toggles in Settings are stored in `pluginStore` (Zustand + AsyncStorage). Remote overrides (e.g. Firebase Remote Config) can be wired in `loadPluginConfig()` later.

## Cross-platform run

- **Web**: `pnpm dev` (starts Expo for web on port 19007); `pnpm build` or `pnpm build:web` for production export.
- **Android**: `pnpm mobile:android` (Expo start + Android). Use Expo dev client for hot reload.
- **iOS**: `pnpm mobile:ios` or `pnpm mobile`.
- **Full stack**: `pnpm dev:all` runs Expo and the Node server together.

## Testing

- **Unit (Vitest)**: Plugin init and features are tested under `lib/plugins/__tests__/`. Run:
  ```bash
  pnpm test -- lib/plugins
  ```
- **Mocks**: Use `vi.mock('@/lib/…')` to mock services (e.g. overture extract). For tRPC, use MSW (Mock Service Worker) for network-level mocks if you add API tests.
- **UI**: Use React Native Testing Library for component tests; run on emulators (Android Studio) or physical devices.
- **E2E**: Test on Android emulator (`pnpm mobile:android`) and web (`pnpm web` or `pnpm dev`) to verify plugin toggles and features.

## Debugging

- **Expo**: Use Expo’s dev tools / inspector for logs and performance.
- **React Native**: Flipper or React DevTools for RN debugging.
- **Dev plugin**: A dev-only plugin in `lib/plugins/dev/` can expose a `log` (or similar) feature to dump plugin state, last actions, or backend responses. Enable it only when `__DEV__` is true (e.g. register in `load.ts` only in development).

## Deployment

- **Web**: `pnpm build` (or `pnpm build:web`) → output in `dist/`; deploy to **Vercel** (see `vercel.json`: buildCommand, outputDirectory, rewrites).
- **Server**: `pnpm build:server` → `dist/`; run with `pnpm start`. Deploy to your Node host (e.g. Vercel serverless or a Node server).
- **Mobile (EAS)**: Use EAS Build for Android/iOS: `pnpm eas:ios` or `pnpm eas:android` (or `pnpm build:android`). Use Expo dev client for hot reload during development.
- **GCP**: `cloudbuild.yaml` at repo root builds and deploys the API to Cloud Run; update image name and region if needed.

## Security and performance

- **API keys**: Keep keys in `.env` (and `.env.example` without values). Never commit secrets. Plugins that need keys should read from env or from a secure store (e.g. Expo SecureStore for sensitive values).
- **Bundles**: Use code splitting (e.g. lazy components in plugins) to keep initial bundle small. Monitor with Firebase Performance or similar.
- **Analytics**: Use Firebase Analytics (or your existing setup) to monitor usage and errors; optional plugin-level events for feature adoption.
