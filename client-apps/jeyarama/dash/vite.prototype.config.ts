// #1225: serves prototype/ — the Report access page with src/api.ts swapped for made-up data.
// Build: npx vite build --config vite.prototype.config.ts && PROTOTYPE_PAGE=reader npx vite build --config
// vite.prototype.config.ts, then open prototype-dist/prototype/index.html
// (any static server, or the file itself). Dev: npx vite --config vite.prototype.config.ts, /prototype/.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// One page per build (a classic script can't be split): PROTOTYPE_PAGE=reader builds reader.html.
const page = process.env.PROTOTYPE_PAGE ?? 'index'
const madeUp = fileURLToPath(new URL('./prototype/made-up-api.ts', import.meta.url))
export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'made-up-api', enforce: 'pre',
    resolveId(source, importer) { return source === './api' && importer?.includes('/src/') ? madeUp : null },
    transformIndexHtml: { order: 'post', handler: html => html.replace(/<script type="module" crossorigin/g, '<script defer') },
  }],
  base: './',
  resolve: { dedupe: ['react', 'react-dom'] },
  build: { outDir: 'prototype-dist', emptyOutDir: page === 'index', modulePreload: false,
    // One classic script, so the built page opens straight from the file, with no server.
    rollupOptions: { input: fileURLToPath(new URL(`./prototype/${page}.html`, import.meta.url)), output: { format: 'iife', inlineDynamicImports: true } } },
  server: { port: 5225, strictPort: true },
})
