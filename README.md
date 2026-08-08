# tfl

A tiny, extremely fast single-page app that shows the next 3 tube arrivals for whichever
station/line/direction combos you care about — built for checking on the way into the
underground before you lose signal.

- Built with Vite + vanilla TypeScript, no framework.
- `vite-plugin-singlefile` inlines all CSS and JS into a single `index.html` at build time,
  so the whole app loads in one HTTP request.
- Favourite stations are stored in `localStorage` — no login, no backend state.
- Live arrival data is proxied through `api.georgesheppard.dev` (see the `/tfl/*` endpoints
  in the `api.georgesheppard.dev` repo), which holds the TfL API key.

## Development

```bash
pnpm install
cp .env.example .env.local # point VITE_API_BASE_URL at your local backend if needed
pnpm dev
```

## Build

```bash
pnpm build
```

Outputs a single self-contained `dist/index.html`.
