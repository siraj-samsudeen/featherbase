# Testing

Featherbase tests hit a **real Postgres** — no mocks, no fixture files, no
cleanup code — through the SQL Sandbox harness
[feather-testing-postgres](https://github.com/siraj-samsudeen/feather-testing-postgres),
a published npm dependency (fix it in its own repo, never vendor it here).

## Where does a new test go?

1. **Server integration** — `apps/server/test/**/*.test.ts`. Sandboxed HTTP
   against the in-process Hono app: lifecycle, permissions, naming,
   validation, API shapes. Almost everything belongs here; reach for it first.
2. **Web component** — `apps/web/test/*.test.tsx`. jsdom +
   `@testing-library/react`, its API calls hitting the *real* in-process server
   on the same sandboxed database, never a mock layer. For React-side
   behaviour: rendering from metadata, form logic, query invalidation, what
   was or wasn't sent to the server.
3. **E2E** — `apps/web/e2e/*.spec.ts`, Playwright. **Not** sandboxed: it
   commits real data through a real browser. Only for what a browser alone can
   witness: a rendered stylesheet, real layout, image decoding, genuine focus
   and keyboard handling, the URL bar, routing, realtime between two sessions,
   file drop.
4. **Pure functions** — `packages/shared` has its own Vitest project: no
   database, no `globalSetup`, fully parallel. It stays that way only while it
   stays free of I/O.

The line between 2 and 3 is not "is it UI" but *what the browser adds*. A
test that could run in layer 2 belongs there, where rollback cleans up and it
runs in milliseconds.

## Running tests

```bash
pnpm test                                        # every workspace's suite
pnpm --filter server test                        # server suite
pnpm --filter server test test/naming.test.ts    # one file (anything after is a vitest filter)
pnpm --filter web test                           # web component suite
pnpm --filter web e2e                            # Playwright e2e, on its own isolated stack
pnpm smoke                                       # server + web smoke (web half needs ./init.sh running)
pnpm test:coverage                               # every suite with coverage and its floor
pnpm --filter server typecheck
pnpm --filter web typecheck
pnpm check:e2e-dsl                               # e2e specs use the DSL fixtures
```

Run `pnpm apps:prepare` after installing dependencies and before the server
and web suites: it builds the runtime packages under `runtime-apps/` (Tasker
has its own npm lockfile and is not a pnpm workspace member). CI and
`./init.sh` do this for you.

`typecheck` runs `tsc` twice — on `src`, then on `tsconfig.test.json`, which
adds the test directories (and for web `e2e/` and the Vite/Playwright
configs). A type error in a test fails typecheck like one in `src`.

`pnpm --filter web e2e` sets `E2E_ISOLATED=1`: Playwright resets and migrates
its own database (`<DATABASE_URL's name>_e2e`) and starts its own API and web
servers on ports 8020/5193 (`E2E_API_PORT`/`E2E_WEB_PORT` move them), then
tears them down. `pnpm smoke` does not; it drives whatever is already up on
`:5173`, which is why `./init.sh` runs it as its boot check.

**CI** (`.github/workflows/test.yml`) runs everything on every push to `main`.
On a pull request it runs the static checks, both typechecks, the server suite
(three shards), the web and shared suites and the PostgreSQL 18 release
preflight, and runs e2e **only** when the PR touches `apps/web/**`,
`packages/**`, `runtime-apps/**`, the lockfile, the root `package.json`,
`pnpm-workspace.yaml` or the workflow. Add the `run-e2e` label to force it
(say, a server change to a route the UI depends on).

## The sandbox model

Every test body runs inside one Postgres transaction that is **rolled back**
when it ends, so whatever it created — Tables, rows, users — vanishes, with no
teardown and no cross-test pollution. The test drives the real app in-process,
so the full path (routes → auth → permissions → lifecycle → SQL) runs.

`apps/server/test/pg-test-shared.ts` is the one place that binds the harness
to this app: it routes the app's queries through the test's transaction
(`_setSqlDelegate` in `src/db.ts`), provides pre-authenticated fixtures such as
`admin`, and on teardown clears the metadata cache, Data Source registry and
rate limiter. The server suite imports from `apps/server/test/pg-test.ts`; the
web suite's `apps/web/test/pg-test.ts` reuses the same binding, never a copy.

```ts
import { describe, expect } from 'vitest'
import { test } from './pg-test'          // NOT vitest's test — the sandboxed one
import { makeTable } from './fixtures'

describe('naming', () => {
  test('series names are sequential', async ({ admin }) => {
    await makeTable(admin, { name: 'Nm Invoice', id_pattern: 'NMINV-.####', columns: ['title'] })
    const row = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Nm Invoice',
      row: { title: 'first' },
    })
    expect(row.row_id).toBe('NMINV-0001')
  })
})
```

`admin` is a `TestClient` signed in as Administrator. You can also query `sql`
from `../src/db` mid-test and see the test's own uncommitted state. The
sandbox still sees committed data, so pick names that don't collide with seeded
ones.

Reach for `apps/server/test/fixtures.ts` before writing a per-file setup:
`makeTable` (column shorthand like `'qty:Int'`), `grantRole` (idempotent Role →
Permission), `createUserWithRole`, and `expectApiError` for asserting an error
envelope whether the call threw or returned a non-ok `Response`.

**A component test must not end with a request in flight.** Writes fired as
`void api.post(...)` (theme, language, list settings) would otherwise run after
rollback and commit for real, breaking a later test. Wait for the round trip —
poll the server until it reports the new value. `apps/web/test/theme.test.tsx`
carries the helper.

### Shared database: no file parallelism, and a cleared job queue

Both Vitest configs set `fileParallelism: false` and Playwright sets
`workers: 1`: every file shares one database, so parallel files steal each
other's `background_job` rows (`drainJobs()` drains every queued job) and
contend on id-pattern row locks. Do not turn parallelism back on.

`background_job` is the one piece of state that outlives a run: a killed run
leaves `queued` rows, and the next run's `drainJobs()` count comes back too
high (`expected 2 to be 1`). `apps/server/test/global-setup.ts`, a `globalSetup`
both suites share, empties the queue once per run outside any transaction —
so that symptom clears on rerun.

### Tests that commit for real

Every non-sandboxed test file says why in its header comment.

- `apps/server/test/rls.test.ts` checks native row-level security through a
  second connection under a login role it creates for the run, which could
  never see an uncommitted sandbox transaction, so it commits and drops the
  role after. The `DATABASE_URL` user must be allowed to create roles.
- `apps/server/test/workflow-active-commit.test.ts` proves two workflow
  activations contend, which needs independent committing connections. Create
  a disposable database `featherbase_<worker>_workflow_commit_e2e` on
  `127.0.0.1:5432` and run the opt-in command in the test's header; global
  setup migrates it and the proof checks its test-environment stamp before
  writing. It keeps its records for inspection, so never point the ordinary
  suite at that database.
- `apps/server/test/managed-settings-commit.test.ts` proves a workflow action
  and an assignment rule's stamp honour a locked set that an instance-settings
  apply commits while they wait (#493). Create a disposable database
  `featherbase_<worker>_settings_commit_e2e`, migrate it, and run the opt-in
  command in the test's header; CI runs it in shard 3. It keeps its records.
- `pnpm apps:prove` builds the runtime packages as npm tarballs, runs them on
  plain Node against compiled core through real restarts, and writes evidence
  to `dist/runtime-proof-*/`. It uses only `featherbase_runtime_proof_e2e`
  (override with `RUNTIME_PROOF_DATABASE_URL` / `RUNTIME_PROOF_PORT`).

## E2E specs

Every spec imports `test` or `anonymousTest` from `./fixtures`, and which one
*is* its auth story: `test` is already signed in as Administrator (a
`storageState` captured once per worker through the real login form);
`anonymousTest` starts signed out, for the login surface itself, another
identity, or a page reached with no session. Shared Table builders
(`ensureTable`, `ensureFormFixtures`, `fillRows`) live in `e2e/fixtures-ui.ts`;
each spec still creates its fixtures idempotently in its own `beforeAll`, using
`request` for API setup.

Both fixtures are backed by the
[feather-testing-core](https://github.com/siraj-samsudeen/feather-testing-core)
DSL, pinned exactly in `apps/web/package.json`. A spec drives the browser
through its `{ session }`:

- `visit`, `clickButton`/`clickLink`, `fillIn`/`selectOption`/`check`/`choose`
  for controls with an accessible name or `<label>`;
- `assertText`/`refuteText`, and `assertHas`/`refuteHas(selector, { text, count })`
  for presence, counts and text under a CSS selector such as a testid;
- `assertPath`/`refutePath` for an **exact** path;
- `within(selector, s => …)` for `assertExactText`, `assertAttribute`,
  `assertComputedStyle` and horizontal overflow/scroll checks on one element;
  `reload()`.

Raw Playwright (`page`, `context`) goes only inside a named
`session.step('<what this does>', async ({ page }) => { … })` — for testid or
`[data-field]` addressing, file inputs, drag, keyboard and focus proofs,
`page.evaluate`, route stubs, downloads, or a URL regex. Name the step the way
you'd narrate it: the name is what a failure prints.

```ts
test('pages through the list', async ({ session }) => {
  await session
    .visit(`/admin/${encodeURIComponent(DT)}`)
    .assertHas('[data-testid="list-total"]', { text: '30 total' })
  await session.step('go to the second page', async ({ page }) => {
    await page.getByTestId('next-page').click()
  })
  await session.assertHas('[data-testid="page-info"]', { text: '21–30 of 30' })
})
```

Traps:

- `assertHas(…, { text })` is a **substring** match, even with `exact`. An
  exact `toHaveText('2')` must stay a raw `expect` inside a step — swapping it
  would let "12" pass.
- `assertPath` is exact. "Somewhere under /admin" is a step with
  `expect(page).toHaveURL(/…/)`.
- Real routes live under `/featherbase/…`; visit `/` and let it redirect.
- A second browser context gets its own `createSession(page)` from
  `feather-testing-core/playwright`.
- Waiting on realtime: `waitForRealtime(page, channel)` waits until the server
  has authorized the subscription, not a timer.
- If you drive your own stack instead of `E2E_ISOLATED=1`, boot it with the
  raised `PREAUTH_*_MAX` limits `playwright.config.ts` uses, or the login rate
  limit trips partway through, and reset the database between full runs.

**At least one journey per surface arrives by clicking** (#257): a URL proves
the destination, never the path to it. Keep deliberate deep-link tests and
say why in a comment; `page.goto` for incidental fixture navigation is fine.

`pnpm check:e2e-dsl` (`tools/check-e2e-dsl.mjs`, run in CI) fails any
`apps/web/e2e/*.spec.ts` that does not import `test` or `anonymousTest` from
`./fixtures`, or that imports `test` from `@playwright/test` or
`feather-testing-core/playwright`. A file whose first line is
`// e2e-dsl: exempt — <reason>` is skipped.

## Conventions

- **Names** are spec sentences. A spec-tier test leads with the rule ID it
  verifies and may carry the example table
  (`'UPS-R2 examples: one match updates · none inserts · …'`); other tests are
  verb-first with no "should" (`'series names are sequential'`).
- **Assert the shape.** `toBeTruthy()` / `toBeDefined()` are banned: use
  `toMatch` against an id pattern, `toEqual` against a structure, and
  `expectApiError` for an error envelope.
- Never mock the database or the API; if a test can't run against the
  sandbox, reshape the test. Don't add cleanup to sandboxed tests.

## Coverage gates (ADR 0012)

Coverage is per package, collected only by `pnpm test:coverage` (never by
plain `pnpm test`) and scoped to each package's `src/` — v8 for server and
shared, Istanbul for web. E2E is not attributable to these numbers, and the
server's `migrations/` and `patches/` are excluded (a separate process applies
them; shipped migrations are append-only history).

The floors live only in each package's `vitest.config.ts` `coverage.thresholds`
and only rise. CI fails a suite that drops below. The server suite's three CI
shards run with thresholds zeroed and the `unit` job enforces the floor on the
merged shard reports; locally each suite runs whole against its floor.

Under ADR 0012 the server reached 100% of lines and functions, except
release-preflight's PostgreSQL 18 checks (CI's `release-preflight-pg18` job).
Its gates are functions 100, lines and statements 99.5, branches 90.
`src/sources/mysql-driver.ts` is measured only when `MYSQL_TEST_URL` is set
(CI sets it). A coverage ignore is allowed only as ADR 0012 lists, with its
reason in the comment.

A `packages/shared` module driven only from the server and web suites reads as
uncovered in shared's own report.

### Merged web coverage

The web number that decides which component tests to write is ONE report over
both web suites. A screen e2e already drives is covered; component tests go
where the merged report is still red.

```bash
rm -rf apps/web/.nyc_output        # or old runs are summed in
pnpm --filter web test:coverage    # jsdom run → .nyc_output/jsdom.json
pnpm --filter web coverage:e2e     # isolated e2e, instrumented → .nyc_output/e2e-*.json
pnpm --filter web coverage:merged  # → apps/web/coverage-merged/index.html
```

- `coverage:e2e` sets `E2E_COVERAGE=1`; only then does Playwright start the web
  server with `VITE_COVERAGE=true`, which adds `vite-plugin-istanbul` (the
  normal dev server and `vite build` never see it). Tests get 60s instead of 30s.
- `e2e/fixtures.ts` collects `window.__coverage__` from every page of both
  fixtures, carrying counters across navigations via `sessionStorage`. Pages a
  spec opens in its own `browser.newContext()` are not collected.
- `scripts/coverage-merge.mjs` remaps each input to source lines *before*
  merging (`nyc merge` would add served-code counters to source-level ones).
- The jsdom run's own thresholds gate CI's `unit-web` job; the merged run is
  done by hand. To run it beside `./init.sh`, move the ports and give it a
  private `DATABASE_URL`.
- Both web suites strip comments before instrumenting, so a coverage hint
  before a statement must be a legal comment —
  `/* istanbul ignore next -- <reason> @preserve */`; one inside an expression
  (the argument of `.catch(...)`) survives as it is.

## Tasker development scenarios

With Tasker installed and enabled on a local dev server backed by local
Postgres, seed deterministic discussion scenarios through the HTTP API:

```bash
ADMIN_PASSWORD=admin pnpm seed:tasker -- --url=http://127.0.0.1:8000
```

It refuses non-loopback URLs, redirects, an environment other than
`development`, and a database reporting a non-local address. It cannot detect
a transparent proxy, so never point it through a tunnel, port forward or
proxy, or at any shared, QA, staging or production database. Rows have
deterministic `DEV-TASKER-*` IDs; rerunning is safe and never overwrites a row
a developer changed. Scenarios live in
`runtime-apps/tasker/development/scenarios.mjs`.
