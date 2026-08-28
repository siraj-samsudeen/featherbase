# Testing

## Where does a new test go?

- **Server integration** — sandboxed HTTP against the in-process app. Almost
  everything belongs here; reach for it first.
- **Web component** — jsdom + the *real* in-process server, never a mock
  layer. Reach here only when the behavior is React-side.
- **E2E** — only for what a browser alone can witness: routing,
  focus/keyboard behavior, realtime updates, file drop.

See [The three layers](#the-three-layers) below for the full picture.

Featherbase tests hit a **real Postgres** — no mocks, no fixture files, no
cleanup code. The trick that makes this fast and safe is the SQL Sandbox
model, borrowed from Phoenix/Ecto and packaged as
[feather-testing-postgres](https://github.com/siraj-samsudeen/feather-testing-postgres)
(consumed as a published npm dependency; it lives in its own repo — fix it
there, never vendor it here).

## The sandbox model

Every test body runs inside one Postgres transaction that is **rolled back**
when the test ends. Whatever the test creates — Tables, tables, rows,
users — vanishes at rollback, so tests need no teardown and can't pollute
each other. Crucially, the test drives the *real* Hono app in-process, so
the full production path (routes → auth → permissions → lifecycle → SQL)
gets exercised.

The binding of the harness to this app is
`apps/server/test/pg-test-shared.ts` — the one place that calls
`createPgTest`, wiring the app, the `sql` client, and a delegate hook
(`_setSqlDelegate` in `apps/server/src/db.ts`) that routes the app's queries
through the test's transaction. It also wires:

- `mintToken` / `insertUser` — fixtures like `admin` come pre-authenticated.
- `onTeardown` — invalidates the per-process metadata cache and Data Source
  registry, and resets the rate limiter, because a test may have created
  Tables (or Data Sources) whose physical backing no longer exists after
  rollback.

`apps/server/test/pg-test.ts` re-exports that `test` fixture — plus `expect`
and `patchDoc`, the PATCH-aware error-envelope helper from `./fixtures.ts` —
so the server suite has one place to import from.
`apps/web/test/pg-test.ts` imports the same fixture from `pg-test-shared`
directly, across the workspace boundary via the `server` package, rather
than copy-pasting it: the two bindings used to be copies and drifted (the
web one was missing `invalidateSources()`, leaking a stale Data Source
cache into the next test — #218).

## Writing a test

A minimal real example, adapted from `apps/server/test/naming.test.ts`:

```ts
import { describe, expect } from 'vitest'
import { test } from './pg-test'   // NOT vitest's test — the sandboxed one

describe('naming', () => {
  test('series names are sequential', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: 'Nm Invoice',
      id_pattern: 'NMINV-.####',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    const doc = await admin.post<{ name: string }>('/api/save_row', {
      table: 'Nm Invoice',
      row: { title: 'first' },
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
Table that a migration created, say) will 409 — pick names that don't
exist in the real schema.

Most setup doesn't need to be hand-rolled per file — `apps/server/test/fixtures.ts`
is the standard toolkit. `makeTable(admin, def)` creates a Table, expanding
the column shorthand (`'qty:Int'`), and hands back its URL handles (list,
meta, row, def). `grantRole(admin, { role, table, ...perms })` makes the
Role → Permission dance idempotent (the Role is only created if missing, so
widening an existing Role with a further Permission row just works).
`createUserWithRole` layers a fixture user on top of a grant. `expectApiError
(call, { status, ... })` asserts a failed request's error envelope whether
the call threw (a `TestClient` method) or resolved to a non-ok `Response` (a
raw `client.fetch`) — the one place ~170 `.rejects.toMatchObject({ status,
type })`-shaped assertions agree on the shape. Reach for these before
writing a new per-file `setup()`; 22 files had their own before this module
existed (#220), and the shapes had drifted apart.

## Running tests

```bash
pnpm test                                        # everything (all workspaces)
pnpm --filter server test                        # server suite
pnpm --filter server test test/naming.test.ts    # one file
pnpm --filter web test                           # web component suite
pnpm --filter web e2e                            # Playwright e2e (spins up its own isolated stack)
pnpm smoke                                       # server + web smoke tests (web half needs ./init.sh running)
pnpm --filter server typecheck
pnpm --filter web typecheck
```

`pnpm --filter server test` is `vitest run`, so anything after it is a
vitest filter — a path runs that file.

`typecheck` runs `tsc` twice: once against `tsconfig.json` (`src` only), once
against `tsconfig.test.json`, which extends it and widens `include` to the
test directories (`test`, and for web also `e2e`, plus the Vite/Playwright
configs). A type error in a test file fails typecheck exactly like one in
`src`.

## Why `fileParallelism: false`

Both `apps/server/vitest.config.ts` and `apps/web/vitest.config.ts` set
`fileParallelism: false`, and `apps/web/playwright.config.ts` sets
`workers: 1`, all for the same reason: every test file shares **one**
database. Tests within a file are transaction-isolated, but parallel *files*
contend on cross-cutting state — the single `background_job` queue
(`drainJobs()` drains every queued job, so parallel files steal each other's
jobs) and id-pattern row locks. Do not turn parallelism back on; the
flake it causes looks like unrelated bugs.

## The stale-job-queue story

`background_job` is the one piece of state that outlives a run. A run
killed partway through (Ctrl-C, crash) leaves committed `queued` rows
behind; the next run's `drainJobs()` then returns a higher count than a test
expected, and the failure (`expected 2 to be 1`) reads like a real bug in
job code. The fix is `apps/server/test/global-setup.ts`: a Vitest
`globalSetup` that runs in the main process, **outside** any sandbox
transaction, and deletes everything in `background_job` once per run.
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
Admin UI's realtime client doesn't try to open real connections under jsdom. Use
this layer when the behavior under test is React-side: rendering from
metadata, form interaction logic, query invalidation.

**3. Playwright e2e** — `apps/web/e2e/*.spec.ts`. These are **not**
sandboxed — they commit real data through a real browser. Use this layer
only for things the other two can't see: routing, focus/keyboard behavior,
realtime updates, visual flows.

The dividing line between layers 2 and 3 is not "is it UI" — it is *what
the browser adds*. A rendered stylesheet, real layout and box model, image
decoding, genuine focus and key handling, the URL bar, two sessions at once:
those need layer 3. Rendering from metadata, form logic, query invalidation,
what got sent to the server and what didn't: those are layer 2, where the
sandbox rolls the data back and the whole test runs in milliseconds. #223 is
the standing effort to move the misfiled ones down.

**A component test must not leave a request in flight when it ends.** The
Admin fires several writes as `void api.post(...)` — the theme toggle,
`setLanguage`, ListView's settings PUT. A test that returns while one is
outstanding lets it execute *after* its sandbox transaction closed, which
commits it for real: the next test then starts against a dark, French, or
pre-sorted Admin, and the failure surfaces somewhere else entirely. End such
a test by waiting for the round trip — poll the server until it reports the
new value — so the write lands inside the transaction that rollback undoes.
`apps/web/test/theme.test.tsx` and `list-settings.test.tsx` both carry the
helper and the reasoning.

Which `test` a spec imports from `e2e/fixtures.ts` *is* its auth story.
Plain `test` is already signed in as Administrator, from a `storageState`
captured once per worker by driving the real login form — no `/login` round
trip per spec — and is the right import for the majority of specs, whose
subject is something *behind* the login. `anonymousTest` starts signed out,
for specs whose subject is the login surface itself, an identity other than
Administrator, or a page that must be reached with no session at all.
`journeyTest` is the `feather-testing-core` DSL entry point; those specs
walk the sign-in as a step of the journey they narrate, so they deliberately
don't reuse the stored session. Shared UI fixture builders (`ensureTable`,
the FormView Table trio, `fillRows`) live in `e2e/fixtures-ui.ts` — every
spec still creates its own fixtures idempotently in its own `beforeAll`;
what's shared is the *definition*, so the Table shapes can't drift apart
across specs (#215/#216).

`pnpm --filter web e2e` sets `E2E_ISOLATED=1`: Playwright brings up its own
database and its own API/web ports (default 8020/5193, overridable),
resetting the database first and tearing the stack down after — so a spec's
real commits land in a disposable database, not whatever's running for
development. `pnpm smoke` (just `e2e/smoke.spec.ts`) does not set that flag;
it drives whatever stack is already up at `http://localhost:5173`, which is
why `./init.sh` runs it as its own boot check — run `./init.sh` first to use
`pnpm smoke` standalone.

A spec waiting on a realtime update waits for the server's acknowledgment,
not a timer: `waitForRealtime(page, channel)` polls
`<html data-realtime-channels>` until the channel appears there, because the
realtime client only mirrors a subscription onto that attribute once the
server has authorized and recorded it (#224) — a subscribe frame is
asynchronous, so an event published before that moment is simply missed.

**`packages/shared`** has its own Vitest project
(`packages/shared/vitest.config.ts`) alongside these three, for pure,
I/O-free functions — no database, no `globalSetup`, no `fileParallelism`
restriction. It's the one suite free to run fully parallel, and stays that
way only as long as it stays free of database access.

One deliberate exception in the server suite:
`apps/server/test/rls.test.ts` is *not* sandbox-isolated either. It verifies
native Postgres row-level security through a second connection under the
`app_client` role — and that connection could never see an uncommitted
sandbox transaction, so the test commits for real and cleans up after
itself. It connects to
`postgres://app_client:app_client@127.0.0.1:5432/featherbase` by default;
override with `RLS_TEST_URL` (the role is created by
`apps/server/migrations/0010_rls.sql`).

## House conventions (ratified 2026-08-28, #226)

**Naming.** Spec-sentence style is the standard: a name may encode the
example table directly, the way `import/upsert.test.ts` does —
`'UPS-R2 examples: one match updates · none inserts · empty fails ·
file-dup fails both · multi-match fails with count'` — with a spec-tier
file prefixing the rule ID it verifies. Plain behavior tests outside the
spec tier stay verb-first with no "should" (`'series names are
sequential'`), as before. This supersedes the <8-word cap in
`docs/research/feather-testing-study.md`: that number was inherited
verbatim from `feather-testing-convex`'s philosophy doc and never fit a
suite whose spec-tier names carry a rule ID and a collapsed example table.

**Assertion precision.** `toBeTruthy()` / `toBeDefined()` stay banned —
assert the actual shape: `toMatch` against an id pattern, `toEqual` against
a structure, `toMatchObject` against an error envelope (`expectApiError` in
`fixtures.ts` exists so call sites don't hand-roll that last one). This is
the standard now, not an aspiration to grow into — a sweep of the
remaining pre-ruling instances is in flight, and each one is a defect
against this rule, not a style call to revisit.

**Every non-sandboxed test file says why, in a header comment.** This
codifies a practice the suite already follows consistently, not a new one.
`apps/server/test/rls.test.ts` is the exemplar: its header states, in the
first lines, that it verifies native Postgres RLS through a second
connection that can never see the sandbox's uncommitted transaction, so the
test commits for real and cleans up after itself.

**Coverage.** 100% line coverage is the ratified target, enforced as a CI
ratchet rather than a gate sprung at 100% from day one: the threshold sits
at the measured baseline and only rises, one commit at a time, until it
reaches 100%.

The wiring is v8 coverage in each of the three Vitest configs, collected by
`pnpm test:coverage` (per package, or `pnpm -r test:coverage` from the root)
and never by the plain `pnpm test` — day-to-day runs stay uninstrumented.
Each config scopes collection to its own package's `src/`. The e2e suite is
excluded by construction: Playwright drives a live stack from a separate
process, so nothing it exercises is attributable to these numbers. The
server's `migrations/` and `patches/` are excluded for the same reason —
a separate `tsx src/migrate.ts` process applies them before the suite
starts — and because a shipped migration is append-only history that no
test can retroactively cover.

The ratchet itself is `coverage.thresholds` in each `vitest.config.ts`;
that is the single place the numbers live, and the CI `unit` job runs the
coverage scripts so a suite that drops below its floor fails the build.
Baselines measured 2026-08-28, each rounded down to the whole percent:

| Package | Lines / statements | Functions | Threshold set |
|---|---|---|---|
| `apps/server` | 86.64% | 91.18% | lines 86, functions 91 |
| `apps/web` | 33.33% | 45.92% | lines 33, functions 45 |
| `packages/shared` | 21.30% | 85.71% | lines 21, functions 85 |

The web row was re-measured on 2026-08-28 after #223's first batch moved
seven e2e specs down to the component layer; it stood at lines 29.64% /
functions 40.52% (thresholds 29 / 39) before that. Growing this layer is how
the number moves — the ratchet rises as a side effect of rebalancing the
pyramid, not as separate work.

Two caveats on those figures. The server number is a *floor*, not the truth:
`sources-mysql.test.ts` skips itself when `MYSQL_TEST_URL` is unset, so a
developer checkout leaves `src/sources/mysql-driver.ts` (359 lines) at 6%
while CI, which sets the variable, covers it — raise the server threshold to
whatever the first green CI run reports. And coverage is per package, so a
`packages/shared` module driven only from the server and web suites reads as
uncovered here; `src/import.ts` alone is the whole of shared's gap.

## Ground rules

- Never mock the database or the API — if a test can't run against the
  sandbox, reshape the test.
- Don't add cleanup code to sandboxed tests; rollback is the cleanup.
- If a run dies and the next one fails with a job-count mismatch, that's the
  stale-queue symptom above — just rerun; the global setup clears it.
