const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const expoDir = path.join(root, ".expo");

console.log("\n>>> Serving from this folder (must match the one you edit in Cursor):");
console.log(">>>", root);
console.log(">>> If that path is wrong, cd to the correct project and run again.\n");

if (fs.existsSync(expoDir)) {
  fs.rmSync(expoDir, { recursive: true, force: true });
  console.log("Cleared .expo cache\n");
}

execSync("npx expo start --clear", { cwd: root, stdio: "inherit" });
