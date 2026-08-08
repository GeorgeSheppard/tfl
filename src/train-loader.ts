/*
 * A pixel-art District line train, rasterised pixel by pixel into a 96×62 <canvas> and scaled
 * up by the browser with nearest-neighbour filtering.
 *
 * Drawn in code rather than shipped as an image on purpose: vite-plugin-singlefile base64-inlines
 * every asset into index.html, so a sprite sheet big enough to animate would cost several KB of
 * the single request this app gets before signal drops. This generator is a few KB of source that
 * gzips smaller than one frame would, and it stays sharp at any size because frames are rasterised
 * at runtime rather than resampled.
 *
 * The subject is an S7 Stock unit as it actually looks — red cab end, unpainted aluminium body
 * sides, corporate blue lower band, red passenger doors, amber dot-matrix destination display.
 * S Stock wears the same livery on every subsurface line, so there is deliberately no District
 * green on the train itself; what makes it a District line train is what the destination display
 * says, exactly as it works on the real thing.
 */

const GRID_W = 96;
const GRID_H = 62;

// ImageData is RGBA in byte order, so a Uint32 write on a little-endian machine (every platform
// a browser runs on) lands as 0xAABBGGRR.
function packed(hex: string, alpha = 255): number {
  const n = parseInt(hex.slice(1), 16);
  return ((alpha << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255)) >>> 0;
}

const C = {
  clear: 0,

  // Cab end. TfL red is #DC241F; the mid tone is pulled down slightly so the highlight has
  // somewhere to go without clipping.
  red: packed('#d3221e'),
  redLit: packed('#ee4a3e'),
  redDark: packed('#9b1310'),
  redDeep: packed('#6d0b09'),

  // Unpainted aluminium body sides.
  silver: packed('#c8c8c2'),
  silverLit: packed('#e4e4de'),
  silverDark: packed('#9c9c96'),
  silverDeep: packed('#74746e'),

  // Corporate blue lower band (Pantone 072, shaded).
  blue: packed('#1f3e9e'),
  blueLit: packed('#3358c4'),
  blueDark: packed('#142769'),

  glass: packed('#3b4a57'),
  glassLit: packed('#5c7484'),
  glassDark: packed('#232e38'),
  glassDeep: packed('#161d24'),

  roof: packed('#b6b6b0'),
  roofDark: packed('#8b8b85'),

  frame: packed('#2b2b2b'),
  frameLit: packed('#474747'),
  frameDeep: packed('#131313'),

  matrix: packed('#0d0f0a'),

  lampCore: packed('#fff8e0'),
  lampAmber: packed('#ff8a12'),

  railHead: packed('#8d8d85'),
  rail: packed('#57574f'),
  sleeper: packed('#4b4139'),
  sleeperLit: packed('#5f5346'),
  ballast: packed('#3c3a35'),
};

// --- geometry ---------------------------------------------------------------------------------
//
// Two-point perspective. The camera sits just left of the train's centreline at roughly window
// height, so the horizon cuts through the middle of the body: the roof line falls away as it
// recedes and the underframe rises to meet it. Both faces are straight-edged quads, and because
// straight world lines project to straight screen lines, interpolating each face's top and bottom
// edge linearly across screen x is exact.

const CAB_XL = 55; // near corner, shared with the side face
const CAB_XR = 88; // far outer edge
const CAB_TOP_L = 8;
const CAB_TOP_R = 7;
const CAB_BOT_L = 47;
const CAB_BOT_R = 44;

const SIDE_XF = 0; // far end, run off the frame edge so the train reads as continuing
const SIDE_TOP_F = 20;
const SIDE_BOT_F = 31;

// Far/near scale ratio of the side face. Evenly spaced doors are *not* evenly spaced on screen,
// and this is the same 1/z factor the face edges already obey, so features placed through
// depthAt() bunch toward the far end by exactly the right amount.
const SIDE_K = 0.38;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Screen fraction across the side face (0 at the cab, 1 at the far end) -> fraction along the
// train's actual length. Inverse of s = v / (v + (1 - v) * K).
function depthAt(s: number): number {
  return (s * SIDE_K) / (1 - s + s * SIDE_K);
}

