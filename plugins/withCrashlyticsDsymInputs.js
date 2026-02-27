/**
 * Expo config plugin: ensures Firebase Crashlytics Run Script has the Input Files
 * required by Xcode 15+ so dSYMs are uploaded and crash reports are deobfuscated.
 *
 * The @react-native-firebase/crashlytics script phase only lists 2 input files;
 * Xcode 15+ (and User Script Sandboxing) need the full set or you get
 * "Unable to process Info.plist at path" / missing dSYM errors.
 *
 * @see https://firebase.google.com/docs/crashlytics/ios/get-deobfuscated-reports
 */
const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");
const requireFromRoot = createRequire(path.join(__dirname, "..", "package.json"));
const { withDangerousMod } = requireFromRoot("expo/config-plugins");

const CRASHLYTICS_PHASE_NAME = "[RNFB] Crashlytics Configuration";

// Xcode 15+ required Input Files per Firebase docs (get-deobfuscated-reports)

function patchPbxproj(pbxprojPath) {
  let contents = fs.readFileSync(pbxprojPath, "utf8");
  if (!contents.includes(CRASHLYTICS_PHASE_NAME)) return false;

  const match = contents.match(
    /(\s+inputPaths\s*=\s*\(\s*)([\s\S]*?)(\s*\);\s*\n\s*name\s*=\s*"\[RNFB\] Crashlytics Configuration")/
  );
  if (!match) return false;
  if (match[2].includes("GoogleService-Info.plist")) return false;
  const indent = match[1].replace(/inputPaths.*/, "");
  const lineIndent = indent + "\t\t\t";
  const replacement = match[1] + [
    '"${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}"',
    '"${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/${PRODUCT_NAME}"',
    '"${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Info.plist"',
    '"$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/GoogleService-Info.plist"',
    '"$(TARGET_BUILD_DIR)/$(EXECUTABLE_PATH)"',
  ].join(",\n" + lineIndent) + "\n" + indent + match[3];
  contents = contents.replace(
    /(\s+inputPaths\s*=\s*\(\s*)([\s\S]*?)(\s*\);\s*\n\s*name\s*=\s*"\[RNFB\] Crashlytics Configuration")/,
    replacement
  );
  fs.writeFileSync(pbxprojPath, contents, "utf8");
  return true;
}

function withCrashlyticsDsymInputs(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const iosRoot = cfg.modRequest.platformProjectRoot;
      const dirs = fs.readdirSync(iosRoot, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.endsWith(".xcodeproj")) {
          const pbxproj = path.join(iosRoot, d.name, "project.pbxproj");
          if (fs.existsSync(pbxproj)) {
            const patched = patchPbxproj(pbxproj);
            if (patched) {
              console.log("[withCrashlyticsDsymInputs] Patched Crashlytics Run Script input paths in", d.name);
            }
            break;
          }
        }
      }
      return cfg;
    },
  ]);
}

module.exports = withCrashlyticsDsymInputs;
