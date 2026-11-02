import { fileURLToPath } from 'node:url'
import { resolve, relative } from 'node:path'
import { buildSync } from 'esbuild'
import { createInstrumenter } from '@vitest/istanbul-lib-instrument'

export const app = fileURLToPath(new URL('../', import.meta.url))
// Derive the denominator from the real entry point, including unused imports.
export function backendSources() {
  const { metafile } = buildSync({
    absWorkingDir: app, entryPoints: ['src/server.ts'], bundle: true,
    platform: 'node', write: false, metafile: true,
  })
  const sources = Object.keys(metafile.inputs).map(file => resolve(app, file)).sort()
  if (!sources.length || !sources.includes(resolve(app, 'src/server.ts')))
    throw new Error('Dash backend source inventory must include its executable server entry')
  for (const file of sources)
    if (!relative(app, file).startsWith('src/') || !file.endsWith('.ts'))
      throw new Error(`Unexpected Dash backend input: ${file}`)
  return sources
}

export function instrumentBackend(code, filename, map) {
  // Exactly the Vitest 5 Istanbul provider's instrumenter and options. Do not
  // instrument the final bundle: esbuild has already changed its control flow.
  const instrumenter = createInstrumenter({
    produceSourceMap: true, autoWrap: false, esModules: true, compact: false,
    coverageVariable: '__VITEST_COVERAGE__', coverageGlobalScope: 'globalThis',
    coverageGlobalScopeFunc: false, ignoreLines: true,
  })
  return {
    code: instrumenter.instrumentSync(code, filename, map),
    map: instrumenter.lastSourceMap(),
  }
}
