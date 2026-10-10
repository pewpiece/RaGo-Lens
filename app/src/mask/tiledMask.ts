/**
 * The cut-out mask: one 8-bit coverage byte per photo pixel, stored in 512x512 tiles so a 12 MP photo is
 * 12 MB of mask, edits touch (and snapshot) only the tiles they change, and display can invalidate per tile.
 * A tile that is a single value (all background / all object, the common case) is stored as just that number.
 */
export const TILE = 512;

export type TileData = Uint8Array | number;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class TiledMask {
  readonly tilesX: number;
  readonly tilesY: number;
  private readonly tiles: TileData[];
  /** Bumped whenever a tile changes; display caches compare against it. */
  private readonly versions: number[];

  constructor(
    readonly width: number,
    readonly height: number,
    fill = 0,
  ) {
    if (width < 1 || height < 1) throw new Error('TiledMask: empty size');
    this.tilesX = Math.ceil(width / TILE);
    this.tilesY = Math.ceil(height / TILE);
    this.tiles = new Array<TileData>(this.tilesX * this.tilesY).fill(fill);
    this.versions = new Array<number>(this.tiles.length).fill(0);
  }

  get tileCount(): number {
    return this.tiles.length;
  }

  tileIndex(tx: number, ty: number): number {
    return ty * this.tilesX + tx;
  }

  /** Pixel rect of tile `index` (edge tiles are smaller). */
  tileRect(index: number): Rect {
    const tx = index % this.tilesX;
    const ty = Math.floor(index / this.tilesX);
    const x = tx * TILE;
    const y = ty * TILE;
    return { x, y, w: Math.min(TILE, this.width - x), h: Math.min(TILE, this.height - y) };
  }

  version(index: number): number {
    return this.versions[index]!;
  }

  /** Uniform value of the tile, or null when it holds varied data. */
  uniformValue(index: number): number | null {
    const t = this.tiles[index]!;
    return typeof t === 'number' ? t : null;
  }

  /** A copy of the tile's bytes (row-major, tile width x tile height). */
  getTile(index: number): Uint8Array {
    const r = this.tileRect(index);
    const t = this.tiles[index]!;
    if (typeof t === 'number') return new Uint8Array(r.w * r.h).fill(t);
    return t.slice();
  }

  /** Replaces a tile; collapses it to a single number when every byte is equal. */
  setTile(index: number, data: Uint8Array): void {
    const r = this.tileRect(index);
    if (data.length !== r.w * r.h) throw new Error('setTile: wrong tile size');
    const first = data[0]!;
    let uniform = true;
    for (let i = 1; i < data.length; i++) {
      if (data[i] !== first) {
        uniform = false;
        break;
      }
    }
    this.tiles[index] = uniform ? first : data.slice();
    this.versions[index] = this.versions[index]! + 1;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const index = this.tileIndex(Math.floor(x / TILE), Math.floor(y / TILE));
    const t = this.tiles[index]!;
    if (typeof t === 'number') return t;
    const r = this.tileRect(index);
    return t[(y - r.y) * r.w + (x - r.x)]!;
  }

  /** Tile indices that intersect the rect (clamped to the mask). */
  tilesIn(rect: Rect): number[] {
    const x0 = Math.max(0, Math.floor(rect.x / TILE));
    const y0 = Math.max(0, Math.floor(rect.y / TILE));
    const x1 = Math.min(this.tilesX - 1, Math.floor((rect.x + rect.w - 1) / TILE));
    const y1 = Math.min(this.tilesY - 1, Math.floor((rect.y + rect.h - 1) / TILE));
    const out: number[] = [];
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) out.push(this.tileIndex(tx, ty));
    return out;
  }

  /** Copies a region out as a flat array (w x h). */
  readRegion(rect: Rect): Uint8Array {
    const out = new Uint8Array(rect.w * rect.h);
    for (const index of this.tilesIn(rect)) {
      const tr = this.tileRect(index);
      const t = this.tiles[index]!;
      const x0 = Math.max(rect.x, tr.x);
      const x1 = Math.min(rect.x + rect.w, tr.x + tr.w);
      const y0 = Math.max(rect.y, tr.y);
      const y1 = Math.min(rect.y + rect.h, tr.y + tr.h);
      for (let y = y0; y < y1; y++) {
        const o = (y - rect.y) * rect.w + (x0 - rect.x);
        if (typeof t === 'number') {
          if (t !== 0) out.fill(t, o, o + (x1 - x0));
        } else {
          const s = (y - tr.y) * tr.w + (x0 - tr.x);
          out.set(t.subarray(s, s + (x1 - x0)), o);
        }
      }
    }
    return out;
  }

  /** Writes a flat region (w x h) back, touching only the tiles it overlaps. */
  writeRegion(rect: Rect, data: Uint8Array): void {
    if (data.length !== rect.w * rect.h) throw new Error('writeRegion: wrong data size');
    for (const index of this.tilesIn(rect)) {
      const tr = this.tileRect(index);
      const tile = this.getTile(index);
      const x0 = Math.max(rect.x, tr.x);
      const x1 = Math.min(rect.x + rect.w, tr.x + tr.w);
      const y0 = Math.max(rect.y, tr.y);
      const y1 = Math.min(rect.y + rect.h, tr.y + tr.h);
      for (let y = y0; y < y1; y++) {
        const s = (y - rect.y) * rect.w + (x0 - rect.x);
        tile.set(data.subarray(s, s + (x1 - x0)), (y - tr.y) * tr.w + (x0 - tr.x));
      }
      this.setTile(index, tile);
    }
  }

  static fromFlat(bytes: Uint8Array, width: number, height: number): TiledMask {
    if (bytes.length !== width * height) throw new Error('fromFlat: wrong size');
    const m = new TiledMask(width, height, 0);
    for (let i = 0; i < m.tileCount; i++) {
      const r = m.tileRect(i);
      const tile = new Uint8Array(r.w * r.h);
      for (let y = 0; y < r.h; y++) {
        const s = (r.y + y) * width + r.x;
        tile.set(bytes.subarray(s, s + r.w), y * r.w);
      }
      m.setTile(i, tile);
    }
    m.versions.fill(0);
    return m;
  }

  toFlat(): Uint8Array {
    return this.readRegion({ x: 0, y: 0, w: this.width, h: this.height });
  }

  clone(): TiledMask {
    const m = new TiledMask(this.width, this.height, 0);
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i]!;
      m.tiles[i] = typeof t === 'number' ? t : t.slice();
    }
    return m;
  }

  /** Bytes held in memory (varied tiles only; uniform tiles are free). */
  memoryBytes(): number {
    let n = 0;
    for (const t of this.tiles) if (typeof t !== 'number') n += t.length;
    return n;
  }
}
