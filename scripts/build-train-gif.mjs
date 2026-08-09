/*
 * Encodes src/district-train.gif from the animation's own frames.
 *
 *   pnpm build:gif
 *
 * This loads src/train-frames.ts — the very module the canvas loader paints from — so the GIF
 * cannot drift from the animation running in the app. It goes through Vite rather than Node's own
 * loader so that TypeScript and extensionless imports resolve exactly as they do in the build,
 * instead of having to bend the source to suit the script.
 *
 * The GIF is the empty state's copy of the animation. It lives in src/ rather than public/ so Vite
 * fingerprints it, which is what makes it safe for the immutable Cache-Control in public/_headers:
 * change the animation and the filename changes with it, so nobody is left holding a stale one.
 */
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { encodeGIF } from './gif.mjs';

const OUT = new URL('../src/district-train.gif', import.meta.url);

// noDiscovery because the only module wanted here is a local one with no bare imports; without it
// Vite starts scanning index.html for dependencies to pre-bundle and then noisily complains when
// close() cuts the scan short.
const server = await createServer({
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { CANVAS_H, CANVAS_W, FRAME_BUFFERS, FRAME_MS } = await server.ssrLoadModule('/src/train-frames.ts');
await server.close();

// GIF delays are in hundredths of a second, so the canvas's milliseconds have to round to one.
const delayCs = Math.round(FRAME_MS / 10);

// Index 0 is the transparent one, so the animation sits on whatever background it is dropped onto.
const palette = [[0, 0, 0]];
const keys = new Map();
const indexed = FRAME_BUFFERS.map((buf) => {
  const out = new Uint8Array(CANVAS_W * CANVAS_H);
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if ((v >>> 24) === 0) continue; // transparent, leave as index 0
    const rgb = [v & 255, (v >>> 8) & 255, (v >>> 16) & 255];
    const k = rgb.join(',');
    let idx = keys.get(k);
    if (idx === undefined) {
      idx = palette.length;
      palette.push(rgb);
      keys.set(k, idx);
    }
    out[i] = idx;
  }
  return out;
});

if (palette.length > 256) throw new Error(`palette overflow: ${palette.length}`);

const gif = encodeGIF(CANVAS_W, CANVAS_H, indexed, palette, delayCs, 0);
writeFileSync(OUT, gif);

console.log(
  `${CANVAS_W}x${CANVAS_H}  ${FRAME_BUFFERS.length} frames  ${delayCs * 10}ms each  ` +
    `palette ${palette.length}  ${(gif.length / 1024).toFixed(1)}KB`,
);
