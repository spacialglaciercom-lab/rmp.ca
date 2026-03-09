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
  config.resolver = config.resolver || {};
  config.resolver.useWatchman = false;
}

const configWithNativeWind = withNativeWind(config, {
  input: "./global.css",
});

// Apply our resolver on top of NativeWind's so we wrap (not replace) the chain.
// Avoids "Cannot read properties of undefined (reading 'get')" in Metro DependencyGraph.
const defaultResolveRequest = configWithNativeWind.resolver.resolveRequest;
if (typeof defaultResolveRequest !== "function") {
  throw new Error("metro.config.cjs: NativeWind did not set resolver.resolveRequest");
}

const projectRoot = __dirname;

const codegenStubPath = path.join(projectRoot, "lib", "metro-stubs", "react-native-codegen-web.js");
const rnmapboxStubPath = path.join(projectRoot, "lib", "metro-stubs", "rnmapbox-maps-web.js");
const rnmapsStubPath = path.join(projectRoot, "lib", "metro-stubs", "react-native-maps-web.js");
const rnwebviewStubPath = path.join(projectRoot, "lib", "metro-stubs", "react-native-webview-web.js");
const extensions = [".ts", ".tsx", ".js", ".jsx", ".json"];
// Always resolve 'buffer' to our shim (under projectRoot) so Metro never uses module name for SHA-1
const bufferShimPath = path.resolve(projectRoot, "lib", "buffer-shim.js");
configWithNativeWind.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "buffer") {
    return { type: "sourceFile", filePath: bufferShimPath };
  }
  if (platform === "web") {
    // Stub native-only modules so the web bundle never loads them
    if (moduleName === "react-native-codegen" || moduleName.startsWith("react-native-codegen/")) {
      return { type: "sourceFile", filePath: codegenStubPath };
    }
    if (moduleName === "@rnmapbox/maps" || moduleName.startsWith("@rnmapbox/maps/")) {
      return { type: "sourceFile", filePath: rnmapboxStubPath };
    }
    if (moduleName === "react-native-maps" || moduleName.startsWith("react-native-maps/")) {
      return { type: "sourceFile", filePath: rnmapsStubPath };
    }
    if (moduleName === "react-native-webview" || moduleName.startsWith("react-native-webview/")) {
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
  return defaultResolveRequest(context, moduleName, platform);
};

module.exports = configWithNativeWind;
