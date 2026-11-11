import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    // Component tests import the server in-process and share one Postgres
    // database. Each TEST is transaction-isolated (feather-testing-postgres
    // sandbox), but parallel FILES would contend on shared row locks (naming
    // series counters), so files run sequentially like the server suite.
    fileParallelism: false,
    testTimeout: 15000,
    // Component tests drive the server in-process against the same database,
    // so they share the same background-job queue and need the same clean
    // slate. Reuses the server suite's setup rather than duplicating it.
    // Vite resolves that file's bare imports from THIS root, not from where
    // the file lives, and pnpm's isolated layout will not hand us `postgres`
    // transitively through the `server` dependency — hence the direct
    // devDependency on `postgres` here.
    globalSetup: ['../server/test/global-setup.ts'],
    server: {
      deps: {
        // feather-testing-postgres ships raw TypeScript (`main: src/index.ts`,
        // no build step). Vitest does not transform node_modules by default,
        // so it must be inlined to be compiled like source.
        inline: ['feather-testing-postgres'],
      },
    },
    // Collected only by `pnpm test:coverage`, never by the default `pnpm test`.
    //
    // Include every source entry, even main.tsx: the browser supplies its
    // hits, while this report supplies zeroes for files neither suite loads.
    //
    // Istanbul, not v8 (ADR 0012): the Playwright run is Istanbul-instrumented
    // through vite-plugin-istanbul, and the two runs merge into one report only
    // if both speak the same format. The `json` reporter drops this run's map
    // into `.nyc_output/jsdom.json`, beside the e2e fixtures' output, where
    // `pnpm coverage:merged` picks both up. The thresholds below gate THIS run
    // alone — the jsdom floor CI enforces, and since the browser suite is down
    // to the smoke test (#1080) the number that counts.
    coverage: {
      provider: 'istanbul',
      // Moving the shared UI out of this app must not remove it from the
      // coverage denominator; these same component tests still exercise it.
      allowExternal: true,
      include: ['src/**/*.{ts,tsx}', '../../packages/shop-floor/src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', '**/*.stories.{ts,tsx}'],
      reporter: ['text', 'json-summary', ['json', { file: '../.nyc_output/jsdom.json' }]],
      // Without this a single failing test suppresses the report entirely
      // (v8's default), which hides the numbers exactly when they are most
      // useful for diagnosing what a broken run stopped exercising.
      reportOnFailure: true,
      // ADR 0017's caps, as the server's: negative thresholds cap uncovered
      // counts, not percentages; 100 means none uncovered (a cap of -0 would
      // read as a 0% floor). Tighten as coverage improves; never exclude code
      // to meet them. An additional uncovered item fails even if % rounds up.
      // CI's unit-web job merges the four component shards' blobs and applies
      // these to the merge (tools/ci-shards.mjs runs each shard at 0).
      // Stage 2 (lines, statements, functions): measured on a fresh database,
      // the whole jsdom suite; none is left uncovered. The Admin index's early
      // return when the address has already moved on (router.tsx
      // AdminIndexPage) is staged with a module mock in its own test file.
      // Branches are reported, not gated (ADR 0024): CI's merged shards count
      // a few more uncovered branches than a local run of the same commit,
      // and the count moves between CI runs. Most uncovered branches are
      // reachable and still untested; the text report still lists them.
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
      },
    },
  },
  resolve: {
    // The testing library and the app must share one React instance.
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router'],
  },
})
