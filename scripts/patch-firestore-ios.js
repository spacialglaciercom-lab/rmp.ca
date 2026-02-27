/**
 * Postinstall: fix @react-native-firebase/firestore iOS build (RCTPromiseRejectBlock undefined on EAS).
 * Applies the typedef fix so the patch works with pnpm and on EAS without relying on patch-package.
 */
const fs = require("fs");
const path = require("path");

function findFirestoreRoot() {
  try {
    const resolved = require.resolve("@react-native-firebase/firestore/package.json");
    return path.dirname(resolved);
  } catch {
    const fromNodeModules = path.join(__dirname, "..", "node_modules", "@react-native-firebase", "firestore");
    if (fs.existsSync(fromNodeModules)) return fromNodeModules;
  }
  return null;
}

const headerPath = path.join(
  findFirestoreRoot() || "",
  "ios",
  "RNFBFirestore",
  "RNFBFirestoreCommon.h"
);

if (!fs.existsSync(headerPath)) {
  console.warn("patch-firestore-ios: RNFBFirestoreCommon.h not found, skipping");
  process.exit(0);
}

let content = fs.readFileSync(headerPath, "utf8");

const needTypedef = "#if !defined(RCTPromiseRejectBlock)";
if (!content.includes(needTypedef)) {
  const importLine = "#import <React/RCTBridgeModule.h>";
  const insertBlock = `${importLine}
#if !defined(RCTPromiseRejectBlock)
typedef void (^RCTPromiseRejectBlock)(NSString *code, NSString *message, NSError *error);
#endif`;
  if (content.includes(importLine)) {
    content = content.replace(importLine + "\n", insertBlock + "\n");
    fs.writeFileSync(headerPath, content);
    console.log("patch-firestore-ios: applied RCTPromiseRejectBlock fix to RNFBFirestoreCommon.h");
  }
}

// Fix RNFBFirestoreTransactionModule.m: ensure Firebase + RNFBFirestoreCommon are imported first
// so FIRApp and RCTPromiseRejectBlock are visible (fixes iOS build "implicit int" errors on EAS).
const transactionModulePath = path.join(
  findFirestoreRoot() || "",
  "ios",
  "RNFBFirestore",
  "RNFBFirestoreTransactionModule.m"
);
if (fs.existsSync(transactionModulePath)) {
  let tmContent = fs.readFileSync(transactionModulePath, "utf8");
  const firebaseImport = '#import <Firebase/Firebase.h>';
  const commonImport = '#import "RNFBFirestoreCommon.h"';
  if (!tmContent.includes(firebaseImport) || !tmContent.includes(commonImport)) {
    const anchor = "#import <RNFBApp/RNFBRCTEventEmitter.h>";
    const insert = `${firebaseImport}\n${commonImport}\n${anchor}`;
    tmContent = tmContent.replace(anchor, insert);
    fs.writeFileSync(transactionModulePath, tmContent);
    console.log("patch-firestore-ios: applied Firebase/Common imports to RNFBFirestoreTransactionModule.m");
  }
}

// Fix RNFBFirestoreModule.h: import RCTBridgeModule via RNFBApp so the compiler sees it from module RNFBApp.RNFBAppModule (fixes "must be imported from module" error on EAS).
const firestoreModuleHeaderPath = path.join(
  findFirestoreRoot() || "",
  "ios",
  "RNFBFirestore",
  "RNFBFirestoreModule.h"
);
if (fs.existsSync(firestoreModuleHeaderPath)) {
  let hContent = fs.readFileSync(firestoreModuleHeaderPath, "utf8");
  const rnfbAppModuleImport = "#import <RNFBApp/RNFBAppModule.h>";
  if (!hContent.includes(rnfbAppModuleImport)) {
    const anchor = "#import <React/RCTBridgeModule.h>";
    hContent = hContent.replace(anchor, rnfbAppModuleImport + "\n" + anchor);
    fs.writeFileSync(firestoreModuleHeaderPath, hContent);
    console.log("patch-firestore-ios: applied RNFBAppModule import to RNFBFirestoreModule.h");
  }
}

// Fix RNFBFirestoreModule.m: ensure Firebase + RNFBFirestoreCommon are imported first (fixes "implicit int" errors for FIRApp / promise blocks on EAS).
const firestoreModulePath = path.join(
  findFirestoreRoot() || "",
  "ios",
  "RNFBFirestore",
  "RNFBFirestoreModule.m"
);
if (fs.existsSync(firestoreModulePath)) {
  let fmContent = fs.readFileSync(firestoreModulePath, "utf8");
  const firebaseImport = '#import <Firebase/Firebase.h>';
  const commonImport = '#import "RNFBFirestoreCommon.h"';
  if (!fmContent.includes(firebaseImport) || !fmContent.includes(commonImport)) {
    const anchor = '#import "RNFBFirestoreModule.h"';
    const insert = `${firebaseImport}\n${commonImport}\n${anchor}`;
    fmContent = fmContent.replace(anchor, insert);
    fs.writeFileSync(firestoreModulePath, fmContent);
    console.log("patch-firestore-ios: applied Firebase/Common imports to RNFBFirestoreModule.m");
  }
}

