# feather-testing-postgres

### How do you test a React component that talks to a Postgres-backed server?

| Approach | Tests backend logic | Tests component rendering | Tests the integration | Fast | Isolated |
|----------|:---:|:---:|:---:|:---:|:---:|
| Server-only (HTTP tests + manual cleanup) | ✅ | ❌ | ❌ | ✅ | ❌ |
| Component with mocks (`vi.mock`/MSW) | ❌ | ✅ | ❌ | ✅ | ✅ |
| E2E (Playwright) | ✅ | ✅ | ✅ | ❌ | ❌ |
| **This library** | **✅** | **✅** | **✅** | **✅** | **✅** |

Inspired by **Phoenix**: Ecto's SQL Sandbox runs every test inside a real
database transaction that is rolled back at the end, so tests are fast,
perfectly isolated, and exercise the production code path — no mocks, no
fixtures files, no cleanup code. This library brings that model to a
React + Hono + Postgres stack (and pairs it with the MECE component-testing
philosophy of
[feather-testing-convex](https://github.com/siraj-samsudeen/feather-testing-convex)).

## How it works

1. **SQL sandbox** — the app exports its postgres.js handle through a
   delegating proxy (`_setSqlDelegate` seam). `withSandbox` opens a real
   transaction, swaps the delegate, runs the test, and ALWAYS rolls back.
   While sandboxed, the app's own `sql.begin(...)` calls become
   `SAVEPOINT`s — the app still gets atomic "transactions" (aborted saves
   roll back to the savepoint), but nothing ever commits.
2. **In-process server** — under `NODE_ENV=test` the Hono `app` binds no
   port; requests dispatch via `app.request(path, init)`. Auth is real
   (JWT), users are real rows — created inside the sandbox.
3. **Fetch bridge (component tests)** — `installFetchBridge(app)` patches
   jsdom's `fetch` so the app's own api client (`fetch('/api/...')`) lands
   on the in-process server. `renderDesk(path)` mounts the REAL route tree
   on a memory history with a fresh QueryClient: component → fetch → Hono →
   sandboxed Postgres, end to end, in milliseconds.

## Quick start (server test)

```ts
// test/pg-test.ts — bind the library to your app once
import { app } from '../src/index'
import { sql, _setSqlDelegate } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { issueSession } from '../src/auth'
import { saveDoc } from '../src/document'
import { createPgTest } from 'feather-testing-postgres'

export const test = createPgTest({
  app,
  sql,
  setDelegate: _setSqlDelegate,
  onTeardown: () => invalidateMeta(),
  mintToken: async (user) => (await issueSession(user)).token,
  insertUser: async ({ email, roles }) => {
    const doc = await saveDoc('User', { name: email, email, enabled: true,
      roles: roles.map((role) => ({ role })) }, 'Administrator')
    return String(doc.name)
  },
})
```

```ts
// test/ticket.test.ts
import { test } from './pg-test'
import { expect } from 'vitest'

test('reporters see only their own tickets', async ({ seed, createUser }) => {
  const alice = await createUser({ roles: ['Ticket Reporter'] })
  await seed('Ticket', { title: 'Someone else’s ticket' })          // as admin
  const mine = await alice.post('/api/save_doc', {
    doctype: 'Ticket', doc: { title: 'Mine' } })

  const list = await alice.get<{ data: { name: string }[] }>('/api/resource/Ticket')
  expect(list.data.map((d) => d.name)).toEqual([mine.name])
})
// No cleanup. The transaction rolls back. The database is untouched.
```

## Quick start (component test)

```tsx
import { screen } from '@testing-library/react'
import { test, expect, renderSession } from './pg-test'   // web binding

test('create a ticket through the real UI', async ({ admin }) => {
  const { session } = await renderSession('/desk/Ticket/new', admin)
  await session
    .fillIn('Title', 'Filed from a component test')
    .selectOption('Priority', 'High')
    .clickButton('Save')
    .assertText('TICK-0006')          // real naming series, sandboxed
})
```

## Fixtures

`createPgTest(bindings, options?)` returns a Vitest `test` whose fixtures
all run inside the per-test transaction:

| Fixture | Description |
|---------|-------------|
| `db` | The sandbox transaction handle (raw SQL inside the test tx). Auto — every test is sandboxed even without touching it. |
| `api` | Anonymous in-process client (`get/post/put/delete/fetch`). |
| `admin` | Administrator-authenticated client. |
| `client` | A freshly created regular user (default roles from `options.defaultRoles`). |
| `seed(doctype, values)` | Insert a document through the REAL save lifecycle as admin. Returns the saved doc. |
| `createUser(opts)` | Create another user (email/fullName/roles); returns an authenticated client. |

Clients throw `TestApiError { status, type, fields }` on non-2xx — assert
with `rejects.toMatchObject({ status: 403 })`.

## Session DSL

`renderSession(path, client)` returns `{ session }` — a fluent, chainable
driver. Methods queue; `await` executes the chain.

Interactions: `fillIn(label, value)` (handles label-as-sibling layouts),
`selectOption`, `check/uncheck/choose`, `click`, `clickButton` (refuses
disabled buttons), `clickLink`, `submit`.
Assertions: `assertText`, `refuteText`. Scoping: `within(selector, fn)`.
Debugging: `debug()`.

Failures print the whole chain:

```
feather-testing-postgres: step 3 of 4 failed

Failed at: clickButton("Save")
Cause: Button "Save" is disabled — a user could not click it

Chain:
    [ok] fillIn("Title", "x")
    [ok] selectOption("Priority", "High")
>>> [FAILED] clickButton("Save")
    [skipped] assertText("TICK-")
```

## Limitations & notes

- **One connection per test**: all sandboxed queries serialize on the test
  transaction's connection. Parallel test FILES are separate processes with
  separate transactions — safe, but they contend on shared row locks
  (e.g. naming-series counters), so keep `fileParallelism: false` unless
  your tests avoid shared counters.
- **`SET TRANSACTION` inside a sandbox** (e.g. a read-only report txn)
  cannot change the already-started outer transaction's mode; such code
  runs, but without the read-only guard, under the sandbox.
- **Process caches**: anything cached per-process (DocType meta, rate-limit
  buckets) must be cleared in `onTeardown` or rolled-back state leaks
  between tests.
- **Commit-after side effects** (job queue rows, emails) written through
  the same `sql` seam are sandboxed too — they roll back with the test.
