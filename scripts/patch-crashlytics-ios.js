/**
 * Postinstall: fix @react-native-firebase/crashlytics iOS build (RCTBridgeModule must be imported
 * from module RNFBApp.RNFBAppModule). Adds RNFBAppModule import before RCTBridgeModule so the
 * compiler sees it in the correct module context. Works with pnpm and on EAS.
 *
 * @see https://github.com/invertase/react-native-firebase/issues/8452
 * @see patch-firestore-ios.js for RNFBFirestoreModule.h fix (same pattern)
 */
const fs = require("fs");
const path = require("path");

function findCrashlyticsRoot() {
  try {
    const resolved = require.resolve("@react-native-firebase/crashlytics/package.json");
    return path.dirname(resolved);
  } catch {
    const fromNodeModules = path.join(
      __dirname,
      "..",
      "node_modules",
      "@react-native-firebase",
      "crashlytics"
    );
    if (fs.existsSync(fromNodeModules)) return fromNodeModules;
  }
  return null;
}

// Fix RNFBCrashlyticsModule.h: import RNFBAppModule before RCTBridgeModule so the compiler sees
// RCTBridgeModule from module RNFBApp.RNFBAppModule (fixes "must be imported from module" error).
const headerPath = path.join(
  findCrashlyticsRoot() || "",
  "ios",
  "RNFBCrashlytics",
  "RNFBCrashlyticsModule.h"
);

if (!fs.existsSync(headerPath)) {
  console.warn("patch-crashlytics-ios: RNFBCrashlyticsModule.h not found, skipping");
  process.exit(0);
}

let content = fs.readFileSync(headerPath, "utf8");
const rnfbAppModuleImport = "#import <RNFBApp/RNFBAppModule.h>";

if (!content.includes(rnfbAppModuleImport)) {
  const anchor = "#import <React/RCTBridgeModule.h>";
  content = content.replace(anchor, rnfbAppModuleImport + "\n" + anchor);
  fs.writeFileSync(headerPath, content);
  console.log("patch-crashlytics-ios: applied RNFBAppModule import to RNFBCrashlyticsModule.h");
}

// Fix RNFBCrashlyticsModule.m: import RCTBridgeModule before any RNFBApp imports so it's in scope
// before the RNFBApp module context is established (belt-and-suspenders for the header fix).
const modulePath = path.join(
  findCrashlyticsRoot() || "",
  "ios",
  "RNFBCrashlytics",
  "RNFBCrashlyticsModule.m"
);

if (fs.existsSync(modulePath)) {
  let mContent = fs.readFileSync(modulePath, "utf8");
  const rctBridgeImport = "#import <React/RCTBridgeModule.h>";
  const firstReactImport = "#import <React/RCTConvert.h>";

  if (!mContent.includes(rctBridgeImport) && mContent.includes(firstReactImport)) {
    mContent = mContent.replace(firstReactImport, rctBridgeImport + "\n" + firstReactImport);
    fs.writeFileSync(modulePath, mContent);
    console.log("patch-crashlytics-ios: applied RCTBridgeModule import to RNFBCrashlyticsModule.m");
  }
}
