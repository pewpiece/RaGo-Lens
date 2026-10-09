const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Bundle the ONNX segmentation model (and the diagnostics sample photo, stored as .bin) as assets.
config.resolver.assetExts.push('onnx', 'bin');

module.exports = config;
