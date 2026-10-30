import fs from 'node:fs/promises'
import { build, transform } from 'esbuild'
import { createInstrumenter } from 'istanbul-lib-instrument'

await build({
  entryPoints: ['src/server.ts'], bundle: true, format: 'esm', platform: 'node',
  sourcemap: true, outfile: 'dist/server.mjs',
  plugins: process.env.VITE_COVERAGE === 'true' ? [{
    name: 'runtime-coverage',
    setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
        const source = await transform(await fs.readFile(path, 'utf8'), {
          loader: 'ts', sourcefile: path, sourcemap: 'external', target: 'esnext',
        })
        const instrumenter = createInstrumenter({ esModules: true, produceSourceMap: true })
        const code = instrumenter.instrumentSync(source.code, path, JSON.parse(source.map))
        const map = Buffer.from(JSON.stringify(instrumenter.lastSourceMap())).toString('base64')
        return { contents: `${code}\n//# sourceMappingURL=data:application/json;base64,${map}`, loader: 'js' }
      })
    },
  }] : [],
})
