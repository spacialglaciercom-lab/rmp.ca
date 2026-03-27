/**
 * Postinstall wrapper. On Vercel (web-only build) skip native iOS/Firebase patches
 * so `pnpm install` does not fail; patches are only needed for native builds.
 */
if (process.env.VERCEL === "1") {
  console.log("Vercel build: skipping native patches (web-only).");
  process.exit(0);
}

const { execSync } = require("child_process");
const run = (cmd, opts = {}) => {
  try {
    execSync(cmd, { stdio: "inherit", ...opts });
  } catch (e) {
    if (opts.ignoreFailure) return;
    throw e;
  }
};
const patches = [
  "scripts/patch-react-native-css-interop.js",
  "scripts/patch-firestore-ios.js",
  "scripts/patch-crashlytics-ios.js",
  "scripts/patch-rnfb-app-check.js",
  "scripts/patch-rnfb-app-module.js",
  "scripts/patch-rnfb-app-module-header.js",
  "scripts/patch-rnfb-simple.js",
  "scripts/patch-rnfb-app-check-specific.js",
  "scripts/patch-ngrok-utils.js",
];
for (const patch of patches) {
  run(`node ${patch}`, { ignoreFailure: true });
}
run("patch-package", { ignoreFailure: true });
