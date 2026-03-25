#!/usr/bin/env node
/**
 * Start Expo (Metro) for iOS/Android with LAN IP so the device loads bundles from this machine.
 * Use: pnpm run mobile:lan
 * Ensures REACT_NATIVE_PACKAGER_HOSTNAME and EXPO_PUBLIC_API_BASE_URL use your LAN IP (same Wi‑Fi required).
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

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

let ip = process.env.REACT_NATIVE_PACKAGER_HOSTNAME || process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/^https?:\/\//, "").split(":")[0];
if (!ip || ip === "localhost" || ip === "127.0.0.1") {
  const sh = path.join(process.cwd(), "scripts", "check-host-ip.sh");
  try {
    if (fs.existsSync(sh)) ip = execSync(sh, { encoding: "utf8", cwd: process.cwd() }).trim();
  } catch {
    // ignore
  }
}
if (!ip) {
  try {
    const out = execSync("hostname -I 2>/dev/null | awk '{print $1}'", { encoding: "utf8" }).trim();
    if (out) ip = out.split(/\s/)[0];
  } catch {
    // ignore
  }
}
if (!ip) {
  console.warn("Could not detect LAN IP. Set REACT_NATIVE_PACKAGER_HOSTNAME and EXPO_PUBLIC_API_BASE_URL in .env to your computer's IP.");
} else {
  process.env.REACT_NATIVE_PACKAGER_HOSTNAME = ip;
  if (!process.env.EXPO_PUBLIC_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL.includes("localhost")) {
    process.env.EXPO_PUBLIC_API_BASE_URL = `http://${ip}:3000`;
  }
  console.log("LAN mode: packager host =", ip, "| API base =", process.env.EXPO_PUBLIC_API_BASE_URL);
}

const child = spawn(
  "npx",
  ["expo", "start", "--clear"],
  {
    stdio: "inherit",
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=8192" },
    shell: true,
  }
);
child.on("close", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
