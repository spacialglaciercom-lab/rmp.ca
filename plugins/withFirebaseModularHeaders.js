/**
 * Expo config plugin: fixes @react-native-firebase iOS build with static frameworks.
 *
 * Problem: use_modular_headers! globally breaks RNFB ObjC pods (RCT_EXPORT_METHOD macro
 * expands to ObjC that requires non-modular RCTBridgeModule includes). Xcode 16 makes
 * this a hard error. The fix is per-pod modular headers only for Firebase Swift pods,
 * NOT global use_modular_headers!.
 *
 * @see https://github.com/invertase/react-native-firebase/issues/6726
 * @see https://github.com/invertase/react-native-firebase/issues/6933
 */
const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");
const requireFromRoot = createRequire(
  path.join(__dirname, "..", "package.json"),
);
const { withPodfile, withDangerousMod, withPlugins } = requireFromRoot(
  "expo/config-plugins",
);

// Firebase Swift pods that require modular headers to be imported correctly.
// These are the pods that ship as Swift modules and need strict module semantics.
const FIREBASE_SWIFT_PODS = [
  "Firebase",
  "FirebaseCore",
  "FirebaseCoreInternal",
  "FirebaseInstallations",
  "FirebaseRemoteConfig",
  "FirebaseABTesting",
  "GoogleUtilities",
  "GoogleDataTransport",
  "nanopb",
];

// Run at pod install time so Expo autolinking never sees the module (works with EAS cache).
const PRE_INSTALL_LSTM_REMOVAL = [
  "pre_install do |installer|",
  "  lstm_path = File.expand_path('../modules/lstm-model-downloader', __dir__)",
  "  if File.directory?(lstm_path)",
  "    system('rm', '-rf', lstm_path)",
  "    Pod::UI.puts 'Removed modules/lstm-model-downloader to avoid FirebaseMLModelDownloader conflict.'",
  "  end",
  "end",
  "",
].join("\n");

// post_install snippet: fix build settings for all pods.
// Critically: do NOT enforce modular headers globally; instead allow non-modular includes
// so RNFB ObjC macros (RCT_EXPORT_METHOD etc.) continue to work.
// Also set DEFINES_MODULE=NO for RNFB pods so CocoaPods does not generate module maps
// for them — which would cause -fmodule-name=RNFB* to be passed at compile time and hide
// RCTBridgeModule across module boundaries (the actual Xcode 16 compile error).
const RNFB_SNIPPET = [
  "# Fix RNFB + Xcode 16: non-modular headers + implicit int errors",
  "    installer.pods_project.targets.each do |target|",
  "      target.build_configurations.each do |config|",
  "        config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'",
  "        config.build_settings['GCC_WARN_ABOUT_IMPLICIT_INT'] = 'NO'",
  "        existing_flags = config.build_settings['OTHER_CFLAGS']",
  "        flags = existing_flags.is_a?(Array) ? existing_flags.dup : ['$(inherited)']",
  "        extra = ['-Wno-error=implicit-int', '-Wno-implicit-int', '-Wno-implicit-function-declaration', '-Wno-error=implicit-function-declaration', '-Wno-deprecated-declarations', '-Wno-strict-prototypes']",
  "        extra.each { |f| flags << f unless flags.include?(f) }",
  "        config.build_settings['OTHER_CFLAGS'] = flags",
  "      end",
  "      # Disable module map generation for RNFB ObjC pods so RCTBridgeModule is not",
  "      # hidden across module boundaries (fixes -fmodule-name=RNFB* Xcode 16 error)",
  "      if target.name.start_with?('RNFB')",
  "        target.build_configurations.each do |config|",
  "          config.build_settings['DEFINES_MODULE'] = 'NO'",
  "        end",
  "      end",
  "    end",
  "",
  # Force modular headers for Firebase Swift pods to fix scope/visibility issues
  # and EXPLICITLY disable them for RNFBFirestore/RNFBApp to fix Swift scope issues.
  firebase_swift_pods = ['Firebase', 'FirebaseCore', 'FirebaseCoreInternal', 'FirebaseInstallations', 'FirebaseRemoteConfig', 'FirebaseABTesting', 'GoogleUtilities', 'GoogleDataTransport', 'nanopb']
  rnfb_objc_pods = ['RNFBApp', 'RNFBFirestore', 'RNFBAuth', 'RNFBAnalytics', 'RNFBCrashlytics', 'RNFBDatabase', 'RNFBFunctions', 'RNFBMessaging', 'RNFBStorage']

  installer.pod_targets.each do |pod|
    if firebase_swift_pods.include?(pod.name)
      def pod.defines_module?; true; end
      def pod.modular_headers?; true; end
    elsif rnfb_objc_pods.include?(pod.name)
      def pod.defines_module?; false; end
      def pod.modular_headers?; false; end
    end
  end
  ].join("\n");

