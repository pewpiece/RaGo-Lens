/**
 * Run-length coding for mask tiles. Format: repeated (value: u8, run: LEB128 varint). A uniform 512x512 tile is
 * 4 bytes; masks are mostly flat regions with thin edges, so history entries stay tiny.
 */
export function rleEncode(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const v = bytes[i]!;
    let j = i + 1;
    while (j < n && bytes[j] === v) j++;
    let run = j - i;
    out.push(v);
    while (run >= 0x80) {
      out.push((run & 0x7f) | 0x80);
      run >>>= 7;
    }
    out.push(run);
    i = j;
  }
  return Uint8Array.from(out);
}

export function rleDecode(enc: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let p = 0;
  let o = 0;
  while (p < enc.length) {
    const v = enc[p++]!;
    let run = 0;
    let shift = 0;
    for (;;) {
      const b = enc[p++]!;
      run |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    if (o + run > length) throw new Error('rleDecode: run past the end');
    if (v !== 0) out.fill(v, o, o + run);
    o += run;
  }
  if (o !== length) throw new Error('rleDecode: length mismatch');
  return out;
}