// How far a rounded corner of radius r pulls the edge in, e pixels from the silhouette's side.
function corner(e: number, r: number): number {
  if (e >= r) return 0;
  return r - Math.sqrt(r * r - (r - e) * (r - e));
}

// --- raster helpers -----------------------------------------------------------------------------

function px(buf: Uint32Array, x: number, y: number, c: number): void {
  if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
  buf[y * GRID_W + x] = c;
}

// Pulls an already-painted pixel toward a colour. Used for the headlight wash and the shadow under
// the train, both of which should land on the ballast without bleeding onto the transparent page
// background behind it — so fully transparent pixels are left alone.
function tint(buf: Uint32Array, x: number, y: number, r: number, g: number, b: number, amount: number): void {
  if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
  const i = y * GRID_W + x;
  const d = buf[i];
  if ((d >>> 24) === 0) return;
  const dr = d & 255;
  const dg = (d >>> 8) & 255;
  const db = (d >>> 16) & 255;
  const nr = (dr + (r - dr) * amount) | 0;
  const ng = (dg + (g - dg) * amount) | 0;
  const nb = (db + (b - db) * amount) | 0;
  buf[i] = ((255 << 24) | (nb << 16) | (ng << 8) | nr) >>> 0;
}

// --- the train ----------------------------------------------------------------------------------

// Colour of the aluminium body side at depth d, height fraction f down the column. Doors are
// spaced evenly along the train's real length, so they compress toward the far end on their own.
function sideColor(d: number, f: number, faded: boolean, dither: boolean): number {
  const cyc = ((d - 0.015) / 0.108) % 1;
  const onDoor = !faded && cyc > 0 && cyc < 0.42;

  if (f < 0.055) return dither && !faded ? C.roof : C.roofDark; // roof sliver, seen from below
  if (f < 0.085) return C.silverDeep; // shadow line under the roof lip
  if (f > 0.875) return f > 0.955 ? C.frameDeep : C.frame; // underframe and bogies

  // Lower band. Red doors run full height and interrupt it, as they do on the real thing.
  if (f > 0.755) {
    if (onDoor) return cyc > 0.19 && cyc < 0.23 ? C.redDark : C.red;
    if (faded) return C.blueDark;
    return f < 0.8 && dither ? C.blueLit : C.blue;
  }

  if (onDoor) {
    // Door glass, inset a little from the body glazing either side of it.
    if (f > 0.33 && f < 0.5 && cyc > 0.06 && cyc < 0.36) return C.glassDark;
    if (cyc > 0.19 && cyc < 0.23) return C.redDark; // seam between the two leaves
    return f < 0.3 ? C.redLit : C.red;
  }

  // Body glazing, two windows per bay between door sets.
  if (!faded && f > 0.31 && f < 0.52) {
    const w = (cyc - 0.42) / 0.58;
    if ((w > 0.08 && w < 0.44) || (w > 0.56 && w < 0.92)) {
      return f < 0.36 ? C.glassLit : C.glass;
    }
  }

  if (faded) return C.silverDark;
  return f < 0.14 ? C.silverLit : f > 0.66 ? C.silverDark : C.silver;
}

