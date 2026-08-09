// Minimal GIF89a encoder with LZW, no dependencies.

function lzwCompress(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let dict = new Map();
  let next = end + 1;
  let codeSize = minCodeSize + 1;

  const out = [];
  let cur = 0, curBits = 0;
  const emit = (code) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { out.push(cur & 255); cur >>= 8; curBits -= 8; }
  };

  const reset = () => { dict = new Map(); next = end + 1; codeSize = minCodeSize + 1; };

  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    if (dict.has(key)) { prefix = dict.get(key); continue; }
    emit(prefix);
    dict.set(key, next);
    if (next === 4095) { emit(clear); reset(); }
    else { next++; if (next > (1 << codeSize) && codeSize < 12) codeSize++; }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (curBits > 0) out.push(cur & 255);
  return out;
}

function subBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

/**
 * @param frames  array of Uint8Array palette indices, width*height each
 * @param palette array of [r,g,b]
 * @param delayCs frame delay in hundredths of a second
 * @param transparentIndex palette index to treat as transparent, or -1
 */
export function encodeGIF(width, height, frames, palette, delayCs, transparentIndex = -1) {
  let bits = 1;
  while (1 << bits < palette.length) bits++;
  if (bits > 8) throw new Error('palette too large');
  const tableSize = 1 << bits;
  const minCodeSize = Math.max(2, bits);

  const b = [];
  const push = (...v) => b.push(...v);
  const short = (v) => push(v & 255, (v >> 8) & 255);

  push(...[...'GIF89a'].map((c) => c.charCodeAt(0)));
  short(width); short(height);
  push(0x80 | 0x70 | (bits - 1), 0, 0);
  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] ?? [0, 0, 0];
    push(c[0], c[1], c[2]);
  }

  // Loop forever.
  push(0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 0x03, 0x01, 0x00, 0x00, 0x00);

  for (const frame of frames) {
    const hasT = transparentIndex >= 0;
    push(0x21, 0xf9, 0x04, (hasT ? 2 : 1) << 2 | (hasT ? 1 : 0));
    short(delayCs);
    push(hasT ? transparentIndex : 0, 0x00);

    push(0x2c); short(0); short(0); short(width); short(height); push(0);
    push(minCodeSize);
    push(...subBlocks(lzwCompress(frame, minCodeSize)));
  }

  push(0x3b);
  return Buffer.from(b);
}
