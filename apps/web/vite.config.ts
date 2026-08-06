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
      '/ws': { target: `ws://localhost:${apiPort}`, ws: true },
    },
  },
})
