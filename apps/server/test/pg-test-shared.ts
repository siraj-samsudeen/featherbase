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
import { withCommittedDatabase } from './committed-database'

// Whether a test's sandbox transaction is open right now. Outside one, the
// app's `sql` is the real pool and every write COMMITS — so the web binding's
// fetch bridge refuses requests that arrive then (#426).
let sandboxOpen = false
let committedOpen = false
const independent = new Set<Promise<unknown>>()
export function isTestDatabaseOpen(): boolean {
  return sandboxOpen || committedOpen
}

// Requests in this harness share ONE SQL connection, unlike production HTTP
// requests. Own their sequencing here, for both TestClient and the web bridge.
// Never use this dispatcher for independent-connection concurrency proofs.
let pending = Promise.resolve()
function inSandbox<T>(work: () => Promise<T>): Promise<T> {
  if (committedOpen) {
    const result = Promise.resolve().then(work)
    independent.add(result)
    void result.then(() => independent.delete(result), () => independent.delete(result))
    return result
  }
  if (!sandboxOpen) return Promise.reject(new Error('No test sandbox is open'))
  const result = pending.then(() => {
    if (!sandboxOpen) throw new Error('The test sandbox has closed')
    return work()
  })
  pending = result.then(() => {}, () => {})
  return result
}

export function sandboxRequest(path: string, init?: RequestInit): Promise<Response> {
  return inSandbox(async () => app.request(path, init))
}

/** Also use before direct fixture SQL while a rendered UI has requests open. */
export async function settleSandboxRequests(): Promise<void> {
  let tail: Promise<void>
  do { tail = pending; await tail } while (tail !== pending)
  while (independent.size) await Promise.allSettled([...independent])
}

export const test = createPgTest(
  {
    app: { request: sandboxRequest },
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
    mintToken: (user) => inSandbox(async () => (await issueSession(user)).token),
    insertUser: ({ email, fullName, roles }) => inSandbox(async () => {
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
    }),
  },
  { defaultRoles: ['All'] },
).extend<{ requestsSettled: void }>({
  requestsSettled: [async ({ db: _db }, use) => {
    try { await use() }
    finally { await settleSandboxRequests() }
  }, { auto: true }],
})

// Opt in only for cases whose observable contract requires overlapping HTTP
// requests. Setup and cleanup commit on the real pool, never on a delegate.
export const committedTest = test.extend({
  db: [async ({}, use) => {
    await withCommittedDatabase(async () => {
      committedOpen = true
      try { await use(sql) }
      finally {
        await settleSandboxRequests()
        committedOpen = false
      }
    })
  }, { auto: true }],
})
