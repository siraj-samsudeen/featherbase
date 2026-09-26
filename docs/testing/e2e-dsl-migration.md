# E2E → feather-testing-core DSL migration

Working doc for the migration of `apps/web/e2e/*.spec.ts` onto the owner's
`feather-testing-core` DSL. This is the pilot (10 files); it sets the pattern
the remaining ~62 files should follow. Not a spec — a mechanics doc, kept
current by whoever does the next batch.

## Version decision

`apps/web` pins `feather-testing-core` exactly at `0.5.0`. This release adds
scoped exact-text, attribute, computed-style, horizontal-layout, scrolling,
and reload operations. The installed `dist/session.d.ts` is the source used
for migrations: `assertExactText` compares normalized whole text;
`assertHorizontallyContained` requires exactly one descendant; and all of
these element-level operations are scoped with `within(selector, callback)`.

`feather-testing-postgres@0.2.0` intentionally retains its own `^0.4.0`
dependency, so the lockfile contains both Core versions. Do not widen that
harness dependency or publish another harness merely to deduplicate the
lockfile.

## Fixture design (`apps/web/e2e/fixtures.ts`)

Both `test` and `anonymousTest` are now DSL-backed. `journeyTest` is
retired — the four suites that imported it now import `test` like everyone
else.

```ts
import { test as dslTest } from 'feather-testing-core/playwright'

export const test = dslTest.extend<object, AuthWorkerFixtures>({
  adminStorageState: [ /* unchanged: sign in once per worker via loginAs() */ ],
  storageState: ({ adminStorageState }, use) => use(adminStorageState),
})

export const anonymousTest = dslTest
```

`feather-testing-core/playwright`'s own `test` is already
`base.extend({ session: async ({ page }, use) => use(createSession(page)) })`
— extending it a second time for the worker-scoped `storageState` fixture
is exactly what the pre-migration code did to `@playwright/test`'s own
`base`, so the auth story (`test` = signed in as Administrator via a
captured storageState, `anonymousTest` = signed out) is unchanged. Every
spec gets `{ session }` now, whether it uses it yet or not; `{ page,
request, context, ... }` all still work because the DSL's `test` is a
normal Playwright `TestType`, not a replacement for one.

Net effect: **no import needs to change** in the ~62 files not yet
migrated. `import { test, ... } from './fixtures'` and `import {
anonymousTest as test, ... } from './fixtures'` both still work exactly as
before; they simply start receiving an unused `session` fixture until
someone migrates that file's body.

## Baseline (before this change, on a fresh `featherbase_e2e1`)

Command used throughout (see "Setup" below for how the stack was booted):

```bash
WEB_URL=http://localhost:5198 pnpm exec playwright test --reporter=list
```

**184 tests total: 156 passed, 28 skipped, 0 failed.** Runtime ~2.3
minutes, single worker (`workers: 1`), against a freshly created,
freshly migrated database.

All 28 skips are self-documented, environment-gated skips, not migration
casualties:
- `preview-login.spec.ts` (4 tests) — skips itself unless the server was
  booted with `PREVIEW_LOGIN_KEY`/`PREVIEW_LOGIN_USER`.
- `sales-target.spec.ts` (24 tests) — skips checks that need a live
  MotherDuck embed session / the `data-warehouse` repo's shared `.env.local`,
  neither of which exists in this worktree.

No other file had a flake or failure at baseline. **No GitHub issues were
filed** — there was nothing pre-existing to file.

One transient flake was observed *before* the baseline run above, while
smoke-checking the four pre-existing DSL suites right after the 0.4.0
bump: `import-upsert-journey.spec.ts`'s `UPS-J2` failed once on
`iw-result-0` not appearing in time. Re-run 3 more times in isolation, it
passed every time. Root cause traced to a different problem (below), not a
real product defect — recorded here rather than filed as an issue because
it never reproduced once that problem was fixed.

### Environment gotcha this pilot hit (read before you boot your own stack)

The isolated `pnpm --filter web e2e` mode (`E2E_ISOLATED=1`) boots its API
server with `PREAUTH_LOGIN_MAX=10000` (and the OAuth equivalents) — see the
comment in `apps/web/playwright.config.ts`. **A manually-booted stack via
`./init.sh` does NOT set these**, and the default login budget
(`PREAUTH_LOGIN_MAX`, default 60 per 15-minute window,
`apps/server/src/pre-auth-rate-limit.ts`) is sized for a production login
form, not ~184 e2e tests each doing 1-2 `POST /api/login` calls. Running
the full suite against a stack booted without the override rate-limits
itself around test #15 and cascades into dozens of `beforeAll`/fixture
failures for the rest of the run (visible as consecutive `0ms` failures in
`--reporter=list` output) — it looks exactly like a systemic app crash, and
isn't one.

