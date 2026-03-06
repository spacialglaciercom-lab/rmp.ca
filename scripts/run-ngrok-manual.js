/**
 * Start ngrok tunnel to Metro (port 8081) with .env loaded.
 * Use when "ngrok took too long to connect" keeps failing with expo start --tunnel.
 *
 * 1. In another terminal run: pnpm run mobile
 * 2. Run this script: node scripts/run-ngrok-manual.js
 * 3. In Expo Go on your phone, enter the printed URL manually.
 */
const path = require("path");
const fs = require("fs");

// Load .env
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

const METRO_PORT = parseInt(process.env.METRO_PORT || "8081", 10);

async function main() {
  if (!process.env.NGROK_AUTHTOKEN) {
    console.error("Missing NGROK_AUTHTOKEN in .env. Add it from https://dashboard.ngrok.com/get-started/your-authtoken");
    process.exit(1);
  }

  const ngrok = require("@expo/ngrok");
  console.log(`Starting ngrok tunnel to localhost:${METRO_PORT}…`);
  console.log("(Start Metro in another terminal with: pnpm run mobile)\n");

  try {
    const url = await ngrok.connect({
      addr: METRO_PORT,
      authtoken: process.env.NGROK_AUTHTOKEN,
    });
    console.log("---");
    console.log("Tunnel URL (paste this in Expo Go → Enter URL manually):");
    console.log(url);
    console.log("---");
    console.log("Leave this running. Press Ctrl+C to stop the tunnel.");
  } catch (err) {
    console.error("Ngrok failed:", err.message || err);
    process.exit(1);
  }

  process.on("SIGINT", () => {
    ngrok.kill().then(() => process.exit(0)).catch(() => process.exit(0));
  });
}

main();
