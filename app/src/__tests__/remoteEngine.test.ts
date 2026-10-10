/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { ImageFormat } from '@shopify/react-native-skia';
import { MockEngine } from '@/engine/mockEngine';
import { decodeMaskPng } from '@/engine/remoteDecode';
import {
  DEFAULT_REMOTE,
  FallbackEngine,
  RemoteEngine,
  RemoteError,
  isLanUrl,
  normalizeBaseUrl,
  type RemoteDeps,
} from '@/engine/remoteEngine';
import { alpha8Image } from '@/engine/skiaOps';
import { CutoutError } from '@/engine/types';
import { parseRemoteSettings } from '@/store/settingsStore';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

const input = { uri: 'file:///work.jpg', width: 400, height: 300 };
const pngOf = (w: number, h: number, fill: (x: number, y: number) => number) => {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = fill(x, y);
  return alpha8Image(a, w, h).encodeToBytes(ImageFormat.PNG, 100)!;
};
const cfg = {
  ...DEFAULT_REMOTE,
  baseUrl: 'http://192.168.1.20:8787',
  token: 'secret',
  timeoutMs: 60,
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  bytes: number;
}
function rig(
  handler: (
    call: Call,
  ) =>
    | Promise<{ status: number; type?: string; body?: Uint8Array | string }>
    | { status: number; type?: string; body?: Uint8Array | string },
) {
  const calls: Call[] = [];
  const deps: RemoteDeps = {
    fetch: async (url, init) => {
      const call = {
        url,
        method: init.method,
        headers: init.headers,
        bytes: init.body?.length ?? 0,
      };
      calls.push(call);
      const aborted = new Promise<never>((_, rej) =>
        init.signal.addEventListener('abort', () =>
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        ),
      );
      const r = await Promise.race([Promise.resolve(handler(call)), aborted]);
      const body =
        typeof r.body === 'string'
          ? new TextEncoder().encode(r.body)
          : (r.body ?? new Uint8Array());
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: {
          get: (n: string) => (n.toLowerCase() === 'content-type' ? (r.type ?? null) : null),
        },
        arrayBuffer: async () =>
          body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
      };
    },
    readBytes: async () => new Uint8Array(1000).fill(7),
    decodeMask: decodeMaskPng,
  };
  return { calls, engine: new RemoteEngine(cfg, deps), deps };
}

describe('LAN-only rule', () => {
  it('accepts private, link-local, loopback, localhost and .local hosts; refuses everything else', () => {
    for (const ok of [
      'http://192.168.1.20:8787',
      'http://10.0.0.5',
      'https://172.16.4.2:9000/x',
      'http://172.31.255.1',
      'http://169.254.10.10',
      'http://127.0.0.1:3000',
      'http://localhost:8787',
      'http://golesync.local:8787',
    ])
      expect(isLanUrl(ok)).toBe(true);
    for (const bad of [
      'http://8.8.8.8',
      'https://example.com',
      'http://172.32.0.1',
      'http://172.15.0.1',
      'http://192.169.1.1',
      'http://300.1.1.1',
      'ftp://192.168.1.1',
      'not a url',
      '',
      'http://192.168.1.1.evil.com',
      'file:///etc/passwd',
    ])
      expect(isLanUrl(bad)).toBe(false);
  });
  it('a public address never causes a request', async () => {
    const r = rig(() => ({ status: 200 }));
    const e = new RemoteEngine({ ...cfg, baseUrl: 'https://example.com' }, r.deps);
    await expect(e.segment(input)).rejects.toMatchObject({ code: 'not-lan' });
    await expect(
      new RemoteEngine({ ...cfg, token: '' }, r.deps).segment(input),
    ).rejects.toMatchObject({ code: 'not-configured' });
    expect(r.calls).toEqual([]);
  });
});

describe('typed addresses', () => {
  it('get http:// added when the user leaves the scheme off, and the engine uses it', async () => {
    expect(normalizeBaseUrl(' 192.168.1.20:8787 ')).toBe('http://192.168.1.20:8787');
    expect(normalizeBaseUrl('https://10.0.0.2')).toBe('https://10.0.0.2');
    expect(normalizeBaseUrl('')).toBe('');
    const r = rig(() => ({ status: 200, type: 'application/json', body: '{"model":"m"}' }));
    const e = new RemoteEngine({ ...cfg, baseUrl: '10.0.0.7:8787' }, r.deps);
    await e.ping();
    expect(r.calls[0]!.url).toBe('http://10.0.0.7:8787/v1/health');
    await expect(
      new RemoteEngine({ ...cfg, baseUrl: 'example.com' }, r.deps).ping(),
    ).rejects.toMatchObject({ code: 'not-lan' });
  });
});

