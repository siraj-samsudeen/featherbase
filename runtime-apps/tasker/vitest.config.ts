import { defineConfig } from 'vitest/config'

// Tasker is an npm app, not a pnpm workspace. Keep its whole production
// source denominator visible even when only the pure-function tests run.
export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',
      // Runtime artifact fingerprints include every file under the app root.
      reportsDirectory: '../../coverage/tasker/unit',
      include: ['src/**/*.{ts,tsx}', 'public/**/*.js'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportOnFailure: true,
    },
  },
})
