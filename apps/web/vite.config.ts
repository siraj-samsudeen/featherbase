import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Parallel checkouts (git worktrees) each need their own ports: WEB_PORT
// moves the dev server, API_PORT points the proxy at that checkout's API.
// Defaults match ./init.sh — nothing changes for a single-checkout setup.
const apiPort = Number(process.env.API_PORT ?? 8000)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
      '/files': `http://localhost:${apiPort}`,
      '/private/files': `http://localhost:${apiPort}`,
      '/web': `http://localhost:${apiPort}`,
      // The dev-preview sign-in link. In production one container answers
      // both the SPA and the API, so this path needs no help; in dev the
      // vite server would otherwise serve index.html for it and the redirect
      // that establishes the session would never happen.
      '/preview': `http://localhost:${apiPort}`,
      '/ws': { target: `ws://localhost:${apiPort}`, ws: true },
    },
  },
})
