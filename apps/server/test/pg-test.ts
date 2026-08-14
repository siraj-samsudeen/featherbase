// Binding of feather-testing-postgres to THIS app: every test using this
// `test` runs inside a rolled-back Postgres transaction (Phoenix/Ecto SQL
// Sandbox style) and drives the real Hono app in-process.

import { app } from '../src/index'
import { sql, _setSqlDelegate } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { invalidateSources } from '../src/sources/registry'
import { resetRateLimit } from '../src/rate-limit'
import { issueSession } from '../src/auth'
import { saveDoc } from '../src/document'
import { createPgTest, TestApiError, type TestClient } from 'feather-testing-postgres'

export const test = createPgTest(
  {
    app,
    sql,
    setDelegate: _setSqlDelegate,
    // A test may create/alter DocTypes inside its transaction; after rollback
    // the per-process meta cache would describe tables that no longer exist.
    onTeardown: () => {
      invalidateMeta()
      // Data Source rows created in the rolled-back tx may be cached.
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

export { expect } from 'vitest'

// TestClient (feather-testing-postgres) predates PATCH — round 2 (#61) moved
// row updates from PUT to PATCH (Tables gain columns at runtime; a PUT from a
// client that read a row before a column existed would silently null it).
// Mirrors TestClient's own doJson exactly so existing `.rejects.toMatchObject
// ({ status, type })` assertions keep working unchanged against PATCH calls.
export async function patchDoc<T = Record<string, unknown>>(
  client: TestClient,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await client.fetch(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) })
  const json = (await res.json().catch(() => ({}))) as {
    error?: { type: string; message: string; fields?: Record<string, string> }
  }
  if (!res.ok)
    throw new TestApiError(
      res.status,
      json.error?.type ?? 'InternalError',
      json.error?.message ?? `request failed (${res.status})`,
      json.error?.fields,
    )
  return json as T
}
