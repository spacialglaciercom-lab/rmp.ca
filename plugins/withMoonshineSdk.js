/**
 * Expo config plugin: adds the Moonshine Voice SDK as a Swift Package Manager
 * dependency to the iOS app target for on-device speech-to-text.
 *
 * For Android, the JNI shared libraries (.so) and AAR are bundled via the
 * module's build.gradle — no extra config plugin work needed.
 *
 * Pattern follows plugins/withLeapSdk.js.
 *
 * @see https://github.com/nicholasgasior/moonshine (placeholder — use actual repo)
 */

const path = require("path");
const { createRequire } = require("module");

const requireFromRoot = createRequire(
  path.join(__dirname, "..", "package.json"),
);
const { withXcodeProject } = requireFromRoot("expo/config-plugins");

const DEFAULT_OPTIONS = {
  // TODO: Replace with public Moonshine SPM repo URL once published
  repositoryUrl: "https://github.com/nicholasgasior/moonshine.git",
  version: "2.0.0",
  repoName: "moonshine",
  products: ["MoonshineVoice"],
};

/**
 * Find all PBXNativeTarget keys (so we add packageProductDependencies to every target).
 */
function getAllNativeTargetKeys(project) {
  const objects = project.hash.project.objects;
  const nativeTargets = objects.PBXNativeTarget || {};
  return Object.keys(nativeTargets).filter((k) => !k.includes("_comment"));
}

function addMoonshineSdkToTargets(config, options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { repositoryUrl, version, repoName, products } = opts;

  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const objects = xcodeProject.hash.project.objects;

    // One package reference for the repo
    const packageReferenceUUID = xcodeProject.generateUuid();
    const packageRefKey = `${packageReferenceUUID} /* XCRemoteSwiftPackageReference "${repoName}" */`;

    // 1. XCRemoteSwiftPackageReference
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

    // 2. PBXProject.packageReferences
    const projectSection = objects.PBXProject || {};
    const projectId = Object.keys(projectSection).find(
      (k) => !k.includes("_comment"),
    );
    if (projectId) {
      const proj = projectSection[projectId];
      if (!proj.packageReferences) proj.packageReferences = [];
      if (!proj.packageReferences.includes(packageRefKey)) {
        proj.packageReferences.push(packageRefKey);
      }
    }

    const nativeTargetKeys = getAllNativeTargetKeys(xcodeProject);

    for (const productName of products) {
      for (const targetKey of nativeTargetKeys) {
        const target = objects.PBXNativeTarget[targetKey];
        if (!target) continue;

        const packageProductUUID = xcodeProject.generateUuid();
        const productRefKey = `${packageProductUUID} /* ${productName} */`;

        // 3. XCSwiftPackageProductDependency
        if (!objects.XCSwiftPackageProductDependency) {
          objects.XCSwiftPackageProductDependency = {};
        }
        objects.XCSwiftPackageProductDependency[productRefKey] = {
          isa: "XCSwiftPackageProductDependency",
          package: packageRefKey,
          productName: productName,
        };

        // 4. Target packageProductDependencies
        if (!target.packageProductDependencies) {
          target.packageProductDependencies = [];
        }
        const alreadyAdded = target.packageProductDependencies.some((ref) => {
          const dep = objects.XCSwiftPackageProductDependency?.[ref];
          return dep && dep.productName === productName;
        });
        if (!alreadyAdded) {
          target.packageProductDependencies.push(productRefKey);
        }

        // 5. PBXBuildFile
        const frameworkBuildFileUUID = xcodeProject.generateUuid();
        const buildFileKey = `${frameworkBuildFileUUID} /* ${productName} in Frameworks */`;

        if (!objects.PBXBuildFile) objects.PBXBuildFile = {};
        objects.PBXBuildFile[buildFileKey] = {
          isa: "PBXBuildFile",
          productRef: productRefKey,
        };

        // 6. Frameworks build phase
        if (target.buildPhases) {
          for (const phaseRef of target.buildPhases) {
            const phaseKey =
              typeof phaseRef === "string" ? phaseRef : phaseRef.value;
            const phase = objects.PBXFrameworksBuildPhase?.[phaseKey];
            if (phase) {
              if (!phase.files) phase.files = [];
              const fileAlreadyAdded = phase.files.some((f) => {
                const bf = objects.PBXBuildFile?.[f];
                if (!bf || !bf.productRef) return false;
                const dep =
                  objects.XCSwiftPackageProductDependency?.[bf.productRef];
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

module.exports = function withMoonshineSdk(config, options = {}) {
  return addMoonshineSdkToTargets(config, options);
};
