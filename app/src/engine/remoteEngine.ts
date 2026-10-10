import {
  throwIfAborted,
  CutoutError,
  type EngineInput,
  type EngineRunOptions,
  type ImageEngine,
  type MaskResult,
} from './types';

/**
 * Optional "HD engine": sends the working photo to a larger model on the user's own computer over the local network and
 * gets a mask back. DISABLED BY DEFAULT. This is the only code in the app that may use the network, and only for an
 * address on the local network that the user typed in (private IPv4 ranges, link-local, `localhost` and `*.local`).
 * Any failure falls back to the on-device engine (see FallbackEngine).
 */
export interface RemoteConfig {
  baseUrl: string;
  token: string;
  /** Total time allowed for one request. */
  timeoutMs: number;
  /** Largest photo we will upload. */
  maxRequestBytes: number;
}

export const DEFAULT_REMOTE: RemoteConfig = {
  baseUrl: '',
  token: '',
  timeoutMs: 30_000,
  maxRequestBytes: 12 * 1024 * 1024,
};

export type RemoteErrorCode =
  | 'not-lan'
  | 'not-configured'
  | 'too-large'
  | 'unreachable'
  | 'timeout'
  | 'auth'
  | 'busy'
  | 'server'
  | 'bad-response';

export class RemoteError extends Error {
  constructor(
    public readonly code: RemoteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

/** "192.168.1.20:8787" -> "http://192.168.1.20:8787" (a typed address usually has no scheme). */
export const normalizeBaseUrl = (input: string): string => {
  const t = input.trim();
  return !t || /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`;
};

/** True only for http(s) URLs whose host is on the local network. Public hosts and public IPs are refused. */
export function isLanUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false; // other DNS names could resolve anywhere
  const [a, b, c, d] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return (
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  );
}

export interface RemoteDeps {
  fetch: (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body?: Uint8Array;
      signal: AbortSignal;
    },
  ) => Promise<{
    ok: boolean;
    status: number;
    headers: { get(name: string): string | null };
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  readBytes(uri: string): Promise<Uint8Array>;
  /** Decodes a PNG mask into 8-bit coverage. */
  decodeMask(png: Uint8Array): MaskResult;
}

/** The platform fetch, used only by RemoteEngine (which checks the address is on the LAN first). */
export const lanFetch: RemoteDeps['fetch'] = (url, init) =>
  fetch(url, init as RequestInit) as never;

const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`;

export class RemoteEngine implements ImageEngine {
  readonly id = 'remote';
  readonly label = 'HD engine (laptop on this network)';
  constructor(
    private readonly cfg: RemoteConfig,
    private readonly deps: RemoteDeps,
  ) {}

  private check(): void {
    if (!this.cfg.baseUrl.trim() || !this.cfg.token.trim())
      throw new RemoteError(
        'not-configured',
        'The HD engine needs an address and a token in Settings.',
      );
    if (!isLanUrl(normalizeBaseUrl(this.cfg.baseUrl)))
      throw new RemoteError(
        'not-lan',
        'The HD engine address must be on your local network (for example 192.168.1.20 with a port).',
      );
  }

  private async request(
    path: string,
    init: { method: string; body?: Uint8Array; headers?: Record<string, string> },
    outer?: AbortSignal,
  ) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.cfg.timeoutMs);
    const onAbort = () => controller.abort();
    outer?.addEventListener('abort', onAbort);
    try {
      const res = await this.deps.fetch(join(normalizeBaseUrl(this.cfg.baseUrl), path), {
        method: init.method,
        headers: { Authorization: `Bearer ${this.cfg.token}`, ...(init.headers ?? {}) },
        body: init.body,
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403)
        throw new RemoteError('auth', 'The laptop refused the token.');
      if (res.status === 413)
        throw new RemoteError('too-large', 'The laptop says the photo is too large.');
      if (res.status === 429 || res.status === 503)
        throw new RemoteError('busy', 'The laptop is busy.');
      if (!res.ok)
        throw new RemoteError('server', `The laptop answered with an error (${res.status}).`);
      return res;
    } catch (e) {
      if (e instanceof RemoteError) throw e;
      if (outer?.aborted) throw new CutoutError('cancelled', 'Cancelled');
      if (timedOut || (e instanceof Error && e.name === 'AbortError'))
        throw new RemoteError('timeout', 'The laptop did not answer in time.');
      throw new RemoteError('unreachable', 'Could not reach the laptop on the network.');
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    }
  }

  /** GET /v1/health: used by the "Test connection" button. Resolves with the server's reported model name. */
  async ping(): Promise<string> {
    this.check();
    const res = await this.request('/v1/health', { method: 'GET' });
    try {
      const j = JSON.parse(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()))) as {
        model?: string;
      };
      return typeof j.model === 'string' ? j.model : 'unknown model';
    } catch {
      throw new RemoteError(
        'bad-response',
        'The laptop answered, but not with the expected health report.',
      );
    }
  }

  async segment(input: EngineInput, options: EngineRunOptions = {}): Promise<MaskResult> {
    const { signal, onProgress } = options;
    throwIfAborted(signal);
    this.check();
    onProgress?.(0.1, 'Sending to the laptop');
    const body = await this.deps.readBytes(input.uri);
    if (body.length > this.cfg.maxRequestBytes)
      throw new RemoteError(
        'too-large',
        'This photo is too large to send. Lower the working size in Settings.',
      );
    throwIfAborted(signal);
    const res = await this.request(
      '/v1/segment',
      {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'image/jpeg',
          'X-Image-Width': String(input.width),
          'X-Image-Height': String(input.height),
          Accept: 'image/png',
        },
      },
      signal,
    );
    onProgress?.(0.7, "Reading the laptop's answer");
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!type.startsWith('image/png'))
      throw new RemoteError('bad-response', 'The laptop did not return a PNG mask.');
    let mask: MaskResult;
    try {
      mask = this.deps.decodeMask(new Uint8Array(await res.arrayBuffer()));
    } catch {
      throw new RemoteError('bad-response', 'The mask from the laptop could not be read.');
    }
    const ratio = mask.width / mask.height / (input.width / input.height);
    if (mask.width < 8 || mask.height < 8 || Math.abs(ratio - 1) > 0.03)
      throw new RemoteError('bad-response', 'The mask from the laptop has the wrong shape.');
    onProgress?.(1, 'Done');
    return mask;
  }
}

/**
 * Tries the primary engine; on any failure (not a user cancel) quietly uses the fallback instead. `id` reports which engine
 * produced the last mask, so the result can say "laptop" or "on this phone".
 */
export class FallbackEngine implements ImageEngine {
  private last: ImageEngine;
  constructor(
    private readonly primary: ImageEngine,
    private readonly fallback: ImageEngine,
    private readonly onFallback?: (reason: unknown) => void,
  ) {
    this.last = primary;
  }
  get id(): string {
    return this.last.id;
  }
  get label(): string {
    return this.last.label;
  }
  async segment(input: EngineInput, options: EngineRunOptions = {}): Promise<MaskResult> {
    try {
      const m = await this.primary.segment(input, options);
      this.last = this.primary;
      return m;
    } catch (e) {
      if (e instanceof CutoutError && e.code === 'cancelled') throw e;
      if (options.signal?.aborted) throw e;
      this.onFallback?.(e);
      this.last = this.fallback;
      return this.fallback.segment(input, options);
    }
  }
  dispose(): Promise<void> | void {
    return Promise.all([this.primary.dispose?.(), this.fallback.dispose?.()]).then(() => undefined);
  }
}
