import { build } from 'esbuild'

await build({
  entryPoints: ['src/server/index.ts'], bundle: true, format: 'esm', platform: 'node',
  sourcemap: true, outfile: 'dist/server.mjs',
})