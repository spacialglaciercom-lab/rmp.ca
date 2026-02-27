/**
 * Expo config plugin: adds the Leap SDK (Liquid AI) as a Swift Package Manager
 * dependency to the main iOS app target so it is available for native code and TestFlight builds.
 *
 * @see https://leap.liquid.ai/docs/edge-sdk/ios
 * @see https://github.com/Liquid4All/leap-ios
 */

const path = require("path");
const { createRequire } = require("module");

// Require from project root so EAS Build and pnpm resolve correctly (same as other plugins)
const requireFromRoot = createRequire(path.join(__dirname, "..", "package.json"));
const { withXcodeProject } = requireFromRoot("expo/config-plugins");

const DEFAULT_OPTIONS = {
  repositoryUrl: "https://github.com/Liquid4All/leap-ios.git",
  version: "0.9.2",
  repoName: "leap-ios",
  products: ["LeapSDK"],
};

/**
 * Find all PBXNativeTarget keys (so we add packageProductDependencies to every target).
 */
function getAllNativeTargetKeys(project) {
  const objects = project.hash.project.objects;
  const nativeTargets = objects.PBXNativeTarget || {};
  return Object.keys(nativeTargets).filter((k) => !k.includes("_comment"));
}

/**
 * Find all Frameworks build phase keys (so we add Leap to both app and module targets).
 */
function getAllFrameworksBuildPhaseKeys(project) {
  const objects = project.hash.project.objects;
  const frameworksSection = objects.PBXFrameworksBuildPhase || {};
  return Object.keys(frameworksSection).filter((k) => !k.includes("_comment"));
}

function addLeapSdkToMainTarget(config, options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { repositoryUrl, version, repoName, products } = opts;

  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const objects = xcodeProject.hash.project.objects;

    // One package reference for the repo
    const packageReferenceUUID = xcodeProject.generateUuid();
    const packageRefKey = `${packageReferenceUUID} /* XCRemoteSwiftPackageReference "${repoName}" */`;

    // 1. XCRemoteSwiftPackageReference (once per repo)
    if (!objects.XCRemoteSwiftPackageReference) {
      objects.XCRemoteSwiftPackageReference = {};
    }
    objects.XCRemoteSwiftPackageReference[packageRefKey] = {
      isa: "XCRemoteSwiftPackageReference",
      repositoryURL: repositoryUrl,
      requirement: {
        kind: "upToNextMajorVersion",
        minimumVersion: version,
      },
    };

    // 2. PBXProject.packageReferences (once)
    const projectSection = objects.PBXProject || {};
    const projectId = Object.keys(projectSection).find((k) => !k.includes("_comment"));
    if (projectId) {
      const proj = projectSection[projectId];
      if (!proj.packageReferences) proj.packageReferences = [];
      if (!proj.packageReferences.includes(packageRefKey)) {
        proj.packageReferences.push(packageRefKey);
      }
    }

    // Get all native targets so we can add product dependencies to each
    const nativeTargetKeys = getAllNativeTargetKeys(xcodeProject);
    const frameworkPhaseKeys = getAllFrameworksBuildPhaseKeys(xcodeProject);

    for (const productName of products) {
      // Each native target needs its OWN product dependency + build file entry.
      // Without per-target packageProductDependencies, the module target cannot
      // resolve `import LeapSDK` and the native module fails to load at runtime.
      for (const targetKey of nativeTargetKeys) {
        const target = objects.PBXNativeTarget[targetKey];
        if (!target) continue;

        // Create a unique product dependency for this target
        const packageProductUUID = xcodeProject.generateUuid();
        const productRefKey = `${packageProductUUID} /* ${productName} */`;

        // 3. XCSwiftPackageProductDependency (per target per product)
        if (!objects.XCSwiftPackageProductDependency) {
          objects.XCSwiftPackageProductDependency = {};
        }
        objects.XCSwiftPackageProductDependency[productRefKey] = {
          isa: "XCSwiftPackageProductDependency",
          package: packageRefKey,
          productName: productName,
        };

        // 4. Add to target's packageProductDependencies array
        if (!target.packageProductDependencies) {
          target.packageProductDependencies = [];
        }
        // Avoid duplicates (check by product name)
        const alreadyAdded = target.packageProductDependencies.some((ref) => {
          const dep = objects.XCSwiftPackageProductDependency?.[ref];
          return dep && dep.productName === productName;
        });
        if (!alreadyAdded) {
          target.packageProductDependencies.push(productRefKey);
        }

        // 5. PBXBuildFile (per target)
        const frameworkBuildFileUUID = xcodeProject.generateUuid();
        const buildFileKey = `${frameworkBuildFileUUID} /* ${productName} in Frameworks */`;

        if (!objects.PBXBuildFile) objects.PBXBuildFile = {};
        objects.PBXBuildFile[buildFileKey] = {
          isa: "PBXBuildFile",
          productRef: productRefKey,
        };

        // 6. Add to this target's frameworks build phase
        if (target.buildPhases) {
          for (const phaseRef of target.buildPhases) {
            const phaseKey = typeof phaseRef === "string" ? phaseRef : phaseRef.value;
            const phase = objects.PBXFrameworksBuildPhase?.[phaseKey];
            if (phase) {
              if (!phase.files) phase.files = [];
              // Check if already added by product name
              const fileAlreadyAdded = phase.files.some((f) => {
                const bf = objects.PBXBuildFile?.[f];
                if (!bf || !bf.productRef) return false;
                const dep = objects.XCSwiftPackageProductDependency?.[bf.productRef];
                return dep && dep.productName === productName;
              });
              if (!fileAlreadyAdded) {
                phase.files.push(buildFileKey);
              }
            }
          }
        }
      }
    }

    return config;
  });
}

module.exports = function withLeapSdk(config, options = {}) {
  return addLeapSdkToMainTarget(config, options);
};
