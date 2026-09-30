import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * The screenshot harness writes PNGs into `shots/` while the page it is
 * driving is still open. Vite's default watcher treats those writes as source
 * changes and full-reloads the page mid-run, which destroys the game handle
 * and makes a healthy build look broken. Nothing outside `src/`, `public/` and
 * `index.html` can affect the bundle, so the review artefacts are ignored.
 *
 * `ignored` replaces chokidar's defaults rather than extending them, so the
 * usual suspects have to be repeated here or the watcher walks node_modules.
 */
export default defineConfig({
  /** 分层别名。跨层一律走别名，不写 ../.. ——分层门会查这条。 */
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./engine', import.meta.url)),
      '@builder': fileURLToPath(new URL('./builder', import.meta.url)),
      '@knowledge': fileURLToPath(new URL('./knowledge', import.meta.url)),
      '@project': fileURLToPath(new URL('./projects/daguanyuan', import.meta.url)),
    },
  },
  /** 部署到 games.findu.life/daguanyuan/ 时 `BASE=/daguanyuan/ npm run build`。 */
  base: process.env.BASE ?? '/',
  /**
   * The part turntable at `/viewer.html` and the garden at `/garden.html` are
   * extra entry points (the front door at `/` stays pure static). Vite only
   * builds `index.html` unless the others are named.
   */
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        garden: fileURLToPath(new URL('./garden.html', import.meta.url)),
        viewer: fileURLToPath(new URL('./viewer.html', import.meta.url)),
        fashi: fileURLToPath(new URL('./fashi.html', import.meta.url)),
      },
    },
  },
  server: {
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/shots/**',
      ],
    },
  },
});