function applyPodfilePatches(contents) {
  if (typeof contents !== "string") return contents;

  // 0. Add pre_install to remove lstm-model-downloader
  const LSTM_PRE_INSTALL_MARKER =
    "Removed modules/lstm-model-downloader to avoid FirebaseMLModelDownloader";
  if (!contents.includes(LSTM_PRE_INSTALL_MARKER)) {
    const afterPlatform = contents.match(/^(platform\s+:ios[^\n]*\n)/m);
    if (afterPlatform) {
      contents = contents.replace(
        afterPlatform[1],
        afterPlatform[1] + "\n" + PRE_INSTALL_LSTM_REMOVAL + "\n",
      );
    } else {
      contents = PRE_INSTALL_LSTM_REMOVAL + "\n" + contents;
    }
  }

  // 1. REMOVE global use_modular_headers! if present — it breaks RNFB ObjC pods.
  // Per-pod :modular_headers => true for Firebase Swift pods is injected in post_install instead.
  if (contents.includes("use_modular_headers!")) {
    contents = contents.replace(/^\s*use_modular_headers!\s*\n/gm, "");
    console.log(
      "[withFirebaseModularHeaders] Removed global use_modular_headers! (breaks RNFB ObjC)",
    );
  }

  // 2. Add CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES in post_install
  if (
    !contents.includes("CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES")
  ) {
    let applied = false;

    // A: Inject at start of post_install block
    const postInstallStart = contents.match(
      /^(\s*post_install\s+do\s+\|[^|]+\|\s*\n)/m,
    );
    if (postInstallStart) {
      contents = contents.replace(
        postInstallStart[1],
        postInstallStart[1] + RNFB_SNIPPET + "\n",
      );
      applied = true;
    }

    // B: Inject after react_native_post_install(...)
    if (!applied) {
      const rnfBlock = contents.match(
        /(react_native_post_install\s*\([\s\S]*?\n\s+\))\s*\n(\s+end\b)/m,
      );
      if (rnfBlock) {
        contents = contents.replace(
          rnfBlock[0],
          `${rnfBlock[1]}\n${RNFB_SNIPPET}\n${rnfBlock[2]}`,
        );
        applied = true;
      }
    }

    // C: Append new post_install block
    if (!applied) {
      const block = [
        "  post_install do |installer|",
        "    " + RNFB_SNIPPET,
        "  end",
      ].join("\n");
      const targetClose = contents.match(/(\n\s+end\s*\n)(\s*end\s*)\s*$/);
      if (targetClose) {
        contents = contents.replace(
          targetClose[0],
          targetClose[1] + block + "\n" + targetClose[2],
        );
      }
    }
  }

  return contents;
}

/** Remove ExpoLSTMModelDownloader module so pod install does not pull in FirebaseMLModelDownloader. */
function removeLstmModelDownloaderModule(projectRoot) {
  const lstmPath = path.join(projectRoot, "modules", "lstm-model-downloader");
  if (fs.existsSync(lstmPath)) {
    try {
      fs.rmSync(lstmPath, { recursive: true, force: true });
      console.log(
        "[withFirebaseModularHeaders] Removed modules/lstm-model-downloader to avoid FirebaseMLModelDownloader conflict.",
      );
    } catch (e) {
      console.warn(
        "[withFirebaseModularHeaders] Could not remove lstm-model-downloader:",
        (e && e.message) || e,
      );
    }
  }
}

function withFirebaseModularHeaders(config) {
  return withPlugins(config, [
    (c) =>
      withPodfile(c, (cfg) => {
        cfg.modResults = applyPodfilePatches(cfg.modResults);
        return cfg;
      }),
    (c) =>
      withDangerousMod(c, [
        "ios",
        async (cfg) => {
          const { platformProjectRoot, projectRoot } = cfg.modRequest;
          removeLstmModelDownloaderModule(projectRoot);

          const podfilePath = path.join(platformProjectRoot, "Podfile");
          if (fs.existsSync(podfilePath)) {
            let contents = fs.readFileSync(podfilePath, "utf8");
            contents = applyPodfilePatches(contents);
            fs.writeFileSync(podfilePath, contents, "utf8");
          }
          return cfg;
        },
      ]),
  ]);
}

module.exports = withFirebaseModularHeaders;
