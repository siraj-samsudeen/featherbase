import { fileURLToPath } from 'node:url'
import { relative, resolve } from 'node:path'
import { backendSources } from './scripts/backend-coverage.mjs'
// Both profiles run with the host's Vitest, not the app's independent npm copy.
import { defineConfig } from '../../../apps/server/node_modules/vitest/dist/config.js'
import type { BaseCoverageProvider } from '../../../apps/server/node_modules/vitest/dist/node.js'
import server from '../../../apps/server/vitest.config.ts'

const app = fileURLToPath(new URL('.', import.meta.url))
const platform = process.env.DASH_BACKEND_COVERAGE === '1'
const root = platform ? resolve(app, '../../../apps/server') : app
// Follow the actual server bundle's imports, not a hand-maintained subset of
// the app or the platform's unrelated server coverage denominator.
const sources = backendSources()

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
        for (const metric of ['statements', 'functions', 'lines', 'branches'] as const)
          if (summary[metric].total <= 0) throw new Error(`Dash backend ${metric} denominator is empty`)
      },
    }],
    coverage: {
      enabled: true,
      provider: 'custom',
      customProviderModule: resolve(app, 'scripts/backend-coverage-provider.mjs'),
      allowExternal: true,
      include: sources.map(file => relative(root, file)),
      // The runtime already carries original-source counters. Never instrument
      // the bundle a second time or include its generated code in the report.
      exclude: ['**/*.test.*', '**/node_modules/**'],
      reportsDirectory: resolve(app, '../../../coverage/dash-backend', platform ? 'platform' : 'unit'),
      reporter: ['text', 'json', 'json-summary'],
      reportOnFailure: true,
    },
  },
})
