/*
 * The frames of the loading animation, as packed RGBA buffers. No DOM in here on purpose: this is
 * imported both by train-loader.ts, which paints it to a canvas, and by scripts/build-train-gif.mjs
 * under Node, which encodes the very same buffers into the GIF used for the empty state. Sharing
 * the module is what stops the two from drifting apart.
 *
 * Nothing in the animation moves. Every pixel stays exactly where the artist put it and only
 * changes brightness, which is how arcade racers faked a rushing road: keep the vehicle still,
 * cycle the colours of the stripes underneath it, and the eye supplies the motion.
 *
 * Only the track changes. The train is byte-for-byte identical in all eight frames:
 *
 *   1. The sleepers light in sequence, one crest every SLEEPERS_PER_CREST ties, stepping toward
 *      the viewer. They are lit by rank rather than by a fixed wavelength — perspective packs the
 *      ties closer toward the far end, so a single wavelength beats against them and shimmers
 *      instead of marching.
 *   2. The ballast and rails shimmer at a fifth of that amplitude, so the ties read as the thing
 *      streaming past rather than the whole image pulsing.
 *
 * Brightness is stepped into a few discrete levels rather than ramped smoothly, which is both what
 * real palette cycling does and what keeps the tone count low enough to precompute.
 */
import { AXIS_X, AXIS_Y, CANVAS_H, CANVAS_W, PALETTE, RANKS, TRACK, TRAIN } from './train-sprite';

export const FRAMES = 8;
export const FRAME_MS = 70;
export { CANVAS_W, CANVAS_H };

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
 * Every tone any pixel can ever take, worked out once: palette entry × brightness level. A pixel is
 * then a table lookup, so building a frame is one pass with no arithmetic per pixel and no garbage.
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
 * once at module load costs about 170KB of memory and reduces each repaint to a buffer copy. That
 * is the difference between a loader a phone can run a dozen of and one it can't.
 */
export const FRAME_BUFFERS: Uint32Array[] = [];
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

  // The train is identical in every frame — it never moves and never changes tone.
  for (let i = 0; i < TRAIN.length; i++) {
    const c = TRAIN[i];
    if (c !== 0) buf[i] = FLAT_RAMP[c * LEVELS + (LEVELS >> 1)];
  }

  FRAME_BUFFERS.push(buf);
}
