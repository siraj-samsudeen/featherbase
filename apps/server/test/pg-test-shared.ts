// Shared feather-testing-postgres binding, consumed by BOTH the server
// integration suite (./pg-test.ts) and the web component suite
// (../../web/test/pg-test.ts). Every test using the `test` fixture exported
// here runs inside a rolled-back Postgres transaction (Phoenix/Ecto SQL
// Sandbox style) and drives the real Hono app in-process.
//
// This is the one place token minting, user insertion, default roles, and
// the teardown invalidation set are defined — the two bindings used to
// copy-paste this verbatim, and the copies drifted (the web binding was
// missing invalidateSources(), so a web test that created a Data Source left
// a stale cache for the next test; see #218). apps/web/vitest.config.ts
// already reaches into `../server/test/` for globalSetup, so importing this
// module from the web binding via the `server` workspace package follows an
// established pattern rather than a new one.
import { app } from '../src/index'
import { sql, _setSqlDelegate } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { invalidateSources } from '../src/sources/registry'
import { resetRateLimit } from '../src/rate-limit'
import { issueSession } from '../src/auth'
import { saveDoc } from '../src/document'
import { createPgTest } from 'feather-testing-postgres'

// Whether a test's sandbox transaction is open right now. Outside one, the
// app's `sql` is the real pool and every write COMMITS — so the web binding's
// fetch bridge refuses requests that arrive then (#426).
let sandboxOpen = false
export function isSandboxOpen(): boolean {
  return sandboxOpen
}

export const test = createPgTest(
  {
    app,
    sql,
    setDelegate: (tx) => {
      sandboxOpen = tx !== null
      _setSqlDelegate(tx as Parameters<typeof _setSqlDelegate>[0])
    },
    // A test may create/alter Tables inside its transaction; after rollback
    // the per-process meta cache would describe tables that no longer exist,
    // and a Data Source row created in the rolled-back tx may still be
    // cached by the sources registry.
    onTeardown: () => {
      invalidateMeta()
      invalidateSources()
      resetRateLimit()
    },
    mintToken: async (user) => (await issueSession(user)).token,
    insertUser: async ({ email, fullName, roles }) => {
      // person-rename: a person's id is minted (`psn_…`); the address is
      // contact data. Tests use the returned id (`client.user`).
      const doc = await saveDoc(
        'Person',
        {
          email,
          full_name: fullName ?? email.split('@')[0],
          enabled: true,
          roles: roles.map((role) => ({ role })),
        },
        'Administrator',
        'insert',
      )
      return String(doc.row_id)
    },
  },
  { defaultRoles: ['All'] },
)