// Colour of the cab end at width fraction t, height fraction f. Feature extents are fractions so
// they ride the face's taper without any extra maths.
function cabColor(t: number, f: number, dither: boolean): number {
  // Underframe, with the coupler housing hanging below it.
  if (f > 0.815) {
    if (t > 0.36 && t < 0.64 && f > 0.86) return f > 0.94 ? C.frameDeep : C.frameLit;
    return f > 0.95 ? C.frameDeep : C.frame;
  }

  // Light clusters: white headlight outboard, amber marker inboard, mirrored either side.
  if (f > 0.645 && f < 0.735) {
    if (t > 0.075 && t < 0.16) return C.lampCore;
    if (t > 0.185 && t < 0.265) return C.lampAmber;
    if (t > 0.735 && t < 0.815) return C.lampAmber;
    if (t > 0.84 && t < 0.925) return C.lampCore;
    if ((t > 0.05 && t < 0.29) || (t > 0.71 && t < 0.95)) return C.redDeep; // recessed housing
  }

  // Destination display. The amber text is painted per frame, over the top of this.
  if (f > 0.055 && f < 0.205 && t > 0.3 && t < 0.9) {
    return f < 0.075 || f > 0.185 || t < 0.315 || t > 0.885 ? C.frameDeep : C.matrix;
  }

  // Windscreens either side of the centre de-training door.
  if (f > 0.235 && f < 0.525) {
    const pane = (t > 0.055 && t < 0.345) || (t > 0.675 && t < 0.945);
    const doorPane = t > 0.425 && t < 0.6;
    if (pane || doorPane) {
      // One sparse diagonal reflection across the glazing, over a top-lit / bottom-pooled base.
      if ((t * 30 + f * 22) % 13 < 1.8) return C.glassLit;
      return f > 0.46 ? C.glassDeep : f < 0.3 ? C.glass : C.glassDark;
    }
    if (t > 0.345 && t < 0.425) return C.redDark; // pillar
    if (t > 0.6 && t < 0.675) return C.redDark;
  }

  // Seams either side of the centre door, from below the display to the underframe.
  if (f > 0.21 && f < 0.81 && ((t > 0.375 && t < 0.4) || (t > 0.625 && t < 0.65))) return C.redDark;

  // Body red, lit from the near (left) corner and turning away to the right.
  if (t > 0.9) return dither ? C.redDark : C.red;
  if (t < 0.09 || f < 0.045) return C.redLit;
  return C.red;
}

// Rasterises the train once. It only ever moves as a whole, so the sprite is built a single time
// and blitted at an offset each frame.
function buildTrain(): Uint32Array {
  const buf = new Uint32Array(GRID_W * GRID_H);

  // Body sides, far end first.
  for (let x = SIDE_XF; x <= CAB_XL; x++) {
    const s = (CAB_XL - x) / (CAB_XL - SIDE_XF);
    const d = depthAt(s);
    const yt = lerp(CAB_TOP_L, SIDE_TOP_F, s);
    const yb = lerp(CAB_BOT_L, SIDE_BOT_F, s);
    const h = yb - yt;
    const y0 = Math.round(yt);
    const y1 = Math.round(yb);

    // Detail drops out past the point where doors and windows fall below a pixel wide. This has
    // to be a whole-column decision: dithering it would flick features on and off between
    // neighbouring pixels and read as noise rather than distance.
    const faded = s > 0.78;
    // Aerial perspective instead does the smoothing, as a colour-level wash toward the tunnel
    // dark. Quantised so the far end stays a handful of tones rather than a continuous ramp.
    const haze = Math.round((Math.max(0, s - 0.42) / 0.58) * 0.55 * 8) / 8;

    for (let y = y0; y <= y1; y++) {
      const f = (y - yt) / h;
      const dither = ((x + y) & 1) === 0;
      let c = sideColor(d, f, faded, dither);
      if (y === y0 || y === y1) c = C.frameDeep;
      px(buf, x, y, c);
      if (haze > 0) tint(buf, x, y, 46, 50, 58, haze);
    }
  }

  // Cab end.
  for (let x = CAB_XL; x <= CAB_XR; x++) {
    const t = (x - CAB_XL) / (CAB_XR - CAB_XL);
    // Only the outboard corners are rounded — the inboard edge is the join with the body side,
    // and rounding it would notch a step into an edge that should be continuous.
    const edge = CAB_XR - x;
    const yt = lerp(CAB_TOP_L, CAB_TOP_R, t) + corner(edge, 5);
    const yb = lerp(CAB_BOT_L, CAB_BOT_R, t) - corner(edge, 2.5);
    const h = yb - yt;
    const y0 = Math.round(yt);
    const y1 = Math.round(yb);

    for (let y = y0; y <= y1; y++) {
      const f = (y - yt) / h;
      const dither = ((x + y) & 1) === 0;
      let c = cabColor(t, f, dither);
      // Outline the silhouette so the cab reads against a light page background.
      if (y === y0 || y === y1 || x === CAB_XR) c = f > 0.8 ? C.frameDeep : C.redDeep;
      px(buf, x, y, c);
    }
  }

  // Seam where the cab end meets the body side.
  for (let y = CAB_TOP_L; y <= CAB_BOT_L; y++) px(buf, CAB_XL, y, C.redDeep);

  return buf;
}

