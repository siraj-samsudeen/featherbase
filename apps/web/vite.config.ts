import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { APP_ROOT_PATTERN, LEGACY_HUMAN_ROOT_PATTERN } from '../../packages/shared/src/app-routes'

// Parallel checkouts (git worktrees) each need their own ports: WEB_PORT
// moves the dev server, API_PORT points the proxy at that checkout's API.
// Defaults match ./init.sh — nothing changes for a single-checkout setup.
const apiPort = Number(process.env.API_PORT ?? 8000)
// The browser's own Host header reaches the API unchanged: the server matches
// it against INSTANCE_ADDRESSES to know which address a request came in on
// (#488). Vite's string shorthand would rewrite it to localhost:<API_PORT>.
const api = { target: `http://localhost:${apiPort}`, changeOrigin: false }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': api,
      '/featherbase/runtime-shell.css': api,
      '/featherbase/runtime-shell.js': api,
      [APP_ROOT_PATTERN]: api,
      [LEGACY_HUMAN_ROOT_PATTERN]: api,
      '/files': api,
      '/private/files': api,
      '/web': api,
      // The dev-preview sign-in link. In production one container answers
      // both the SPA and the API, so this path needs no help; in dev the
      // vite server would otherwise serve index.html for it and the redirect
      // that establishes the session would never happen.
      '/preview': api,
      '/ws': { target: `ws://localhost:${apiPort}`, ws: true },
    },
  },
})
