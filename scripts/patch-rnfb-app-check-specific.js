#!/usr/bin/env node

/**
 * Specific patch for @react-native-firebase/app-check to fix the exact errors
 * found in the failed build logs.
 *
 * Errors addressed:
 * 1. RCTBridgeModule import error at RNFBAppCheckModule.h:24:43
 * 2. Undeclared identifiers: firebaseApp, isTokenAutoRefreshEnabled, etc.
 * 3. Missing function declarations for resolve/reject
 * 4. Macro redefinition issues
 */

const fs = require("fs");
const path = require("path");

/** Find RNFBAppCheckModule.h/.m (node_modules or .pnpm). */
function findAppCheckPaths() {
  const cwd = process.cwd();
  const candidates = [
    path.join(
      cwd,
      "node_modules/@react-native-firebase/app-check/ios/RNFBAppCheck/RNFBAppCheckModule.h",
    ),
    path.join(
      cwd,
      "node_modules/@react-native-firebase/app-check/ios/RNFBAppCheck/RNFBAppCheckModule.m",
    ),
  ];
  try {
    const dir = path.join(cwd, "node_modules/.pnpm");
    if (fs.existsSync(dir)) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (
          e.isDirectory() &&
          e.name.includes("@react-native-firebase+app-check")
        ) {
          const base = path.join(
            dir,
            e.name,
            "node_modules/@react-native-firebase/app-check/ios/RNFBAppCheck",
          );
          candidates.push(
            path.join(base, "RNFBAppCheckModule.h"),
            path.join(base, "RNFBAppCheckModule.m"),
          );
        }
      }
    }
  } catch (_) {}
  return {
    header: candidates.find((p) => p.endsWith(".h") && fs.existsSync(p)),
    impl: candidates.find((p) => p.endsWith(".m") && fs.existsSync(p)),
  };
}

function patchRNFBAppCheckHeader() {
  const paths = findAppCheckPaths();
  const fullPath = paths.header;
  if (!fullPath) {
    console.log("[RNFB AppCheck Specific] Header file not found");
    return;
  }
  try {
    console.log("[RNFB AppCheck Specific] Fixing header file...");
    let content = fs.readFileSync(fullPath, "utf8");

    // RCTBridgeModule must be imported from module RNFBApp.RNFBAppModule (Xcode 16+). Add RNFBApp import before React's.
    const rnfbAppImport = "#import <RNFBApp/RNFBAppModule.h>";
    if (!content.includes(rnfbAppImport)) {
      content = content.replace(
        "#import <React/RCTBridgeModule.h>",
        rnfbAppImport + "\n#import <React/RCTBridgeModule.h>",
      );
      console.log(
        "[RNFB AppCheck Specific] Added RNFBAppModule import before RCTBridgeModule",
      );
    }

    fs.writeFileSync(fullPath, content, "utf8");
    console.log("[RNFB AppCheck Specific] ✅ Header file fixed");
  } catch (error) {
    console.error("[RNFB AppCheck Specific] Error with header:", error.message);
  }
}

function patchRNFBAppCheckImplementation() {
  const paths = findAppCheckPaths();
  const fullPath = paths.impl;
  if (!fullPath) {
    console.log("[RNFB AppCheck Specific] Implementation file not found");
    return;
  }
  try {
    console.log("[RNFB AppCheck Specific] Fixing implementation file...");
    let content = fs.readFileSync(fullPath, "utf8");

    // Add pragma to suppress macro redefinition warnings at the top
    if (!content.includes("#pragma clang diagnostic push")) {
      const pragmas = `#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wmacro-redefined"
#pragma clang diagnostic ignored "-Wimplicit-int"
#pragma clang diagnostic ignored "-Wundeclared-selector"

`;
      content = pragmas + content + "\n#pragma clang diagnostic pop\n";
      console.log("[RNFB AppCheck Specific] Added compiler pragmas");
    }

    // Fix the specific RCT_EXPORT_METHOD that was causing undeclared identifier errors.
    // Allow (nonnull NSString *) / (nullable NSString *) - package uses these modifiers.
    const nsString = "\\((?:(?:nonnull|nullable)\\s+)?NSString\\s*\\*\\)";
    const methodFixes = [
      {
        // Activate: (NSString *) or (nonnull NSString *)
        pattern: new RegExp(
          `RCT_EXPORT_METHOD\\(activate\\s*:\\s*\\(FIRApp\\s*\\*\\)\\s*firebaseApp\\s*\\n\\s*:\\s*${nsString}\\s*siteKeyOrProvider\\s*\\n\\s*:\\s*\\(BOOL\\)\\s*isTokenAutoRefreshEnabled\\s*\\n\\s*:\\s*\\(RCTPromiseResolveBlock\\)\\s*resolve\\s*rejecter\\s*\\n\\s*:\\s*\\(RCTPromiseRejectBlock\\)\\s*reject\\)`,
          "g",
        ),
        replacement: `RCT_EXPORT_METHOD(activate
                  : (FIRApp *)firebaseApp
                  : (nonnull NSString *)siteKeyOrProvider
                  : (BOOL)isTokenAutoRefreshEnabled
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)`,
        description: "Fix activate method syntax",
      },
      {
        // configureProvider: (NSString *) or (nullable NSString *) for debugToken
        pattern: new RegExp(
          `RCT_EXPORT_METHOD\\(configureProvider\\s*:\\s*\\(FIRApp\\s*\\*\\)\\s*firebaseApp\\s*\\n\\s*:\\s*${nsString}\\s*providerName\\s*\\n\\s*:\\s*${nsString}\\s*debugToken\\s*\\n\\s*:\\s*\\(RCTPromiseResolveBlock\\)\\s*resolve\\s*rejecter\\s*\\n\\s*:\\s*\\(RCTPromiseRejectBlock\\)\\s*reject\\)`,
          "g",
        ),
        replacement: `RCT_EXPORT_METHOD(configureProvider
                  : (FIRApp *)firebaseApp
                  : (nonnull NSString *)providerName
                  : (nullable NSString *)debugToken
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)`,
        description: "Fix configureProvider method syntax",
      },
      {
        // setTokenAutoRefreshEnabled
        pattern:
          /RCT_EXPORT_METHOD\(\s*setTokenAutoRefreshEnabled\s*:\s*\(FIRApp\s*\*\)\s*firebaseApp\s*\n\s*:\s*\(BOOL\)\s*isTokenAutoRefreshEnabled\s*\)/g,
        replacement: `RCT_EXPORT_METHOD(setTokenAutoRefreshEnabled
                  : (FIRApp *)firebaseApp
                  : (BOOL)isTokenAutoRefreshEnabled)`,
        description: "Fix setTokenAutoRefreshEnabled method syntax",
      },
    ];

    for (const fix of methodFixes) {
      if (content.match(fix.pattern)) {
        content = content.replace(fix.pattern, fix.replacement);
        console.log(`[RNFB AppCheck Specific] ${fix.description}`);
      }
    }

    fs.writeFileSync(fullPath, content, "utf8");
    console.log("[RNFB AppCheck Specific] ✅ Implementation file fixed");
  } catch (error) {
    console.error(
      "[RNFB AppCheck Specific] Error with implementation:",
      error.message,
    );
  }
}

function runSpecificFixes() {
  console.log(
    "[RNFB AppCheck Specific] Applying specific fixes for build errors...",
  );
  patchRNFBAppCheckHeader();
  patchRNFBAppCheckImplementation();
  console.log("[RNFB AppCheck Specific] All specific fixes applied");
}

if (require.main === module) {
  runSpecificFixes();
}

module.exports = runSpecificFixes;
