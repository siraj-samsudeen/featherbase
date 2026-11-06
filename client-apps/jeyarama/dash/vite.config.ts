/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  // Shop Floor's components use this app's one React, wherever the package sits.
  resolve: { dedupe: ['react', 'react-dom'] },
  build: { outDir: 'dist/client', emptyOutDir: true },
  // platform-test/ runs inside a featherbase checkout (npm run test:platform).
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], server: { deps: { inline: [/shop-floor/, /lucide-react/] } } },
})