// Fix all other RNFBFirestore *Module.m files that use RCT_EXPORT_METHOD(FIRApp/promise): add Firebase + Common imports so build completes on EAS.
const firestoreIosDir = path.join(findFirestoreRoot() || "", "ios", "RNFBFirestore");
const firebaseImport = '#import <Firebase/Firebase.h>';
const commonImport = '#import "RNFBFirestoreCommon.h"';
const moduleFiles = [
  "RNFBFirestoreDocumentModule.m",
  "RNFBFirestoreCollectionModule.m",
];
const firstImportAnchor = "#import <RNFBApp/RNFBRCTEventEmitter.h>";
for (const name of moduleFiles) {
  const filePath = path.join(firestoreIosDir, name);
  if (!fs.existsSync(filePath)) continue;
  let fileContent = fs.readFileSync(filePath, "utf8");
  if (!fileContent.includes(firebaseImport) || !fileContent.includes(commonImport)) {
    if (fileContent.includes(firstImportAnchor)) {
      fileContent = fileContent.replace(
        firstImportAnchor,
        `${firebaseImport}\n${commonImport}\n${firstImportAnchor}`
      );
      fs.writeFileSync(filePath, fileContent);
      console.log("patch-firestore-ios: applied Firebase/Common imports to " + name);
    }
  }
}

// Fix block pointer types: completion blocks must return void, not id (fixes "incompatible block pointer types" + "no known class method" on EAS).
function applyBlockFixes(filePath, fileName) {
  if (!fs.existsSync(filePath)) return;
  let c = fs.readFileSync(filePath, "utf8");
  const orig = c;
  // 1) completion:^(FIRDocumentSnapshot *snapshot, NSError *error) { -> ^void(...)
  c = c.replace(
    /completion:\^\(FIRDocumentSnapshot \*snapshot, NSError \*error\) \{/g,
    "completion:^void(FIRDocumentSnapshot *snapshot, NSError *error) {"
  );
  // 2) return [RNFBFirestoreCommon promiseRejectFirestoreException:reject (any whitespace) error:error]; -> call then return;
  // Use withError: to match RNFBFirestoreCommon selector (plugin renames error: -> withError: for Xcode 16+).
  c = c.replace(
    /return \[RNFBFirestoreCommon promiseRejectFirestoreException:reject\s+error:error\];/g,
    "[RNFBFirestoreCommon promiseRejectFirestoreException:reject withError:error];\n                     return;"
  );
  // 3) completion:^(NSError *error) {
  c = c.replace(/completion:\^\(NSError \*error\) \{/g, "completion:^void(NSError *error) {");
  // 4) id listenerBlock = ^(FIRDocumentSnapshot *snapshot, NSError *error) {
  c = c.replace(
    /id listenerBlock = \^\(FIRDocumentSnapshot \*snapshot, NSError \*error\) \{/g,
    "void (^listenerBlock)(FIRDocumentSnapshot *, NSError *) = ^void(FIRDocumentSnapshot *snapshot, NSError *error) {"
  );
  // 5) id completionBlock = ^(NSError *error) { ... return [RNFB...]; ... };
  c = c.replace(
    /id completionBlock = \^\(NSError \*error\) \{\s+if \(error\) \{\s+return \[RNFBFirestoreCommon promiseRejectFirestoreException:reject error:error\];\s+\} else \{\s+resolve\(nil\);\s+\}\s+\};/g,
    "void (^completionBlock)(NSError *) = ^void(NSError *error) {\n    if (error) {\n      [RNFBFirestoreCommon promiseRejectFirestoreException:reject withError:error];\n      return;\n    }\n    resolve(nil);\n  };"
  );
  // 6) deleteDocumentWithCompletion:^(NSError *error) { if (error) { return [RNFB...]; } else { resolve(nil); } };
  c = c.replace(
    /\[documentReference deleteDocumentWithCompletion:\^\(NSError \*error\) \{\s+if \(error\) \{\s+return \[RNFBFirestoreCommon promiseRejectFirestoreException:reject error:error\];\s+\} else \{\s+resolve\(nil\);\s+\}\s+\}\];/g,
    "[documentReference deleteDocumentWithCompletion:^void(NSError *error) {\n    if (error) {\n      [RNFBFirestoreCommon promiseRejectFirestoreException:reject withError:error];\n      return;\n    }\n    resolve(nil);\n  }];"
  );
  // 7) updateData completion block (multiline)
  c = c.replace(
    /completion:\^\(NSError \*error\) \{\s+if \(error\) \{\s+return \[RNFBFirestoreCommon promiseRejectFirestoreException:reject\s+error:error\];\s+\} else \{\s+resolve\(nil\);\s+\}\s+\}\];/g,
    "completion:^void(NSError *error) {\n                       if (error) {\n                         [RNFBFirestoreCommon promiseRejectFirestoreException:reject\n                                                                     withError:error];\n                         return;\n                       }\n                       resolve(nil);\n                     }];"
  );
  // 8) batch commitWithCompletion block: add ^void and fix return
  c = c.replace(
    /\[batch commitWithCompletion:\^\(NSError \*_Nullable error\) \{/g,
    "[batch commitWithCompletion:^void(NSError *_Nullable error) {"
  );
  if (c !== orig) {
    fs.writeFileSync(filePath, c);
    console.log("patch-firestore-ios: applied block pointer fixes to " + fileName);
  }
}
applyBlockFixes(path.join(firestoreIosDir, "RNFBFirestoreDocumentModule.m"), "RNFBFirestoreDocumentModule.m");
applyBlockFixes(path.join(firestoreIosDir, "RNFBFirestoreCollectionModule.m"), "RNFBFirestoreCollectionModule.m");
