const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

export interface NameVars {
  /** The source photo's file name without extension. */
  name: string;
  sku: string;
  /** 1-based position in the batch. */
  index: number;
  total: number;
  preset: string;
}

const slug = (s: string): string =>
  s
    .replace(ILLEGAL, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);

/** File name (with extension) from a template such as "{sku}_{name}"; tokens: {name} {sku} {index} {preset}. */
export function formatName(template: string, v: NameVars, ext: string): string {
  const digits = String(Math.max(1, v.total)).length;
  const idx = String(v.index).padStart(digits, '0');
  const raw = template
    .replace(/\{name\}/g, v.name)
    .replace(/\{sku\}/g, v.sku)
    .replace(/\{index\}/g, idx)
    .replace(/\{preset\}/g, v.preset);
  const base = slug(raw) || `image-${idx}`;
  return `${base}.${ext.replace(/^\./, '')}`;
}

/** Makes names unique within a set: a repeat gets -2, -3, ... before the extension. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    const c = (seen.get(key) ?? 0) + 1;
    seen.set(key, c);
    if (c === 1) return n;
    const dot = n.lastIndexOf('.');
    return dot < 0 ? `${n}-${c}` : `${n.slice(0, dot)}-${c}${n.slice(dot)}`;
  });
}

/** "IMG_1234.JPG" or "file:///x/IMG_1234.jpg?x=1" -> "IMG_1234". */
export function baseNameOf(uri: string): string {
  const last = decodeURIComponent(uri.split('?')[0]!.split('#')[0]!.split('/').pop() ?? '');
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}