const TRAIN = buildTrain();

// --- track --------------------------------------------------------------------------------------

const TRACK_FAR_X = 1;
const TRACK_FAR_Y = 33; // tucked just under the train's far underframe, so no daylight shows through
const TRACK_NEAR_X = 104;
const TRACK_NEAR_Y = 64;
const SLEEPER_COUNT = 14;

// Depth -> screen fraction, the same 1/z curve the train uses. Sleepers march evenly in depth and
// therefore spread apart as they arrive, which is what sells the motion.
function trackScreen(d: number): number {
  const k = 0.22;
  return d / (d + (1 - d) * k);
}

function drawTrack(buf: Uint32Array, phase: number): void {
  // Ballast bed.
  for (let x = 0; x < GRID_W; x++) {
    const s = x / GRID_W;
    const cy = lerp(TRACK_FAR_Y, TRACK_NEAR_Y, s);
    const spread = lerp(4, 17, s);
    for (let y = Math.round(cy - spread * 0.55); y <= Math.round(cy + spread * 0.75); y++) {
      px(buf, x, y, C.ballast);
    }
  }

  // Sleepers, marching toward the camera.
  for (let i = 0; i < SLEEPER_COUNT; i++) {
    const d = ((i / SLEEPER_COUNT + phase) % 1 + 1) % 1;
    const s = trackScreen(d);
    const cx = lerp(TRACK_FAR_X, TRACK_NEAR_X, s);
    const cy = lerp(TRACK_FAR_Y, TRACK_NEAR_Y, s);
    const hw = lerp(3, 17, s);
    const thick = Math.max(1, Math.round(lerp(0.6, 3.2, s)));

    for (let o = -hw; o <= hw; o++) {
      // Sleepers sit perpendicular to the rails, which projects to a tilt opposing the track's.
      const x = Math.round(cx + o);
      const y = Math.round(cy - o * 0.3);
      for (let k = 0; k < thick; k++) px(buf, x, y + k, k === 0 ? C.sleeperLit : C.sleeper);
    }
  }

  // Rails, one either side of the gauge.
  for (let x = 0; x < GRID_W; x++) {
    const s = x / GRID_W;
    const cy = lerp(TRACK_FAR_Y, TRACK_NEAR_Y, s);
    const gauge = lerp(1.7, 5.6, s);
    for (const side of [-1, 1]) {
      const y = Math.round(cy + gauge * side);
      px(buf, x, y, C.rail);
      px(buf, x, y - 1, C.railHead);
    }
  }
}

// --- frame composition ----------------------------------------------------------------------------