**Fix:** boot with the same envs the isolated webServer config uses:

```bash
WEB_PORT=<port> API_PORT=<port> DATABASE_URL=<url> \
PREAUTH_LOGIN_MAX=100000 PREAUTH_OAUTH_LOGIN_MAX=100000 \
PREAUTH_OAUTH_CALLBACK_MAX=100000 PREAUTH_PASSWORD_MAX=100000 \
PREAUTH_FORM_MAX=100000 ALLOW_MOCK_OAUTH=1 \
./init.sh
```

Then point Playwright at it non-isolated with `WEB_URL=http://localhost:<web
port>` — do **not** set `E2E_ISOLATED=1`, which ignores your ports/db and
tries to boot its own second stack (colliding with the one you just booted
if it reuses the same default port).

A second, unrelated gotcha: **re-running the full suite against the SAME
database a second time is not clean.** A handful of specs
(`dashboard.spec.ts`, `palette.spec.ts`'s second test,
`portal.spec.ts`, `task-management.spec.ts`, `user-management.spec.ts`)
create named Users/rows without the 404-tolerant idempotency the
`fixtures-ui.ts` builders use, so a second run against leftover data from
the first hits `417 Updates must include the updated_at timestamp of the
loaded row` or stale counts. This reproduced identically on the
*pre-migration* code with the same non-reset database, so it is a
pre-existing property of those five files, not a migration regression —
confirmed by resetting the database and re-running, which came back clean
(156/156, matching baseline exactly) both before and after this change.
**Always reset the database between full-suite runs** if you're driving
your own stack instead of `E2E_ISOLATED=1` (which resets for you).

## The pattern

### The step rule

The DSL's verbs (`click`, `clickButton`, `clickLink`, `fillIn`,
`selectOption`, `assertText`, `assertHas`, `assertPath`, …) address
controls by **accessible role/name or `<label>`**. Most of this Admin UI
addresses controls by `data-testid` / `[data-field=...]` /
`[data-rowfield=...]` instead — FormView's fields, the Table Builder's
grid, the import wizard, testid'd buttons with no accessible name distinct
from a sibling. When a control the spec needs isn't reachable by role/label
text, **don't force it through a DSL verb** — open a named
`session.step('<what this does>', async ({ page }) => { ...raw Playwright... })`
and write the exact same Playwright code that was there before.

A step's name is not decoration: it is what a `StepError` trace prints on
failure, so name it the way you'd narrate the action to a reviewer — what
happens, not "step 3".

Concretely, per verb:

| Situation | Use |
|---|---|
| A `<label>`-associated input/select/checkbox/radio | `fillIn` / `selectOption` / `check` / `uncheck` / `choose` |
| A `<button>` or `<a>` with an accessible name | `clickButton` / `clickLink` |
| Visiting a URL | `session.visit(path)` |
| "this text is/isn't on the page" | `assertText` / `refuteText` |
| "this element exists / has N of them / contains text" (CSS selector, e.g. `[data-testid=...]`) | `assertHas` / `refuteHas` (`{ text, count }`) |
| Exact pathname | `assertPath` / `refutePath` — **exact match only**; a "somewhere under /admin" check (landing path varies) still needs a step with `expect(page).toHaveURL(/regex/)` |
| Whole normalized text of one element | `within(selector, s => s.assertExactText(text))` |
| Attribute or computed CSS on one element | `within(selector, s => s.assertAttribute(...) / refuteAttribute(...) / assertComputedStyle(...))` |
| Reload the current document | `reload()` |
| Page/element horizontal overflow | `assertNoHorizontalOverflow()` / `assertHorizontalOverflow()` inside `within` when scoped |
| One descendant contained horizontally by a scope | `within(scope, s => s.assertHorizontallyContained(descendant))` — the descendant selector must resolve to exactly one element |
| Prove and perform horizontal scrolling | `within(selector, s => s.assertHorizontalOverflow().scrollToHorizontalEnd())` |
| Anything else: synthetic in-memory file inputs, drag/reorder/resize, focus proofs, screenshots, API/localStorage inspection, `page.evaluate`, `context.clearCookies()`, positional/dynamic locator logic | `session.step('<name>', async ({ page }) => { ... })` |

