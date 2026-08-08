/*
 * Turns art/district-train.png into src/train-sprite.ts.
 *
 *   node scripts/build-train-sprite.mjs
 *
 * The source art holds the train and the track as two separate drawings on a white field. It is a
 * render of pixel art rather than true pixel art — the cells are ~10px and don't land on a whole
 * pixel grid — so it can't just be nearest-neighbour downscaled. This walks the artist's grid,
 * takes the median of each cell's central half (cell edges are antialiased and would drag the
 * colour), quantises to the tones actually used, and floods the white away.
 *
 * It also finds the two things the animation needs and nothing else: the direction the track runs,
 * and which pixels belong to which sleeper. Every pixel of both drawings is otherwise the artist's,
 * untouched — the animation only ever changes their brightness.
 *
 * Output is a palette plus one character per pixel. That beats an inlined base64 PNG on the two
 * counts that matter here: it decodes synchronously, so there is no image request and no blank
 * first frame, and it gzips far smaller, because base64 defeats deflate while a run-heavy index
 * string plays straight into it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePNG } from './png.mjs';

const SRC = new URL('../art/district-train.png', import.meta.url);
const OUT = new URL('../src/train-sprite.ts', import.meta.url);

// The two drawings inside the source render, and the artist's cell size across them.
const TRAIN_BOX = { x0: 248, y0: 200, x1: 1163, y1: 666 };
const TRACK_BOX = { x0: 299, y0: 746, x1: 1375, y1: 959 };
const CELL = 10.0;

// Where each drawing sits in the finished frame. The track strip is shorter than the train, so it
// can't both run the full length of it and extend in front of the cab; the frame is cropped so both
// run off the left edge instead, which reads as the train continuing out of shot and keeps the near
// track — where the motion is easiest to read — visible ahead of the cab.
const TRAIN_AT = { x: -14, y: 2 };
const TRACK_AT = { x: -18, y: 34 };
const CANVAS_W = 92;
const CANVAS_H = 57;

// Printable ASCII with space, quotes and backslash removed, so the strings need no escaping.
const ALPHABET = "#$%&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~";

const { width, height, rgba } = decodePNG(readFileSync(SRC));
const at = (x, y) => { const i = (y * width + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2]]; };
const median = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1] ?? 255; };
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function extract(box, { colours, minSep }) {
  const W = box.x1 - box.x0 + 1, H = box.y1 - box.y0 + 1;
  const GW = Math.round(W / CELL), GH = Math.round(H / CELL);
  const cw = W / GW, ch = H / GH;

  const grid = [];
  for (let gy = 0; gy < GH; gy++) {
    const row = [];
    for (let gx = 0; gx < GW; gx++) {
      const rs = [], gs = [], bs = [];
      for (let y = Math.floor(box.y0 + (gy + 0.25) * ch); y <= Math.ceil(box.y0 + (gy + 0.75) * ch); y++)
        for (let x = Math.floor(box.x0 + (gx + 0.25) * cw); x <= Math.ceil(box.x0 + (gx + 0.75) * cw); x++) {
          if (x < 0 || x >= width || y < 0 || y >= height) continue;
          const c = at(x, y); rs.push(c[0]); gs.push(c[1]); bs.push(c[2]);
        }
      row.push([median(rs), median(gs), median(bs)]);
    }
    grid.push(row);
  }

  // Alpha by flooding the white in from the border, so enclosed whites — the headlights — survive.
  const alpha = Array.from({ length: GH }, () => new Uint8Array(GW).fill(1));
  const seen = Array.from({ length: GH }, () => new Uint8Array(GW));
  const stack = [];
  for (let x = 0; x < GW; x++) stack.push([x, 0], [x, GH - 1]);
  for (let y = 0; y < GH; y++) stack.push([0, y], [GW - 1, y]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= GW || y < 0 || y >= GH || seen[y][x]) continue;
    seen[y][x] = 1;
    const [r, g, b] = grid[y][x];
    if (!(r > 232 && g > 232 && b > 232)) continue;
    alpha[y][x] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  // Quantise. Pixel art is mostly flat, so seeding from the most frequent colours and snapping to
  // the nearest keeps the artist's actual tones, where median cut would invent averaged ones.
  const freq = new Map();
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++)
    if (alpha[y][x]) { const k = grid[y][x].join(','); freq.set(k, (freq.get(k) || 0) + 1); }
  const seeds = [];
  for (const [k] of [...freq.entries()].sort((a, b) => b[1] - a[1])) {
    const c = k.split(',').map(Number);
    if (seeds.every((p) => dist2(p, c) > minSep ** 2)) seeds.push(c);
    if (seeds.length >= colours) break;
  }
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++)
    if (alpha[y][x]) grid[y][x] = seeds.reduce((b, p) => (dist2(p, grid[y][x]) < dist2(b, grid[y][x]) ? p : b), seeds[0]);

  return { GW, GH, grid, alpha };
}

const train = extract(TRAIN_BOX, { colours: 32, minSep: 20 });
const track = extract(TRACK_BOX, { colours: 16, minSep: 16 });

// --- which way does the track run --------------------------------------------------------------
// Found by the x-shift that best aligns each row of the strip with the next. Reading it off the
// strip's ragged ends instead gives a badly wrong answer, and the whole effect hangs on this.
const AXIS = (() => {
  const shifts = [];
  for (let y = 2; y < track.GH - 2; y++) {
    let best = null;
    for (let d = 1; d <= 7; d += 0.5) {
      let se = 0, n = 0;
      for (let x = 0; x < track.GW; x++) {
        const x2 = Math.round(x + d);
        if (x2 < 0 || x2 >= track.GW || !track.alpha[y][x] || !track.alpha[y + 1][x2]) continue;
        se += dist2(track.grid[y][x], track.grid[y + 1][x2]);
        n++;
      }
      if (n < 12) continue;
      const rms = Math.sqrt(se / n);
      if (!best || rms < best.rms) best = { d, rms };
    }
    if (best) shifts.push(best.d);
  }
  shifts.sort((a, b) => a - b);
  const slope = shifts[shifts.length >> 1];
  const len = Math.hypot(slope, 1);
  return { x: slope / len, y: 1 / len };
})();

// --- which pixels are which sleeper --------------------------------------------------------------
// The ties are what carries the motion, and they have to be lit by rank rather than by a fixed
// wavelength: perspective packs them closer toward the far end, so any single wavelength beats
// against them and shimmers instead of marching.
const isSleeper = ([r, g, b]) => r > g && g > b && r - b > 18 && r > 45;
const rankOf = Array.from({ length: track.GH }, () => new Int16Array(track.GW).fill(-1));
let sleeperCount = 0;
{
  const label = Array.from({ length: track.GH }, () => new Int16Array(track.GW).fill(-1));
  const groups = [];
  for (let y = 0; y < track.GH; y++) for (let x = 0; x < track.GW; x++) {
    if (!track.alpha[y][x] || label[y][x] >= 0 || !isSleeper(track.grid[y][x])) continue;
    const id = groups.length, cells = [], stack = [[x, y]];
    label[y][x] = id;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      cells.push([cx, cy]);
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < 0 || nx >= track.GW || ny < 0 || ny >= track.GH) continue;
        if (label[ny][nx] >= 0 || !track.alpha[ny][nx] || !isSleeper(track.grid[ny][nx])) continue;
        label[ny][nx] = id;
        stack.push([nx, ny]);
      }
    }
    groups.push(cells);
  }
  const real = groups.filter((g) => g.length >= 3);
  const meanS = (g) => g.reduce((s, [px, py]) => s + px * AXIS.x + py * AXIS.y, 0) / g.length;
  real.sort((a, b) => meanS(a) - meanS(b));
  real.forEach((cells, rank) => { for (const [px, py] of cells) rankOf[py][px] = rank; });
  sleeperCount = real.length;
}

// --- compose into the frame ------------------------------------------------------------------------
const palette = [];
const key = new Map();
const trainIdx = new Uint8Array(CANVAS_W * CANVAS_H);
const trackIdx = new Uint8Array(CANVAS_W * CANVAS_H);
const rankIdx = new Uint8Array(CANVAS_W * CANVAS_H);

function place(layer, offset, target, ranks) {
  for (let y = 0; y < layer.GH; y++) for (let x = 0; x < layer.GW; x++) {
    if (!layer.alpha[y][x]) continue;
    const cx = x + offset.x, cy = y + offset.y;
    if (cx < 0 || cx >= CANVAS_W || cy < 0 || cy >= CANVAS_H) continue;
    const k = layer.grid[y][x].join(',');
    if (!key.has(k)) { palette.push(layer.grid[y][x]); key.set(k, palette.length); }
    target[cy * CANVAS_W + cx] = key.get(k);
    if (ranks) rankIdx[cy * CANVAS_W + cx] = rankOf[y][x] + 1; // 0 means "not a sleeper"
  }
}
place(track, TRACK_AT, trackIdx, true);
place(train, TRAIN_AT, trainIdx, false);

if (palette.length + 1 > ALPHABET.length) throw new Error('alphabet too small for palette');
const encode = (arr) => Array.from(arr, (v) => ALPHABET[v]).join('');
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

writeFileSync(OUT, `/*
 * Generated by scripts/build-train-sprite.mjs from art/district-train.png — do not edit by hand.
 *
 * TRAIN and TRACK are palette indices, one character per pixel, row-major over the frame. Index 0
 * is transparent. RANKS marks which sleeper each track pixel belongs to, 0 meaning "not a sleeper".
 */

export const CANVAS_W = ${CANVAS_W};
export const CANVAS_H = ${CANVAS_H};

/** Sleepers found in the track art, numbered from the far end. */
export const SLEEPER_COUNT = ${sleeperCount};

/** Unit vector pointing down the track toward the viewer. */
export const AXIS_X = ${AXIS.x.toFixed(4)};
export const AXIS_Y = ${AXIS.y.toFixed(4)};

export const PALETTE = ${JSON.stringify(palette.map(hex))};

const ALPHABET = ${JSON.stringify(ALPHABET)};
const decode = (s: string) => Uint8Array.from(s, (ch) => ALPHABET.indexOf(ch));

export const TRAIN = decode(
  ${JSON.stringify(encode(trainIdx))},
);

export const TRACK = decode(
  ${JSON.stringify(encode(trackIdx))},
);

export const RANKS = decode(
  ${JSON.stringify(encode(rankIdx))},
);
`);

console.log(`frame ${CANVAS_W}x${CANVAS_H}  palette ${palette.length}  sleepers ${sleeperCount}  axis ${AXIS.x.toFixed(3)},${AXIS.y.toFixed(3)}`);
