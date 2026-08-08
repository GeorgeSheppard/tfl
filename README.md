# Platform

A tiny, extremely fast single-page app that shows the next 3 tube arrivals for whichever
station/line/direction combos you care about — built for checking on the way into the
underground before you lose signal.

- Built with Vite + vanilla TypeScript, no framework.
- `vite-plugin-singlefile` inlines all CSS and JS into a single `index.html` at build time,
  so the whole app loads in one HTTP request.
- Favourite stations are stored in `localStorage` — no login, no backend state.
- The loading state is a pixel-art S Stock train (`src/train-loader.ts`), rasterised pixel by
  pixel onto a 96×62 canvas rather than shipped as an image — `viteSingleFile` base64-inlines
  every asset, so a sprite sheet would land in the same single request. It adds 2.6KB gzipped,
  less than one PNG frame, and stays sharp at any size.
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
