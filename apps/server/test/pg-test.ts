// Binding of feather-testing-postgres to THIS app's server suite. The
// sandboxed `test` fixture itself lives in ./pg-test-shared.ts, shared with
// the web component suite (apps/web/test/pg-test.ts) — see that file for
// what it wires. The shared setup helpers (makeTable, grantRole,
// expectApiError, ...) live in ./fixtures.ts; import them from there.

export { test } from './pg-test-shared'
export { expect } from 'vitest'

// `patchDoc` is defined in ./fixtures.ts alongside the error-envelope reader
// it shares with expectApiError, and re-exported here because this is where
// the suite already imports it from.
export { patchDoc } from './fixtures'
