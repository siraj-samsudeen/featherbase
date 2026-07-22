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
  },
  resolve: {
    // The testing library and the app must share one React instance.
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router'],
  },
})
