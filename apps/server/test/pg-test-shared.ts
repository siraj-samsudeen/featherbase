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
import { createPgTest, type AppLike } from 'feather-testing-postgres'

// Stale harness type: the pinned feather-testing-postgres commit declares
// AppLike.request() -> Promise<Response>, but Hono's actual request() may
// resolve synchronously (Response | Promise<Response>). Promise.resolve
// preserves behavior exactly for every caller, which always awaits it —
// this shim is removable once the harness releases a corrected AppLike.
const appLike: AppLike = { request: (input, init) => Promise.resolve(app.request(input, init)) }

export const test = createPgTest(
  {
    app: appLike,
    sql,
    setDelegate: _setSqlDelegate,
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
      const doc = await saveDoc(
        'User',
        {
          row_id: email,
          email,
          full_name: fullName ?? email.split('@')[0],
          enabled: true,
          roles: roles.map((role) => ({ role })),
        },
        'Administrator',
      )
      return String(doc.row_id)
    },
  },
  { defaultRoles: ['All'] },
)
