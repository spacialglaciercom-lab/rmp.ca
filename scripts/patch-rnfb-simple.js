#!/usr/bin/env node

/**
 * Simple, targeted patch for React Native Firebase modules to fix Xcode 16+ issues
 */

const fs = require("fs");
const path = require("path");

function patchRNFBAppModule() {
  try {
    const modulePath =
      "node_modules/@react-native-firebase/app/ios/RNFBApp/RNFBAppModule.h";
    const fullPath = path.join(process.cwd(), modulePath);

    if (!fs.existsSync(fullPath)) {
      console.log("[RNFB Simple Patch] RNFBApp module header not found");
      return;
    }

    let content = fs.readFileSync(fullPath, "utf8");

    // Add proper imports if missing
    const imports = [
      "#import <React/RCTBridgeModule.h>",
      "#import <React/RCTEventEmitter.h>",
    ];

    for (const headerImport of imports) {
      if (!content.includes(headerImport)) {
        // Add after license header
        const licenseEnd = content.match(/\*\/\s*\n/);
        if (licenseEnd) {
          content = content.replace(
            licenseEnd[0],
            licenseEnd[0] + headerImport + "\n",
          );
        }
      }
    }

    fs.writeFileSync(fullPath, content, "utf8");
    console.log("[RNFB Simple Patch] ✅ Fixed RNFBApp module header");
  } catch (error) {
    console.error("[RNFB Simple Patch] Error with RNFBApp:", error.message);
  }
}

function patchRNFBAppCheckModule() {
  try {
    const modulePath =
      "node_modules/@react-native-firebase/app-check/ios/RNFBAppCheck/RNFBAppCheckModule.m";
    const fullPath = path.join(process.cwd(), modulePath);

    if (!fs.existsSync(fullPath)) {
      console.log("[RNFB Simple Patch] RNFBAppCheck module not found");
      return;
    }

    let content = fs.readFileSync(fullPath, "utf8");

    // Fix the specific RCT_EXPORT_METHOD syntax that was causing errors
    const brokenPattern =
      /RCT_EXPORT_METHOD\(\s*activate\s*\n\s*:\s*\(\s*FIRApp\s*\*\s*\)\s*firebaseApp\s*\n\s*:\s*\(\s*NSString\s*\*\s*\)\s*siteKeyOrProvider\s*\n\s*:\s*\(\s*BOOL\s*\)\s*isTokenAutoRefreshEnabled\s*\n\s*:\s*\(\s*RCTPromiseResolveBlock\s*\)\s*resolve\s*rejecter\s*\n\s*:\s*\(\s*RCTPromiseRejectBlock\s*\)\s*reject\s*\)/g;

    const fixedPattern = `RCT_EXPORT_METHOD(activate
                  : (FIRApp *)firebaseApp
                  : (NSString *)siteKeyOrProvider
                  : (BOOL)isTokenAutoRefreshEnabled
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)`;

    if (content.match(brokenPattern)) {
      content = content.replace(brokenPattern, fixedPattern);
      console.log("[RNFB Simple Patch] Fixed RCT_EXPORT_METHOD syntax");
    }

    // Add compiler pragmas to suppress warnings
    if (!content.includes("#pragma clang diagnostic push")) {
      const pragmas = `#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wimplicit-int"
#pragma clang diagnostic ignored "-Wmacro-redefined"

`;
      content = pragmas + content + "\n#pragma clang diagnostic pop\n";
      console.log("[RNFB Simple Patch] Added compiler pragmas");
    }

    fs.writeFileSync(fullPath, content, "utf8");
    console.log("[RNFB Simple Patch] ✅ Fixed RNFBAppCheck module");
  } catch (error) {
    console.error(
      "[RNFB Simple Patch] Error with RNFBAppCheck:",
      error.message,
    );
  }
}

function patchRNFBFirestore() {
  try {
    const modulePath =
      "node_modules/@react-native-firebase/firestore/ios/RNFBFirestore/RNFBFirestoreCommon.m";
    const fullPath = path.join(process.cwd(), modulePath);

    if (!fs.existsSync(fullPath)) {
      console.log("[RNFB Simple Patch] RNFBFirestore module not found");
      return;
    }

    let content = fs.readFileSync(fullPath, "utf8");

    // Add pragmas to suppress warnings
    if (!content.includes("#pragma clang diagnostic push")) {
      const pragmas = `#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wimplicit-int"
#pragma clang diagnostic ignored "-Wmacro-redefined"
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

`;
      content = pragmas + content + "\n#pragma clang diagnostic pop\n";
      console.log("[RNFB Simple Patch] Added pragmas to Firestore");
    }

    fs.writeFileSync(fullPath, content, "utf8");
    console.log("[RNFB Simple Patch] ✅ Fixed RNFBFirestore module");
  } catch (error) {
    console.error(
      "[RNFB Simple Patch] Error with RNFBFirestore:",
      error.message,
    );
  }
}

function runSimplePatches() {
  console.log("[RNFB Simple Patch] Starting simple targeted patches...");
  patchRNFBAppModule();
  patchRNFBAppCheckModule();
  patchRNFBFirestore();
  console.log("[RNFB Simple Patch] All patches completed");
}

if (require.main === module) {
  runSimplePatches();
}

module.exports = runSimplePatches;
