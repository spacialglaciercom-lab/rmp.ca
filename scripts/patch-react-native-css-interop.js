/**
 * Postinstall script: apply NativeWind SafeAreaView fix to react-native-css-interop.
 * Uses SafeAreaView from react-native-safe-area-context so className works correctly.
 * Replaces patch-package for this change to avoid parse errors on EAS (Linux).
 */
const fs = require("fs");
const path = require("path");

const targetPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "react-native-css-interop",
  "dist",
  "runtime",
  "components.js"
);

if (!fs.existsSync(targetPath)) {
  console.warn("patch-react-native-css-interop: components.js not found, skipping");
  process.exit(0);
}

let content = fs.readFileSync(targetPath, "utf8");

if (content.includes("SafeAreaViewContext")) {
  // Already patched
  process.exit(0);
}

const line1 =
  "(0, api_1.cssInterop)(react_native_1.SafeAreaView, { className: \"style\" });";
const replacement1 = `const SafeAreaViewContext = require("react-native-safe-area-context").SafeAreaView;
(0, api_1.cssInterop)(SafeAreaViewContext, { className: "style" });`;

const blockToRemove = /try \{\s+const SafeAreaView = require\("react-native-safe-area-context"\)\.SafeAreaView;\s+\(0, api_1\.cssInterop\)\(SafeAreaView, \{\s+className: "style",\s+\}\);\s+\}\s+catch \{ \}\s+/;

if (!content.includes(line1)) {
  console.warn("patch-react-native-css-interop: unexpected file content, skipping");
  process.exit(0);
}

content = content.replace(line1, replacement1).replace(blockToRemove, "");

fs.writeFileSync(targetPath, content, "utf8");
console.log("patch-react-native-css-interop: applied SafeAreaView fix");
