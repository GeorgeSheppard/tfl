/*
 * The card loading state: the District line train painted to a canvas, frame by frame.
 *
 * The frames themselves live in train-frames.ts, shared with the GIF build. This file is only the
 * DOM side of it — the canvas, and the single clock that drives every loader on the page.
 *
 * Nothing is fetched: the sprite decodes from a string at module load, so there is no image request
 * and no blank first frame. That matters here specifically, because this is the animation shown
 * *while the network is being used* — and the app inlines to a single index.html so it can arrive
 * in one request before you lose signal underground. The empty state, which is not on that critical
 * path, uses the GIF instead.
 */
import { CANVAS_H, CANVAS_W, FRAME_BUFFERS, FRAME_MS, FRAMES } from './train-frames';

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
  const inst: Instance = { ctx, image, pixels: new Uint32Array(image.data.buffer) };

  // Paint immediately, so the train is there before the first rAF — and so it is still there, held
  // still, when the reader has asked for reduced motion. Joining at the shared clock's current
  // frame keeps every loader on the page in step.
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
