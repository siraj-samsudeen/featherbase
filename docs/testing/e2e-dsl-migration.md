# E2E → feather-testing-core DSL migration

Working doc for the migration of `apps/web/e2e/*.spec.ts` onto the owner's
`feather-testing-core` DSL. This is the pilot (10 files); it sets the pattern
the remaining ~62 files should follow. Not a spec — a mechanics doc, kept
current by whoever does the next batch.

## Version decision

Upgraded `feather-testing-core` from the pinned `^0.2.0` to `^0.4.0`
(latest on npm). 0.4.0 is purely additive over 0.2.0's Session API:
`attachFile` (renamed from `upload`, which still works as a deprecated
alias), `pressKey`, `hover`, `assertDownload`, `until`, and the `raw()`
escape hatch. The `Session`/`TestDriver`/exports shape used by
`e2e/fixtures.ts` (`test as base.extend({ session })`) is unchanged. No
CHANGELOG is published with the package; this was verified by downloading
and diffing the `dist/session.d.ts` type signatures between 0.2.0 and 0.4.0
rather than reading prose.

`@playwright/test` in this repo is `^1.50.0`, comfortably inside 0.4.0's
peer range (`>=1.40.0`). `pnpm install` picked up 0.4.0 cleanly; `pnpm
--filter web typecheck` and the four pre-existing DSL suites
(`import-journey`, `import-upsert-journey`, `table-deletion`,
`table-lifecycle`) all pass unchanged after the bump. **Decision: take
0.4.0.** No breakage found, so there was nothing to stay on 0.2.0 for.

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
| Anything else: file inputs by testid, native `<select>` by testid, drag/reorder, `page.evaluate`, `context.clearCookies()`, attribute assertions (`toHaveAttribute`, `toHaveValue` on a non-label field), keyboard shortcuts, multi-field forms addressed by `data-field` | `session.step('<name>', async ({ page }) => { ... })` |

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

**Batch 1 — Import wizard family (12).** Same shape as
`import-revert-journey.spec.ts`: testid-heavy wizard mechanics, mostly
steps, `assertPath`/`assertHas` around the edges.
`import-batches.spec.ts`, `import-combine.spec.ts`, `import-file.spec.ts`,
`import-merge.spec.ts`, `import-overview.spec.ts`,
`import-partial-failure.spec.ts`, `import-resume.spec.ts`,
`import-row-numbers.spec.ts`, `import-stepper.spec.ts`,
`import-typed-confirmation.spec.ts`, `import-wizard.spec.ts`,
`table-merge.spec.ts`.

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

**Batch 3 — Admin UI mechanics, A–K (18).** Plain `test`, testid/grid/list
mechanics similar to `listview.spec.ts`/`grid-layout.spec.ts`.
`access-tokens.spec.ts`, `attach-field.spec.ts`, `attachments.spec.ts`,
`awesomebar.spec.ts`, `bulk-actions.spec.ts`, `calendar.spec.ts`,
`checklist.spec.ts`, `client-script.spec.ts`, `column-editor.spec.ts`,
`custom-field.spec.ts`, `dashboard.spec.ts`, `explore.spec.ts`,
`form-sidebar.spec.ts`, `gantt.spec.ts`, `home-page.spec.ts`,
`kanban.spec.ts`, `keyboard-shortcuts.spec.ts`, `naming-series.spec.ts`.

**Batch 4 — Admin UI mechanics, P–W (19).** Same shape as batch 3, rest of
the alphabet plus the two non-idempotent-across-reruns files flagged above
(no extra care needed beyond a fresh database when verifying).
`print-formats.spec.ts`, `print-view.spec.ts`,
`private-file-cookie.spec.ts`, `property-setter.spec.ts`,
`recents.spec.ts`, `report-chart.spec.ts`, `report-export.spec.ts`,
`report-view.spec.ts`, `responsive.spec.ts`, `saved-report.spec.ts`,
`saved-views.spec.ts`, `submit-actions.spec.ts`,
`system-settings-global.spec.ts`, `task-management.spec.ts`,
`thumbnail.spec.ts`, `ticketing.spec.ts`, `timeline.spec.ts`,
`ui-feedback.spec.ts`, `workflow.spec.ts`.

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
