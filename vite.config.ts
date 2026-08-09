import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/*
 * `vite-plugin-singlefile` sets `assetsInlineLimit = () => true` and `assetsDir = ''` as part of its
 * recommended config, which would base64 the empty state's GIF into the page. Its `overrideConfig`
 * option can't undo that surgically — it's a shallow `Object.assign`, so passing a `build` key
 * would drop the rest of the recommended build settings with it. Overriding from a later `post`
 * plugin changes only these two fields and leaves everything else the plugin does intact.
 *
 * The plugin only ever inlines JS and CSS itself; other assets it leaves as files, so this is all
 * that's needed to keep the GIF separate.
 */
function keepGifSeparate(): Plugin {
  return {
    name: 'keep-gif-separate',
    enforce: 'post',
    config(config) {
      config.build ??= {};
      // The GIF is 15KB — a sixth of the page if inlined — and only someone with no stations saved
      // ever sees it, so making every load carry it would be backwards. As its own fingerprinted
      // file it is fetched once and then served from cache forever (see public/_headers), and it
      // never delays the page that actually shows arrival times.
      config.build.assetsInlineLimit = (filePath) => !filePath.endsWith('.gif');
      // Back under /assets/ so one glob in _headers covers everything content-hashed.
      config.build.assetsDir = 'assets';
      // The plugin sets base to './' so inlined output can load public/ files by relative path. That
      // breaks the moment an asset *isn't* inlined: Vite writes the URL relative to the JS chunk in
      // assets/, then the chunk is inlined into index.html at the root, and the reference resolves a
      // directory too high. An absolute base is correct here anyway — the app is served from the
      // root, and index.html already references /favicon.ico absolutely.
      config.base = '/';
    },
  };
}

// Single HTML file output (CSS + JS inlined) so the page loads in one request —
// this matters underground where connectivity is brief and patchy.
export default defineConfig({
  plugins: [viteSingleFile(), keepGifSeparate()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
  },
});
