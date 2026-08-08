/*
 * The loading state: the District line S Stock train from art/district-train.png.
 *
 * Every pixel is the artist's and stays exactly where they put it. Nothing translates, nothing is
 * redrawn — the pixels just take a different tone each frame. That is how arcade racers faked a
 * rushing road: keep the vehicle still, cycle the colours of the stripes underneath it, and the
 * eye supplies the motion.
 *
 * Three things move, in descending order of how much work they do:
 *
 *   1. The sleepers light in sequence, one crest every SLEEPERS_PER_CREST ties, stepping toward
 *      the viewer. They are lit by rank rather than by a fixed wavelength — perspective packs the
 *      ties closer toward the far end, so a single wavelength beats against them and shimmers
 *      instead of marching.
 *   2. The ballast and rails shimmer at a fifth of that amplitude, so the ties read as the thing
 *      streaming past rather than the whole image pulsing.
 *   3. The train bobs a single pixel, which is a whole-sprite offset rather than an edit to it.
 *
 * Brightness is stepped into a few discrete levels rather than ramped smoothly, which is both what
 * real palette cycling does and what keeps the tone count low enough to precompute.
 *
 * Nothing is fetched: the sprite decodes synchronously from a string, so there is no image request
 * and no blank first frame. That matters here specifically, because the app inlines to a single
 * index.html so it can arrive in one request before you lose signal underground.
 */
import {
  AXIS_X,
  AXIS_Y,
  CANVAS_H,
  CANVAS_W,
  PALETTE,
  RANKS,
  TRACK,
  TRAIN,
} from './train-sprite';

const FRAMES = 8;
const FRAME_MS = 70;
const LEVELS = 5; // discrete brightness steps in the cycle
const SLEEPERS_PER_CREST = 3;
const SHIMMER_WAVELENGTH = 16; // pixels along the track between ballast crests
const SLEEPER_AMP = 0.34;
const SHIMMER_AMP = 0.07;

// ImageData is RGBA in byte order, so a Uint32 write on a little-endian machine (every platform a
// browser runs on) lands as 0xAABBGGRR.
function packed(r: number, g: number, b: number): number {
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/*
 * Every tone any pixel can ever take, worked out once: palette entry × brightness level. At runtime
 * a pixel is a table lookup, so a frame costs one pass over the buffer with no arithmetic per pixel
 * and no garbage. Index 0 of the palette is transparent and stays transparent at every level.
 */
function buildRamp(amp: number): Uint32Array {
  const ramp = new Uint32Array((PALETTE.length + 1) * LEVELS);
  for (let level = 0; level < LEVELS; level++) {
    const k = 1 + amp * ((2 * level) / (LEVELS - 1) - 1);
    for (let i = 0; i < PALETTE.length; i++) {
      const n = parseInt(PALETTE[i].slice(1), 16);
      ramp[(i + 1) * LEVELS + level] = packed(
        clamp(((n >> 16) & 255) * k),
        clamp(((n >> 8) & 255) * k),
        clamp((n & 255) * k),
      );
    }
  }
  return ramp;
}

const SLEEPER_RAMP = buildRamp(SLEEPER_AMP);
const SHIMMER_RAMP = buildRamp(SHIMMER_AMP);
const FLAT_RAMP = buildRamp(0);

/** Brightness level 0..LEVELS-1 for a cosine phase. */
const levelOf = (phase: number) => Math.round(((Math.cos(phase * Math.PI * 2) + 1) / 2) * (LEVELS - 1));

/*
 * Precomputed frames. There are only eight, they are 92×57, and they never vary, so building them
 * once at module load costs about 40KB of memory and reduces each repaint to a buffer copy. That is
 * the difference between a loader a phone can run a dozen of and one it can't.
 */
const FRAME_BUFFERS: Uint32Array[] = [];
for (let f = 0; f < FRAMES; f++) {
  const t = f / FRAMES;
  const buf = new Uint32Array(CANVAS_W * CANVAS_H);

  for (let y = 0; y < CANVAS_H; y++) {
    for (let x = 0; x < CANVAS_W; x++) {
      const i = y * CANVAS_W + x;
      const c = TRACK[i];
      if (c === 0) continue;
      const rank = RANKS[i];
      if (rank > 0) {
        buf[i] = SLEEPER_RAMP[c * LEVELS + levelOf((rank - 1) / SLEEPERS_PER_CREST + t)];
      } else {
        const s = x * AXIS_X + y * AXIS_Y;
        buf[i] = SHIMMER_RAMP[c * LEVELS + levelOf(s / SHIMMER_WAVELENGTH - t)];
      }
    }
  }

  // Suspension bob: one pixel, held rather than eased, so it reads as pixels moving.
  const bob = Math.sin(t * Math.PI * 2 * 2) > 0.4 ? 1 : 0;
  for (let y = CANVAS_H - 1; y >= 0; y--) {
    const sy = y - bob;
    if (sy < 0) continue;
    for (let x = 0; x < CANVAS_W; x++) {
      const c = TRAIN[sy * CANVAS_W + x];
      if (c !== 0) buf[y * CANVAS_W + x] = FLAT_RAMP[c * LEVELS + (LEVELS >> 1)];
    }
  }

  FRAME_BUFFERS.push(buf);
}

// --- component ------------------------------------------------------------------------------------

export interface TrainLoaderOptions {
  /** Largest on-screen width in CSS pixels. Multiples of 92 land on exact pixel boundaries. */
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
  frame: number;
}

// One rAF drives every loader on the page — a card list can hold a dozen of them, and a dozen
// independent animation loops would be a dozen wakeups per frame on a phone.
const instances = new Set<Instance>();
let rafId = 0;
let lastAdvance = 0;
let currentFrame = 0;

function paint(inst: Instance, frame: number): void {
  inst.pixels.set(FRAME_BUFFERS[frame]);
  inst.ctx.putImageData(inst.image, 0, 0);
  inst.frame = frame;
}

function tickAll(now: number): void {
  rafId = requestAnimationFrame(tickAll);
  if (now - lastAdvance < FRAME_MS) return;
  lastAdvance = now;
  currentFrame = (currentFrame + 1) % FRAMES;
  for (const inst of instances) paint(inst, currentFrame);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function syncClock(): void {
  const shouldRun = instances.size > 0 && !document.hidden && !prefersReducedMotion();
  if (shouldRun && !rafId) rafId = requestAnimationFrame(tickAll);
  else if (!shouldRun && rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

document.addEventListener('visibilitychange', syncClock);

export function createTrainLoader(options: TrainLoaderOptions = {}): TrainLoader {
  const el = document.createElement('div');
  el.className = 'train-loader';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', options.label ?? 'Loading');

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  canvas.style.maxWidth = `${options.maxWidth ?? CANVAS_W * 3}px`;
  el.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(CANVAS_W, CANVAS_H);
  const inst: Instance = {
    ctx,
    image,
    pixels: new Uint32Array(image.data.buffer),
    frame: 0,
  };

  // Paint immediately, so the train is there before the first rAF — and so it is still there, held
  // still, when the reader has asked for reduced motion. Joining mid-cycle keeps every loader on
  // the page in step with the shared clock.
  paint(inst, currentFrame);

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
