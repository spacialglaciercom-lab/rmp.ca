/**
 * Run expo start --tunnel with .env loaded so NGROK_AUTHTOKEN is set.
 * Use: pnpm run mobile:tunnel  (or node scripts/run-tunnel.js)
 *
 * Retries automatically when ngrok times out ("took too long to connect").
 * Set TUNNEL_MAX_RETRIES (default 10) and TUNNEL_RETRY_DELAY_MS (default 12000) in .env to tune.
 */
const { spawn } = require("child_process");
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
      process.env[match[1].trim()] = match[2]
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  });
}

const maxRetries = Math.max(
  1,
  parseInt(process.env.TUNNEL_MAX_RETRIES || "10", 10),
);
const retryDelayMs = Math.max(
  1000,
  parseInt(process.env.TUNNEL_RETRY_DELAY_MS || "12000", 10),
);

function runOne() {
  return new Promise((resolve) => {
    const child = spawn("npx", ["expo", "start", "--clear", "--tunnel"], {
      stdio: "inherit",
      env: process.env,
      shell: true,
    });
    child.on("close", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  let lastStatus = 1;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (attempt > 1) {
      console.warn(
        `\n[Tunnel] Retry ${attempt}/${maxRetries} in ${retryDelayMs / 1000}s (ngrok can be slow or flaky)…\n`,
      );
      await sleep(retryDelayMs);
    }
    lastStatus = await runOne();
    if (lastStatus === 0) {
      process.exit(0);
    }
  }
  process.exit(lastStatus);
})();
