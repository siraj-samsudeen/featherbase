import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import istanbul from 'vite-plugin-istanbul'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(),
    // Runtime pages are served from dist, not by the platform's Vite server.
    // Opt in only for coverage runs; normal app builds remain uninstrumented.
    ...(process.env.VITE_COVERAGE === 'true' ? [istanbul({
      include: ['src/**/*'], exclude: ['src/**/*.test.ts'],
      forceBuildInstrument: true,
    })] : []),
  ],
  build: { outDir: 'dist/client', emptyOutDir: true },
})
