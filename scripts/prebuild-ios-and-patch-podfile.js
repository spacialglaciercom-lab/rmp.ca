/**
 * Runs expo prebuild for iOS then patches every Podfile (removes invalid
 * "end @rnmapbox/maps-post_installer" line). Use locally: pnpm run prebuild:ios.
 * When used as EAS prebuildCommand, EAS appends --platform ios; strip it so Node doesn't see unknown options.
 *
 * Usage: node scripts/prebuild-ios-and-patch-podfile.js
 */
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// EAS Build appends "--platform ios" to the prebuild command; strip so our script isn't passed unknown options
process.argv = process.argv.slice(0, 2);

execSync("pnpm expo prebuild --platform ios", { stdio: "inherit" });

// Match the exact bad line (optional \r for Windows); remove entire line so Ruby never sees "end @rnmapbox..."
const BAD_LINE = /\s*end\s+@rnmapbox[^\s\n\r]*\r?\n?/g;

function fixPodfileContent(contents) {
  if (typeof contents !== "string") return contents;
  return contents.replace(BAD_LINE, "\n");
}

/** Collect every path named Podfile under dir, skip node_modules, max depth 5 */
function findPodfiles(dir, collected = [], depth = 0) {
  if (depth > 5 || !fs.existsSync(dir)) return collected;
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) return collected;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.name === "Podfile") collected.push(full);
    else if (
      e.isDirectory() &&
      e.name !== "node_modules" &&
      !e.name.startsWith(".")
    )
      findPodfiles(full, collected, depth + 1);
  }
  return collected;
}

const cwd = process.cwd();
const searchRoots = [path.join(cwd, "ios"), path.join(cwd, "build"), cwd];
const allPodfiles = [
  ...new Set(searchRoots.flatMap((root) => findPodfiles(root))),
];

let patched = 0;
for (const podfilePath of allPodfiles) {
  try {
    let contents = fs.readFileSync(podfilePath, "utf8");
    const fixed = fixPodfileContent(contents);
    if (fixed !== contents) {
      fs.writeFileSync(podfilePath, fixed, "utf8");
      patched++;
      console.log(
        "[prebuild-ios-and-patch] Patched:",
        path.relative(cwd, podfilePath),
      );
    }
  } catch (err) {
    console.warn("[prebuild-ios-and-patch] Skip", podfilePath, err.message);
  }
}
if (patched)
  console.log(
    "[prebuild-ios-and-patch] Removed invalid 'end @rnmapbox/...' from",
    patched,
    "Podfile(s).",
  );

// Verify no Podfile still contains the bad line (fail fast so we don't get to pod install with a broken file)
for (const podfilePath of allPodfiles) {
  try {
    const contents = fs.readFileSync(podfilePath, "utf8");
    if (
      contents.includes("@rnmapbox/maps-post_installer") ||
      /\bend\s+@rnmapbox\b/.test(contents)
    ) {
      console.error(
        "[prebuild-ios-and-patch] ERROR: Podfile still contains invalid line:",
        podfilePath,
      );
      process.exit(1);
    }
  } catch {
    // ignore
  }
}
