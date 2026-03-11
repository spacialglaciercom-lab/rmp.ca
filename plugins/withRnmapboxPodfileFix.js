/**
 * Fix malformed Podfile line inserted by @rnmapbox/maps Expo plugin.
 * The plugin generates "  end @rnmapbox/maps-post_installer" which is invalid Ruby.
 * We REMOVE that entire line. Applied in withPodfile (in-memory) and withDangerousMod
 * (on-disk, including recursive search) so it works on EAS regardless of path/layout.
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

// Remove the entire line containing "end @rnmapbox/..." (allow \r for Windows)
const BAD_LINE = /^\s*end\s+@rnmapbox[^\n\r]*\r?\n?/gm;
function fixPodfileContent(contents) {
  if (typeof contents !== "string") return contents;
  return contents.replace(BAD_LINE, "");
}

/** Find every file named Podfile under dir, skip node_modules, max depth 5 */
function findPodfiles(dir, collected = [], depth = 0) {
  if (depth > 5 || !fs.existsSync(dir)) return collected;
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return collected;
  } catch {
    return collected;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return collected;
  }
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

function withRnmapboxPodfileFix(config) {
  return withPlugins(config, [
    (c) =>
      withPodfile(c, (cfg) => {
        cfg.modResults = fixPodfileContent(cfg.modResults);
        return cfg;
      }),
    (c) =>
      withDangerousMod(c, [
        "ios",
        async (cfg) => {
          const root = cfg.modRequest.platformProjectRoot;
          const cwd = process.cwd();
          const candidates = [
            path.join(root, "Podfile"),
            path.join(cwd, "ios", "Podfile"),
            path.join(cwd, "build", "ios", "Podfile"),
            path.join(root, "..", "ios", "Podfile"),
            path.join(root, "..", "build", "ios", "Podfile"),
          ];
          const searchRoots = [
            root,
            path.join(root, ".."),
            cwd,
            path.join(cwd, "build"),
          ];
          const allPodfiles = [
            ...new Set([
              ...candidates,
              ...searchRoots.flatMap((d) => findPodfiles(d)),
            ]),
          ];
          for (const podfilePath of allPodfiles) {
            try {
              if (!fs.existsSync(podfilePath)) continue;
              const contents = fs.readFileSync(podfilePath, "utf8");
              const fixed = fixPodfileContent(contents);
              if (fixed !== contents)
                fs.writeFileSync(podfilePath, fixed, "utf8");
            } catch {
              // ignore
            }
          }
          return cfg;
        },
      ]),
  ]);
}

module.exports = withRnmapboxPodfileFix;
