
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    './scripts/babel-plugin-design-literals.js',
    ['dotenv-import', {
      moduleName: '@env',
      path: '.env',
    }],
    // reanimated 3.19.5 plugin (NOT react-native-worklets/plugin, which is for
    // reanimated 4 + the New Architecture). Paired with iOS Paper config to
    // avoid the Bridgeless RCTEventEmitter.receiveEvent startup-race crash.
    'react-native-reanimated/plugin',
  ],
};
