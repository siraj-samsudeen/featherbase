import { fileURLToPath } from 'node:url'
import { relative, resolve } from 'node:path'
import { buildSync } from 'esbuild'
// Both profiles run with the host's Vitest, not the app's independent npm copy.
import { defineConfig } from '../../../apps/server/node_modules/vitest/dist/config.js'
import type { BaseCoverageProvider } from '../../../apps/server/node_modules/vitest/dist/node.js'
import server from '../../../apps/server/vitest.config.ts'

const app = fileURLToPath(new URL('.', import.meta.url))
const platform = process.env.DASH_BACKEND_COVERAGE === '1'
const root = platform ? resolve(app, '../../../apps/server') : app
// Follow the actual server bundle's imports, not a hand-maintained subset of
// the app or the platform's unrelated server coverage denominator.
const { metafile } = buildSync({
  absWorkingDir: app, entryPoints: ['src/server.ts'], bundle: true,
  platform: 'node', write: false, metafile: true,
})
const sources = Object.keys(metafile.inputs).map(file => resolve(app, file)).sort()
if (!sources.length || !sources.includes(resolve(app, 'src/server.ts')))
  throw new Error('Dash backend source inventory must include its executable server entry')

export default defineConfig({
  root,
  test: {
    ...(platform ? server.test : { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] }),
    reporters: ['default', {
      onCoverage(coverage: unknown) {
        const map = coverage as ReturnType<BaseCoverageProvider['createCoverageMap']>
        if (JSON.stringify(map.files().sort()) !== JSON.stringify(sources))
          throw new Error('Dash backend coverage must contain exactly the original server source inventory')
        const summary = map.getCoverageSummary()
        for (const metric of ['statements', 'functions', 'lines'] as const)
          if (summary[metric].total <= 0) throw new Error(`Dash backend ${metric} denominator is empty`)
      },
    }],
    coverage: {
      enabled: true,
      provider: 'v8',
      allowExternal: true,
      include: [
        ...sources.map(file => relative(root, file)),
        ...(platform ? ['test/feather-dash-platform-*/app/dist/server.mjs'] : []),
      ],
      // The platform runner copies its runtime under test/, which V8 excludes
      // by default. Only test modules, not the copied backend, are out of scope.
      exclude: ['**/*.test.*', '**/node_modules/**'],
      reportsDirectory: resolve(app, '../../../coverage/dash-backend', platform ? 'platform' : 'unit'),
      reporter: ['text', 'json', 'json-summary'],
      reportOnFailure: true,
    },
  },
})
