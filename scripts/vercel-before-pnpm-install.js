#!/usr/bin/env node
/**
 * Vercel / CI: pnpm fails if package.json links to
 * file:./shared-logic/build/js/packages/shared-logic (gitignored until Gradle runs).
 * Create a minimal stub there only when that path is the declared dependency.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let dep = "";
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  dep = pkg.dependencies?.["shared-logic"] || "";
} catch {
  process.exit(0);
}

const wantsGradlePath =
  typeof dep === "string" &&
  dep.includes("shared-logic/build/js/packages/shared-logic");

if (!wantsGradlePath) {
  process.exit(0);
}

const stubDir = path.join(root, "shared-logic/build/js/packages/shared-logic");
const pkgJson = path.join(stubDir, "package.json");
if (fs.existsSync(pkgJson)) {
  process.exit(0);
}

fs.mkdirSync(path.join(stubDir, "kotlin"), { recursive: true });
fs.writeFileSync(
  pkgJson,
  JSON.stringify(
    {
      name: "shared-logic",
      version: "0.0.1",
      main: "kotlin/rmp-ca-shared-logic.js",
      description: "CI stub (KMP not built). Replace via Gradle + pnpm add file:...",
    },
    null,
    2,
  ) + "\n",
);
fs.writeFileSync(
  path.join(stubDir, "kotlin/rmp-ca-shared-logic.js"),
  "module.exports = {};\n",
);
console.log("[vercel-before-pnpm-install] created shared-logic Gradle-path stub for pnpm");