`assertHas`/`refuteHas` cover more than they look like they do — they take
`{ text, count }`, so "list-total shows '30 total'" or "exactly 3 filter
chips" are one-liners even though the target is a bare testid selector.
Reach for these before reaching for a step; the step is for anything that
*acts* on the page in a way the DSL can't name, or asserts something
`assertHas` genuinely can't express (an attribute value, an exact count
comparison against a dynamic list, focus state).

### Fixture imports — unchanged

```ts
import { test, expect, adminAuth } from './fixtures'          // signed-in Administrator
import { anonymousTest as test, expect } from './fixtures'    // signed out
```

Nothing here changes for a file that hasn't been migrated yet. The bodies
of `beforeAll`/`afterEach` blocks that only use `request` don't need
touching at all — `adminToken`, `adminAuth`, and the `fixtures-ui.ts`
builders (`ensureTable`, `fillRows`, `ensureFormFixtures`, …) are unchanged
and orthogonal to the DSL; keep using `request` for API setup exactly as
before.

### Before / after — a testid-only ListView spec

*(from `listview.spec.ts` — full example in that file)*

```ts
// Before
test('...', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(DT_A)}`)
  await expect(page.getByTestId('list-total')).toContainText('30 total')
  await page.getByTestId('next-page').click()
  await expect(page.getByTestId('page-info')).toContainText('21–30 of 30')
})

// After
test('...', async ({ session }) => {
  await session
    .visit(`/admin/${encodeURIComponent(DT_A)}`)
    .assertHas('[data-testid="list-total"]', { text: '30 total' })
  await session.step('click to the second page', async ({ page }) => {
    await page.getByTestId('next-page').click()
  })
  await session.assertHas('[data-testid="page-info"]', { text: '21–30 of 30' })
})
```

### Before / after — a label-friendly login flow (`anonymousTest`)

*(from `admin.spec.ts`)*

```ts
// Before
test('...', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', 'wrong')
  await page.click('button[type=submit]')
  await expect(page.getByTestId('login-error')).toBeVisible()
})

// After
test('...', async ({ session }) => {
  await session.visit('/').assertPath('/featherbase/login')
  await session
    .fillIn('Email or username', 'Administrator')
    .fillIn('Password', 'wrong')
    .clickButton('Sign in')
    .assertHas('[data-testid="login-error"]')
})
```

### Before / after — a click-only journey (already-DSL reference)

`table-lifecycle.spec.ts` and `table-deletion.spec.ts` (pre-existing DSL
suites this pilot only renamed `journeyTest` → `test` in) are the fullest
worked examples of a multi-page click journey: `session.step()` for every
testid click, `assertPath`/`assertHas` for every round-trip proof, and
`signIn(session)` (in `fixtures.ts`) as the one shared, composable
sign-in-as-a-journey-step helper. Read `table-lifecycle.spec.ts` before
migrating anything click-heavy like the Table Builder or Import Wizard —
`table-builder.spec.ts` in this pilot follows it directly.

### Gotchas found migrating this pilot

1. **`assertPath` is an exact match.** The post-login landing path varies
   with home-recall state (`/admin/home/home`, a recently-visited Table,
   …), so "lands somewhere in /admin" needs
   `session.step(..., async ({ page }) => expect(page).toHaveURL(/\/admin/))`,
   not `assertPath('/admin')`. A regex-substring `toHaveURL` check is not
   expressible by `assertPath`/`refutePath` at all — don't reach for them
   when the check is "contains", only when it's "equals exactly".
2. **There is no bare `/login` or `/admin` route.** Every real route lives
   under `/featherbase/...` (`apps/web/src/router.tsx`); only `/` is
   mapped outside that prefix, and it redirects. `session.visit('/login')`
   404s. Visit `/` (or the real `/featherbase/...` path) and let the
   redirect happen, the way the pre-migration test did with `page.goto('/')`.
3. **`test.skip(condition, reason)` still works inside a DSL test body** —
   the DSL's `test` is a normal `TestType` extension, so the static
   `test.skip()` escape a couple of files use (`table-builder.spec.ts`,
   guarding a create-path against a leftover Table) needed no change.
4. **Unused destructured fixtures fail nothing at runtime but are dead
   weight** — don't destructure `{ session, page }` and then only use
   `page` inside step callbacks (which get their own `page` param); drop
   the fixture you don't use at the outer scope.

## Files migrated in this pilot (10 + 4 renamed)

Renamed only (`journeyTest as test` → `test`, no body changes beyond that
and the 0.4.0 bump): `import-journey.spec.ts`,
`import-upsert-journey.spec.ts`, `table-deletion.spec.ts`,
`table-lifecycle.spec.ts`. All pass, matching baseline.

Migrated bodies (all pass, matching baseline exactly — same assertions,
same test names, same pass/skip status):

| File | Shape | Notes |
|---|---|---|
| `listview.spec.ts` | list-view, testid-only | pagination/sort in steps, counts via `assertHas` |
| `formview.spec.ts` | form, `[data-field]`-only | every field-type check is a step (no labels) |
| `admin.spec.ts` | `anonymousTest`, login-heavy | login form IS label-friendly; sidebar/nav stays in steps |
| `account-menu.spec.ts` | `anonymousTest`, modal-heavy | almost entirely steps; reused `signIn(session)` |
| `import-revert-journey.spec.ts` | plain `test`, wizard | required by the brief; wizard mechanics all in steps |
| `filters.spec.ts` | `fixtures-ui.ts` builder, 2 tests | filter builder controls are testid selects, all steps |
| `table-builder.spec.ts` | plain `test`, click journey | mirrors `table-lifecycle.spec.ts`'s established pattern |
| `grid-layout.spec.ts` | `fixtures-ui.ts` builder, 3 tests | child-grid reorder + section-break layout, both step-heavy |
| `link-autocomplete.spec.ts` | `fixtures-ui.ts` builder | one long step (a single filtering/picking flow) |
| `web-page.spec.ts` | `anonymousTest`, minimal | shortest example; shows `assertText`/`refuteText` fit |

Verification per file: ran individually
(`WEB_URL=http://localhost:5198 pnpm exec playwright test e2e/<file>.spec.ts --reporter=list`),
then the full suite twice (once immediately after, once against a freshly
reset database) — both full runs came back **156 passed / 28 skipped / 0
failed**, identical to baseline. `pnpm --filter web typecheck` is clean.

