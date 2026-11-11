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
and web suites: it builds the app packages the suites install
(`example-apps/tasker`, `test-apps/scope-proof`, `client-apps/jeyarama/dash`;
the apps have their own npm lockfiles and are not pnpm workspace members). CI
and `./init.sh` do this for you. It installs and builds; it does not run the
apps' tests. Those are each app's `npm test`, and CI's.

`typecheck` runs `tsc` twice — on `src`, then on `tsconfig.test.json`, which
adds the test directories (and for web `e2e/` and the Vite/Playwright
configs). A type error in a test fails typecheck like one in `src`.

`pnpm --filter web e2e` sets `E2E_ISOLATED=1`: Playwright resets and migrates
its own database (`<DATABASE_URL's name>_e2e`) and starts its own API and web
servers on ports 8020/5193 (`E2E_API_PORT`/`E2E_WEB_PORT` move them), then
tears them down. `pnpm smoke` does not; it drives whatever is already up on
`:5173`, which is why `./init.sh` runs it as its boot check.

**CI** (`.github/workflows/test.yml`) runs everything on every push to `main`.
On a pull request `tools/ci-scope.mjs` picks the suites from the changed paths:

| A PR changes | What runs |
|---|---|
| `*.md`, `docs/**`, `openspec/**`, agent files | the fast checks: specs, sensitive data, vocabulary, the other guards |
| `openspec/**/spec.md` | fast checks, typechecks, server and web suites (where its scenarios run), merged coverage |
| `client-apps/**` | fast checks, the app's `npm test` and platform tests |
| `example-apps/**` | fast checks, Tasker's unit tests, the server and web tests that name an example app, its runtime components and packaged journeys |
| `apps/server/**`, `docs/DEPLOY.md` | fast checks, typechecks, server suite, release preflight, client platform tests |
| `apps/web/**` | fast checks, typechecks, web suite, e2e, merged coverage |
| anything else (`packages/**`, lockfile, `package.json`, `tools/**`, workflows) | everything |

A change across several areas gets the union. Add the `run-all` label to force
everything, or `run-e2e` for e2e alone (say, a server change to a route the UI
depends on). `unit` and `e2e` report on every PR, so never add a workflow-level
`paths` filter to `test.yml`. The checks also fail a PR that changes an app's
`version` to one not greater than `main`'s (`pnpm check:app-versions`).

The component and browser suites each use four CI shards, with a separate
runner and PostgreSQL service per shard. Files still run sequentially within
each shard: their server and instance-wide state is shared. `unit-web` merges
all four Vitest blobs and enforces the component suite's unchanged coverage
floor; `coverage-merged` combines that report with every browser shard.
The `runtime-coverage` job collects Tasker's HTTP coverage and runs the
packaged delivery proof with coverage, for `coverage-merged`.
The required `e2e` check aggregates the smoke, served-page and tour results;
only an explicit scope decision permits skipped suites. Server coverage merges
as soon as its three shards and PostgreSQL 18 preflight finish, leaving `unit`
as a lightweight final verdict rather than another serial setup/merge step.

A scoped PR can break what it did not run; that shows on `main`, which runs it all.

## The sandbox model

By default, each test body runs inside one Postgres transaction that is **rolled back**
when it ends, so whatever it created — Tables, rows, users — vanishes, with no
teardown and no cross-test pollution. The test drives the real app in-process,
so the full path (routes → auth → permissions → lifecycle → SQL) runs.

