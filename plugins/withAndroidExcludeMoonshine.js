/**
 * Expo config plugin: exclude moonshine-voice from Android autolinking so the
 * build does not resolve ai.moonshine:moonshine-voice from JitPack (avoids timeouts).
 * On Android we use server Whisper for STT.
 *
 * Injects exclude into settings.gradle so Gradle does not link moonshine-voice.
 * Handles both: useExpoModules() (legacy) and expoAutolinking.useExpoModules() (plugin).
 */
const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");
const requireFromRoot = createRequire(
  path.join(__dirname, "..", "package.json"),
);
const { withDangerousMod } = requireFromRoot("expo/config-plugins");

const EXCLUDE_LINE = "expoAutolinking.exclude = ['moonshine-voice']";
const LEGACY_CALL = "useExpoModules([exclude: ['moonshine-voice']])";
const PLAIN_CALL = "useExpoModules()";

function withAndroidExcludeMoonshine(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const settingsPath = path.join(projectRoot, "android", "settings.gradle");

      if (!fs.existsSync(settingsPath)) {
        return cfg;
      }

      let contents = fs.readFileSync(settingsPath, "utf8");
      if (contents.includes("moonshine-voice")) {
        return cfg;
      }

      // New plugin format: expoAutolinking.useExpoModules() — add exclude before the call
      if (contents.includes("expoAutolinking.useExpoModules()")) {
        contents = contents.replace(
          "expoAutolinking.useExpoModules()",
          `${EXCLUDE_LINE}\nexpoAutolinking.useExpoModules()`,
        );
      } else if (contents.includes(PLAIN_CALL)) {
        contents = contents.replace(PLAIN_CALL, LEGACY_CALL);
      }
      fs.writeFileSync(settingsPath, contents, "utf8");
      return cfg;
    },
  ]);
}

module.exports = withAndroidExcludeMoonshine;
