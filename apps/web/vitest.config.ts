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
