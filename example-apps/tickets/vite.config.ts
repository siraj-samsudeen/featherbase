import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/client', emptyOutDir: true },
})
