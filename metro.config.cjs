"use strict";

const path = require("path");
const fs = require("fs");

/**
 * CommonJS Metro config so Metro can load it via require() on Windows.
 * (ESM import() with absolute Windows path fails: "Received protocol 'c:'")
 */
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Avoid "Failed to start watch mode" on Windows (e.g. OneDrive/synced folders).
// Watchman can time out; Node watcher is more reliable here.
if (process.platform === "win32") {
  config.watcher = config.watcher || {};
  config.watcher.watchman = config.watcher.watchman || {};
  config.watcher.watchman.enabled = false;
}

// On Linux without watchman, Metro's FallbackWatcher calls fs.watch() on every
// subdirectory, quickly exhausting the default inotify limit (65536 watchers).
// Adding node_modules to blockList causes FallbackWatcher to skip those dirs,
// cutting the number of watchers from ~50k+ down to just the project source.
// Metro resolves node_modules via its own resolver (not the file watcher),
// so this doesn't break dependency resolution or hot reload.
if (process.platform === "linux") {
  config.resolver = config.resolver || {};
  const existing = config.resolver.blockList || [];
  const toArray = (v) =>
    Array.isArray(v) ? v : v instanceof RegExp ? [v] : [];
  config.resolver.blockList = [
    ...toArray(existing),
    /.*\/node_modules\/.*/,
    /.*\/\.git\/.*/,
    /.*\/android\/build\/.*/,
    /.*\/ios\/build\/.*/,
    /.*\/dist\/.*/,
    /.*\/\.expo\/.*/,
  ];
}

// Set our custom resolver BEFORE withNativeWind so NativeWind wraps it.
// Fall through via context.resolveRequest (Metro's default resolver chain).
const projectRoot = __dirname;

const codegenStubPath = path.join(
  projectRoot,
  "lib",
  "metro-stubs",
  "react-native-codegen-web.js",
);
const rnmapboxStubPath = path.join(
  projectRoot,
  "lib",
  "metro-stubs",
  "rnmapbox-maps-web.js",
);
const rnmapsStubPath = path.join(
  projectRoot,
  "lib",
  "metro-stubs",
  "react-native-maps-web.js",
);
const rnwebviewStubPath = path.join(
  projectRoot,
  "lib",
  "metro-stubs",
  "react-native-webview-web.js",
);
const extensions = [".ts", ".tsx", ".js", ".jsx", ".json"];
// Always resolve 'buffer' to our shim (under projectRoot) so Metro never uses module name for SHA-1
const bufferShimPath = path.resolve(projectRoot, "lib", "buffer-shim.js");
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "buffer") {
    return { type: "sourceFile", filePath: bufferShimPath };
  }
  if (platform === "web") {
    // Stub native-only modules so the web bundle never loads them
    if (
      moduleName === "react-native-codegen" ||
      moduleName.startsWith("react-native-codegen/")
    ) {
      return { type: "sourceFile", filePath: codegenStubPath };
    }
    if (
      moduleName === "@rnmapbox/maps" ||
      moduleName.startsWith("@rnmapbox/maps/")
    ) {
      return { type: "sourceFile", filePath: rnmapboxStubPath };
    }
    if (
      moduleName === "react-native-maps" ||
      moduleName.startsWith("react-native-maps/")
    ) {
      return { type: "sourceFile", filePath: rnmapsStubPath };
    }
    if (
      moduleName === "react-native-webview" ||
      moduleName.startsWith("react-native-webview/")
    ) {
      return { type: "sourceFile", filePath: rnwebviewStubPath };
    }
  }
  if (moduleName.startsWith("@/")) {
    const subpath = moduleName.slice(2);
    const basePath = path.join(projectRoot, subpath);
    // Prefer platform-specific file first (e.g. NavigationView.web.tsx on web) so web never loads react-native-maps
    if (platform && platform !== "undefined") {
      for (const ext of extensions) {
        const platformPath = basePath + "." + platform + ext;
        if (fs.existsSync(platformPath)) {
          return { type: "sourceFile", filePath: platformPath };
        }
      }
    }
    for (const ext of extensions) {
      const filePath = basePath + ext;
      if (fs.existsSync(filePath)) {
        return { type: "sourceFile", filePath };
      }
    }
    // Directory index (e.g. @/lib/foo -> lib/foo/index.ts)
    const indexPath = path.join(projectRoot, subpath, "index");
    if (platform && platform !== "undefined") {
      for (const ext of extensions) {
        const platformPath = indexPath + "." + platform + ext;
        if (fs.existsSync(platformPath)) {
          return { type: "sourceFile", filePath: platformPath };
        }
      }
    }
    for (const ext of extensions) {
      const filePath = indexPath + ext;
      if (fs.existsSync(filePath)) {
        return { type: "sourceFile", filePath };
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, {
  input: "./global.css",
});
