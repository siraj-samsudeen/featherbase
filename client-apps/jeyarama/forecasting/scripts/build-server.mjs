import { build } from 'esbuild'

await build({
  entryPoints: ['src/server.ts'], bundle: true, format: 'esm', platform: 'node',
  sourcemap: true, outfile: 'dist/server.mjs',
})
