/**
 * Postinstall script: apply NativeWind fixes to react-native-css-interop.
 * 1. SafeAreaView: use react-native-safe-area-context so className works correctly.
 * 2. Metro getSha1: guard when graph._fileSystem is undefined (Expo 54 / Metro 0.83+).
 * Replaces patch-package for these changes to avoid parse errors on EAS (Linux).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "node_modules", "react-native-css-interop");

// --- 1. SafeAreaView fix (components.js) ---
const componentsPath = path.join(root, "dist", "runtime", "components.js");

if (fs.existsSync(componentsPath)) {
  let content = fs.readFileSync(componentsPath, "utf8");

  if (!content.includes("SafeAreaViewContext")) {
    const line1 =
      "(0, api_1.cssInterop)(react_native_1.SafeAreaView, { className: \"style\" });";
    const replacement1 = `const SafeAreaViewContext = require("react-native-safe-area-context").SafeAreaView;
(0, api_1.cssInterop)(SafeAreaViewContext, { className: "style" });`;

    const blockToRemove = /try \{\s+const SafeAreaView = require\("react-native-safe-area-context"\)\.SafeAreaView;\s+\(0, api_1\.cssInterop\)\(SafeAreaView, \{\s+className: "style",\s+\}\);\s+\}\s+catch \{ \}\s+/;

    if (content.includes(line1)) {
      content = content.replace(line1, replacement1).replace(blockToRemove, "");
      fs.writeFileSync(componentsPath, content, "utf8");
      console.log("patch-react-native-css-interop: applied SafeAreaView fix");
    }
  }
}

// --- 2. Metro getSha1 guard (dist/metro/index.js) ---
const metroPath = path.join(root, "dist", "metro", "index.js");

if (!fs.existsSync(metroPath)) {
  console.warn("patch-react-native-css-interop: metro/index.js not found, skipping Metro patch");
} else {
  let metroContent = fs.readFileSync(metroPath, "utf8");

  // Only patch if we haven't already (guard for graph._fileSystem)
  if (!metroContent.includes("graph._fileSystem && typeof graph._fileSystem.getSha1")) {
    const unsafe = "ensureFileSystemPatched(graph._fileSystem);";
    const safe =
      "if (graph._fileSystem && typeof graph._fileSystem.getSha1 === \"function\") { ensureFileSystemPatched(graph._fileSystem); }";

    if (metroContent.includes(unsafe)) {
      metroContent = metroContent.replace(unsafe, safe);
      fs.writeFileSync(metroPath, metroContent, "utf8");
      console.log("patch-react-native-css-interop: applied Metro getSha1 guard");
    }
  }
}
