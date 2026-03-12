/**
 * Postinstall wrapper. On Vercel (web-only build) skip native iOS/Firebase patches
 * so `pnpm install` does not fail; patches are only needed for native builds.
 */
if (process.env.VERCEL === "1") {
  console.log("Vercel build: skipping native patches (web-only).");
  process.exit(0);
}

const { execSync } = require("child_process");
const cmd =
  "node scripts/patch-react-native-css-interop.js && node scripts/patch-firestore-ios.js && node scripts/patch-crashlytics-ios.js && node scripts/patch-rnfb-app-check.js && node scripts/patch-rnfb-app-module.js && node scripts/patch-rnfb-app-module-header.js && node scripts/patch-rnfb-simple.js && node scripts/patch-rnfb-app-check-specific.js && node scripts/patch-ngrok-utils.js && patch-package";
execSync(cmd, { stdio: "inherit" });
