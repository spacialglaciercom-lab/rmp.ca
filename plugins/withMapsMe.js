/**
 * Expo config plugin: adds MAPS.ME React Native module to the iOS project
 * This plugin integrates the MAPS.ME framework as a native dependency
 */

const path = require("path");
const { createRequire } = require("module");
const fs = require("fs");

// Require from project root so EAS Build and pnpm resolve correctly
const requireFromRoot = createRequire(path.join(__dirname, "..", "package.json"));
const { withXcodeProject, withDangerousMod, withPlugins } = requireFromRoot("expo/config-plugins");

const DEFAULT_OPTIONS = {
  // Path to the MapsMeReactNative module relative to project root
  modulePath: "./lib/mapsme-react-native",
  // Whether to add the module to the main app target
  addToMainTarget: true,
  // Whether to add the module to test targets
  addToTestTargets: false,
};

/**
 * Copy the MapsMeReactNative native module to the iOS project
 * Paths are resolved inside the mod callback so projectRoot is only read when the mod runs (prebuild), not at config load time.
 */
function copyMapsMeModuleToIOS(config, options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest?.projectRoot;
      if (!projectRoot) {
        console.warn("MAPS.ME: modRequest.projectRoot not available, skipping module copy");
        return config;
      }

      const iosProjectRoot = path.join(projectRoot, "ios");
      const sourceModulePath = path.join(projectRoot, opts.modulePath, "ios", "MapsMeReactNative");
      const destModulePath = path.join(iosProjectRoot, "MapsMeReactNative");

      // Ensure the iOS project directory exists
      if (!fs.existsSync(iosProjectRoot)) {
        console.warn("iOS project directory does not exist, skipping MAPS.ME module copy");
        return config;
      }

      // Copy the MapsMeReactNative native pod to the iOS project
      try {
        if (fs.existsSync(sourceModulePath)) {
          // Remove existing module if it exists
          if (fs.existsSync(destModulePath)) {
            fs.rmSync(destModulePath, { recursive: true, force: true });
          }

          // Copy the native pod (so MapsMeReactNative.podspec is at dest root for :path => './MapsMeReactNative')
          fs.cpSync(sourceModulePath, destModulePath, { recursive: true });
          console.log("✅ MAPS.ME React Native module copied to iOS project");
        } else {
          console.warn("MAPS.ME module source path does not exist:", sourceModulePath);
        }
      } catch (error) {
        console.error("Failed to copy MAPS.ME module:", error);
      }

      return config;
    },
  ]);
}

/**
 * Add MAPS.ME framework dependencies to the Xcode project
 */
function addMapsMeFrameworkToXcodeProject(config, options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const projectRoot = config.modRequest.projectRoot;
    const objects = xcodeProject.hash.project.objects;

    // Add MAPS.ME framework search paths
    const buildConfigKeys = Object.keys(objects.XCBuildConfiguration || {});
    for (const key of buildConfigKeys) {
      if (key.includes("_comment")) continue;
      const buildConfig = objects.XCBuildConfiguration[key];
      
      // Add framework search paths
      if (!buildConfig.buildSettings) buildConfig.buildSettings = {};
      
      const frameworkSearchPaths = buildConfig.buildSettings.FRAMEWORK_SEARCH_PATHS || [];
      if (!Array.isArray(frameworkSearchPaths)) {
        // Convert string to array if needed
        const paths = frameworkSearchPaths.split(" ") || [];
        buildConfig.buildSettings.FRAMEWORK_SEARCH_PATHS = paths;
      }
      
      // Add MAPS.ME framework path
      const mapsMeFrameworkPath = "$(PROJECT_DIR)/../iphone/Maps";
      if (!buildConfig.buildSettings.FRAMEWORK_SEARCH_PATHS.includes(mapsMeFrameworkPath)) {
        buildConfig.buildSettings.FRAMEWORK_SEARCH_PATHS.push(mapsMeFrameworkPath);
      }
      
      // Add header search paths
      const headerSearchPaths = buildConfig.buildSettings.HEADER_SEARCH_PATHS || [];
      if (!Array.isArray(headerSearchPaths)) {
        const paths = headerSearchPaths.split(" ") || [];
        buildConfig.buildSettings.HEADER_SEARCH_PATHS = paths;
      }
      
      const mapsMeHeadersPath = "$(PROJECT_DIR)/../iphone/Maps/include";
      if (!buildConfig.buildSettings.HEADER_SEARCH_PATHS.includes(mapsMeHeadersPath)) {
        buildConfig.buildSettings.HEADER_SEARCH_PATHS.push(mapsMeHeadersPath);
      }
    }

    return config;
  });
}

/**
 * Add MAPS.ME module to the main app target
 */
function addMapsMeToMainTarget(config, options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const objects = xcodeProject.hash.project.objects;

    // Find the main app target
    const nativeTargets = Object.keys(objects.PBXNativeTarget || {})
      .map((key) => objects.PBXNativeTarget[key])
      .filter((target) => target.name && target.name.endsWith("App"));

    if (nativeTargets.length === 0) {
      console.warn("No native app target found for MAPS.ME integration");
      return config;
    }

    const mainTarget = nativeTargets[0];

    // Add MapsMeReactNative pod dependency
    const podfilePath = path.join(config.modRequest.projectRoot, "ios", "Podfile");
    if (fs.existsSync(podfilePath)) {
      let podfileContent = fs.readFileSync(podfilePath, "utf8");
      
      // Add the MapsMeReactNative pod if not already present
      if (!podfileContent.includes("pod 'MapsMeReactNative'")) {
        const lines = podfileContent.split('\n');
        let targetBlockEnd = -1;
        
        // Find the end of the main target block
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes("target '") && lines[i].includes("do")) {
            // Find the matching end
            let depth = 1;
            for (let j = i + 1; j < lines.length; j++) {
              if (lines[j].includes("end")) {
                depth--;
                if (depth === 0) {
                  targetBlockEnd = j;
                  break;
                }
              } else if (lines[j].includes("target '") && lines[j].includes("do")) {
                depth++;
              }
            }
            break;
          }
        }

        if (targetBlockEnd > 0) {
          // Insert the MapsMeReactNative pod before the end of the target block
          lines.splice(targetBlockEnd, 0, "  pod 'MapsMeReactNative', :path => './MapsMeReactNative'");
          podfileContent = lines.join('\n');
          fs.writeFileSync(podfilePath, podfileContent);
          console.log("✅ Added MapsMeReactNative pod to Podfile");
        }
      }
    }

    return config;
  });
}

/**
 * Main plugin function
 */
module.exports = function withMapsMe(config, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Apply the plugin steps in order
  config = copyMapsMeModuleToIOS(config, opts);
  config = addMapsMeFrameworkToXcodeProject(config, opts);
  config = addMapsMeToMainTarget(config, opts);

  return config;
};

// Add to the plugins array in app.config.ts
module.exports.__expoConfigPlugin = true;