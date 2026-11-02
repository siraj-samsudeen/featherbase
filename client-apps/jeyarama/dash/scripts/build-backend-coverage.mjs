import { readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { build } from 'esbuild'
import { transformWithOxc } from 'vite'
import { app, backendSources, instrumentBackend } from './backend-coverage.mjs'

const outfile = resolve(process.argv[2] || '')
const serverTests = resolve(app, '../../../apps/server/test')
if (!/^feather-dash-platform-[^/]+\/app\/dist\/server\.mjs$/.test(relative(serverTests, outfile)))
  throw new Error('Coverage builds must target a disposable platform-test runtime, never app dist')
const sources = backendSources()
const loaded = new Set()
await build({
  absWorkingDir: app, entryPoints: ['src/server.ts'], bundle: true,
  format: 'esm', platform: 'node', outfile, sourcemap: 'linked',
  plugins: [{
    name: 'dash-backend-coverage',
    setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
        if (!sources.includes(path)) throw new Error(`Unexpected coverage input: ${path}`)
        loaded.add(path)
        const source = await transformWithOxc(await readFile(path, 'utf8'), path, { target: 'esnext' })
        const result = instrumentBackend(source.code, path, source.map)
        const map = Buffer.from(JSON.stringify(result.map)).toString('base64')
        return { contents: `${result.code}\n//# sourceMappingURL=data:application/json;base64,${map}`, loader: 'js' }
      })
    },
  }],
})
if (JSON.stringify([...loaded].sort()) !== JSON.stringify(sources))
  throw new Error('Coverage build did not instrument the full Dash backend closure')
