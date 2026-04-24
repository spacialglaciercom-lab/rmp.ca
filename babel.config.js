module.exports = function (api) {
  api.cache(true);
  let plugins = [];

  plugins.push(require.resolve("react-native-worklets/plugin"));

  return {
    presets: [
      [
        "babel-preset-expo",
        {
          jsxImportSource: "nativewind",
          reanimated: false,
          unstable_transformImportMeta: true,
        },
      ],
      "nativewind/babel",
    ],
    plugins: [
      ...plugins,
      ["@babel/plugin-proposal-decorators", { legacy: true }],
      ["@babel/plugin-transform-class-properties", { loose: true }],
    ],
  };
};
