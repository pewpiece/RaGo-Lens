/** Shown in Settings > About. Keep in sync with DECISIONS.md and scripts/model.env. */
export const MODEL_INFO = {
  name: 'U²-Net-P (u2netp.onnx, 4.6 MB), salient object segmentation',
  licence: 'Licence: Apache License 2.0',
  attribution:
    'U²-Net by Xuebin Qin et al. (github.com/xuebinqin/U-2-Net). ONNX conversion distributed by the rembg project (github.com/danielgatis/rembg).',
} as const;

export const OTHER_LICENCES =
  'RaGo Lens is built with React Native, Expo, Skia (react-native-skia), ONNX Runtime, Drizzle ORM and Zustand, all under permissive open-source licences (MIT, Apache 2.0 or similar). Their licence files are in the packages in the source repository.';
