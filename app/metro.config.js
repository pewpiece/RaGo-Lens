const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Bundle the ONNX segmentation model as an asset.
config.resolver.assetExts.push('onnx');

module.exports = config;
