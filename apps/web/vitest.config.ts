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
    // Scope is the app's own `src/`, test files excluded. `main.tsx` is the
    // Vite entry point — it mounts the router into a real DOM document and is
    // exercised by the browser, never by jsdom — so it is out of scope here.
    //
    // The e2e suite is excluded by design: Playwright drives a live stack in a
    // separate browser process, so the screens it covers cannot be credited
    // here. That is why this number is the lowest of the three packages — much
    // of `pages/` is currently only reached through e2e.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx'],
      reporter: ['text', 'json-summary'],
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
      thresholds: {
        lines: 33,
        statements: 33,
        functions: 45,
      },
    },
  },
  resolve: {
    // The testing library and the app must share one React instance.
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router'],
  },
})
