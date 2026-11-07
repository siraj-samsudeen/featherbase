import { defineConfig } from 'vitest/config'

// Assets is an npm app, not a pnpm workspace: these are its pure-function tests.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
