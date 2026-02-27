/**
 * Patches the iOS Podfile to remove the invalid line "end @rnmapbox/maps-post_installer"
 * that @rnmapbox/maps Expo plugin can insert. Run after prebuild (e.g. via EAS prebuildCommand)
 * so the fix is applied before "pod install".
 *
 * Usage: node scripts/patch-podfile-rnmapbox.js
 * Run from project root; reads and writes ios/Podfile.
 */
const path = require("path");
const fs = require("fs");

const podfilePath = path.join(process.cwd(), "ios", "Podfile");
if (!fs.existsSync(podfilePath)) {
  console.warn("[patch-podfile-rnmapbox] No ios/Podfile found, skipping.");
  process.exit(0);
}

let contents = fs.readFileSync(podfilePath, "utf8");
const bad = /(\s*)end\s+@rnmapbox[^\s\n]*/g;
const fixed = contents.replace(bad, "$1end");
if (fixed === contents) {
  process.exit(0);
}
fs.writeFileSync(podfilePath, fixed, "utf8");
console.log("[patch-podfile-rnmapbox] Patched Podfile: removed invalid 'end @rnmapbox/...' line(s).");
