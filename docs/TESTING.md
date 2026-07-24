# Testing

Featherbase tests hit a **real Postgres** — no mocks, no fixture files, no
cleanup code. The trick that makes this fast and safe is the SQL Sandbox
model, borrowed from Phoenix/Ecto and packaged as
[feather-testing-postgres](https://github.com/siraj-samsudeen/feather-testing-postgres)
(consumed as a published npm dependency; it lives in its own repo — fix it
there, never vendor it here).

## The sandbox model

Every test body runs inside one Postgres transaction that is **rolled back**
when the test ends. Whatever the test creates — DocTypes, tables, documents,
users — vanishes at rollback, so tests need no teardown and can't pollute
each other. Crucially, the test drives the *real* Hono app in-process, so
the full production path (routes → auth → permissions → lifecycle → SQL)
gets exercised.

The binding of the harness to this app is
`apps/server/test/pg-test.ts`. It hands `createPgTest` the app, the `sql`
client, and a delegate hook (`_setSqlDelegate` in `apps/server/src/db.ts`)
that routes the app's queries through the test's transaction. It also wires:

- `mintToken` / `insertUser` — fixtures like `admin` come pre-authenticated.
- `onTeardown` — invalidates the per-process metadata cache and resets the
  rate limiter, because a test may have created DocTypes whose tables no
  longer exist after rollback.

## Writing a test

A minimal real example, adapted from `apps/server/test/naming.test.ts`:

```ts
import { describe, expect } from 'vitest'
import { test } from './pg-test'   // NOT vitest's test — the sandboxed one

describe('naming', () => {
  test('series names are sequential', async ({ admin }) => {
    await admin.post('/api/doctype', {
      name: 'Nm Invoice',
      autoname: 'NMINV-.####',
      fields: [{ fieldname: 'title', fieldtype: 'Data' }],
    })
    const doc = await admin.post<{ name: string }>('/api/save_doc', {
      doctype: 'Nm Invoice',
      doc: { title: 'first' },
    })
    expect(doc.name).toBe('NMINV-0001')
  })
})
```

Import `test` from `./pg-test` and `expect` from vitest (pg-test re-exports
it too). The `admin` fixture is a `TestClient` logged in as Administrator;
call the HTTP API through it and assert on the JSON. You can also import
`sql` from `../src/db` and query the database directly mid-test — you'll see
the test's own uncommitted state, which is exactly what you want.

Asserting `NMINV-0001` works every run because the series counter row is
created inside the transaction and rolled back with it. But remember the
sandbox *sees committed state*: a name that collides with seeded data (a
DocType that a migration created, say) will 409 — pick names that don't
exist in the real schema.

## Running tests

```bash
pnpm test                                        # everything (all workspaces)
pnpm --filter server test                        # server suite
pnpm --filter server test test/naming.test.ts    # one file
pnpm --filter web test                           # web component suite
pnpm --filter web e2e                            # Playwright e2e (stack must be running)
pnpm smoke                                       # server + web smoke tests
pnpm --filter server typecheck
```

`pnpm --filter server test` is `vitest run`, so anything after it is a
vitest filter — a path runs that file.

## Why `fileParallelism: false`

Both `apps/server/vitest.config.ts` and `apps/web/vitest.config.ts` set
`fileParallelism: false`, and `apps/web/playwright.config.ts` sets
`workers: 1`, all for the same reason: every test file shares **one**
database. Tests within a file are transaction-isolated, but parallel *files*
contend on cross-cutting state — the single `tab_background_job` queue
(`drainJobs()` drains every queued job, so parallel files steal each other's
jobs) and naming-series row locks. Do not turn parallelism back on; the
flake it causes looks like unrelated bugs.

## The stale-job-queue story

`tab_background_job` is the one piece of state that outlives a run. A run
killed partway through (Ctrl-C, crash) leaves committed `queued` rows
behind; the next run's `drainJobs()` then returns a higher count than a test
expected, and the failure (`expected 2 to be 1`) reads like a real bug in
job code. The fix is `apps/server/test/global-setup.ts`: a Vitest
`globalSetup` that runs in the main process, **outside** any sandbox
transaction, and deletes everything in `tab_background_job` once per run.
Both suites use it (the web config points at
`../server/test/global-setup.ts`), so every run starts from a known-empty
queue. It complements `fileParallelism: false` rather than replacing it.

## The three layers

**1. Server integration** — `apps/server/test/*.test.ts`. Sandboxed HTTP
against the in-process Hono app, as above. This is where almost everything
belongs: lifecycle behavior, permissions, naming, validation, API shapes.
Reach for it first.

**2. Web component** — `apps/web/test/*.test.tsx`. jsdom +
`@testing-library/react`, but *not* mocked: the components' API calls hit
the same in-process server against the same sandboxed database (which is why
the web vitest config inlines `feather-testing-postgres` and reuses the
server's global setup). `apps/web/test/setup.ts` stubs `WebSocket` so the
Desk's realtime client doesn't try to open real connections under jsdom. Use
this layer when the behavior under test is React-side: rendering from
metadata, form interaction logic, query invalidation.

**3. Playwright e2e** — `apps/web/e2e/*.spec.ts`, run with
`pnpm --filter web e2e` against the live stack (`baseURL`
`http://localhost:5173`, so run `./init.sh` first; `pnpm smoke` runs just
`e2e/smoke.spec.ts`). These are **not** sandboxed — they commit real data
through a real browser. Use this layer only for things the other two can't
see: routing, focus/keyboard behavior, realtime updates, visual flows.

One deliberate exception in the server suite:
`apps/server/test/rls.test.ts` is *not* sandbox-isolated either. It verifies
native Postgres row-level security through a second connection under the
`desk_client` role — and that connection could never see an uncommitted
sandbox transaction, so the test commits for real and cleans up after
itself. It connects to
`postgres://desk_client:desk_client@127.0.0.1:5432/featherbase` by default;
override with `RLS_TEST_URL` (the role is created by
`apps/server/migrations/0010_rls.sql`).

## Ground rules

- Never mock the database or the API — if a test can't run against the
  sandbox, reshape the test.
- Don't add cleanup code to sandboxed tests; rollback is the cleanup.
- If a run dies and the next one fails with a job-count mismatch, that's the
  stale-queue symptom above — just rerun; the global setup clears it.
