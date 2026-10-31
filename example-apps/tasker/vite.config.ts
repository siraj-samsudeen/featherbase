import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import istanbul from 'vite-plugin-istanbul'
import { createInstrumenter } from 'istanbul-lib-instrument'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { transform } from 'esbuild'

// A coverage build compiles JSX as the component tests do (development jsxDEV
// calls, with React's development build to run them): its Istanbul maps must
// match theirs location for location, and a production jsx() call ends a
// ternary's arm at a different column. Vite reads NODE_ENV once this file has
// loaded; a normal build is untouched.
if (process.env.VITE_COVERAGE === 'true') process.env.NODE_ENV = 'development'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(),
    // Runtime pages are served from dist, not by the platform's Vite server.
    // Opt in only for coverage runs; normal app builds remain uninstrumented.
    ...(process.env.VITE_COVERAGE === 'true' ? [istanbul({
      include: ['src/**/*'], exclude: ['src/**/*.test.ts'],
      forceBuildInstrument: true,
    }), {
      name: 'tasker-help-coverage',
      async closeBundle() {
        // Vite copies public files without running transform plugins.
        const file = resolve('public/help/help.js')
        const source = await transform(await readFile(file, 'utf8'), {
          loader: 'js', sourcefile: file, sourcemap: 'external', target: 'esnext',
        })
        const code = createInstrumenter().instrumentSync(source.code, file, JSON.parse(source.map))
        await writeFile('dist/client/help/help.js', code)
      },
    }] : []),
  ],
  build: { outDir: 'dist/client', emptyOutDir: true },
})
