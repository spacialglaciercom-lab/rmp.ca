/**
 * Expo config plugin: set android:largeHeap="true" on the application element.
 * Mitigates OutOfMemoryError from gRPC/OkHttp (e.g. Firebase AsyncSink) on low-memory
 * devices (e.g. tablets, Rebecco). Use as a mitigation only; prefer fixing leaks and
 * reducing memory pressure (lazy Firebase init, image sizing, list virtualization).
 * @see https://developer.android.com/reference/android/R.attr#largeHeap
 */
const path = require("path");
const { createRequire } = require("module");
const requireFromRoot = createRequire(path.join(__dirname, "..", "package.json"));
const { withAndroidManifest } = requireFromRoot("expo/config-plugins");

function withAndroidLargeHeap(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const application = manifest.manifest?.application;
    if (!application || !Array.isArray(application) || application.length === 0) {
      return cfg;
    }
    const app = application[0];
    if (!app.$) app.$ = {};
    app.$["android:largeHeap"] = "true";
    return cfg;
  });
}

module.exports = withAndroidLargeHeap;
