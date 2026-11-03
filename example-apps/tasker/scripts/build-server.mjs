import fs from 'node:fs/promises'
import { build } from 'esbuild'
import { transformWithOxc } from 'vite'
import { createInstrumenter } from 'istanbul-lib-instrument'

await build({
  entryPoints: ['src/server.ts'], bundle: true, format: 'esm', platform: 'node',
  sourcemap: true, outfile: 'dist/server.mjs',
  plugins: process.env.VITE_COVERAGE === 'true' ? [{
    name: 'runtime-coverage',
    setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
        // Match Vitest's Vite transform before instrumentation: esbuild maps
        // an else-if to the preceding closing brace, giving it different
        // statement and branch locations from the unit baseline.
        const source = await transformWithOxc(await fs.readFile(path, 'utf8'), path, { target: 'esnext' })
        const instrumenter = createInstrumenter({ esModules: true, produceSourceMap: true })
        const code = instrumenter.instrumentSync(source.code, path, source.map)
        const map = Buffer.from(JSON.stringify(instrumenter.lastSourceMap())).toString('base64')
        return { contents: `${code}\n//# sourceMappingURL=data:application/json;base64,${map}`, loader: 'js' }
      })
    },
  }] : [],
})
