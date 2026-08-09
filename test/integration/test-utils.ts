import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.resolve(dirname, '../../index.html');

// Mounts the real index.html body markup into the jsdom document, so tests exercise the actual
// DOM structure main.ts binds to rather than a hand-maintained copy that can drift out of sync.
export function mountAppShell(): void {
  const html = readFileSync(indexHtmlPath, 'utf-8');
  const body = html.match(/<body>([\s\S]*)<\/body>/)?.[1];
  if (!body) throw new Error('index.html: could not find <body> content');
  document.body.innerHTML = body;
}

// Stubs global fetch, routing by substring match against the request URL — enough to
// distinguish the /tfl/stations and /tfl/arrivals endpoints main.ts calls.
export function mockFetchResponses(fixtures: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const entry = Object.entries(fixtures).find(([pattern]) => url.includes(pattern));
      if (!entry) throw new Error(`Unexpected fetch call: ${url}`);
      return { ok: true, json: async () => entry[1] } as Response;
    })
  );
}

// Lets pending microtasks (fetch/json promise chains) drain. Timers are faked in these tests, so
// advancing by 0ms is enough to flush them without any real waiting.
export async function flushAsync(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}
