/**
 * onnxruntime-react-native is not picked up by Expo's Android autolinking (its native module never registers,
 * so `NativeModules.Onnxruntime` is null at runtime and the app crashes when it opens the processing screen).
 * Declaring it here makes autolinking add `OnnxruntimePackage` to the generated PackageList.
 * Found with the emulator test (scripts/emulator-test.sh).
 */
module.exports = {
  dependencies: {
    'onnxruntime-react-native': {
      platforms: {
        android: {
          sourceDir: 'android', // relative to the package
          packageImportPath: 'import ai.onnxruntime.reactnative.OnnxruntimePackage;',
          packageInstance: 'new OnnxruntimePackage()',
        },
      },
    },
  },
};