describe('RemoteEngine', () => {
  it('posts the JPEG with the bearer token and returns the decoded mask', async () => {
    const r = rig(() => ({
      status: 200,
      type: 'image/png',
      body: pngOf(200, 150, (x) => (x > 100 ? 255 : 0)),
    }));
    const progress: string[] = [];
    const m = await r.engine.segment(input, { onProgress: (_, l) => progress.push(l) });
    expect([m.width, m.height]).toEqual([200, 150]);
    expect(m.alpha[75 * 200 + 150]).toBe(255);
    expect(m.alpha[75 * 200 + 50]).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({
      url: 'http://192.168.1.20:8787/v1/segment',
      method: 'POST',
      bytes: 1000,
    });
    expect(r.calls[0]!.headers).toMatchObject({
      Authorization: 'Bearer secret',
      'Content-Type': 'image/jpeg',
      Accept: 'image/png',
      'X-Image-Width': '400',
      'X-Image-Height': '300',
    });
    expect(progress).toContain('Sending to the laptop');
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [413, 'too-large'],
    [429, 'busy'],
    [503, 'busy'],
    [500, 'server'],
  ])('maps HTTP %i to "%s"', async (status, code) => {
    const r = rig(() => ({ status }));
    await expect(r.engine.segment(input)).rejects.toMatchObject({ code });
  });

  it('times out, reports an unreachable laptop, and rejects wrong or odd answers', async () => {
    await expect(rig(() => new Promise(() => {})).engine.segment(input)).rejects.toMatchObject({
      code: 'timeout',
    });
    const down = rig(() => Promise.reject(new TypeError('Network request failed')));
    await expect(down.engine.segment(input)).rejects.toMatchObject({ code: 'unreachable' });
    await expect(
      rig(() => ({ status: 200, type: 'text/html', body: '<html>' })).engine.segment(input),
    ).rejects.toMatchObject({ code: 'bad-response' });
    await expect(
      rig(() => ({
        status: 200,
        type: 'image/png',
        body: new Uint8Array([1, 2, 3]),
      })).engine.segment(input),
    ).rejects.toMatchObject({ code: 'bad-response' });
    // a 100x100 mask for a 400x300 photo is the wrong shape
    await expect(
      rig(() => ({
        status: 200,
        type: 'image/png',
        body: pngOf(100, 100, () => 255),
      })).engine.segment(input),
    ).rejects.toMatchObject({ code: 'bad-response' });
  });

  it('never uploads a photo above the size limit', async () => {
    const r = rig(() => ({ status: 200 }));
    r.deps.readBytes = async () => new Uint8Array(13 * 1024 * 1024);
    await expect(r.engine.segment(input)).rejects.toMatchObject({ code: 'too-large' });
    expect(r.calls).toEqual([]);
  });

  it('a user cancel is a cancel, not a failure', async () => {
    const r = rig(() => new Promise(() => {}));
    const ctl = new AbortController();
    const p = r.engine.segment(input, { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 5);
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('health check returns the model name', async () => {
    const r = rig(() => ({
      status: 200,
      type: 'application/json',
      body: '{"ok":true,"model":"birefnet-hr"}',
    }));
    expect(await r.engine.ping()).toBe('birefnet-hr');
    expect(r.calls[0]).toMatchObject({ url: 'http://192.168.1.20:8787/v1/health', method: 'GET' });
    await expect(rig(() => ({ status: 200, body: 'nope' })).engine.ping()).rejects.toBeInstanceOf(
      RemoteError,
    );
  });
});

describe('mask PNG decoding', () => {
  it('plain grey is the mask; grey with a real alpha uses alpha', () => {
    const grey = decodeMaskPng(pngOf(20, 10, (x) => x * 12));
    expect([grey.width, grey.height]).toEqual([20, 10]);
    expect(grey.alpha[5]).toBeGreaterThan(0);
    // an Alpha_8 PNG decodes as (0,0,0,a): colour equal, alpha varies -> alpha is the mask
    const a8 = decodeMaskPng(
      alpha8Image(
        Uint8Array.from({ length: 200 }, (_, i) => (i % 20) * 12),
        20,
        10,
      ).encodeToBytes(ImageFormat.PNG, 100)!,
    );
    expect(a8.alpha[19]).toBe(228);
  });
});

describe('FallbackEngine', () => {
  const local = new MockEngine({ maskSize: 32 });
  it('uses the primary when it works and the on-device engine when it fails; id says which', async () => {
    const ok = {
      id: 'remote',
      label: 'r',
      segment: jest.fn(async () => ({ alpha: new Uint8Array(16), width: 4, height: 4 })),
    };
    const f1 = new FallbackEngine(ok, local);
    await f1.segment(input);
    expect(f1.id).toBe('remote');
    const bad = {
      id: 'remote',
      label: 'r',
      segment: jest.fn(async () => {
        throw new RemoteError('unreachable', 'x');
      }),
    };
    const reasons: unknown[] = [];
    const f2 = new FallbackEngine(bad, local, (r) => reasons.push(r));
    const m = await f2.segment(input);
    expect(m.width).toBeGreaterThan(2);
    expect(f2.id).toBe('mock');
    expect(reasons).toHaveLength(1);
  });
  it('does not fall back after a user cancel', async () => {
    const cancelled = {
      id: 'remote',
      label: 'r',
      segment: async () => {
        throw new CutoutError('cancelled', 'Cancelled');
      },
    };
    const spy = jest.spyOn(local, 'segment');
    spy.mockClear();
    await expect(new FallbackEngine(cancelled, local).segment(input)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('remote settings', () => {
  it('are parsed defensively and off by default', () => {
    expect(parseRemoteSettings(null)).toEqual({
      enabled: false,
      baseUrl: '',
      token: '',
      timeoutSec: 30,
    });
    expect(
      parseRemoteSettings('{"enabled":true,"baseUrl":" http://10.0.0.2:1 ","timeoutSec":999}'),
    ).toMatchObject({ enabled: true, baseUrl: 'http://10.0.0.2:1', timeoutSec: 120 });
    expect(parseRemoteSettings('junk').enabled).toBe(false);
  });
});