## Remaining files, batched for follow-up agents

62 files left. Grouped by shape so one agent's context stays coherent
across a batch — not by directory, since these repos don't have
subdirectories. Each batch is independent; hand batches to different agents
in parallel if desired.

**Batch 1 — Import wizard family (12). DONE.** Same shape as
`import-revert-journey.spec.ts`: testid-heavy wizard mechanics, mostly
steps, `assertPath`/`assertHas` around the edges.
`import-batches.spec.ts`, `import-combine.spec.ts`, `import-file.spec.ts`,
`import-merge.spec.ts`, `import-overview.spec.ts`,
`import-partial-failure.spec.ts`, `import-resume.spec.ts`,
`import-row-numbers.spec.ts`, `import-stepper.spec.ts`,
`import-typed-confirmation.spec.ts`, `import-wizard.spec.ts`,
`table-merge.spec.ts`.

### Batch 1 status

Migrated on `e2e-dsl-b1` (db `featherbase_e2e_b1`, ports 5211/8031). No app
code, `fixtures.ts`, or other batch's files touched.

Baseline (unmodified files, this batch only):
`WEB_URL=http://localhost:5211 pnpm exec playwright test e2e/import-batches.spec.ts e2e/import-combine.spec.ts e2e/import-file.spec.ts e2e/import-merge.spec.ts e2e/import-overview.spec.ts e2e/import-partial-failure.spec.ts e2e/import-resume.spec.ts e2e/import-row-numbers.spec.ts e2e/import-stepper.spec.ts e2e/import-typed-confirmation.spec.ts e2e/import-wizard.spec.ts e2e/table-merge.spec.ts --reporter=list`
— **41 passed, 0 skipped, 0 failed.** Same command after migrating, run
twice (once immediately, once again against the same un-reset database) —
both **41 passed, 0 skipped, 0 failed**, identical to baseline. No baseline
failure existed to file as an issue.

| File | Tests | Notes |
|---|---|---|
| `import-batches.spec.ts` | 3 | batch/import-log view; `page.goto`→`session.visit`, rest in steps |
| `import-combine.spec.ts` | 4 | column-combine grid; `openMergedGroup(page)` helper called from inside a step |
| `import-file.spec.ts` | 3 | drag-and-drop + file picker onto the Table Builder |
| `import-merge.spec.ts` | 4 | multi-sheet merge-to-one-Table; revert step included |
| `import-overview.spec.ts` | 5 | file overview: hidden-sheet sections, tri-state master toggle |
| `import-partial-failure.spec.ts` | 3 | `page.route` network stub stays inside its step, unchanged |
| `import-resume.spec.ts` | 5 | `page.reload()`/sessionStorage-quota simulation stay inside steps |
| `import-row-numbers.spec.ts` | 1 | dry-run row-number attribution |
| `import-stepper.spec.ts` | 4 | one-target-at-a-time column stepper |
| `import-typed-confirmation.spec.ts` | 1 | typed-number mass-update guard |
| `import-wizard.spec.ts` | 3 | the biggest file; new-Table + existing-Table-by-column-match in one run |
| `table-merge.spec.ts` | 5 | standalone Table→Table merge screen |

