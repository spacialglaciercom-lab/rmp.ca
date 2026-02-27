/**
 * Run expo start --tunnel with .env loaded so NGROK_AUTHTOKEN is set.
 * Use: pnpm run mobile:tunnel  (or node scripts/run-tunnel.js)
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// Load .env into process.env (same logic as load-env: only set if not already set)
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    if (!line || line.trim().startsWith("#")) return;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  });
}

const result = spawnSync(
  "npx",
  ["expo", "start", "--clear", "--tunnel"],
  { stdio: "inherit", env: process.env, shell: true }
);
process.exit(result.status ?? 1);
