import { defineConfig } from 'vitest/config'

// Pure functions, no I/O: no database, no globalSetup, no fileParallelism
// restriction — this is the one suite that's free to run fully parallel.
export default defineConfig({
  test: {
    environment: 'node',
  },
})