function renderFrame(buf: Uint32Array, t: number): void {
  buf.fill(C.clear);

  drawTrack(buf, t * 0.9);

  // Suspension bob. Stepped rather than smooth so it reads as pixels moving, not as a tween.
  const bob = Math.round(Math.sin(t * Math.PI * 2 * 3) * 0.7);

  // Contact shadow, laid on the ballast before the train goes over it.
  for (let x = SIDE_XF; x <= CAB_XR + 2; x++) {
    const s = Math.max(0, (x - SIDE_XF) / (CAB_XR - SIDE_XF));
    const base = lerp(SIDE_BOT_F, CAB_BOT_L, Math.min(1, s)) + bob;
    for (let y = Math.round(base); y < Math.round(base + lerp(2, 6, s)); y++) {
      tint(buf, x, y, 0, 0, 0, 0.55);
    }
  }

  // Train, blitted with the bob applied.
  for (let y = 0; y < GRID_H; y++) {
    const sy = y - bob;
    if (sy < 0 || sy >= GRID_H) continue;
    for (let x = 0; x < GRID_W; x++) {
      const c = TRAIN[sy * GRID_W + x];
      if (c !== 0) buf[y * GRID_W + x] = c;
    }
  }

  // Headlight wash on the ballast ahead of the cab, breathing gently.
  const glow = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 2));
  for (let x = CAB_XL - 4; x < GRID_W; x++) {
    for (let y = CAB_BOT_L + bob; y < GRID_H; y++) {
      const dx = (x - (CAB_XL + CAB_XR) / 2) / 26;
      const dy = (y - CAB_BOT_L) / 16;
      const fall = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy));
      if (fall <= 0) continue;
      tint(buf, x, y, 255, 214, 138, fall * glow * 0.5);
    }
  }

  // Marker lights pulse a touch out of phase with the headlights.
  const flare = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 2 + 1.1);
  for (let x = CAB_XL; x <= CAB_XR; x++) {
    const tt = (x - CAB_XL) / (CAB_XR - CAB_XL);
    if (!((tt > 0.185 && tt < 0.265) || (tt > 0.735 && tt < 0.815))) continue;
    const yt = lerp(CAB_TOP_L, CAB_TOP_R, tt);
    const yb = lerp(CAB_BOT_L, CAB_BOT_R, tt);
    for (let y = Math.round(yt + (yb - yt) * 0.645); y < Math.round(yt + (yb - yt) * 0.735); y++) {
      tint(buf, x, y + bob, 255, 190, 90, flare * 0.6);
    }
  }
}

// --- component ------------------------------------------------------------------------------------

export interface TrainLoaderOptions {
  /** Largest on-screen width in CSS pixels. Multiples of 96 land on exact pixel boundaries. */
  maxWidth?: number;
  /** Accessible label announced in place of the animation. */
  label?: string;
}

export interface TrainLoader {
  el: HTMLElement;
  destroy(): void;
}

interface Instance {
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  pixels: Uint32Array;
  start: number;
}

// One rAF drives every loader on the page — a card list can hold a dozen of them, and a dozen
// independent animation loops would be a dozen wakeups per frame on a phone.
const instances = new Set<Instance>();
const FRAME_MS = 1000 / 18;
let rafId = 0;
let lastFrame = 0;

function paint(inst: Instance, now: number): void {
  renderFrame(inst.pixels, ((now - inst.start) / 1000) % 1000);
  inst.ctx.putImageData(inst.image, 0, 0);
}

function tickAll(now: number): void {
  rafId = requestAnimationFrame(tickAll);
  if (now - lastFrame < FRAME_MS) return;
  lastFrame = now;
  for (const inst of instances) paint(inst, now);
}

function syncClock(): void {
  const shouldRun = instances.size > 0 && !document.hidden && !prefersReducedMotion();
  if (shouldRun && !rafId) rafId = requestAnimationFrame(tickAll);
  else if (!shouldRun && rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

document.addEventListener('visibilitychange', syncClock);

export function createTrainLoader(options: TrainLoaderOptions = {}): TrainLoader {
  const label = options.label ?? 'Loading';

  const el = document.createElement('div');
  el.className = 'train-loader';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', label);

  const canvas = document.createElement('canvas');
  canvas.width = GRID_W;
  canvas.height = GRID_H;
  canvas.style.maxWidth = `${options.maxWidth ?? GRID_W * 3}px`;
  el.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(GRID_W, GRID_H);
  const inst: Instance = {
    ctx,
    image,
    pixels: new Uint32Array(image.data.buffer),
    start: performance.now(),
  };

  // Paint one frame immediately so the train is there before the first rAF — and so it is still
  // there, held static, when the reader has asked for reduced motion.
  paint(inst, inst.start);

  instances.add(inst);
  syncClock();

  return {
    el,
    destroy() {
      instances.delete(inst);
      syncClock();
    },
  };
}