Requests sharing that rollback connection run sequentially. Tests that deliberately
hold one request while another completes must use `committedTest` from the same
binding instead: their requests use independent committed transaction roots.
They must release and drain held requests before teardown. The fixture snapshots
and restores baseline tables, rows, sequences and added schemas/columns on a
database stamped `test`; it requires the privileged test role. It does not restore
arbitrary changes to existing column types or functions. A killed process can
bypass restoration, so use a fresh disposable database after interrupted runs.

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
- `apps/server/test/security-concurrency-commit.test.ts` proves concurrent
  workflow actions have one winner (#572), conditions are checked after a
  waiting edit commits, and comment/file/share saves serialize with parent
  rename/delete in either order (#599). Create the disposable local database
  `featherbase_security_concurrency_commit_e2e` and run the opt-in command in
  its header. Global setup migrates it; the tests check its environment stamp
  and keep their records. Never use a default development or test database.
- `pnpm apps:prove` builds the runtime packages as npm tarballs, runs them on
  plain Node against compiled core through real restarts, and writes evidence
  to `dist/runtime-proof-*/`. It uses only `featherbase_runtime_proof_e2e`
  (override with `RUNTIME_PROOF_DATABASE_URL` / `RUNTIME_PROOF_PORT`).

## Spec scenarios

A fenced scenario in `openspec/**/spec.md` is proven by one Vitest test bound
to it (#1070): `scenarioFor(test, '<capability>')` from
`apps/server/test/scenario.ts`, then `scenario('<the scenario's name>', …)`.
The body walks the scenario's Gherkin in order. Each `step(...)` names the
next line, by its exact text or a pattern, and a step out of order, changed or
left out fails the test. Put it at the fastest layer that proves it:
`apps/server/test/scenarios/` for the server, `apps/web/test/scenarios/` for
what a person reads on screen.

```ts
const scenario = scenarioFor(test, 'naming-and-numbering')
describe('naming-and-numbering', () => {
  scenario('An imported row already holds the next number', async ({ admin }, step) => {
    await step('a table "Bin" whose rows are numbered 1, 2, 3', () => makeTable(admin, { … }))
    …
  })
})
```

A new scenario test drives the screen with the Session DSL (feather-testing-core,
through feather-testing-postgres's adapter): `renderSession(path, client)` from
`apps/web/test/pg-test.ts`, or `onScreen()` for a page the test mounts itself,
then one chain of verbs inside each step. It sets up data with the `seed(table,
values)` and `createUser({ roles })` fixtures, and keeps the When as an explicit
request. Raw Testing Library is for what no verb covers, with a comment saying why.
On the server, check a refusal with `expectRefused(call, status, message?)` and a raw
Response's status with `expectStatus(res, status)` (`apps/server/test/fixtures.ts`).

```ts
await step('the user corrects the plant code', async () => {
  const { session } = await renderSession(rowHref('Plant', plant.row_id), admin)
  await session.fillIn('Plant Code', '8159').clickButton('Save').assertText('Saved')
})
```

`pnpm check:scenarios` (CI's `checks` job) fails unless every fenced scenario
of the effective spec has exactly one bound test, and every binding names a
scenario the spec has. A scenario still in prose needs none.
`pnpm scenarios:report` runs the bound tests and writes
`scenarios-report/index.html`. It lists every capability, requirement and
scenario with its Gherkin, the test that runs it and whether it passed, prose
scenarios included.

## Tours

A tour (`apps/web/tours/*.tour.ts`, #1070) is one long browser test that tells
one story the way a demo does. It catches what narrow tests miss: one feature
handing over to the next, a normal user rather than Administrator, realistic
amounts of data, and steps that are too slow.

- **Through the screen only.** The one setup is the people who sign in.
  Everything else is done the way a person does it, and later chapters use what
  earlier chapters made.
- **The watchdog.** A tour fails on any uncaught page error, server error
  (5xx) or request that got no answer, even if every assertion passes. It also
  fails on any chapter slower than its time limit.
  `tours/harness.tour.ts` proves the watchdog itself still works.
- **Gaps.** A step the platform can't do yet is a `gap(...)` naming its issue.
  It shows as a card in the video and a note in the report, and never fails the
  tour.
- **One install per run.** `playwright.tours.config.ts` builds the web app,
  resets its own database (`<name>_tours_e2e`) and serves both from the API
  server, as an instance does.
- **Every CI run.** The `tours` job runs on every push and PR, whatever the
  change touches. It is part of the required `e2e` check.

```bash
pnpm tour                                   # every tour, as CI runs them
VIDEO=1 pnpm tour --grep "Featherbase:"     # slow, captioned: test-results/tours/**/video.webm
TOUR_URL=https://<preview> pnpm tour        # against a running instance, before a demo
TOUR_ROWS=500 pnpm tour                     # the base tour with bigger sheets
```

`VIDEO=1` shows each chapter as a title card and each step as a caption, so the
recording can serve as a product video. Playwright records it with its own
ffmpeg (`pnpm --filter web exec playwright install ffmpeg`). Each chapter's time
is printed and kept in the HTML report (`apps/web/tours-report/`).

The **Featherbase base tour** (`featherbase.tour.ts`) goes from a spreadsheet to
an app you can navigate: first the simple path with one clean sheet, then the
stores' own messy sheets layered on top. Each app gets its own tour, and that tour shows the
platform features the app relies on.

## E2E specs

Every spec imports `test` or `anonymousTest` from `./fixtures`, and which one
*is* its auth story: `test` is already signed in as Administrator (a
`storageState` captured once per worker through the real login form);
`anonymousTest` starts signed out, for the login surface itself, another
identity, or a page reached with no session. Only `smoke.spec.ts` remains
(#1080): behaviour is tested in the server and component suites, layout in
Storybook, and demos in the tours.

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
shared, Istanbul for web. The standalone web number counts component tests;
the merged web report below also counts E2E. The server's `migrations/` are
excluded (a separate process applies them; shipped migrations are append-only
history). Hosted MotherDuck I/O is an explicit excluded boundary in
`motherduck-hosted.ts`; local token validation and query construction remain
measured. Thus even a 100% report does not claim to test the hosted service.

Standalone floors live in each package's `vitest.config.ts`
`coverage.thresholds`; merged-report scripts enforce the combined-source
gates. Floors only rise. The server suite's three CI shards run with thresholds
zeroed and the `unit` job enforces the floor on the merged shard reports, only
when the server suite ran; locally each suite runs whole against its floor.

[ADR 0017](../adr/0017-backend-coverage-non-regression-baselines.md) supersedes
ADR 0016's immediate 100% gates with owner-approved maximum uncovered counts.
Core now covers every line and function, and web every statement; the server
caps its statements at 1 uncovered (ADR 0023). Dash and Tasker keep their own
gates under ADR 0017. Caps are exact counts, not rounded percentage floors; one
additional uncovered item fails. Tighten them as coverage improves and keep
every measured source and existing exclusion unchanged.

Core branches are reported, not gated
([ADR 0024](../adr/0024-core-branch-coverage-is-reported-not-gated.md)): the
aggregate count drifts between runs of the same code. The branch column still
prints in every report, and CI keeps the merged numbers as artifacts
(`server-coverage`, `merged-source-coverage`). Most uncovered branches are
reachable and untested; the goal stays 100%.

CI merges the PostgreSQL 18 release-preflight coverage with the server's
three shards before enforcing the server gate. A coverage ignore is allowed only as ADR 0012 lists, with its reason
in the comment. Read the generated report and exclusions, not an old
percentage in documentation, to assess the current code.

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
  normal dev server and `vite build` never see it). It also builds Tasker
  with instrumentation. Tests get 60s instead of 30s.
- `e2e/fixtures.ts` collects `window.__coverage__` from every page of both
  fixtures, including contexts a spec creates through `browser.newContext()`.
  Before navigation it transfers maps directly to Node, including across
  origins; `sessionStorage` carries fallback counters. Per-document deltas
  prevent counting the same execution twice.
- `scripts/coverage-merge.mjs` remaps each input to source lines *before*
  merging (`nyc merge` would add served-code counters to source-level ones).
  It uses Vitest's Istanbul remapper to retain implicit branch arms, and
  refuses incompatible statement, function or branch inventories. The merge
  command first runs a regression test using genuine instrumented executions.
  It requires both suites and refuses missing executable source files,
  including the SPA and gallery entries.
- CI partitions component and browser files across isolated runners, each
  with one worker and its own PostgreSQL. `tools/ci-shards.mjs` records actual
  successful file execution and artifact hashes. The collecting jobs reject
  missing, duplicate, stale or altered producers and require the configured
  file inventory exactly once. `unit-web` replays all component blobs under
  the unchanged jsdom thresholds; `coverage-merged` combines that report with
  every browser map under the existing source-level gates. Served journeys
  and tours run independently; the required `e2e` check requires them and
  the smoke test. To run E2E beside `./init.sh`, move the ports and
  give it a private `DATABASE_URL`.
- Both web suites strip comments before instrumenting, so a coverage hint
  before a statement must be a legal comment —
  `/* istanbul ignore next -- <reason> @preserve */`; one inside an expression
  (the argument of `.catch(...)`) survives as it is.

### Tasker coverage across runtime layers

Tasker is an independent npm package. Its unit report supplies zero counters
for every executable source file, including the server and nested help page.
Merge it with the existing real-server component tests, owning server HTTP
tests, browser tests above, and packaged journeys (`pnpm apps:prove`). All layers use
the same Istanbul instrumentation; mixing V8 counters with these maps is
rejected rather than reporting a false percentage.

```bash
rm -rf coverage/tasker
npm run test:coverage --prefix example-apps/tasker
VITE_COVERAGE=true npm run build --prefix example-apps/tasker
pnpm --filter web exec vitest run --config ../../tools/vitest.runtime-components.config.ts
pnpm --filter server exec vitest run --config ../../example-apps/tasker/vitest.integration.config.ts
VITE_COVERAGE=true pnpm apps:prove
# Run web coverage:e2e above before merging; it supplies the browser maps.
npm run coverage:merged --prefix example-apps/tasker -- \
  --browser-dir "$PWD/apps/web/.nyc_output" \
  "$PWD"/coverage/tasker/components/coverage-final.json \
  "$PWD"/coverage/tasker/integration/*.json \
  "$PWD"/coverage/tasker/packaged/*.json
```

Use a disposable `DATABASE_URL` for HTTP tests. The packaged proof uses its
own guarded `*_e2e` database as described above. Reports live at the repository
root under `coverage/tasker/`, never inside the fingerprinted runtime app.
Do not rebuild or edit an app while a server using its artifact is running:
installed versions require their exact fingerprint. CI's `runtime-coverage`
job collects the HTTP layer before `apps:prove` rebuilds the packages, then
runs the proof with `VITE_COVERAGE=true` for the packaged layer.
It publishes the merged runtime report alongside the web report. The runtime
merger requires every line, statement and function
to be covered, comparing exact counts rather than rounded percentages. It also
requires every branch arm in Tasker's owned esbuild server-entry import closure
to be covered; missing source coverage fails rather than shrinking that scope.
This does not gate frontend branches or count platform backend code as Tasker.
Each collector clears only its own previous output before a run; fresh browser
collection preserves the independent component report.

### Dash frontend coverage

Dash's frontend profile is separate from its backend collector. It derives
the executable source inventory from the browser entry's esbuild import
closure and rejects missing or extra files. An unexecuted entry remains in
the denominator. The profile includes public formatting contracts and page
tests that use the real platform server and SQLSandbox; the older tests
that inject API responses are not inputs to this report.

After `pnpm apps:prepare`, use the explicitly named disposable local database:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_dash_frontend_test \
  npm run test:coverage:frontend --prefix client-apps/jeyarama/dash
npm run typecheck:frontend --prefix client-apps/jeyarama/dash
```

The report is `coverage/dash-frontend/coverage-final.json` with a summary and
HTML beside it. This is frontend coverage only, not backend coverage or
evidence of hosted warehouse or embedded-frame integration. There is no
100% frontend gate yet: add it only when the actual report reaches 100%,
without excluding executable source or weakening existing gates.

### Dash backend coverage

Both backend profiles use the same per-source Istanbul instrumentation.
The platform profile instruments the original modules before bundling only
the disposable copied app; the packageable app artifact stays unchanged.
The denominator is the actual `src/server.ts` esbuild import closure, not
the platform server's source or Dash's frontend.

```bash
npm run test:coverage:backend --prefix client-apps/jeyarama/dash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_dash_backend_test \
  npm run test:coverage:backend:platform --prefix client-apps/jeyarama/dash
npm run coverage:backend:merged --prefix client-apps/jeyarama/dash
```

The merger requires both complete source inventories and identical statement,
function and branch maps before adding counters. It writes exact covered/total
counts under `coverage/dash-backend/merged/` and fails if any uncovered count
exceeds its ADR 0017 baseline, or any metric is empty.
These commands do not prove hosted MotherDuck behavior. Old V8 profiles have
incompatible remapping: regenerate both profiles rather than mixing them with
these reports. A valid merge is not a claim that its coverage gate passes.

### Mutation testing

```bash
npm ci --prefix tools/mutation --no-audit --no-fund
npm test --prefix tools/mutation
```

This pinned Stryker runner copies the current shared source and tests into a
disposable directory; it never mutates the checkout or touches a database.
It runs every shared test, mutating the route, date, row-title and person-scope
modules listed in `tools/mutation/stryker.config.json`. Its score describes
that slice, not the backend or the whole project. Reports are written under
`tools/mutation/reports/` and there is no mutation-score gate.

The runner uses forks because changing `process.env.TZ` does not change
Date's clock inside Node worker threads. A survivor means a mutation was not
detected: inspect the contract and add a discriminating assertion where
needed. It is not evidence that the original code is unused. Remove code
only after checking real callers and reachability; keep equivalent mutants,
uncovered mutants and runtime errors distinct from assertion kills.

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
`example-apps/tasker/development/scenarios.mjs`.
