/**
 * Expo config plugin: fixes iOS voice recording when expo-video is in the app.
 *
 * expo-video sets the audio session to .playback, which prevents expo-audio from recording.
 * This plugin changes it to .playAndRecord so both video playback and microphone recording work.
 * See: https://github.com/expo/expo/issues/36890
 *
 * Runs at prebuild so the fix is applied before Xcode compiles (works on EAS).
 */
const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");
const requireFromRoot = createRequire(
  path.join(__dirname, "..", "package.json"),
);
const { withDangerousMod } = requireFromRoot("expo/config-plugins");

function patchExpoVideoManager(projectRoot) {
  let videoRoot;
  try {
    const pkgPath = requireFromRoot.resolve("expo-video/package.json");
    videoRoot = path.dirname(pkgPath);
  } catch {
    return;
  }

  const swiftPath = path.join(videoRoot, "ios", "VideoManager.swift");
  if (!fs.existsSync(swiftPath)) return;

  let content = fs.readFileSync(swiftPath, "utf8");

  const alreadyPatched = content.includes(".playAndRecord");
  if (alreadyPatched) return;

  content = content.replace(
    /audioSession\.category != \.playback/g,
    "audioSession.category != .playAndRecord",
  );
  content = content.replace(
    /setCategory\(\.playback, mode: \.moviePlayback/g,
    "setCategory(.playAndRecord, mode: .moviePlayback",
  );
  content = content.replace(
    "if audioSession.categoryOptions != audioSessionCategoryOptions || audioSession.category != .playAndRecord || audioSession.mode != .moviePlayback {",
    "// Use .playAndRecord so expo-audio voice recording works alongside video (expo/expo#36890)\n    if audioSession.categoryOptions != audioSessionCategoryOptions || audioSession.category != .playAndRecord || audioSession.mode != .moviePlayback {",
  );

  fs.writeFileSync(swiftPath, content, "utf8");
}

function withExpoVideoRecordingFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      patchExpoVideoManager(projectRoot);
      return cfg;
    },
  ]);
}

module.exports = withExpoVideoRecordingFix;
