/**
 * Clear all Expo/Metro/UI caches so the latest code (e.g. new UI) is loaded.
 * Run from project root: node scripts/clear-all-cache.js
 * Then start dev with: npx expo start --clear
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

const dirs = [
  path.join(root, ".expo"),
  path.join(root, "node_modules", ".cache"),
];

console.log("\n>>> Clearing caches in:", root);

for (const dir of dirs) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("    Removed:", path.relative(root, dir));
  }
}

console.log("\n>>> Cache clear done.");
console.log(">>> Start the app with a clean Metro bundle:\n");
console.log("    npx expo start --clear\n");
console.log(">>> For web: npx expo start --web --clear\n");
