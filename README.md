# Platform

A tiny, extremely fast single-page app that shows the next 3 tube arrivals for whichever
station/line/direction combos you care about — built for checking on the way into the
underground before you lose signal.

- Built with Vite + vanilla TypeScript, no framework.
- `vite-plugin-singlefile` inlines all CSS and JS into a single `index.html` at build time,
  so the whole app loads in one HTTP request.
- Favourite stations are stored in `localStorage` — no login, no backend state.
- The loading state is a pixel-art S Stock train (`src/train-loader.ts`) that animates without
  moving a single pixel — see [The loading state](#the-loading-state). It adds 3.4KB gzipped and
  makes no image request at all.
- Live arrival data is proxied through `api.georgesheppard.dev` (see the `/tfl/*` endpoints
  in the `api.georgesheppard.dev` repo), which holds the TfL API key.
- The API client is generated from the backend's OpenAPI schema with
  [orval](https://orval.dev/), same as `mise` and `shelfie` — see below.

## Development

```bash
pnpm install
cp .env.example .env.local # point VITE_API_BASE_URL at your local backend if needed
pnpm dev
```

## Updating the API client

The backend schema isn't committed here — it's fetched fresh and regenerated automatically
before every `pnpm build`. To do it manually (e.g. after changing an endpoint on the backend):

```bash
pnpm fetch:schema   # curls the latest OpenAPI spec from api.georgesheppard.dev's master branch
pnpm generate:api   # regenerates src/api/generated.ts with orval
```

`src/api/generated.ts` is a single generated file covering the whole monolith's API (all
websites' endpoints, not just tfl's) — it's committed so the app builds without a network call,
but only the two `/tfl/*` functions actually get referenced from `src/api.ts`, so Vite's
tree-shaking drops the rest at build time (confirmed: adding orval added ~200 bytes to the
final bundle, not the ~30KB the full generated file would suggest).

Unlike `mise`/`shelfie` (React apps using orval's `react-query` + `axios` client), this app
uses orval's `fetch` client — no React Query, no axios, just typed wrappers around native
`fetch` via a small mutator in `src/lib/custom-fetch.ts`. There's no component tree here to
benefit from React Query's caching, so pulling it in would be dead weight.

## Build

```bash
pnpm build
```

Outputs a single self-contained `dist/index.html`.

## The loading state

`art/district-train.png` holds the train and the track as two separate drawings.
`scripts/build-train-sprite.mjs` turns them into `src/train-sprite.ts`:

```bash
node scripts/build-train-sprite.mjs
```

The source is a render *of* pixel art rather than true pixel art — its cells are ~10px and don't
land on a whole-pixel grid — so it can't be nearest-neighbour downscaled. The script walks the
artist's grid taking the median of each cell's central half (cell edges are antialiased and drag
the colour), quantises to the tones actually used, and floods the white background away. It emits
a palette plus one character per pixel, which decodes synchronously — no image request, no blank
first frame — and gzips to about half what an inlined base64 PNG would, since base64 defeats
deflate while a run-heavy index string plays straight into it.

The animation moves nothing. Every pixel stays where the artist put it and only changes brightness,
which is how arcade racers faked a rushing road: keep the vehicle still, cycle the colours of the
stripes underneath it, and the eye supplies the motion. The sleepers light in sequence toward the
viewer, the ballast and rails shimmer at a fifth of that amplitude so the ties read as the thing
streaming past. The train itself is byte-for-byte identical in every frame.

Two details carry the whole effect, and both are measured from the art rather than guessed:

- **Which way the track runs**, found by the x-shift that best aligns each row of the strip with
  the next. Reading it off the strip's ragged ends gives a badly wrong answer.
- **Which pixels belong to which sleeper**, so the ties can be lit by rank. Perspective packs them
  closer toward the far end, so lighting by a fixed wavelength beats against them and shimmers
  instead of marching.

The eight frames are precomputed at module load into one buffer each, so a repaint is a buffer
copy, and a single `requestAnimationFrame` drives every loader on the page.
