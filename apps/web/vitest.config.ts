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
    // alone — the jsdom floor CI enforces; the merged report is the number
    // component tests are targeted from.
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts'],
      reporter: ['text', 'json-summary', ['json', { file: '../.nyc_output/jsdom.json' }]],
      // Without this a single failing test suppresses the report entirely
      // (v8's default), which hides the numbers exactly when they are most
      // useful for diagnosing what a broken run stopped exercising.
      reportOnFailure: true,
      // Ratchet toward 100% (#226 ruling): only raise, never lower.
      // Re-measured 2026-08-28 after #223 batch 1 moved seven e2e specs down
      // to this layer: lines/statements 33.33% then 33.35% across two runs,
      // functions 45.92% then 46.32%, rounded DOWN to the whole percent.
      // (The pre-batch floor was lines 29, functions 39.) Lines are stable to
      // a hundredth of a point; the function count is not (component tests
      // take different render branches run to run), so its threshold sits a
      // further point below the floor rather than a hundredth above it,
      // where it would flake.
      //
      // Re-measured 2026-08-28 after #197 added the column editor and the
      // post-hoc Table merge with component tests rather than e2e alone:
      // lines/statements 34.25%, functions 50.61%. The same asymmetry
      // applies — lines to the whole percent below, functions a further
      // point below that.
      //
      // Re-measured 2026-10-26 on the switch to Istanbul (ADR 0012), whose
      // counting differs from v8's: lines 73.62%, statements 72.08%,
      // functions 66.48% — the suite had long outgrown the old 34/34/49 floor.
      // Then again after the component tests the merged report called for:
      // lines 81.97%, statements 80.1%, functions 78.15%. Same rounding as above.
      // Re-measured 2026-10-26 once the merged report reached 100% of lines
      // and functions: lines 94.24%, statements 92.48%, functions 92.79%.
      thresholds: {
        lines: 94,
        statements: 92,
        functions: 91,
      },
    },
  },
  resolve: {
    // The testing library and the app must share one React instance.
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router'],
  },
})
