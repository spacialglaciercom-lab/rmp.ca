/**
 * Postinstall: patch @rnmapbox/maps plugin so the Podfile it writes never contains
 * the invalid line "end @rnmapbox/maps-post_installer". We fix the content right before
 * writeFile so pod install succeeds on EAS.
 */
const fs = require("fs");
const path = require("path");

const cwd = process.cwd();

function findRnmapboxPlugin() {
  const candidates = [];
  try {
    const pkgPath = require.resolve("@rnmapbox/maps/package.json");
    candidates.push(path.join(path.dirname(pkgPath), "plugin", "build", "withMapbox.js"));
  } catch {
    // continue
  }
  candidates.push(path.join(cwd, "node_modules", "@rnmapbox", "maps", "plugin", "build", "withMapbox.js"));
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const patchedPath = path.join(cwd, "scripts", "patches", "withMapbox.patched.js");
const haveCommittedPatch = fs.existsSync(patchedPath);

function findAllWithMapboxPaths() {
  const out = [];
  const nm = path.join(cwd, "node_modules");
  if (!fs.existsSync(nm)) return out;
  const dirs = ["node_modules"];
  if (fs.existsSync(path.join(nm, ".pnpm"))) {
    try {
      const pnpm = fs.readdirSync(path.join(nm, ".pnpm"));
      for (const name of pnpm) {
        if (name.startsWith("@rnmapbox+maps")) {
          const build = path.join(nm, ".pnpm", name, "node_modules", "@rnmapbox", "maps", "plugin", "build", "withMapbox.js");
          if (fs.existsSync(build)) out.push(build);
        }
      }
    } catch {
      // ignore
    }
  }
  const flat = path.join(nm, "@rnmapbox", "maps", "plugin", "build", "withMapbox.js");
  if (fs.existsSync(flat)) out.push(flat);
  return [...new Set(out)];
}

const allPaths = findAllWithMapboxPaths();
if (allPaths.length === 0 && !haveCommittedPatch) {
  process.exit(0);
}

const targetPaths = allPaths.length ? allPaths : (findRnmapboxPlugin() ? [findRnmapboxPlugin()] : []).filter(Boolean);
if (targetPaths.length === 0) {
  process.exit(0);
}

let patchedContent = null;
if (haveCommittedPatch) {
  patchedContent = fs.readFileSync(patchedPath, "utf8");
}

for (const withMapboxPath of targetPaths) {
  if (!fs.existsSync(withMapboxPath)) continue;
  let code = fs.readFileSync(withMapboxPath, "utf8");

  if (code.includes("_podfileContents.replace") && code.includes("@rnmapbox")) {
    continue; // already patched (remove-line or replace variant)
  }

  if (patchedContent) {
    fs.writeFileSync(withMapboxPath, patchedContent, "utf8");
    console.log("[patch-rnmapbox-podfile] Applied fix to", path.relative(cwd, withMapboxPath));
    continue;
  }

  if (!code.includes("applyCocoaPodsModifications)(contents, {")) continue;

  const newBlock = `let _podfileContents = (0, exports.applyCocoaPodsModifications)(contents, {
            RNMapboxMapsImpl,
            RNMapboxMapsVersion,
            RNMapboxMapsDownloadToken,
            RNMapboxMapsUseV11,
        });
        _podfileContents = _podfileContents.replace(/^\\s*end\\s+@rnmapbox[^\\n]*\\n?/gm, '');
        await fs_1.promises.writeFile(file, _podfileContents, 'utf-8');`;

  const regex = /await fs_1\.promises\.writeFile\(file, \(0, exports\.applyCocoaPodsModifications\)\(contents, \{\s*RNMapboxMapsImpl,[\s\S]*?\}\), 'utf-8'\);/;
  const newCode = code.replace(regex, newBlock);
  if (newCode !== code) {
    fs.writeFileSync(withMapboxPath, newCode, "utf8");
    console.log("[patch-rnmapbox-podfile] Patched", path.relative(cwd, withMapboxPath));
  }
}

if (patchedContent || targetPaths.length) {
  console.log("[patch-rnmapbox-podfile] @rnmapbox/maps Podfile fix applied.");
}
