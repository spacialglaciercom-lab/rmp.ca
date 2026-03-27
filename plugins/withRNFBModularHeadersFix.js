/**
 * Expo config plugin: fix React Native Firebase iOS build with Xcode 16+.
 *
 * Xcode 16 promotes -Wimplicit-int and -Wimplicit-function-declaration to hard errors.
 * RNFB ObjC code triggers these. The fix is compiler flags, not source patching.
 * Also disables modular header strictness for RNFB targets.
 *
 * @see https://github.com/invertase/react-native-firebase/issues/6726
 */
const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");
const requireFromRoot = createRequire(
  path.join(__dirname, "..", "package.json"),
);
const { withDangerousMod } = requireFromRoot("expo/config-plugins");

function enhancePodfile(projectRoot) {
  const podfilePath = path.join(projectRoot, "ios", "Podfile");
  if (!fs.existsSync(podfilePath)) return;

  let content = fs.readFileSync(podfilePath, "utf8");

  // Remove global use_modular_headers! if present — it breaks RNFB ObjC pod compilation
  // (RCT_EXPORT_METHOD macro cannot resolve RCTBridgeModule under strict modular headers).
  if (content.includes("use_modular_headers!")) {
    content = content.replace(/^\s*use_modular_headers!\s*\n/gm, "");
    console.log(
      "[RNFB Fix] Removed global use_modular_headers! (breaks RNFB ObjC)",
    );
  }

  // Target RNFB pods specifically to disable strict modular headers
  // This is more targeted than the global fix in withFirebaseModularHeaders
  const RNFB_FIX_MARKER = "# [withRNFBModularHeadersFix]";
  if (!content.includes(RNFB_FIX_MARKER)) {
    const snippet = [
      "",
      `    ${RNFB_FIX_MARKER} Disable modular header strictness for RNFB`,
      "    installer.pods_project.targets.each do |target|",
      "      if target.name.start_with?('RNFB') || target.name.start_with?('Firebase') || target.name.include?('BoringSSL') || target.name.include?('gRPC')",
      "        target.build_configurations.each do |config|",
      "          config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'",
      "          existing_flags = config.build_settings['OTHER_CFLAGS']",
      "          flags = existing_flags.is_a?(Array) ? existing_flags.dup : ['$(inherited)']",
      "          extra = ['-Wno-error=implicit-int', '-Wno-implicit-int', '-Wno-error=implicit-function-declaration', '-Wno-implicit-function-declaration', '-Wno-strict-prototypes', '-Wno-deprecated-declarations']",
      "          extra.each { |f| flags << f unless flags.include?(f) }",
      "          config.build_settings['OTHER_CFLAGS'] = flags",
      "          # Prevent CocoaPods generating a module map for RNFB ObjC pods.",
      "          # Without this, -fmodule-name=RNFB* is passed at compile time and",
      "          # RCTBridgeModule becomes invisible across module boundaries (Xcode 16 error).",
      "          config.build_settings['DEFINES_MODULE'] = 'NO' if target.name.start_with?('RNFB')",
      "        end",
      "      end",
      "    end",
    ].join("\n");

    const postInstallMatch = content.match(
      /(post_install\s+do\s+\|[^|]+\|\s*\n)/,
    );
    if (postInstallMatch) {
      content = content.replace(
        postInstallMatch[1],
        postInstallMatch[1] + snippet + "\n",
      );
    }
  }

  fs.writeFileSync(podfilePath, content, "utf8");
  console.log("[RNFB Fix] Enhanced Podfile with RNFB-targeted compiler flags");
}

function withRNFBModularHeadersFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      console.log("[RNFB Fix] Applying Podfile-level RNFB fixes...");
      enhancePodfile(projectRoot);
      return cfg;
    },
  ]);
}

module.exports = withRNFBModularHeadersFix;
