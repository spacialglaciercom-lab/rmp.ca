/**
 * Stub Babel plugin for react-native-worklets/plugin.
 * Used when Reanimated 3 is installed - worklets plugin is not needed.
 * Provides a no-op to satisfy babel-preset-expo/nativewind that expect it.
 */
module.exports = function () {
  return {
    visitor: {},
  };
};
