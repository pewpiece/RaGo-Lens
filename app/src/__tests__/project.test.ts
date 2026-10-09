import fs from 'node:fs';
import path from 'node:path';

const appDir = path.resolve(__dirname, '../..');
const repoDir = path.resolve(appDir, '..');
const read = (p: string) => fs.readFileSync(p, 'utf8');
const appJson = JSON.parse(read(path.join(appDir, 'app.json'))).expo;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('app configuration', () => {
  it('has the agreed identity', () => {
    expect(appJson.name).toBe('RaGo Lens');
    expect(appJson.android.package).toBe('dev.rago.lens');
    expect(appJson.android.adaptiveIcon.backgroundColor).toBe('#0E1116');
  });

  it('wires the branding files from assets/branding and they exist', () => {
    expect(appJson.icon).toBe('./assets/branding/icon.png');
    expect(appJson.android.adaptiveIcon.foregroundImage).toBe(
      './assets/branding/adaptive-icon-foreground.png',
    );
    const splash = appJson.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen',
    );
    expect(splash[1].image).toBe('./assets/branding/splash-icon.png');
    for (const rel of [
      appJson.icon,
      appJson.android.adaptiveIcon.foregroundImage,
      splash[1].image,
    ]) {
      expect(fs.existsSync(path.join(appDir, rel))).toBe(true);
    }
  });

  it('does not block the camera permission and accepts shared images', () => {
    expect(appJson.android.blockedPermissions).not.toContain('android.permission.CAMERA');
    const share = appJson.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === 'expo-share-intent',
    );
    expect(share[1].androidIntentFilters).toEqual(['image/*']);
    expect(share[1].disableIOS).toBe(true); // Android-only app; the iOS extension needs extra tooling
  });

  it('declares the on-device runtime and storage plugins', () => {
    const names = appJson.plugins.map((p: unknown) => (Array.isArray(p) ? p[0] : p));
    expect(names).toEqual(
      expect.arrayContaining([
        'expo-router',
        'onnxruntime-react-native',
        'expo-sqlite',
        'expo-camera',
        'expo-media-library',
      ]),
    );
  });

  it('blocks INTERNET only when RAGO_BLOCK_INTERNET=1', () => {
    const wrap = require('../../app.config.js');
    const base = { ...appJson };
    const off = wrap({ config: base });
    expect(off.android.blockedPermissions).not.toContain('android.permission.INTERNET');
    process.env.RAGO_BLOCK_INTERNET = '1';
    try {
      const on = wrap({ config: base });
      expect(on.android.blockedPermissions).toEqual(
        expect.arrayContaining([
          'android.permission.INTERNET',
          'android.permission.SYSTEM_ALERT_WINDOW',
        ]),
      );
      expect(on.android.blockedPermissions).toEqual(
        expect.arrayContaining(appJson.android.blockedPermissions),
      );
    } finally {
      delete process.env.RAGO_BLOCK_INTERNET;
    }
  });
});

describe('no network access at runtime', () => {
  const sources = walk(path.join(appDir, 'src')).filter(
    (f) =>
      /\.(ts|tsx)$/.test(f) &&
      !f.includes(`${path.sep}__tests__${path.sep}`) &&
      !f.includes(`${path.sep}testing${path.sep}`),
  );
  it('finds the app sources', () => expect(sources.length).toBeGreaterThan(30));
  it.each([
    ['fetch(', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['WebSocket', /WebSocket/],
    ['axios', /\baxios\b/],
    ['http(s):// URLs', /https?:\/\//],
  ])('app code contains no %s', (_name, re) => {
    const offenders = sources.filter((f) => re.test(read(f)));
    expect(offenders.map((f) => path.relative(appDir, f))).toEqual([]);
  });
});

describe('release pipeline files', () => {
  it('release workflow builds on v* tags, fetches the model and signs from the four documented secrets', () => {
    const wf = read(path.join(repoDir, '.github/workflows/release.yml'));
    expect(wf).toMatch(/tags:\s*\['v\*'\]/);
    expect(wf).toContain('fetch-model.sh');
    expect(wf).toContain('expo prebuild --platform android');
    expect(wf).toContain('assembleRelease');
    for (const s of ['KEYSTORE_BASE64', 'KEYSTORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD']) {
      expect(wf).toContain(`secrets.${s}`);
      expect(read(path.join(repoDir, 'docs/RELEASING.md'))).toContain(s);
    }
    expect(wf).toContain('apksigner');
  });

  it('CI runs lint, typecheck and tests', () => {
    const wf = read(path.join(repoDir, '.github/workflows/ci.yml'));
    for (const cmd of ['npm run lint', 'npm run typecheck', 'npm test']) expect(wf).toContain(cmd);
  });

  it('no keystores or secrets are committed', () => {
    const files = walk(repoDir).filter(
      (f) =>
        !f.includes('node_modules') &&
        !f.includes(`${path.sep}.git${path.sep}`) &&
        !f.includes(`${path.sep}android${path.sep}`),
    );
    expect(files.filter((f) => /\.(keystore|jks|p12|pem)$/.test(f))).toEqual([]);
  });

  it('the model script, env file and About text agree on the model', () => {
    const env = read(path.join(repoDir, 'scripts/model.env'));
    expect(env).toMatch(/MODEL_SHA256=[0-9a-f]{64}/);
    expect(env).toContain('u2netp.onnx');
    const script = read(path.join(repoDir, 'scripts/fetch-model.sh'));
    expect(script).toContain('MODEL_SHA256');
    expect(script).toContain('sha256');
    expect(read(path.join(appDir, 'src/engine/modelAsset.ts'))).toContain('u2netp.onnx');
  });
});
