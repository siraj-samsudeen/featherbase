// Binding of feather-testing-postgres to THIS app: every test using this
// `test` runs inside a rolled-back Postgres transaction (Phoenix/Ecto SQL
// Sandbox style) and drives the real Hono app in-process.

import { app } from '../src/index'
import { sql, _setSqlDelegate } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { resetRateLimit } from '../src/rate-limit'
import { issueSession } from '../src/auth'
import { saveDoc } from '../src/document'
import { createPgTest } from 'feather-testing-postgres'

export const test = createPgTest(
  {
    app,
    sql,
    setDelegate: _setSqlDelegate,
    // A test may create/alter DocTypes inside its transaction; after rollback
    // the per-process meta cache would describe tables that no longer exist.
    onTeardown: () => {
      invalidateMeta()
      resetRateLimit()
    },
    mintToken: async (user) => (await issueSession(user)).token,
    insertUser: async ({ email, fullName, roles }) => {
      const doc = await saveDoc(
        'User',
        {
          name: email,
          email,
          full_name: fullName ?? email.split('@')[0],
          enabled: true,
          roles: roles.map((role) => ({ role })),
        },
        'Administrator',
      )
      return String(doc.name)
    },
  },
  { defaultRoles: ['All'] },
)

export { expect } from 'vitest'
