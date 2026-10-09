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
    const r = await ImageManipulator.manipulateAsync(uri, resize ? [{ resize }] : [], {
      compress: 0.95,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: r.uri, width: r.width, height: r.height };
  },
};
