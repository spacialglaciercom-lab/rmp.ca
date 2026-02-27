/**
 * Expo config plugin: fixes RNFBFirestore iOS build with Xcode 16+.
 * The selector "error:" in RNFBFirestoreCommon.h is macro-expanded by system
 * headers, causing "expected a type". This plugin renames the selector to
 * "withError:" and the parameter to "err", and updates all call sites.
 *
 * Runs at prebuild so the fix is applied before Xcode compiles (works on EAS with pnpm).
 */
const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");
const requireFromRoot = createRequire(path.join(__dirname, "..", "package.json"));
const { withDangerousMod } = requireFromRoot("expo/config-plugins");

function patchFirestoreCommon(projectRoot) {
  let firestoreRoot;
  try {
    const pkgPath = requireFromRoot.resolve(
      "@react-native-firebase/firestore/package.json"
    );
    firestoreRoot = path.dirname(pkgPath);
  } catch {
    return;
  }

  const iosDir = path.join(firestoreRoot, "ios", "RNFBFirestore");
  const headerPath = path.join(iosDir, "RNFBFirestoreCommon.h");
  const implPath = path.join(iosDir, "RNFBFirestoreCommon.m");

  if (!fs.existsSync(headerPath) || !fs.existsSync(implPath)) {
    return;
  }

  let header = fs.readFileSync(headerPath, "utf8");
  let impl = fs.readFileSync(implPath, "utf8");

  const alreadyPatched = header.includes("withError:(NSError *)");

  if (!alreadyPatched) {
  // Header: rename selector error: -> withError: and parameter to err
  header = header.replace(
    "promiseRejectFirestoreException:(RCTPromiseRejectBlock)reject error:(NSError *)error;",
    "promiseRejectFirestoreException:(RCTPromiseRejectBlock)reject withError:(NSError *)err;"
  );
  header = header.replace(
    "promiseRejectFirestoreException:(RCTPromiseRejectBlock)reject error:(NSError *)err;",
    "promiseRejectFirestoreException:(RCTPromiseRejectBlock)reject withError:(NSError *)err;"
  );
  header = header.replace(
    "getCodeAndMessage:(NSError *)error;",
    "getCodeAndMessage:(NSError *)err;"
  );

  // .m: implementation - selector withError: and parameter err
  impl = impl.replace(
    "+ (void)promiseRejectFirestoreException:(RCTPromiseRejectBlock)reject error:(NSError *)error {",
    "+ (void)promiseRejectFirestoreException:(RCTPromiseRejectBlock)reject withError:(NSError *)err {"
  );
  impl = impl.replace(
    "+ (void)promiseRejectFirestoreException:(RCTPromiseRejectBlock)reject error:(NSError *)err {",
    "+ (void)promiseRejectFirestoreException:(RCTPromiseRejectBlock)reject withError:(NSError *)err {"
  );
  impl = impl.replace(
    "NSArray *codeAndMessage = [self getCodeAndMessage:error];",
    "NSArray *codeAndMessage = [self getCodeAndMessage:err];"
  );
  impl = impl.replace(
    "+ (NSArray *)getCodeAndMessage:(NSError *)error {",
    "+ (NSArray *)getCodeAndMessage:(NSError *)err {"
  );
  impl = impl.replace(
    "if (error == nil)",
    "if (err == nil)"
  );
  impl = impl.replace(
    "switch (error.code)",
    "switch (err.code)"
  );
  impl = impl.replace(
    "[error.localizedDescription containsString:",
    "[err.localizedDescription containsString:"
  );
  impl = impl.replace(
    "message = error.localizedDescription;",
    "message = err.localizedDescription;"
  );

  fs.writeFileSync(headerPath, header, "utf8");
  fs.writeFileSync(implPath, impl, "utf8");
  }

  // Update all call sites (always run): promiseRejectFirestoreException:... error: -> withError:
  // Allow \s* between ":" and "reject" so split lines like "[RNFBFirestoreCommon\n    promiseRejectFirestoreException:reject\n    error:..."
  // are matched; otherwise we get "no known class method for selector 'promiseRejectFirestoreException:error:'"
  const callSiteRegex = /promiseRejectFirestoreException:\s*reject\s+error:/g;
  const dirEntries = fs.readdirSync(iosDir, { withFileTypes: true });
  for (const ent of dirEntries) {
    if (!ent.isFile() || !ent.name.endsWith(".m")) continue;
    const fpath = path.join(iosDir, ent.name);
    let content = fs.readFileSync(fpath, "utf8");
    if (content.includes("promiseRejectFirestoreException:") && content.includes("error:")) {
      const updated = content.replace(
        callSiteRegex,
        "promiseRejectFirestoreException:reject withError:"
      );
      if (updated !== content) {
        fs.writeFileSync(fpath, updated, "utf8");
      }
    }
  }
}

function withRNFBFirestoreFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      patchFirestoreCommon(projectRoot);
      return cfg;
    },
  ]);
}

module.exports = withRNFBFirestoreFix;