Every file kept its exact assertions (same testids, same text, same counts) —
only the call sites moved into named `session.step()` blocks; `session.visit`
replaced bare `page.goto`. No Session verb (`fillIn`/`clickButton`/etc.) fit
any of these controls — every one is testid- or attribute-addressed, matching
`import-revert-journey.spec.ts`'s shape exactly.

**Batch 2 — Anonymous / session identity (13).** `anonymousTest` shape,
like `admin.spec.ts`/`web-page.spec.ts`: often has a label-friendly login
sequence worth converting, with testid-heavy application logic in steps.
`core-form-responsive.spec.ts`, `dark-mode.spec.ts`, `i18n-login.spec.ts`,
`oauth.spec.ts`, `palette.spec.ts`, `portal.spec.ts`,
`preview-login.spec.ts`, `realtime.spec.ts`, `runtime-login-return.spec.ts`,
`sales-target.spec.ts` (large — env-gated, mostly skips locally; migrate
the shape, don't try to exercise the live-embed parts), `smoke.spec.ts`
(careful: `./init.sh` depends on this file's exact behavior as a
non-isolated smoke check — verify `./init.sh` still passes after touching
it), `user-management.spec.ts`, `web-form.spec.ts`.

**Batch 3 — Admin UI mechanics, A–K (18). DONE — see "Batch 3 completed"
below.** Plain `test`, testid/grid/list mechanics similar to
`listview.spec.ts`/`grid-layout.spec.ts`.
`access-tokens.spec.ts`, `attach-field.spec.ts`, `attachments.spec.ts`,
`awesomebar.spec.ts`, `bulk-actions.spec.ts`, `calendar.spec.ts`,
`checklist.spec.ts`, `client-script.spec.ts`, `column-editor.spec.ts`,
`custom-field.spec.ts`, `dashboard.spec.ts`, `explore.spec.ts`,
`form-sidebar.spec.ts`, `gantt.spec.ts`, `home-page.spec.ts`,
`kanban.spec.ts`, `keyboard-shortcuts.spec.ts`, `naming-series.spec.ts`.

**Batch 4 — Admin UI mechanics, P–W (19). Done** (branch `e2e-dsl-b4`,
db `featherbase_e2e_b4`, web `:5214` / API `:8034`). Same shape as batch 3,
rest of the alphabet plus the two non-idempotent-across-reruns files flagged
above.
`print-formats.spec.ts`, `print-view.spec.ts`,
`private-file-cookie.spec.ts`, `property-setter.spec.ts`,
`recents.spec.ts`, `report-chart.spec.ts`, `report-export.spec.ts`,
`report-view.spec.ts`, `responsive.spec.ts`, `saved-report.spec.ts`,
`saved-views.spec.ts`, `submit-actions.spec.ts`,
`system-settings-global.spec.ts`, `task-management.spec.ts`,
`thumbnail.spec.ts`, `ticketing.spec.ts`, `timeline.spec.ts`,
`ui-feedback.spec.ts`, `workflow.spec.ts`.

### Batch 4 results

Baseline (unmodified files, fresh `featherbase_e2e_b4`, booted with the
raised `PREAUTH_*` envs per "Environment gotcha" above):
`WEB_URL=http://localhost:5214 pnpm exec playwright test <batch 4 files>
--reporter=list` → **34 passed, 0 skipped, 0 failed** (~33s, single worker).
No pre-existing failures, so no GitHub issue was filed for this batch.

Almost every file in this batch is testid-only (no `<label>`-associated
controls at all, unlike the pilot's `admin.spec.ts`/`filters.spec.ts`), so
nearly the whole body of each test stays inside one or a few named
`session.step()`s; `session.visit`/`assertHas`/`assertText` carry the plain
navigations and presence/text/count checks around them. Two files
(`recents.spec.ts`, `saved-views.spec.ts`, `ui-feedback.spec.ts`,
`task-management.spec.ts`) are long, stateful command-bar/nudge/localStorage
walks where splitting into several small steps would have meant threading
the same `page` and local variables across step boundaries for no gain, so
each test there is one step end to end — consistent with the "one long
step" precedent `link-autocomplete.spec.ts` already set in the pilot.

All 19 files migrated, all pass, matching baseline exactly (same test names,
same assertions, same 34/0/0 split):

| File | Shape | Notes |
|---|---|---|
| `print-formats.spec.ts` | testid + attribute checks | format picker `<select>`, `data-format` attribute |
| `print-view.spec.ts` | testid, regex URL landing | Print-button round trip in a step (assertPath is exact-match only) |
| `private-file-cookie.spec.ts` | href/token attribute + raw status check | one step, no labelled controls at all |
| `property-setter.spec.ts` | bare `<label>` text checks | no fillable control — the label text itself is the assertion |
| `recents.spec.ts` | command-bar/sidebar/strip, keyboard | 5 tests, each one long step (regex URLs, keyboard, testid trails) |
| `report-chart.spec.ts` | testid selects, chart text | group-by + pin flow, two navigations |
| `report-export.spec.ts` | CSV/XLSX download parsing | one step: download events aren't expressible by any verb |
| `report-view.spec.ts` | group/column-picker testids | counts/sums against `[data-group=...]` |
| `responsive.spec.ts` | bounding-box/overflow measurement | `test.use({ viewport })` unchanged; both tests one step |
| `saved-report.spec.ts` | configure/save/restore | 3 navigations, each with its own step |
| `saved-views.spec.ts` | localStorage polling, nudge/chip testids | 2 tests, each one long step |
| `submit-actions.spec.ts` | field enabled/disabled + regex URL | draft→submit→cancel→amend, one step |
| `system-settings-global.spec.ts` | exact-text cells, API calls mid-flow | `setSettings` via `page.request` inside the step |
| `task-management.spec.ts` | Tasker runtime app, role/keyboard-heavy | 2 tests, each one long step; screenshots preserved |
| `thumbnail.spec.ts` | file input, image decode/dimension check | one step |
| `ticketing.spec.ts` | plain-text row click + workflow testids | `assertText`/`assertHas` carry most of it |
| `timeline.spec.ts` | `[data-field]` edit + DOM-attribute ordering check | one step |
| `ui-feedback.spec.ts` | route mocks, `page.evaluate`, filechooser, computed style | 7 tests, each one step (heaviest file in the batch) |
| `workflow.spec.ts` | exact-text testids + localStorage token + `page.request` | one step |

Verification: ran the batch's 19 files together once against a fresh
database (34/34 pass), then again with `dropdb`/`createdb` + re-boot in
between (34/34 pass, identical) — the second run matters because
`task-management.spec.ts` is one of the files flagged above as non-idempotent
across reruns on the same database; running it a second time *without*
resetting the db reproduces exactly that (a `toHaveText` miss on stale
localStorage/task state), confirming it's the known pre-existing property,
not a migration regression. `pnpm --filter web typecheck` is clean.

Whoever picks up a batch: re-read "The pattern" above, re-derive the
environment gotcha section (boot with the raised `PREAUTH_*` envs, reset
the database before the final full-suite verification), and update the
table above with the files you finish — don't leave this doc describing a
state the repo has moved past.

## Batch 2 status — anonymous / session identity (13 files, done)

Booted on `featherbase_e2e_b2` (`WEB_PORT=5212 API_PORT=8032`), the same
raised-`PREAUTH_*`/`ALLOW_MOCK_OAUTH=1` envs as the pilot. Baseline was
captured by copying each file's pre-migration content (from `HEAD` on
`e2e-dsl-migration`) back into the worktree, running it against a freshly
reset database, then restoring the migrated files and re-running against
another freshly reset database — both runs came back identical: **20
passed, 28 skipped, 0 failed**. `pnpm --filter web typecheck` is clean on
the migrated code. No baseline failures were found in this batch, so no
GitHub issue was filed.

| File | Shape | Baseline → after | Notes |
|---|---|---|---|
| `core-form-responsive.spec.ts` | plain `test`, testid/attribute-only, 2 parametrized widths | pass → pass | The whole body is bounding-box/CSS/screenshot/route-stub probes with no DSL verb reach; login is label-friendly DSL verbs, navigation is `session.visit`, everything else is named steps grouped by logical phase (blank form, stale-row refresh, validation, permission/version-error probes, attachment upload/removal). |
| `dark-mode.spec.ts` | plain `test`, single attribute/evaluate test | pass → pass | Whole body is one named step (`data-theme` attribute + computed-style evaluate — no verb reaches either). |
| `i18n-login.spec.ts` | `anonymousTest`, non-Administrator login | pass → pass | Login form is label-friendly (`fillIn`/`clickButton`, mirrors `admin.spec.ts`'s `signIn` but for a different user); account-menu/date-cell checks are testid-addressed steps. |
| `oauth.spec.ts` | `anonymousTest`, mock-OAuth flow, 3 tests | pass → pass | Mock consent screen is entirely testid-addressed (steps); `session.visit('/login')` carries navigation. Third test is API-only, untouched. |
| `palette.spec.ts` | `anonymousTest`, `loginAs`, 3 tests | pass → pass | Every check is a `data-*` attribute assertion or a computed-style/localStorage evaluate — no verb reaches any of them — so each test is a sequence of named steps around `loginAs`/`serverPalette`, unchanged from baseline. |
| `portal.spec.ts` | `anonymousTest`, `loginAs` with a non-Administrator identity, 3 tests | pass → pass | `loginAs` (a website-user identity, not Administrator) stays a step; navigation to `/portal/...` moves onto `session.visit`. |
| `preview-login.spec.ts` | `anonymousTest`, env-gated `describe`, 4 tests | skip → skip (same reason: no `PREVIEW_LOGIN_KEY`/`PREVIEW_LOGIN_USER`) | Navigation via `session.visit`; every check (URL regex, localStorage, framenavigated recording) stays a named step. |
| `realtime.spec.ts` | `anonymousTest`, `browser.newContext()` multi-viewer, 3 tests | pass → pass | `session` (bound to the default `page`) can't reach a second browser context, so each context gets its own `createSession(page)` — the same factory `fixtures.ts`'s own DSL-backed `test` is built on — and both go through `.visit`/`.assertHas`/`.refuteHas`/`.step()` rather than raw Playwright throughout. |
| `runtime-login-return.spec.ts` | `anonymousTest`, deep-link + login round trip | pass → pass | Login form is DSL verbs; the exact query+hash-fragment URL round trip is a `toHaveURL` regex `assertPath`/`refutePath` (exact-match only) can't express, so it and the by-role/by-label heading check stay steps. |
| `sales-target.spec.ts` | `anonymousTest`, env-gated (data-warehouse shared inputs), 24 tests across single-page, two-viewer, and multi-context flows | skip → skip (all 24; same reason) | Migrated the shape per the coordinator's explicit "don't try to exercise the live-embed parts" instruction: single-page tests get `{ session, page }` with the existing `login()`/testid mechanics wrapped in named steps; multi-context tests (`browser.newContext()`) get one `createSession(page)` per context, same as `realtime.spec.ts`, wrapping their (unavoidably raw) iframe/Dive-reading mechanics in one named step per viewer/context. Every assertion is untouched. Because the whole file is currently skipped locally, this could not be exercised against the live/stub embed paths — only the skip path was verified, both before and after. |
| `smoke.spec.ts` | `anonymousTest`, 3 tests; **`./init.sh`'s non-isolated smoke gate runs this file directly** | pass → pass | `./init.sh` was re-run end to end after the change (`WEB_PORT=5212 API_PORT=8032`, fresh `featherbase_e2e_b2`) and its `pnpm --filter web smoke` step reported `3 passed` against the migrated file — no change to how `./init.sh` invokes it (`apps/web/package.json`'s `smoke` script, `WEB_URL` env) was needed. The root-redirect and legacy-query-preservation checks became `session.visit`/`assertPath` (the exact-URL and query-param cases `assertPath`'s `queryParams` option was built for); the by-role button-visibility check stays a step. |
| `user-management.spec.ts` | `anonymousTest`, serial `describe`, password-reset journey, 2 tests | pass → pass | Forgot-password/reset-password screens are testid-addressed steps; the real login form at the end is DSL verbs (mirrors `admin.spec.ts`). |
| `web-form.spec.ts` | `anonymousTest`, public web form, 1 test | pass → pass | `context.clearCookies()` has no DSL verb; every form field is testid-addressed, not labelled — the whole interactive flow is named steps around `session.visit`. |

Verification: ran each file individually against a freshly booted stack
(`WEB_URL=http://localhost:5212 pnpm exec playwright test e2e/<file>.spec.ts
--reporter=list`), then the batch together twice — once immediately after
migrating, once again after `./init.sh` rebuilt the stack from a dropped
and recreated database — both came back **20 passed / 28 skipped / 0
failed**, matching the baseline captured the same way. `pnpm --filter web
typecheck` is clean.
## Batch 3 completed

All 18 files, all pass, matching baseline exactly (same test names, same
assertions, same pass/skip status). One gotcha hit and worked around, not a
migration regression:

| File | Notes |
|---|---|
| `access-tokens.spec.ts` | show-once secret modal, service-account lifecycle; all steps |
| `attach-field.spec.ts` | Attach/Attach Image round trip; file inputs + attribute reads, all steps |
| `attachments.spec.ts` | attach/serve/delete cycle; `href`/served-content checks, all steps |
| `awesomebar.spec.ts` | no accessible label on the input itself; three search rounds, each a step |
| `bulk-actions.spec.ts` | checkbox selection + bulk edit/delete; testid-only, all steps |
| `calendar.spec.ts` | drag-to-reschedule; mouse mechanics + date-cell checks, all steps |
| `checklist.spec.ts` | camera upload + phone-width layout; 2 tests, both step-heavy |
| `client-script.spec.ts` | `[data-field]`-only auto-fill + broken-script error surfacing |
| `column-editor.spec.ts` | 6 tests; rename/add/label mechanics in steps, `assertHas`/`refuteHas` for presence |
| `custom-field.spec.ts` | shortest of the batch; one step for the `[data-field]` check |
| `dashboard.spec.ts` | number-card/bar-chart values are exact `toHaveText`, kept in steps (assertHas is substring-only — see gotcha below) |
| `explore.spec.ts` | 4 tests; pane counts are exact `toHaveText`, kept in steps for the same reason |
| `form-sidebar.spec.ts` | assign/tag/attach + reload persistence; testid-only |
| `gantt.spec.ts` | bar attribute checks (`data-start`/`data-end`/`data-days`) + resize drag, all steps |
| `home-page.spec.ts` | 2 tests; home-page title is exact `toHaveText`, kept in steps |
| `kanban.spec.ts` | drag-card-to-column; DB verification after |
| `keyboard-shortcuts.spec.ts` | Ctrl+S/Ctrl+B/`g d` leader sequence; all steps (no label-addressable controls) |
| `naming-series.spec.ts` | `test.skip()` static escape still works inside the DSL `test`, unchanged |

**Gotcha found this batch, beyond the pilot's four:** `assertHas`/`refuteHas`
with `{ text }` do a **substring** match even with `opts.exact` (confirmed by
reading `feather-testing-core`'s `playwright/driver.js`: the `exact` branch
still uses `locator.filter({ hasText: opts.text })`, which is Playwright's
own substring `hasText`, not `toHaveText`'s whole-string equality). Several
of this batch's original assertions were exact `toHaveText('2')`,
`toHaveText('Sales')`, etc. — swapping those for `assertHas(selector, {
text: '2' })` would have been a real weakening (a card showing "12" would
still pass a `{ text: '2' }` filter). Every exact `toHaveText`/attribute
assertion in this batch was kept as a raw `expect(...).toHaveText(...)`
inside a named `session.step()` instead — `assertHas`/`refuteHas` were used
only where the original assertion was itself a substring check
(`toContainText`) or a plain visibility/count check.

**Non-idempotency gotcha reproduced, not introduced:** `dashboard.spec.ts`
is one of the five files flagged in the pilot's "second gotcha" as not
idempotent across reruns on the same database (it appends rows every run
without a 404-tolerant reset). Running the batch twice against the same
`featherbase_e2e_b3` without resetting reproduced exactly that: card counts
doubled (`6` → `12`) and the test failed on the second run. Confirmed
pre-existing (not a migration regression) by dropping and recreating the
database and re-running: **33/33 passed**, twice in a row on a fresh
database, matching the 33/0/0 baseline exactly both times.

Verification commands used throughout:

```bash
createdb featherbase_e2e_b3   # dropdb first if rerunning
WEB_PORT=5213 API_PORT=8033 DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_e2e_b3 \
PREAUTH_LOGIN_MAX=100000 PREAUTH_OAUTH_LOGIN_MAX=100000 PREAUTH_OAUTH_CALLBACK_MAX=100000 \
PREAUTH_PASSWORD_MAX=100000 PREAUTH_FORM_MAX=100000 ALLOW_MOCK_OAUTH=1 ./init.sh

cd apps/web && WEB_URL=http://localhost:5213 pnpm exec playwright test \
  e2e/access-tokens.spec.ts e2e/attach-field.spec.ts e2e/attachments.spec.ts \
  e2e/awesomebar.spec.ts e2e/bulk-actions.spec.ts e2e/calendar.spec.ts \
  e2e/checklist.spec.ts e2e/client-script.spec.ts e2e/column-editor.spec.ts \
  e2e/custom-field.spec.ts e2e/dashboard.spec.ts e2e/explore.spec.ts \
  e2e/form-sidebar.spec.ts e2e/gantt.spec.ts e2e/home-page.spec.ts \
  e2e/kanban.spec.ts e2e/keyboard-shortcuts.spec.ts e2e/naming-series.spec.ts \
  --reporter=list

pnpm --filter web typecheck
```

No baseline failures were found in this batch, so no GitHub issue was filed.
