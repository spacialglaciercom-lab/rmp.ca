/**
 * Expo config plugin: fixes RNFBStorage RCT_EXPORT_MODULE "implicit int" errors
 * when building with static frameworks. Adds explicit #import <React/RCTBridgeModule.h>
 * to RNFBStorageModule.m so RCT_EXPORT_MODULE/RCT_EXPORT_METHOD macros are defined.
 *
 * Required for @react-native-firebase/storage with useFrameworks: "static".
 */
const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");
const requireFromRoot = createRequire(path.join(__dirname, "..", "package.json"));
const { withDangerousMod } = requireFromRoot("expo/config-plugins");

const IMPORT_TO_ADD = "#import <React/RCTBridgeModule.h>";
const MARKER = "#import <React/RCTUtils.h>";

function withRNFBStorageFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      let storageModulePath;
      try {
        const pkgPath = requireFromRoot.resolve(
          "@react-native-firebase/storage/package.json"
        );
        storageModulePath = path.join(
          path.dirname(pkgPath),
          "ios",
          "RNFBStorage",
          "RNFBStorageModule.m"
        );
      } catch {
        return cfg;
      }

      if (!fs.existsSync(storageModulePath)) {
        return cfg;
      }

      let contents = fs.readFileSync(storageModulePath, "utf8");

      if (contents.includes(IMPORT_TO_ADD)) {
        return cfg;
      }

      if (contents.includes(MARKER)) {
        contents = contents.replace(
          MARKER,
          IMPORT_TO_ADD + "\n" + MARKER
        );
        fs.writeFileSync(storageModulePath, contents, "utf8");
      }

      return cfg;
    },
  ]);
}

module.exports = withRNFBStorageFix;
