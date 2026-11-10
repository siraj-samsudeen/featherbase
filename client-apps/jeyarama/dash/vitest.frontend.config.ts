import { fileURLToPath } from 'node:url'
import { relative, resolve } from 'node:path'
import { buildSync } from 'esbuild'
import { defineConfig } from '../../../apps/server/node_modules/vitest/dist/config.js'
import type { BaseCoverageProvider } from '../../../apps/server/node_modules/vitest/dist/node.js'

const app = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(app, '../../..')
const database = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined
if (!database || !['127.0.0.1', 'localhost'].includes(database.hostname)
  || database.pathname !== '/featherbase_dash_frontend_test')
  throw new Error('Dash frontend tests require the disposable local featherbase_dash_frontend_test DATABASE_URL')

// The browser entry's executable import closure, not the backend entry, and
// not a hand-picked set of easy-to-cover modules. CSS/JSON contain no JS counters.
const { metafile } = buildSync({
  absWorkingDir: app, entryPoints: ['src/main.tsx'], bundle: true,
  platform: 'browser', packages: 'external', write: false, metafile: true,
  outdir: 'inventory',
})
const sources = Object.keys(metafile.inputs)
  .filter(file => /\.[cm]?[jt]sx?$/.test(file)).map(file => resolve(app, file)).sort()
if (!sources.includes(resolve(app, 'src/main.tsx')) || !sources.includes(resolve(app, 'src/app.tsx')))
  throw new Error('Dash frontend inventory must include its browser entry and report component')

export default defineConfig({
  root: app,
  cacheDir: resolve(app, 'node_modules/.dash-frontend-cache'),
  resolve: { alias: { vitest: resolve(repo, 'apps/server/node_modules/vitest/dist/index.js') } },
  test: {
    include: ['frontend-test/**/*.test.tsx', 'src/page-format.test.ts'],
    fsModuleCachePath: resolve(app, 'node_modules/.dash-frontend-module-cache'),
    fileParallelism: false,
    testTimeout: 15000,
    env: { MOTHERDUCK_TOKEN: 'made-up-local-ui-test-token', MOTHERDUCK_EMBED_TOKEN: 'made-up-local-ui-embed-token' },
    globalSetup: [resolve(repo, 'apps/server/test/global-setup.ts')],
    server: { deps: { inline: ['feather-testing-postgres'] } },
    reporters: ['default', {
      onCoverage(coverage: unknown) {
        const map = coverage as ReturnType<BaseCoverageProvider['createCoverageMap']>
        if (JSON.stringify(map.files().sort()) !== JSON.stringify(sources))
          throw new Error('Dash frontend coverage must contain exactly its original executable browser closure')
        const summary = map.getCoverageSummary()
        for (const metric of ['statements', 'functions', 'lines'] as const)
          if (summary[metric].total <= 0) throw new Error(`Dash frontend ${metric} denominator is empty`)
      },
    }],
    coverage: {
      provider: 'v8',
      include: sources.map(file => relative(app, file)),
      reportsDirectory: resolve(repo, 'coverage/dash-frontend'),
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportOnFailure: true,
    },
  },
})
