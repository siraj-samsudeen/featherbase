// Resolve the owning app's exact provider, even when the host runs Vitest.
// Its native collector reads globalThis.__VITEST_COVERAGE__, including the
// counters emitted by the copied runtime (not a second, synthetic execution).
export { default } from '@vitest/coverage-istanbul'
