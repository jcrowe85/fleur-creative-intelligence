module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo (SDK 57) automatically wires up react-native-worklets /
  // reanimated when the package is installed — no manual plugin needed.
  return {
    presets: ["babel-preset-expo"],
  };
};
