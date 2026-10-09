#!/usr/bin/env node
// Writes simple placeholder PNGs into app/assets/branding/ ONLY for files that are missing.
// Replace them with the real RaGo Lens logo files (icon.png, adaptive-icon-foreground.png, splash-icon.png).
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'assets', 'branding');
mkdirSync(dir, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
// RGBA PNG; pixel(x,y) -> [r,g,b,a]
const png = (size, pixel) => {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
const disc = (size, r, color, bg) => (x, y) => {
  const d = Math.hypot(x - size / 2, y - size / 2);
  return d <= r ? color : bg;
};
const files = {
  'icon.png': png(1024, disc(1024, 300, [255, 138, 61, 255], [14, 17, 22, 255])),
  'adaptive-icon-foreground.png': png(1024, disc(1024, 220, [255, 138, 61, 255], [0, 0, 0, 0])),
  'splash-icon.png': png(512, disc(512, 150, [255, 138, 61, 255], [0, 0, 0, 0])),
};
for (const [name, data] of Object.entries(files)) {
  const p = join(dir, name);
  if (existsSync(p)) continue;
  writeFileSync(p, data);
  console.log('wrote placeholder', p);
}
