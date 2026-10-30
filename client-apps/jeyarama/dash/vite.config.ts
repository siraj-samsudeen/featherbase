/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/client', emptyOutDir: true },
  // platform-test/ runs inside a featherbase checkout (npm run test:platform).
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
