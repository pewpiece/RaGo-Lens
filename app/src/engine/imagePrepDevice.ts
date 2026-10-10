import { Image } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import type { PrepDeps } from './imagePrep';

/** Device implementation of PrepDeps (RN Image + expo-image-manipulator). */
export const devicePrepDeps: PrepDeps = {
  getSize: (uri) =>
    new Promise((resolve, reject) =>
      Image.getSize(uri, (width, height) => resolve({ width, height }), reject),
    ),
  async manipulate(uri, resize) {
    // A PNG/WebP source may carry transparency: keep it lossless instead of flattening it into a JPEG
    // (that would turn the transparent parts black before the model even sees them).
    const keepAlpha = /\.(png|webp)(?:[?#].*)?$/i.test(uri);
    const r = await ImageManipulator.manipulateAsync(uri, resize ? [{ resize }] : [], {
      compress: keepAlpha ? 1 : 0.95,
      format: keepAlpha ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: r.uri, width: r.width, height: r.height };
  },
};
