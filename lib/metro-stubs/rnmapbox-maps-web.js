/**
 * Stub for @rnmapbox/maps on web. Native-only; never run in browser.
 * Metro resolves @rnmapbox/maps to this file when platform is "web"
 * so the web bundle never loads the native Mapbox SDK (which pulls in react-native-maps).
 */
const noop = () => {};
module.exports = {
  default: {
    setAccessToken: noop,
  },
};
module.exports.default = module.exports.default;
