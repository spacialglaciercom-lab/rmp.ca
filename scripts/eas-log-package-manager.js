/**
 * EAS Build: log which package manager is in use so the build log confirms pnpm.
 * Runs before "Install dependencies". If this fails, EAS may be using npm.
 */
const { execSync } = require("child_process");
try {
  const out = execSync("pnpm --version", { encoding: "utf8" }).trim();
  console.log("[EAS] Package manager: pnpm@" + out);
} catch (e) {
  console.warn(
    "[EAS] pnpm not in PATH; EAS may use npm. Check the next step in the log.",
  );
}
