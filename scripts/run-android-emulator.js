/**
 * Restart ADB, ensure ANDROID_HOME is set, then run expo start --android.
 * Fixes "could not connect to TCP port 5554" / "emulator-5554 offline" by resetting ADB.
 * Run: node scripts/run-android-emulator.js  (or pnpm run mobile:android:emulator)
 */
const path = require("path");
const fs = require("fs");
const { execSync, spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const sdkRoot =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
const adb = path.join(sdkRoot, "platform-tools", "adb.exe");

if (!fs.existsSync(adb)) {
  console.error("ADB not found at", adb);
  console.error("Set ANDROID_HOME to your Android SDK root, or install Android Studio.");
  process.exit(1);
}

process.env.ANDROID_HOME = sdkRoot;
if (!process.env.PATH.includes(path.join(sdkRoot, "platform-tools"))) {
  process.env.PATH = path.join(sdkRoot, "platform-tools") + path.delimiter + process.env.PATH;
}

// Load .env
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    if (!line || line.trim().startsWith("#")) return;
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  });
}

console.log("Restarting ADB...");
try {
  execSync(`"${adb}" kill-server`, { stdio: "ignore" });
} catch (_) {}
execSync(`"${adb}" start-server`, { stdio: "inherit" });

const out = execSync(`"${adb}" devices`, { encoding: "utf8" });
const lines = out.split(/\r?\n/).filter((l) => l.trim() && !l.includes("List of devices"));
const devices = lines.filter((l) => (l.split("\t")[1] || "").trim() === "device");
const offline = lines.filter((l) => (l.split("\t")[1] || "").trim() === "offline");

const emulatorPath = path.join(sdkRoot, "emulator", "emulator.exe");

async function waitForDevice() {
  if (devices.length > 0) return;
  if (offline.length > 0) {
    console.warn("\nEmulator(s) are OFFLINE. Disconnecting stale entries...");
    try {
      offline.forEach((line) => {
        const id = (line.split("\t")[0] || "").trim();
        if (id) execSync(`"${adb}" disconnect ${id}`, { stdio: "ignore" });
      });
    } catch (_) {}
  }
  if (!fs.existsSync(emulatorPath)) {
    console.warn("No Android device. Start the emulator from Android Studio (Tools → Device Manager → Run).");
    return;
  }
  try {
    const avdList = execSync(`"${emulatorPath}" -list-avds`, { encoding: "utf8" });
    const avds = avdList.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (avds.length === 0) {
      console.warn("No AVD found. Create one in Android Studio: Tools → Device Manager.");
      return;
    }
    const avd = avds[0];
    console.warn("\nNo device connected. Starting emulator:", avd);
    require("child_process").spawn(emulatorPath, ["-avd", avd], {
      stdio: "ignore",
      detached: true,
      cwd: root,
    }).unref();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    console.warn("Waiting up to 50s for emulator to boot...");
    for (let i = 0; i < 25; i++) {
      await sleep(2000);
      try {
        const devOut = execSync(`"${adb}" devices`, { encoding: "utf8" });
        if (/\tdevice\s*$/m.test(devOut)) {
          console.warn("Emulator ready.\n");
          return;
        }
      } catch (_) {}
    }
    console.warn("Emulator may still be booting. Expo will start; press 'a' when ready.\n");
  } catch (e) {
    console.warn("Could not start emulator:", e.message || e);
  }
}

(async () => {
  await waitForDevice();
  console.log("Starting Expo for Android (port 8083)...\n");
  const child = spawn("npx expo start --android --port 8083", [], {
    stdio: "inherit",
    env: process.env,
    shell: true,
    cwd: root,
  });
  child.on("close", (code) => process.exit(code ?? 0));
})();
