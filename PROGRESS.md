# Progress Log

## 2026-08-11 — #135: create-user refuses a duplicate instead of shadowing it

Filed off the sweep below, then fixed. `feather create-user` handed the row
to `saveDoc` in its default `upsert` mode, so a second call for the same
email fell through to the update path — and the operator saw the raw
`Updates must include the updated_at timestamp of the loaded row`. That was
the reported symptom, and it turned out to be the milder half.

- **The real hazard was case.** `user.name` and the unique index on
  `user.email` are both case-sensitive, so `create-user ADMIN@X.COM` for an
  existing `admin@x.com` did not collide at all — it silently created a
  SECOND account shadowing the first. Same trap #131 closed for service
  accounts, which is why that fix checked `lower(name) = lower($1)`.
- **The guard** in `cmdCreateUser` matches `lower(name)` OR `lower(email)`
  (email is unique, and a row can carry the address under either identity —
  the lookup `findOrCreateGoogleUser` already uses) and throws
  `User <name> already exists`. Plain `Error`, matching cli.ts's local
  style; `main()` prints it as `error: …` and exits 1.
- **Verified** by the real subprocess CLI, both spellings, in
  `cli.test.ts`: exact case and upper case both exit 1 with the clear
  message and never leak `updated_at`, and exactly one account survives
  with its `full_name` untouched. With the guard disabled the exact-case
  attempt reproduces #135's reported error verbatim (`error: Updates must
  include the updated_at timestamp of the loaded row`) and never reaches the
  upper-case spelling — the test catches it on the first assertion.
- **Gotcha**: `cli.test.ts` is deliberately NOT sandbox-migrated (it spawns
  subprocesses with their own connections), so its writes are real and a
  failed run can leave rows behind — including a case-variant
  `CLI-DUP-USER@X.COM` shadow that an exact-match `cleanup()` could not see.
  `cleanup()` now deletes on `lower(name)`, so a half-failed run self-heals
  on the next one. It also folds in main's `svc-cli-test` teardown, which
  landed on the same function.

---

## 2026-08-11 — optimistic concurrency accepts the Date it hands out (#136, reworked)

The surviving core of #136, rebased onto main after #137 overruled its other
half.

`updateDoc` compared the echoed `updated_at` against
`new Date(String(values.updated_at))`. `String(Date)` renders
`Thu Aug 06 2026 10:20:30 GMT+0000 (…)` — whole seconds, milliseconds gone. So
any server-side caller that loaded a row and echoed its stamp straight back
409'd against itself whenever the stored value carried a millisecond
component, which `now()` almost always produces. HTTP callers were never
affected: they send an ISO string over the wire.

- **`document.ts`** grows `expectedStamp()`, which normalizes a `Date` through
  `toISOString()` and leaves strings alone. Both concurrency sites use it —
  the native `updateDoc` check and the `expect` that `updateBoundDoc` hands
  the bound-source driver, where `String(Date)` could never have matched a
  source revision either.
- **Verified** by a new `update.test.ts` case on an ordinary Table, against a
  stamp forced to `…:30.123Z` rather than trusting `now()` to carry one. The
  bug is in the shared save path, so it affected every Table, not just User.
- **What #137 took away.** #136 also cast the stamp at the SSO call site,
  where `findOrCreateGoogleUser` re-enabled a disabled User by echoing the
  `updated_at` it had just loaded. #137 deleted that path outright — a
  disabled principal is now refused rather than revived, and the refusal is
  made indistinguishable from the service-account one. So the cast has
  nothing left to fix and was dropped, not ported. Its test went with it: the
  premise ("signing in re-enables a disabled user") is now inverted, and
  #137's `token-hardening.test.ts` already pins the ruled behaviour — the
  sign-in rejects, and `enabled` is still `false` afterwards. No replacement
  test was written, because it would have duplicated that one.
- **The sweep**, done in the follow-up commit. Exactly five call sites echo a
  loaded `updated_at` back into `saveDoc`, and each was read before being
  touched: `service-accounts.ts`, `index.ts`'s permission upsert,
  `methods/frappe-client.ts`'s `set_value`, `report-chart.ts` and
  `actions/collection-import.ts`. All five hand the value straight to the
  concurrency check and nothing else, so `expectedStamp()` makes every one of
  them redundant and all five came out — a sixth copy of the same
  normalization is exactly the shim CLAUDE.md forbids. The one that looked
  like it might differ is `collection-import.ts`, whose `updateValues()` also
  feeds a dry-run validator; it does not read the stamp, because
  `pickFieldValues()` skips `STANDARD_COLUMNS`. The `?:` guards came out with
  the casts: `updateDoc` already rejects a null or missing stamp first, with
  a clearer message than a `TypeError` on `undefined.toISOString()`.
- Callers that *omit* `updated_at` (`apps.ts`, `customizations.ts` and
  friends) pre-check existence or pass `'insert'`, so they only ever insert.
  The one exception was `cli.ts`'s blind `create-user` upsert — fixed above.
- **Both new tests were confirmed red against the un-fixed code**, one at a
  time. Reverting `updateDoc` to `new Date(String(...))` fails the
  `update.test.ts` case with `… has been modified after you loaded it` — and
  now also fails two `import-upsert` cases, which is the removed
  `collection-import.ts` cast showing that the central normalization is
  load-bearing rather than decorative. Deleting the `cli.ts` guard fails the
  `cli.test.ts` case with #135's raw error verbatim.
- **Verified**: `pnpm --filter server typecheck` clean; server suite
  **116 files, 693 passed**, against a dedicated `featherbase_pr136`
  database (migrations + patches). Main's baseline immediately before this
  work was 691 passed / 116 files — the two added tests are the whole
  delta, and no file count moved because `oauth.test.ts` was already main's.
- **Next**: the bound-source half — `updateBoundDoc`'s `expect` now
  normalizes a Date too, but no test drives a bound source with a Date echo
  (the native path is the one under test).

---

## 2026-08-11 — the mysql engine joins the Data Source drivers

Motivated by the VMS system on AWS RDS (MySQL 8.4, `caching_sha2_password`,
TLS): Featherbase can now connect, test, introspect and reflect a MySQL
database exactly like a Postgres one. The credential URL stays in an env var
(`VMS_DATABASE_URL` on the deployment) and is never stored — BV7 unchanged.

**Design (codebase-design pass, recorded here in lieu of an ADR since it
extends the existing EDS seam rather than deciding a new one):** the
`SourceDriver` interface did not change — a fourth adapter fits every method
as-is. MySQL's lack of `RETURNING` is exactly the complexity the seam hides:
`insert`/`update` re-select the row through the pk (`LAST_INSERT_ID()` for
auto_increment keys). Dialect differences live INSIDE `mysql-driver.ts`, not
in a shared dialect module — the duckdb driver already duplicated `buildWhere`
deliberately, because the variance (placeholders, quoting, `<=>`, casts)
touches nearly every line; a shared abstraction would be a shallow seam.

The seams it plugs into: `SourceEngine`/`ENGINE_WRITABLE` (types.ts), the
driver map (registry.ts), the controller's `ENGINES` set, reflect.ts's `reqd`
heuristic (now postgres-or-mysql), and **migration 0072** adding `mysql` to
the engine Choice column. Row actions test_connection/introspect/reflect
worked unchanged, as designed.

Dialect notes worth knowing later: information_schema comes back with
UPPERCASE keys (aliased to lowercase in the query); `tinyint(1)` maps to
Check; unique violations arrive as errno 1062 and are re-shaped into the
postgres `23505` + `detail` form so mapDbError's field-wise errors work
identically; optimistic-lock comparison is `timestampdiff(microsecond) <
1000` because DATETIME precision varies; the session pins `timezone: 'Z'` so
values round-trip — but DATETIME has no zone, so rows written by clients in
another server timezone read shifted (use TIMESTAMP columns or aligned zones
if that matters). TLS rides the URL: `?sslmode=REQUIRED` (RDS without the CA
bundle), `VERIFY_CA`/`VERIFY_IDENTITY`, or `ssl=true`.

**Verified:** new `sources-mysql.test.ts` (11 tests mirroring the postgres
suite: registry, scrubbed failures, introspection, reflection, reads, the
no-RETURNING insert, conflict on a concurrent CLI write, ER_DUP_ENTRY
field-wise mapping, delete, read_only flip) — runs only when `MYSQL_TEST_URL`
is set; CI got a `mysql:8.4` service so it runs there. Full server suite
**702 passed / 117 files** on an isolated `featherbase_mysqlpr` (aligned
`RLS_TEST_URL`; port 8000 was held by another session). End-to-end over HTTP
on `PORT=8100`: created a `vms` source (engine mysql, url_env
`VMS_DATABASE_URL` → local MySQL 9.6 seeded with `vehicle` + composite-pk
`trip_log`), test_connection ok, introspect proposed the right types,
reflect created `Vms Vehicle` and refused `trip_log` ("Needs a single-column
primary key"), list/get returned the rows, and a write on the read_only
source got 403.

**Next:** update `VMS_DATABASE_URL` on featherbase-dev (Railway) to the
mysql:// URL on port 3306 (with `?sslmode=REQUIRED`) after merge, and retest
against the real RDS instance.

## 2026-08-11 — a reset link burns on use, not on success (#137 finding 6, ruled)

Round 2 left finding 6 open for the owner, because the finding and its stated
remedy pulled opposite ways: "the token survives a failed write" cannot be
fixed by making the write and the deletion atomic, since atomicity is exactly
what rolls the deletion back and hands the link back. The owner has ruled
**burn-on-use**.

`resetPassword` now consumes the token in its own committed transaction —
`select ... for update`, delete every outstanding token for that user, commit —
and only then calls `setUserPassword`. A refused write no longer resurrects the
link. Concurrency is settled by the same row lock as before: the first click to
take it consumes them all, and the losers re-read under READ COMMITTED, find
nothing, and get the ordinary "invalid or has expired" refusal. The rationale
now lives in the comment, which previously argued the opposite case.

The cost is accepted and one-sided: a failed write costs the user another
"forgot password" click, where a used link left alive costs them the account.

`setUserPassword`'s `tx` parameter existed only to enrol it in that
transaction, and no other caller passed one, so it is gone rather than left
unused.

The test that pinned atomicity — a trigger blocking the DELETE — pinned the
property now rejected, so it is replaced by one that pins the ruling: after the
service-account guard refuses the write, the `password_reset` row is gone and
the second attempt is turned away by the lookup, with the invalid/expired
message rather than the guard's. Confirmed RED against the atomic
implementation first (source stashed, test kept: `expected 1 to be +0` at the
row-count assertion, since the rolled-back delete leaves the token sitting
there).

**Verified:** rebased onto `origin/main` `4ae5a8c` (PR #127). Conflicts were
`PROGRESS.md` twice — both same-day entries, kept side by side — and one import
line in `oauth.ts`; main's `getDoc` import served only the OAuth re-enable this
PR deletes, so it went with it. This PR's rulings survive the rebase intact:
a disabled principal stays disabled, and the refusals remain one
indistinguishable message. Server suite **691 passed / 116 files** against an
isolated `featherbase_pr137` (680 before the rebase, on the same database),
server typecheck clean. No server was started — port 8000 was held by another
session's process, so this session verified statically and through the suite.

## 2026-08-11 — PR #127 review: the mock provider fails closed, and `state` finally means something

Four security findings from the #127 review, fixed on the branch before it
merges. A and B are guards that looked like guards without being ones; C and
D — from a second, adversarial pass over the fixes themselves — are the
opposite failure, trusting a value the caller supplies.

**A (critical) — the prod mock guard failed open.** `assertOAuthConfigured`
refused only when the client id was missing *and* `NODE_ENV === 'production'`.
So the mock consent page — pre-auth, un-rate-limited, and willing to mint a
session for any typed email including `Administrator` — stayed reachable
whenever `NODE_ENV` was unset or misspelled, and, worse, whenever a System
Manager blanked `google_client_id` in the Admin UI. Absence of configuration
was what *enabled* the mock.

Now nothing but an explicit `ALLOW_MOCK_OAUTH=1` turns it on. `init.sh` sets
it (local dev boot); `vitest.config.ts` sets it (the suite drives the mock
deliberately); a deployment runs neither and so can never serve it. The
misleading name is gone, split into two functions that say what they do:
`assertMockProviderAllowed` (refuses the mock) and `assertSignInAvailable`
(refuses sign-in when no provider is configured). `exchangeCode` re-checks at
the point the identity is actually conjured.

**B (high) — `state` gave no CSRF protection.** It was an HMAC over a
`Math.random()` nonce, and the callback checked only the signature and expiry
— nothing bound it to a browser. An attacker could start a login, complete
consent with their OWN Google account, and hand the victim the callback URL,
planting the attacker's session in the victim's browser (login CSRF /
session fixation). The state now rides a short-lived HttpOnly, SameSite=Lax
cookie (`secure` derived from the request's real protocol, not `NODE_ENV`,
so Railway's TLS edge and plain-http dev both work) and must match at the
callback. The nonce comes from `crypto.randomBytes`. PKCE (S256) added: a
`code_challenge` on the authorize redirect, the `code_verifier` — carried in
its own cookie — on the token exchange.

Verified: server suite 673/673 and web units 39/39 against an isolated
`featherbase_sso127` database (sibling worktree sessions own :8000/:5173 and
:8010/:5183 — this one ran on :8020/:5193 and left theirs alone); the 3-test
browser e2e `oauth.spec.ts` green. The two new tests were mutation-checked —
forcing `mockOAuthEnabled()` to `true` and dropping the cookie check makes
exactly those three fail, so they bite. Live HTTP against a running server
reproduced both defects' conditions: with `NODE_ENV` unset and
`google_client_id` blank all four OAuth routes answer 401, and a callback URL
replayed into a cookie-less or mismatched browser is refused while the
originating browser completes.

**C (high, same review) — `x-forwarded-proto` is a list, and we read it as a
scalar.** A proxy chain *appends* its hop rather than overwriting, so a
request that reached the edge over TLS arrives as `x-forwarded-proto:
https,http`. Both readers compared that whole string to `'https'`, got false,
and set the brand-new `oauth_state` / `oauth_verifier` cookies **without
`Secure`** — the CSRF fix above, undone by a header the attacker controls.
The same header interpolated `https,http://host` into the `redirect_uri`.

The fix is one function, `externalOrigin()`, and both readers now go through
it, so the cookie flag and the `redirect_uri` cannot disagree. Configuration
comes first: `SITE_URL` — already the env var for password-reset links, now
also in `config.siteUrl` with one reader instead of two — is the deployment's
own absolute URL, and a value we own cannot be steered by a request header.
Only a checkout that has not been told where it lives falls back to the
request, and then the header is parsed as what it is: first hop only,
trimmed, and accepted only if it is literally `http` or `https` (so
`x-forwarded-proto: javascript` can no longer be pasted into an origin).

**D (medium) — the mock reflected any `redirect_uri`.** `mockApproveRedirect`
bounced to whatever the caller asked for, and the mock mints a session for
ANY typed email including `Administrator`: `?redirect_uri=https://evil.example.com/x`
returned `302` there with an admin authorization code attached. It is now an
exact-match allowlist against `OAUTH_CALLBACK_PATH`, which also refuses the
protocol-relative `//host` and `…/callback/../../elsewhere` forms; anything
else is a 400 naming the only permitted target.

Verified: server suite **677/677 across 115 files** (673 existing + 4 new)
against an isolated `featherbase_pr127` database, `pnpm --filter server
typecheck` clean. Sibling sessions own :8000 and :8020 — this one ran its
live server on :8033 and left both answering. The four new tests were
confirmed red first by stashing *only* the source fix and re-running: exactly
those four fail (no `Secure` on the cookie, `javascript://localhost/…` as the
redirect_uri, `SITE_URL` ignored, and a 302 to `evil.example.com`) while all
seven pre-existing OAuth tests stay green. Live HTTP against a running server
then reproduced both exploits and refused them: `x-forwarded-proto: https,http`
now yields `HttpOnly; Secure; SameSite=Lax` and a clean
`https://app.example.com/api/oauth/google/callback`, and all three off-origin
`redirect_uri` shapes answer 400 while the full mock sign-in still completes
to `/oauth-callback?token=`.

Gotcha for the next session: `featherbase_pr127` had a committed
`Administrator` row with `social_login = 'google'`, left outside any sandbox
transaction by the reviewer's live exploit. It made the fail-closed test's
"nothing was provisioned" assertion fail for reasons that had nothing to do
with the code. Cleared.

Next: the deploy note now documents `SITE_URL` as required behind a proxy;
still outstanding is that Railway needs `GOOGLE_CLIENT_SECRET` and must NOT
set `ALLOW_MOCK_OAUTH`. Still open from the earlier entry: hide the Google
button when no provider is configured, and stop passing the session token in
the `/oauth-callback` query string (the sid cookie already travels, and the
query string lands in history and referrers) — that one is pre-existing, from
`3752eb6`, and is being filed separately rather than fixed here.
## 2026-08-11 — #137 round 2: the review of the review, seven findings

A second read of the #137 hardening (itself a review of #131/#134) found seven
things. All fixed here, rebased onto main. The through-line is the same one as
last time: a guard is only worth what it actually *runs on*.

- **The migration guard was written where it can never run.** 0069 was edited
  in place to refuse an `access_token` table that is not the credential store.
  But `runMigrations` skips any file already recorded in `migration`, so every
  checkout that already has access tokens skips the new lines forever — and on
  a fresh database the check is vacuous, because `access_token` cannot pre-exist
  the migration that creates it. It protected exactly nobody. 0069 is restored
  byte-for-byte and the guard is now **0071_access_token_guard.sql**, a file no
  database has recorded. Proven both directions against a real database: with
  the guard back inside 0069 a squatting table produces "migrations up to date"
  and no error; as 0071 it raises with the remedy. (0070 was already taken by
  PR #127, hence 0071.)
- **The token list hid the tokens most worth seeing.** `listAccessTokens` inner-
  joined `"user"`, so a token whose owner no longer matches a user row vanished
  from the admin screen while `resolveAccessToken` could still match it by hash —
  an operator cannot revoke a credential they have been shown does not exist.
  Now a `left join` with `coalesce(u.enabled, false)`.
- **The reserved-name set is derived, not listed.** The literal covered
  `access_token`, `password_reset`, `migration` — 3 of the 10 raw tables this
  database actually has, so a Table named "Series" or "User Settings" still
  reached DDL and came back as a raw `relation … already exists`. `createTable`
  now asks the database whether the physical name is taken. Nothing to keep in
  sync: a new raw table is covered the day it lands. Settings Tables are exempt
  (they generate no DDL).
- **`token_count` contradicted the kill switch.** It applied two of
  `resolveAccessToken`'s three conditions, omitting the owner's `enabled`, so a
  disabled service account advertised live tokens while none authenticated.
- **OAuth refusals were an enumeration oracle.** "This account is disabled" and
  "This account cannot sign in" are distinguishable; both are now the same
  generic refusal as `login()`. The **disabled account is still refused** — the
  #137 ruling that a disable must survive an OAuth round trip is untouched; it
  simply stops being *identifiable* as disabled.
- **Password reset was two statements pretending to be one.** The write and the
  token's consumption became one transaction, so a failure could not leave a
  changed password beside a still-live link. *(Superseded — the owner has since
  ruled burn-on-use; see the 2026-08-11 entry above.)*
- Dead `getDoc` import removed from `oauth.ts`.

**One expectation moved, deliberately.** `ddl.test.ts` asserted a **500** when a
Table's name collided with a raw table — that raw Postgres error is precisely
what finding 3 exists to remove, so it is now a **409**. The transactional-
rollback guarantee that test *also* covered has not been dropped: a second test
keeps it, failing the DDL via a composite type, which occupies the same
`pg_class` namespace but is invisible to an `information_schema.tables` check.
That test passes against the old code too — it is coverage preserved, not a
new claim.

**Verified:** server **680 passed / 115 files**, both typechecks clean, web
42/42. Every new assertion was confirmed RED against the unfixed tree first
(6 failures with the expected messages, including the raw
`relation "installed_app" already exists`). The atomicity case is pinned by a
trigger that blocks the DELETE: unfixed, the surrounding transaction aborts;
fixed, it survives and the password write is gone with it. Live HTTP against
an isolated stack (own database, port 8077): "Series" and "User Settings" now
409 with an actionable message, and a disabled service account reports
`token_count: 0` while its token returns 401 — count and reality agree.

**Open for the owner, not decided here.** *(Decided since — burn-on-use. See
the 2026-08-11 entry above.)* Finding 6 was filed as "the token
survives a failed write" but its stated remedy was "make consumption atomic".
Those pull opposite ways: atomic means a failed write rolls the deletion back,
so the link *does* survive (inert, since the same guard refuses it every time).
Burn-on-use — consume in its own committed transaction, then write — would kill
the link on any failure, at the cost of a transient error costing the user their
link. Atomic was implemented, per the explicit instruction; the alternative is a
ratification call.

**Gotchas.** `apps/server/migrations/` already contains two `0064_*` and two
`0069_*` files; the numbers are not unique and `runMigrations` orders by
filename, so `0069_access_tokens.sql` sorts before `0069_import_upsert_log.ts`
by luck of the alphabet. Left alone deliberately — renumbering an applied
migration is the same class of mistake as editing one. Also: `init.sh` still
hardcodes 8000/5173 in its port-cleanup loop, so it cannot be used from a
worktree while another checkout is serving; this session drove migrations and
tests directly against `DATABASE_URL` instead.

## 2026-08-11 — #128 review: the builder's rejection names a column, not an index

PR #129 surfaced the server's `err.fields` in TableBuilder but flattened the
Zod map into one page-level sentence. Five defects from the review, and the
first is the same shape as the one #115 fixed earlier today — which is why
this branch was rebased onto that work rather than landing beside it.

Rebased again onto `2873d80` to land on top of the day's TableBuilder
refactors rather than fork from them. The import path in `create()` is now
main's throughout — `sendImportRun()`, `excelRow()`/`isBlankRow()` from
`parse-file`, and the skipped-row disclosure — with this branch's local
`IMPORT_CHUNK` and inline chunk loop deleted rather than kept beside them.
Only the validation work below is this branch's own; `keptColumns()`'s
`sourceIndex` is deliberately the same name and shape main gave imported
rows, not a second dialect.

- **The indices were offset by blank-row filtering (P1).** The payload is
  built from `columns.filter(c => c.column_name.trim())`, so the server's
  `columns.0` counted the SENT list while the UI rendered the unfiltered
  grid. Clear row 1's name, mistype row 2, and the error pointed at the
  blank row. Fixed the way #115 fixed it — `keptColumns()` threads a
  `sourceIndex` with each column rather than re-deriving the offset, and
  the catch block reads the server's index back onto the grid through it.
  Not a second mechanism: the same lesson, the same shape.
- **Raw Zod paths no longer reach the user.** `describeFieldErrors()`
  translates `columns.0.column_name` to the column's own label — *Column
  "Price": column_name must be snake_case* — honouring this morning's
  directive that the user's mental model must never straddle two numbering
  schemes. Non-column paths get the control's name (`name` → "Table name"),
  never a dotted key.
- **The error is announced.** The banner is `role="alert"`; the offending
  input carries `aria-invalid` and `aria-describedby` pointing at its own
  inline message, and a rejected create moves focus to the first bad row.
  Previously a screen-reader user pressed Create and heard nothing.
- **Marked inline, per row, reusing FormView's mechanism** (`err.fields` →
  a keyed error map → rendered beside the control) rather than the second,
  page-level dialect this PR had invented. The review flagged the
  divergence as duplicated code.
- **The accusation dies with the correction.** `setError(null)` ran only on
  the next submit, so the banner kept naming a column the user had already
  fixed. Editing a flagged row now clears its mark, and the banner goes
  with the last one; adding or removing a row drops every mark, because the
  indices below it have shifted and a stale mark would accuse the wrong
  column — the very bug being fixed.
- **`text-red-600` → `--color-danger` / `--color-danger-tint`**, so the
  error survives palette switching and dark mode like the rest of the
  Admin. Confirmed by computed style, not by eye: `rgb(226,76,76)` on
  `rgb(251,236,236)` under `classic`.

**Verified** against an isolated stack (own database + ports 8010/5183 —
`:8000`/`:5173` belonged to a live sibling session and were left alone):
`pnpm --filter web typecheck` clean, web units **42/42**, full web e2e
**112 passed / 1 skipped / 0 failed** (counts re-measured after the rebase
onto `2873d80`; the pre-rebase run read 39/39 and 111/2). New browser
witness in
`e2e/doctype-builder.spec.ts` — a blank row above a bad column: the banner
says *Column "Price"*, asserted `not.toContainText('columns.0')`, the mark
lands on row 1 and `dt-col-error-0` has count 0, the bad input holds focus,
and typing a fix clears both. Confirmed to FAIL against the unfixed code
first (it reported `columns.0.column_name` with no `role`), and re-confirmed
to still bite AFTER the rebase: inverting `keptColumns()` to filter before
indexing — the exact off-by-a-blank-row defect — fails the spec at
`dt-col-error-1` not found, because the mark lands back on the blank row.
The pin survives the refactor rather than passing vacuously.

**Left alone deliberately:** `FormView`'s own per-field error still uses
`text-red-600`, and TableBuilder keeps pre-existing `hover:text-red-600` /
`bg-blue-50` literals outside the error UI — all pre-dating this change and
out of this branch's scope.


## 2026-08-11 — the wizard shows the spreadsheet: preview grid with Excel-true numbers

Third item of the production-readiness push. Each sheet card now carries a
collapsible preview of the file itself — row numbers down the left edge
through the SAME excelRow translation the error messages use, so the grid
and the failures cannot disagree. Blank rows render as numbered gaps (the
geometry #115 preserved); after a check or import, failed rows highlight in
place with their message in a Problem column, and the details element opens
itself. Capped at PREVIEW_ROWS (50, ADR 0008-style named bet) plus every
failed row beyond the cap, with an explicit "… N more rows" gap marker —
no silent truncation.

**Verified:** web 42/42, typecheck clean, 10/10 import e2e on isolated
worktree servers — import-row-numbers.spec extended to assert the preview
flags row 6 (not innocent row 5) and that blank row 3 occupies its own
numbered place; screenshotted for the owner. **Next:** revert-a-run
(default skip-since-edited + explicit override, per owner ruling), then
typed confirmation above ~20 updates, then index-on-demand (#145).

## 2026-08-11 — deepening: the import run becomes a module (import-run.ts)

Codebase-design pass over the morning's import work. The finding: row-number
truth was deep (one interface in parse-file.ts) but the import RUN was not —
split → chunk → POST → translate the server's per-chunk index → aggregate →
sort existed as four near-copies (wizard runCheck, runImport, UpsertPreview;
TableBuilder.create), plus IMPORT_CHUNK declared twice. That is exactly why
the #115 index fix had to be applied three times and review still caught a
fourth site diverging.

`apps/web/src/lib/import-run.ts` now owns the run: `sendImportRun({table,
rows, upsert?, dryRun?, context?, onChunk?}) → {valid, updated, inserted,
failed: {sourceIndex, message}[]}`. splitForSend moved in beside it (the
unit suite imports it from there now); the server's `index` never leaves
the module. Callers shrank to a handful of lines each — net −95 lines with
the module included. Seam deliberately placed AFTER projection/coercion:
the two UIs own their plan shapes, and a projection-swallowing interface
would have been wider, not deeper. No injected transport seam — one
adapter is a hypothetical seam; e2e covers the wire.

**Verified:** web 42/42, typecheck clean, 10/10 import e2e on isolated
worktree servers (PORT=8010/WEB_PORT=5183). **Next:** unchanged — preview
grid, then revert-a-run.

## 2026-08-11 — #115 polish: two-axis review findings fixed, row-number truth hardened

Two-axis review (standards + spec, parallel reviewers) of the morning's
#115 commit surfaced six findings; all fixed here. Notably the review ran
while another session had switched the primary checkout to its own branch —
this work therefore lives in its own worktree with its own ports (the
PR #134 recipe), and e2e ran against those.

- **The row arithmetic now genuinely lives in one place.** `excelRow` and
  `isBlankRow` moved to `apps/web/src/lib/parse-file.ts` (the module that
  owns sheet geometry) and are imported everywhere — the wizard's and
  TableBuilder's inlined copies are gone, so the "only translation"
  comment is now true instead of aspirational.
- **Two numbering schemes no longer share a field name.** The server's
  per-chunk `index` becomes `sourceIndex` at the response boundary and is
  never stored; wizard plan state and TableBuilder both carry
  `{ sourceIndex, message }`.
- **IMP-I1 disclosure closed:** a data row with nothing in any *mapped*
  column is sent nowhere — the wizard's check/result and TableBuilder's
  failure message now say "N rows have no data in the imported columns and
  were skipped" instead of letting counts quietly disagree with the file.
  (TableBuilder's success path still navigates without the note — the
  residual is recorded here on purpose.)
- **The untested header-offset path has witnesses:** new
  `apps/web/test/parse-file.test.ts` proves blank-row geometry, blank rows
  *above* the header (headerExcelRow = 3 → 'b' names Excel row 6), and
  all-blank-sheet skipping, via real .xlsx buffers (jsdom's File lacks
  arrayBuffer — patched in the test helper, not the code).

**Verified:** web 42/42 (three new), typechecks clean both sides, all 10
import e2e specs green against isolated worktree servers (PORT=8010 /
WEB_PORT=5183). **Next:** unchanged from the entry below — preview grid,
then revert-a-run.

## 2026-08-11 — #115 fixed: the only row number a user sees is Excel's own

First item of the production-readiness push (spec-0004 upsert merged as
PR #140 this morning; customer developers start importing real data today).
Owner's directive: the user's mental model must never straddle two
numbering schemes — internal indices stay internal, everywhere.

**The bug had two layers, and the pin only saw one.**

1. The known layer (#115 as filed): `coerceRows` dropped blank rows
   silently, so failure indices counted the coerced array while the wizard
   displayed `index + 2` as if they counted the sheet.
2. The layer found while verifying end-to-end: `parseWorkbook` passed
   `blankrows: false` to SheetJS, so blank rows vanished *before*
   `coerceRows` ever ran — fixing layer 1 alone left real-file numbering
   exactly as wrong as before. The unit-tier pin could never catch this;
   only walking a real .xlsx through the wizard did.

**The fix.** Sheet geometry is preserved end to end: `parseWorkbook` keeps
blank rows (`blankrows: true`) and reports `headerExcelRow` (the header's
own 1-based row, so a header that isn't row 1 numbers truthfully too —
a bug nobody had filed). `coerceRows` is now the single place blanks are
dropped, and each surviving row carries its `sourceIndex`
(`CoercedRow { values, sourceIndex }` — signature changed outright, all
callers updated, no compat shim). The wizard's `excelRow()` helper is the
only index→row-number translation in the codebase; `splitForSend` reports
source indices; TableBuilder same. User-facing counts ("N rows") count
data rows, never raw geometry.

**Verified:** server import suites 126/126 (the #115 `it.fails` pin
flipped to a plain passing test, per its own instruction); web units
39/39 (splitForSend suite rewritten with gapped source indices); new
browser witness `apps/web/e2e/import-row-numbers.spec.ts` — a real .xlsx
with a blank row 3 and a bad row 6: the wizard says "row 6", asserted
`not.toContainText('row 5')`. Full web e2e 110 passed (one RT-002 flake,
green in isolation, unrelated).

**Next:** the rest of the 2026-08-11 push, in order — Excel-style preview
grid in the wizard (failed rows highlighted at their true numbers), revert-
an-import-run (default skip-since-edited-rows + explicit override, per
owner ruling), typed confirmation above ~20 updates, index-on-demand on the
match key (#145). Ratification queue: #142–#144.

## 2026-08-11 — OAuth config moves into System Settings (PR #127 rework)

Owner decision: allowlists and client ids are instance configuration, not
deployment environment — anything an env var would carry that is not a
secret creates a permanent manual step per install. So PR #127's
`ALLOWED_LOGIN_DOMAINS` env var (and the `GOOGLE_CLIENT_ID` env read it sat
beside) are gone before ever shipping:

- System Settings gains `google_client_id` and `allowed_login_domains`
  (migration 0070, same idempotent column_def pattern as 0025). Values live
  in the `single_value` EAV store, editable in the Admin UI, and a
  `rama_dw` manifest fixture can check them in.
- `oauth.ts` reads both from `getSystemSettings()`; provider selection
  (mock vs real Google) now keys off the *setting*, resolved per request.
  **Only `GOOGLE_CLIENT_SECRET` remains an environment variable.**
- The production guard is unchanged in spirit: no client id configured +
  `NODE_ENV=production` → sign-in refused, mock never serves.
- Branch also merged origin/main (access tokens #131 replaced API keys;
  conflicts in `index.ts` imports and `PROGRESS.md` only).

Verified: 5 server tests in `test/oauth.test.ts` (domain-gate tests now set
`single_value` rows inside the sandbox — no env fiddling, no cleanup; new
test proves a configured client id flips login to accounts.google.com and
shuts the mock endpoints), full suite 650 green (the #126 events failure
was fixed on main), 3-test browser e2e green, migration 0070 applied
locally.

Deploy story after this: Railway needs `GOOGLE_CLIENT_SECRET` (reference to
report-server's) and nothing else; the client id + `jeyarama.com` domain
list ride the checked-in manifest fixture; Google console gets the
featherbase redirect URI. Coordinate merge order with PR #136, which edits
the same `findOrCreateGoogleUser` region.
## 2026-08-06 — #137: review findings on the access-token feature, all five real

A read-only review of the merged #134 raised five findings. Every one
reproduced, and each now has a test that fails against #134 and passes here.
The theme: a credential's *lifecycle* was enforced at the routes rather than
at the operations underneath them, so any second caller bypassed it.

- **P1 — a durable token could travel in a URL.** `resolveToken` accepts
  `fbt_` wherever a Bearer credential is resolved, and two paths turn
  `?token=` into one: private files and the browser WebSocket (which cannot
  set headers). A non-expiring, System-Manager-equivalent secret would land
  in browser history, referrers and proxy logs. `resolveToken` now takes
  `{ fromUrl }` and refuses access tokens there; the `authorization` header
  keeps accepting them, so automation is unaffected. Session JWTs still work
  in both places — verified live: an access token on `/ws?token=` is refused
  while a JWT establishes a session.
- **P1 — OAuth undid an administrator's disable.** `findOrCreateGoogleUser`
  flipped `enabled` back on for any matching disabled User *before*
  `issueSession` got to reject it. So an OAuth round trip against a disabled
  service account's identity re-enabled the account and every access token it
  owned started working again, even though the interactive login was still
  refused — disablement stopped being an incident-response control. It now
  refuses service accounts and disabled users outright, matching `login()`
  and `issueSession()`. Practical reach was widest with the mock provider
  (active whenever `GOOGLE_CLIENT_ID` is unset); real Google could not assert
  a `@service.invalid` address. Note this deletes the `saveDoc` call that
  **#136** patches for the millisecond-`updated_at` trap — see the conflict
  note below.
- **P2 — password reset stamped a hash onto a passwordless principal.**
  `/api/set_password` refused service accounts, but `resetPassword` reaches
  `setUserPassword` directly. The invariant moved onto the write itself, and
  `requestPasswordReset` now returns the same silent `null` as an unknown
  user, so it cannot enumerate service accounts.
- **P2 — "active" did not mean usable.** The service-account token count
  excluded revoked tokens but not expired ones, and the UI called a token
  `active` even when its owner was disabled. The count now applies the same
  liveness conditions `resolveAccessToken` does, and the list carries
  `owner_enabled` so the screen shows `owner disabled`. Revoke is now offered
  until a token is actually revoked — previously it was gated on `active`, so
  the new state would have hidden the button on the tokens most worth killing.
- **P2 — a user Table could squat on the credential store.** A Table named
  "Access Token" compiles to physical `access_token`; the engine's duplicate
  check reads `table_def`, which raw tables have no row in. Proven: creating
  it raised `relation "access_token" already exists`. `createTable` now
  refuses reserved physical names, and 0069 raises a clear, actionable error
  instead of letting `if not exists` silently adopt a foreign table.

**Conflict note for whoever merges second:** #136 (open) edits the exact
`saveDoc` in `findOrCreateGoogleUser` that this change removes. If #136 lands
first, drop that hunk when rebasing — its `document.ts` `expectedStamp`
hardening and the wider sweep stand on their own and are still wanted.

Verified: server **651 passed** (114 files, up from 645), new
`token-hardening.test.ts` (5 cases) confirmed RED against the code as merged
before being kept, web typecheck clean, full Playwright suite green, and the
WebSocket refusal exercised against a live stack. Next: nothing outstanding
on tokens; the Rama install (data-warehouse#1750) is unblocked.

## 2026-08-06 — two ways a green suite goes red on a machine that has been used

A local `pnpm test` came back with four failures on a feature branch. None of
them were the branch's fault, and neither cause named itself in its error.

- **`init.sh` never installed a newly added dependency**
  (`init.sh`). Line 11 read `[ -d node_modules ] || pnpm install`. Once a
  checkout had installed even once, that guard held forever — so switching to
  a branch that ADDS a dependency installed nothing, and the suite died with
  `Cannot find package 'fast-check'` (also `@duckdb/node-api`, and
  `feather-testing-core` in the web e2e fixtures). The packages were in
  `pnpm-lock.yaml` the whole time; nothing pointed at the install step.
  The guard is gone — `pnpm install` now runs every boot. On the reporting
  checkout it took **380ms and added the 6 missing packages without touching
  the lockfile**, which is the whole argument: the cost is noise, the
  debugging it prevents is not.

- **`user_event` is shared state that outlives a run**
  (`apps/server/test/global-setup.ts`). The read-side trail (#101) is written
  by the *app*, so `./init.sh`, the Playwright e2e suite, and any manual
  click-through all commit rows as Administrator, outside any sandbox
  transaction. This machine had **955** of them. `eventSummary` scans only the
  newest 800 rows per user, so the clamp test's deliberately backdated
  `now − 7d` event sank below the scan window and was simply absent from the
  summary — surfacing as `Cannot read properties of undefined (reading
  'visits')`, which reads as a broken endpoint rather than a crowded table.
  This is the `background_job` gotcha exactly, so it gets the same treatment
  in the same place: `global-setup` now empties both tables from a
  `SHARED_TABLES` list. Losing the trail costs nothing — it is telemetry, the
  client keeps its own warm mirror, and nothing user-visible depends on old
  rows.

The events failure reproduces on `main`, so it was never branch-specific; it
was latent on any machine with a few hundred committed events, and dormant on
a fresh one.

**Verified:** `apps/server` full suite green — **113 files, 640 passed, 1
skipped** (the clamp test passes against a DB that still had the 955 rows
before setup ran). On the reporting checkout after the install, the three
previously-uncollectable files pass — `import-properties` (14),
`import-upsert` (20), `sources-duckdb` (3). `playwright test --list` in
`apps/web` now collects **111 tests in 73 files**, so the
`feather-testing-core` fixture import resolves. `pnpm lint:sql` clean;
`bash -n init.sh` clean. `./init.sh` was NOT booted end to end — the reporting
checkout owned :8000 and :5173 at the time, and taking those ports would have
disrupted live work; the changed line is the dependency step alone, and it was
exercised directly.

While here, `apps/server/vitest.config.ts` was corrected twice over: it named a
`tab_background_job` table that does not exist (`to_regclass` confirms only
`background_job` does), and it described `globalSetup` as emptying the queue
alone.

**Gotcha for the next person:** the first full run after a `pnpm install` took
**726s and ended in a hook timeout**, with every test still passing.
`cli.test.ts` spawns the CLI through `npx tsx`, and on a cold cache `npx` goes
to the registry before it runs anything. The very next run was **59.9s with
`cli.test.ts` at 3.2s**. So a one-off slow run right after an install is that,
not a regression — though a test suite that can reach the network is a hazard
worth removing on its own terms.

**Next:** nothing pending from this thread. Worth knowing: any future table the
app writes outside a sandbox transaction belongs in `SHARED_TABLES` the day it
lands, not the day a test goes red.

## 2026-08-06 — Access tokens + service accounts (#131): durable automation credentials

The Rama prod cutover exposed the gap: installing an instance manifest
needs a System Manager bearer token, and the only way to mint one was
logging in as the human Administrator and ferrying the expiring JWT by
hand. Design ping-ponged with the owner (all five calls recorded in #131),
then built end to end:

- **One `access_token` table replaces the API-005 key pair** — named
  tokens, `fbt_`-prefixed show-once secrets stored as SHA-256 (high
  entropy needs no salt, and a deterministic hash keeps auth a single
  indexed select — no more per-request scrypt), optional expiry,
  last-used stamping in the same round-trip as the lookup, idempotent
  revoke. Tokens ride `Authorization: Bearer`, told apart from JWTs by
  prefix. The `token key:secret` scheme, both `user` columns, and the
  generate/revoke endpoints are gone outright (project stage: nothing
  deployed, change outright); API-005 flipped to `retired` in
  `harness/features.json` by owner sanction in #131.
- **Service accounts are User rows with `user_type = 'service'`** (raw
  column, dedicated endpoints/CLI only) — roles, permissions, RLS and
  audit all work unchanged; `login()`, `issueSession()` and
  `/api/set_password` refuse them, so they authenticate by token or not
  at all. Disabling dead-ends every token (owner `enabled` is checked at
  resolve time); deleting cascades tokens away. Duplicate-name check is
  case-insensitive so `administrator` can't shadow `Administrator`.
- **Permissions**: everyone manages their own tokens; System Managers see
  and manage all, and only they touch service accounts.
- **UI** `/admin/access-tokens` (sidebar, next to All tables): token table
  with state pills and one-click revoke, issue dialog (owner picker for
  SMs, expiry presets) into a show-once copy modal, service-account
  section with role checkboxes and enable/disable.
- **CLI**: `create-service-account`, `issue-token` (prints the secret
  once), `list-tokens`, `revoke-token` — production story documented in
  `docs/DEPLOY.md` (ties into #130's break-glass Administrator).
- **Parallel-worktree fix en passant**: `vite.config.ts` now honors
  `WEB_PORT`/`API_PORT` so two checkouts can run side by side; this
  session ran on :8010/:5183 with its own `featherbase_tokens` database
  after colliding with an active session on :8000.

Gotcha caught by the new suite: `String(Date)` truncates to seconds, so
passing a raw `updated_at` back into `saveDoc` trips the optimistic-
concurrency 409 — use `.toISOString()` (`service-accounts.ts`; the same
latent trap exists in `oauth.ts`'s re-enable path).

Verified: server suite **645 passed / 1 skipped** (113 files) including
the new `access-tokens.test.ts` (7) and a CLI lifecycle test; web suite
36 green; new `access-tokens.spec.ts` e2e green in the real browser; live
end-to-end: CLI-created `svc-…` account + token authenticated
`POST /api/install_app` (checklists app installed), revoke → 401. Next:
wire the Rama data-warehouse repo's install flow to a service-account
token, and the #130 no-default-admin-password work it unblocks.

## 2026-08-05 — Spec 0004 built: import upsert on a match key (journey-spec trial #2)

The second greenfield run of the journey-spec framework, executed from a
fully-ruled spec (all five questions ruled 2026-08-05, PR #125) with zero
mid-session stalls. The import boundary and wizard learned update:

- **Server** (`collection-import.ts`): optional `key_column` on
  `POST /api/table/:table:import`. Rows resolve against the DATABASE —
  never the request — per UPS-R2: empty keys fail named, in-file
  duplicates all fail, multi-matches fail with the count, one match
  updates, none inserts. Updates run the full saveDoc lifecycle
  (validation, hooks, versioning; optimistic stamp carried from
  resolution as an ISO string — `String(Date)` drops milliseconds and
  refuses every update, the session's first bug). `empty_cells:
  'keep'|'clear'` (UPS-R3) with 'clear' taking the run's mapped
  `columns`; permission gate extends IMP-R10: inserts need create,
  updates need write per matched row (own-rows per row), refused whole
  BEFORE any write. `dry_run` returns per-row `actions[]` and writes
  nothing. Import Log gains `updated`/`key_column`/`empty_cells` (0069
  converges, 0056 rewritten for fresh installs).
- **Engine** (`document.ts`, UPS-R4): `resolveName` adopts a supplied id
  verbatim on generated-id Tables — series untouched, `prompt`/`field:`
  unchanged — and the unknown-name NotFound guard now applies only
  outside insert mode. This *fixed a latent disagreement*: dry run
  accepted explicit ids the real import refused.
- **Wizard** (`ImportWizard.tsx`): labelled, keyboard-reachable Match
  key select over mapped targets (+ Row ID when mapped); marking a key
  shows real preview counts (whole-file dry run) and reveals the
  empty-cells choice (default keep); rehearse and completion count
  updates/inserts apart; the mapping select offers **Row ID** as a
  target (the append-path half of the old wizard gap); duplicates are
  failed BEFORE chunking (`splitForSend` — a dup split across chunks
  must never reach the server as two clean requests); UPS-R5's last
  keyed choice pre-fills as a visible "Match on Zone Name, as last
  time" suggestion read from the Import Log.

Verified: 20 new server tests (`import-upsert.test.ts` — R2 property via
fast-check over dry_run, R3 model-based property, whole-request refusal
three ways, idempotence proven through the version trail recording
nothing on a no-op second run); 3 web unit tests (`import-upsert-split`,
exhaustive 1024-file sweep); e2e `import-upsert-journey.spec.ts` walks
UPS-J1 and UPS-J2 (with the Row-ID-as-key branch) self-cleaning via
table deletion, no skip paths. Full server suite 660 green; web 39; the
9 existing import/deletion e2e specs green. Evidence CSV flipped
gap→proven with stamps in the same changes as the tests; trial-#2
retrospective (format friction + three-fates queue: id-change refusal,
the `columns` argument, the seq-scan answer) appended to spec 0004.

Gotchas: (1) `sources-csv`'s chmod-based test fails in a root container
on the unmodified base too — root ignores directory write bits; not a
regression. (2) fast-check can't join `apps/web` this session: any
lockfile update re-resolves the `github:` feather-testing-postgres dep,
and this environment's egress blocks codeload tarballs (git clone lane
works; `pnpm install` protocol-swapped to `git+https` locally, manifests
and lockfile restored before commit).

Next: IMP-R13 (undo — insert deletion + version-trail replay for
updates, the last leg of H1/IMP-H1); the three-fates queue in spec
0004's retrospective needs the owner's rulings; #115's true-row naming
still pinned.

## 2026-08-05 — Live Google OAuth: real exchange, domain gate, prod mock guard (PR #127)

The PLAT-006 scaffold becomes a working provider, so Rama's client signs in
with the same Google ID used on dash.jeyarama.com — one corporate OAuth
client shared across both, no WorkOS layer.

- `exchangeCode()` real branch implemented: authorization-code POST to
  Google's token endpoint (`GOOGLE_CLIENT_SECRET`) + userinfo fetch,
  `email_verified` required. The dev mock is untouched, so local flows and
  the e2e suite behave exactly as before.
- `redirect_uri` honors `x-forwarded-proto` — behind Railway's
  TLS-terminating edge the container sees `http`, and Google's exact-match
  registration would otherwise reject the callback.
- `ALLOWED_LOGIN_DOMAINS` (comma-separated) gates *auto-provisioning* on
  first sign-in; users that already exist were provisioned deliberately and
  always sign in (the report server's grants-arm semantics). Unset = dev
  behaviour unchanged. Provisioned users get no roles — deny-by-default;
  a Rama-side `Viewer` role belongs in the `rama_dw` manifest, not here.
- **Security**: the mock provider now refuses to serve under
  `NODE_ENV=production`. An unconfigured prod deploy previously served the
  mock consent page, which minted a session for any typed email — including
  `Administrator`.

Verified: 4 new server tests (`apps/server/test/oauth.test.ts` — mock round
trip, gate deny/admit, off-domain existing user, prod refusal), full server
suite green except pre-existing #126 (events retention, reproduced on an
untouched tree), and the 3-test browser e2e `oauth.spec.ts` against live
dev servers.

Next: Railway vars on the `featherbase` service (references to
`report-server`'s Google client + `ALLOWED_LOGIN_DOMAINS=jeyarama.com`),
add the redirect URI in the `jeyarama-dashboards` Google client, merge
#127, then verify a real `@jeyarama.com` sign-in on prod. Follow-ups worth
considering: hide the Google button on the login page when the provider is
unconfigured, and stop passing the token via the `/oauth-callback` query
string (the sid cookie already travels).

## 2026-08-05 — PR #116 review: the checklist snapshot becomes server-owned

Five findings from the #116 review, three of them P1. The theme running
through the first three: the run's items were treated as *payload*, when
they are the server's record of what a store actually did.

- **The snapshot is server-authoritative** (`sample-apps/checklists.ts`).
  Creation now derives items from the template ALWAYS — supplying an
  `items` array no longer suppresses snapshotting. Updates fold the
  proposed array onto the persisted child rows (`reconcileItems`): only
  the tick and its excuse note travel from the client, while the label and
  the `must_do` / `photo_proof` policy stay as stored, `done_at` is a
  server stamp, omitted rows can no longer delete real items, and invented
  rows cannot add any. The submit gate therefore judges the stored
  checklist — previously `{ run_status: 'Submitted', items: [] }` passed
  the gate at "0/0" and then deleted every item on the way through.
- **A submitted run is terminal.** `run_status` is an ordinary Choice
  column, so the engine's immutability guard (which watches the standard
  `status` column) never saw it — a Submitted run stayed a `draft`
  document and accepted late ticks, new photos, and `Submitted → Open`.
  `prepareRun` now refuses any update whose stored `run_status` is
  Submitted, and `ChecklistView` locks every mutation control on a run
  that has reached its last declared status, showing a "this run is final"
  line instead of inviting saves that can only come back as errors.
- **`own_rows_only` no longer leaks around the parent** — two engine
  fixes, because neither is checklist-specific:
  - **Child rows are only as readable as the row they hang on.** A grant
    on a `sub_table` Table says "may read rows of this shape", never WHICH
    rows, so a second team leader could list every `Checklist Run Item`
    and read another leader's items directly. `getDoc` now defers to the
    parent (`assertParentReadable`) and `scopedWhere` compiles one
    OR-branch per Table that can own the child rows, each scoped to what
    the caller may see of it (`parentScopeCond`).
  - **`/api/upload_file` authorizes the reference** before it writes a
    storage object or a File row, so a refused upload leaves nothing
    behind. Read, not write: `own_rows_only` portals grant create without
    write and their users legitimately attach to their own rows. A
    `ref_doctype` with no `ref_name` attaches to the TABLE rather than a
    row — DEL-R7 (merged from main) registers exactly those so deleting a
    Table sweeps them — so that case checks the Table's read grant instead.
  Plus: checklist photos upload `is_private`, and Team Leader's `File`
  grant is `own_rows_only` — a leader sees the files they uploaded, and
  minting a URL for anyone else's is refused at `/api/signed_url`, which
  authorizes the row the photo hangs on.
- **Checklist discovery got both stricter and wider** (`ChecklistView`).
  The completion binding now REQUIRES a Check column named `done` — the
  old "else the row table's first Check" fallback made the shipped
  Checklist Template look executable, binding `must_do` as completion
  state so tapping a row rewrote the standard instead of running it. And
  child metadata now loads for every Sub-table candidate via `useQueries`,
  not the first two, so a checklist in a Table's third sub-table binds
  like one in its first.

- **The checklists suite pre-cleans instead of skipping** (review F1) —
  the conversion the import create-path specs got in #118, now that
  deletion exists to pay for it. `install()` uninstalls a committed
  structure before installing its own, inside the test's transaction, so
  the rollback hands the database back untouched (verified: the 4 Tables,
  the `installed_app` row and the 8 template items all survive a run).
  The old guard skipped, and a skipped suite reports green while proving
  nothing — on a dirty database the full run showed **605 passed / 10
  skipped** with all eight checklist tests silently absent; it now shows
  **639 passed / 1 skipped** on that same database. The helpdesk round
  trip in `app-fixtures.test.ts` got the same conversion by owner
  instruction: it additionally clears the look-alike `Email Account`,
  because an ADOPTED fixture row is never in the ledger and so survives
  uninstall — leaving it in place would make the next run's "this row
  predates the app" premise a lie.

Verified: server **638 tests green** (113 files) including three new
`checklists-app.test.ts` cases — snapshot reshaping refused, submitted run
final both ways, and a two-team-leader pass over direct child reads, child
lists, File lists, signed URLs and uploads. New
`apps/web/test/checklist-binding.test.tsx` (2 cases) renders the real
components: a checklist in the third sub-table binds past two near-misses,
and Checklist Template reports no shape. Every new test was confirmed to
FAIL against the unfixed code before being kept. `checklist.spec.ts` passes
in the browser (now seeding two runs, since the first spec submits its own
and a submitted run has no controls left) along with every upload-driving
spec — attachments, attach-field, thumbnail, form-sidebar. Both typechecks
clean.

Gotchas: (1) `parentScopeCond` returns its fragment boxed in `{ frag }`
like `compileFilter` does — a bare `sql` fragment is a *thenable*, so
`await`ing one EXECUTES it instead of returning it; the typechecker catches
this, the runtime would not have. (2) That fragment is parenthesized before
being ANDed into the WHERE — `AND` binds tighter than the ORs inside it.
(3) The ONE skip guard left in the server suite is not this pattern and
should stay: `system-flag.test.ts` asserts a property of a *freshly
migrated* database, and the pre-clean trick cannot apply — the "leftovers"
there are the developer's own tables, which a test may not delete.
(4) This worktree's `node_modules` predated `@duckdb/node-api`, which fails
4 of 6 web unit FILES and one server file until `pnpm install` runs — it
looks like a code break and is not one. (5) Ten e2e specs fail in this dev
database (`grid-layout`, `report-*`, `dashboard`, `formview`,
`link-autocomplete`, `client-validation`, `letterhead`); all were confirmed
to fail identically on the unmodified base commit — dirty-dev-DB breakage,
not a regression.

Next: per-item photo *requirement* enforcement (`photo_proof` still invites
rather than blocks), and a template-picker "start run" affordance cheaper
than the generic new form.

## 2026-08-05 — DEL-R9: tombstone messaging (Q2 graduated, #118)

The arbiter ruled on spec 0003's Q2 the day it was raised: option (1),
tombstone messaging. Per the change protocol the spec changed first
(Q2 removed, DEL-R9 added, J1.4's "must see" now names the deletion),
the new server tests demonstrably failed against the old code, then the
implementation landed:

- **Server** (`meta.ts`): `getMeta`'s not-found path reads back the
  Access Log's `delete_table` testimony (DEL-R8) — a deleted Table 404s
  with "*X was deleted by 〈user〉 on 〈date〉*"; a never-created name stays
  a plain "not found" (no burial, no tombstone); repeated
  create/delete cycles answer with the latest line. Every surface that
  resolves a Table by name inherits the message through the same
  boundary. Guarded for mid-upgrade databases without `access_log`.
- **Web** (`ListView`): the list error path shows the server's words
  (`ApiError.message`) instead of the generic "Cannot load X" — so a
  stale Recents entry or bookmark now reads the tombstone.
- **Proven**: 2 new API tests (deleted vs never-created vs double
  burial) + the DEL-J1 walk's J1.4 step asserts the tombstone in the
  browser. Full server suite 112 files / 629 green; evidence CSV rows
  DEL-R9 and Q2 stamped 2026-08-05.
- **Gotcha:** feather-testing-postgres's `TestApiError.message`
  prefixes `404 NotFoundError:` — anchor assertions with `$`, never `^`.

Same day, the arbiter ruled on the remaining questions: **Q1** — the
counted confirm dialog is ratified as the confirmation rule; typed-name
confirmation declined. **Q3** — no archive/inactive tier; hard delete
stands, reconsidered (as its own capability) at first deployment.
Spec 0003 now has **zero open questions**; every evidence row is
`proven` except H1 (open by design until first deployment).

Next: unchanged — feature #2 of the journey-spec gate (IMP-R12 or
IMP-R13).

## 2026-08-04 — Table deletion (#118): spec 0003, first journey-spec trial

Spec-first, per the framework: `docs/specs/0003-table-deletion.md` +
`docs/specs/evidence/table-deletion.csv` were authored and committed
BEFORE any code, then built, then every row stamped `proven` at its
intended tier the same day. The spec survived the build with zero rule
changes; its retrospective section records where the format chafed
(the trial's whole point — read it before feature #2 of the gate).

- **Server** — `deleteTable()` (doctype-engine.ts) +
  `DELETE /api/doctype/:name` (System Manager). One transaction:
  table_def row, column_def rows, physical table + rows, this table's
  child *rows* (child Table definition stays). Schema references from
  other Tables block, naming `Y.column` (DOC-006 one level up);
  self-references don't; `system` tables refuse. The **sidecar sweep is
  metadata-derived**: every column anywhere declared `Reference → Table`
  has its matching rows deleted (Permission, Import Log, File registry,
  home-page links, …) — no hand list; plain-text mentions (Access Log)
  deliberately survive, and the deletion writes its own `delete_table`
  Access Log line. Bound Tables shed only the binding (BV1); series
  counters untouched (IMP-R6); attachment bytes unlinked post-commit.
  12 tests in `test/table-deletion.test.ts`, titles quoting DEL-* IDs.
- **Web** — generic `Delete Table` button in ListView's manager row
  (hidden for `system` tables, zero per-table code); the confirmation
  is a real dialog carrying the **live row count**; on success the
  table's queries are dropped (not refetched — no 404 noise) and the
  user lands on All tables. Verified by hand in the browser first.
- **E2E hermeticity (the reason this feature won the decision)** —
  `e2e/table-deletion.spec.ts` walks DEL-J1 (incl. cancel branch and
  the system-table affordance absence) and DEL-J2 (refusal names the
  blocker in the dialog; unblock; retry succeeds). The four create-path
  import specs now **pre-clean via `e2e/cleanup.ts` instead of
  self-skipping** — all 7 ran their real create paths green on a used
  DB. `IMP-J1` flipped to *proven* in the import evidence CSV; #91's
  drift complaint is closed. Full server suite: 112 files green.
- **Gotchas:** ValidationError maps to HTTP **417** (Frappe legacy) —
  test expectations, not 400. The DSL's text-addressed `clickButton`
  is ambiguous when a dialog's "Delete" sits under the page's "Delete
  Table" — confirm clicks need a test-id `step()` (retrospective #6).
- **Open questions for the arbiter (spec 0003):** Q1 typed-name
  confirmation; Q2 tombstone messaging for stale Recents/deep links
  (owner-raised mid-build); Q3 archive/inactive semantics as a
  separate capability.

Next: feature #2 of the journey-spec gate — IMP-R12 (upsert re-import)
or IMP-R13 (import undo), both already decided and spec'd as rules.
Ask the owner to add a `harness/features.json` entry for table deletion.

## 2026-08-04 — Owner decisions: four questions graduated into rules

The arbiter ruled on the framework's open decisions (all four
recommendations accepted): **hermeticity → table deletion becomes a
product capability**; **Q2+Q4 → IMP-R12** (re-import is an upsert on a
user-mapped key column, which may map the row identifier); **Q5 →
IMP-R13** (Import Log records inserted row ids; one-click reverse);
**Q1 → IMP-R11** (a header-only file creates the empty Table, logged
with 0 inserted). Per the change protocol the questions are removed,
the answers live as rules (spec'd, not yet built), H1 carries its
resolution path, and the evidence CSV rows are stamped 2026-08-04.
Only Q3 (error volume) remains open.

Next: build table deletion first — it unblocks journey hermeticity,
supports R13's recovery story, and is the smallest of the three. Then
R12/R13 as their own journey-spec'd features. Q3 waits for real usage.

## 2026-08-04 — checklists sample app + generic Checklist view

A second flagship sample app beside helpdesk, and the fifth alternate view
beside Kanban/Calendar/Gantt — built for a real consumer (Rama's store team
leaders run daily section checklists on their phones and photograph fast
movers for buyers), shipped as generic framework surface.

- **`sample-apps/checklists.ts`** — a reusable **Checklist Template** (the
  standard, defined once; items sub-table with `must_do` / `photo_proof`
  flags) instantiated as **Checklist Runs**. A `before_validate` hook
  SNAPSHOTS the template's items into a new run — later template edits
  never rewrite what was ticked yesterday. Ticks stamp/clear `done_at` and
  derive `progress` ("5/8"); a `validate` hook gates `run_status →
  Submitted` on must-do items, where a per-item note is an accepted excuse
  (the gate reads child rows from the DB when the payload is status-only).
  Roles: Team Leader works own runs (`own_rows_only`); Store Manager
  defines templates and sees all. One fixture template ships (a retail
  section-opening list); demo runs live in `scripts/seed-checklists.ts`
  (`pnpm --filter server seed:checklists`).
- **Framework fix the hook needed**: `saveDoc` picked Sub-table arrays off
  the raw payload BEFORE the hook chain, so a hook that added or replaced
  child rows on `ctx.row` was silently ignored despite the "hooks may
  mutate ctx.row" contract. Both save paths now re-pick children from the
  hooked row; an absent key still means "children untouched" (the physical
  row spread into ctx.row carries no Sub-table columns). Pinned in
  `children.test.ts`.
- **`ChecklistView`** (`/admin/$doctype/view/checklist?run=…`) — binds any
  Table with checklist shape (a Sub-table column whose row table has a
  Check column) from metadata alone: date-grouped run cards with progress
  bars, then a tap-first run pane — whole-row ≥44px targets, one save_doc
  per tick (server derives stamps/progress), MUST-DO badges, `+ note`
  excuses, and per-item `photo_proof` camera chips
  (`capture="environment"` → `/api/upload_file` bound to the CHILD row,
  thumbnails inline). The footer advances the parent's Choice column to
  its next declared value and surfaces the 417 gate message verbatim.
  ListView's switcher shows Checklist only when the shape is present
  (child-meta-aware `ChecklistSwitch`, same conditional pattern as
  Kanban's Choice check).

Verified: server 604→609 tests green including the 5-case
`checklists-app.test.ts` round trip (snapshot immutability, done_at
stamp/clear, DB-read submit gate, TL/SM scoping) and the hook-adds-children
regression; full e2e 103 passed (new `checklist.spec.ts`: list → run →
tick → gate refusal → submit; camera upload → thumbnail; 375px usability
with no horizontal overflow); both typechecks clean; browser walkthrough at
desktop and mobile width against seeded demo runs.

Gotchas: (1) list `order_by` takes ONE column — a two-column order 417s and
the view rendered empty until recency sorting moved client-side. (2) child
`Datetime` values must be ISO strings — a hook stamping `new Date()` fails
the child zod schema. (3) On Node 26 the web unit suite needs
`NODE_OPTIONS=--localstorage-file=…`: Node's own unbacked `localStorage`
shadows jsdom's (repo tooling pins Node 22, where this doesn't arise).
(4) The dirty-dev-DB skip guard from the helpdesk round trip applies to any
suite that installs a registered app by name — the checklist e2e commits an
install into the dev database.

Next: a "start run from template" affordance cheaper than the generic new
form (template picker in the view), and per-item photo REQUIREMENT
enforcement (photo_proof currently invites, never blocks).

## 2026-08-03 — Requirements framework v2 + first DSL journey spec (IMP-J1)

Two threads, one session: the requirements framework became a synthesis
(`docs/design/requirements-framework.md` — journeys/rules/shapes, merged
from the v1 draft, an external review, and feather-spec; plus §12: the
product manual as a generated view, exemplar in `docs/manual/`), and its
first practical test landed — `feather-testing-core@0.2.0` adopted as the
e2e vocabulary.

- **Adopted the DSL** (`apps/web/e2e/fixtures.ts`): `test` from
  `feather-testing-core/playwright` plus a composable `signIn`. New journey
  specs import from here, not `@playwright/test`.
- **First journey spec** — `apps/web/e2e/import-journey.spec.ts` walks
  IMP-J1 (first import creates a typed Table) against the wizard using the
  framework's zones.csv fixture (`e2e/fixtures/zones.csv` + claims file).
  Verified end-to-end against the running app: full walk green through
  meta/count, Import Log entry confirmed via API, re-run skips cleanly.
- **Findings, exactly as the framework predicted:** (1) `fillIn` refused
  the login form's unassociated labels → `Login.tsx` gained
  `htmlFor`/`id` (accessibility dividend); (2) **#114** — the wizard's
  rename doesn't re-derive the row-id series (ids stayed `ZONES-###`
  after renaming to Journey Zones); pinned in the spec as a polarity-
  tagged gap assertion; (3) hermeticity live: the fixture's headers
  auto-matched the leftover `Zones` Table, so the spec branches — golden
  J1.3 on a fresh DB, R7's auto-match notice + retarget on a used one.
- **Gotcha:** `assertPath` in the DSL compares exact pathnames — the
  post-login route is `/admin/home/home` (home recall), not `/admin`;
  `signIn` asserts the admin shell instead.

Same day, adoption item 6 landed too:
`apps/server/test/import-properties.test.ts` (fast-check) — 11 spec-true
properties over `sanitizeHeaders`/`sanitizeColumnName`/`inferColumnType`
(length preserved, valid non-reserved identifiers, distinct below the
truncation boundary, total, order-independent, decimal-forbids-Int,
Check-before-Choice, Text past 140 chars), with the three executed defects
pinned as `it.fails` against #110–#112 — each fix flips its pin, forcing
the flip-to-`it` in the same change. Gotcha: fast-check v4 dropped
`fullUnicodeString`; use `fc.string({ unit: 'grapheme' })`.

And the rest of the "Next" tier landed the same day:

- **Invariants layer** (`apps/server/test/import-invariants.test.ts`):
  IMP-I1 reconciliation proven through the real coerceRows → :import
  pipeline; its row-number half confirmed as **defect #115** and pinned
  (a blank row shifts every later error onto an innocent spreadsheet
  row — coerceRows filters blanks silently while the wizard displays
  `index + 2`). IMP-I2 **reframed with evidence**: the log schema's
  `part`/`parts` columns show per-chunk rows are design intent, so the
  invariant is "one row per part, all parts present, sums equal the run"
  — proven with a 3-part chunked run. IMP-I3 proven including the
  no-series-burn half (a rehearsal doesn't advance the id counter).
- **ADR 0008** — every inference threshold is a named, exported bet:
  hoisted `COLUMN_NAME_MAX`, `INT_SAFE_DIGITS`, `LONG_TEXT_CHARS`,
  `CHOICE_*`, `AUTO_MATCH_*` in shared/import.ts; named `IMPORT_CHUNK`,
  `SUGGEST_*`, `ERRORS_ON_SCREEN`, `LOG_ERROR_SAMPLE` where they live.
  Behaviour-preserving: 93 import tests green, both typechecks clean,
  wizard e2e still passes.
- **Agent protocol** into CLAUDE.md: never touch an assertion and the
  code under test in one change; a discovered behaviour is not a
  requirement.
- **Hermeticity (adoption item 9)** written up as a decision brief in the
  framework doc — recommendation: table deletion as a product capability;
  awaiting the owner's call. Until then create-path journeys stay
  conditionally proven.

External review round 2 adjudicated (adopt-the-useful, drop-the-bloat):
**adopted** — discrepancy-classification replaces "code is truth"; example
disagreements block for the owner instead of auto-winning; shapes softened
to primary verification strategies; pins doctrine tightened (spec in the
assertion, expected-failing; the e2e #114 pin weakened to a neutral shape
assertion + known-gap, per the doctrine); CLAUDE.md rule narrowed to
anti-expectation-laundering; grep linkage renamed static traceability;
mutation testing scoped, never a headline; judgement split into
conformance/fitness oracles; closure sweep added; four worked-example
inconsistencies fixed (R2/R3 contradiction, J1.6 branch scoping, H2 split
into H2+H3, C1 split into per-call proven vs cross-chunk reported).
**dropped as low-ROI** — the 3-file split (deferred to feature #2),
behaviour/quality/constraint normative types, atomic ID renumbering, the
11-state evidence vocabulary, dissolving ADR 0008.

The matrix moved to its canonical CSV
(`docs/design/evidence/spreadsheet-import.csv`) and the framework is now a
project-local skill (`.claude/skills/journey-spec/` — SKILL.md + spec
template + evidence schema). Format decision: markdown for narrative, CSV
for the evidence layer (the exact shape that later lands as Featherbase
rows — dog-fooding), HTML only ever as a generated view.

Next: the owner's calls — hermeticity (item 9) and the open questions
Q1–Q5 (the wrong-table trap H1 is the highest-stakes cluster); then the
judgement-rule corpus and mutation score, only if the earlier layers keep
earning it.

## 2026-08-02 — NAV-002: server-side relationship joins ('related' filter)

The follow-up noted on #100/#102: the join between Explore panes (and behind
Connections via-links) moved from browser-side name shuttling into the
database.

- **`'related'` filter operator** (`query.ts`): the one relationship-shaped
  filter the list language understands — `[col, 'related', {table, via?,
  column?, filters?}]` compiles to IN/EXISTS subqueries. Three shapes,
  exactly the relationships the metadata models: Reference column →
  target; `'parent'` → owning row (sub-table rows); `'name'` + `via` →
  rows CONTAINING a sub-table row pointing at the target ("which POs
  contain this Item"). `filters` recurses (a pane chain is a related filter
  inside a related filter), capped at 3 levels. **Every hop runs through
  the target table's own scopedWhere** — read permission, own_rows, Data
  Scopes — so a related filter can never surface the effect of rows the
  caller cannot read (tested: Data-Scoped hop, unreadable target 403s).
  Implementation note: postgres-client fragments are thenables, so the
  now-async filter compiler passes them boxed in `{frag}` — awaiting a
  fragment would EXECUTE it.
- **`GET /api/table/:t:aggregate?filters&sum=col`** — scoped `{count, sum}`
  over the same filter language, so pane footers show true totals.
- **`:connections` via-links** now return a compact related filter instead
  of up to 500 owner names — nothing to disclose, no cap (501-owner test
  now asserts the filter matches all 501), URLs short and never stale.
  `relatedOwners()` deleted.
- **Explore** chains panes with related filters: no name fetching, no
  100-row ceiling, the "Selection needed" truncation notice is GONE
  (panes are exact at any scale), Σ/count come from `:aggregate`, and
  **via-sub-table hops are real steps** ("Purchase Order · via PO Line"
  from an Item root). ListView filter chips render related specs readably.
- **Root-cause fix while verifying**: TanStack Router's default search
  stringifier writes spaces as `+` but its parser does not decode `+`
  back — any search value with a space round-tripped corrupted (first hit:
  a via spec naming "PO Line"; latent for text filters too). `main.tsx`
  now wraps `defaultStringifySearch`, rewriting `+` → `%20` (a literal
  `+` is emitted as `%2B`, so the rewrite is exact). Verified in-browser
  with a value containing both a space and a literal `+`.

Verified: `related-filter.test.ts` (8 tests: three shapes, 2-deep nesting,
per-hop scoping, 403 on unreadable target, malformed specs, depth cap,
aggregate), connections tests rewritten to EVALUATE returned filters
per-user through the list API; browser: 123-supplier chain exact with no
selection, Σ 116,080 true total, Item → PO via-hop narrows to 3 on
selection, connection click lands a readable related-filter URL. Full
`pnpm test` green (server 100 files / 519 tests, web 12), smoke green,
both typechecks clean, prior pattern + review-fix browser runs still pass.

Next: the remaining #100 follow-up is per-table curation of related tabs
(order/visibility) once real usage shows which hubs need it.

**Review fixes (same PR #106):** (1) The '+' search-corruption diagnosis was
re-verified after the reviewer showed the isolated codec round-trips
correctly: A/B in the real browser reproduces the corruption without the
patch and exactness with it, on the pinned versions — the served bundle
contains the correct URLSearchParams decode, so the loss is in the router's
runtime navigation path, mechanism unidentified. main.tsx's comment now
states exactly that (no internals claims), and `search-stringify.test.ts`
pins the safety condition (literal '+' emits as %2B) plus full round-trips.
(2) DoS breadth: MAX_RELATED_HOPS = 16 caps TOTAL related specs per
request, not just depth. (3) `:aggregate` sum must name an Int/Float/
Currency column (417, was a Postgres 500) and returns the sum as an EXACT
string — numeric(21,9) money never passes through float64; the client
formats. (4) Non-array `filters` JSON is a 417 at the scopedWhere
chokepoint (was a 500; also covers `:count`). (5) A lone `column` or lone
`via` in a related spec is rejected instead of silently ignored. (6) The
via-EXISTS alias is depth-indexed (`v0`,`v1`…) so repeated-table nesting is
correct by construction. (7) `filterValueLabel` exported + unit-tested;
the web OPS list documents WHY 'related' is absent from the FilterBar.

**Second review round (same PR #106):** (1) `parentfield` — one row table
can back SEVERAL Sub-table columns (sales_lines + return_lines → Order
Line), and relationship paths must tell them apart: Explore child steps
now carry the Sub-table COLUMN (distinct picker options, distinct keys)
and filter `parentfield = <column>`; the via shape takes an optional
`parentfield` in the spec (validated against metadata), with omitted =
any-field — the right default for Connections' "is this row referenced at
all" counts. Regression test builds exactly the two-columns-one-row-table
world. (2) Removing a root chip now clears the pane-2 selection the same
way a root row click does — a stale sel2 could otherwise keep driving
pane 3 after its row vanished from view. (3) The reviewer's aggregate
500s (sum=Data/position, filters=null) were already fixed by the previous
round's summable-type + non-array guards; their exact shapes are now
pinned as tests.

## Visual identity (standing directive for all UI work)

The Admin is reskinned to look like Frappe. Every new UI feature MUST inherit
this look — do not introduce ad-hoc colors/spacing:
- Design tokens live in `apps/web/src/index.css` (`@theme`): canvas
  `#f4f5f6`, brand `#2490ef` (Frappe blue), ink `#1c2126`, hairline borders
  `#ebeef0`/`#d1d8dd`, Inter (self-hosted via `@fontsource-variable/inter`,
  NO network fonts — offline is a hard requirement for the test browser).
- Reuse the shared component classes: `.fc-card`, `.fc-input`, `.fc-btn`,
  `.fc-btn-primary`, `.fc-label`, `.fc-pill`. Prefer these over raw Tailwind.
- Shell (navbar + workspace sidebar + awesomebar + avatar) is in
  `AdminLayout.tsx`; new pages render inside its `<Outlet/>` canvas.
- Since UI-025 the tokens come in four palettes (`classic`/`ivory`/
  `graphite`/`indigo`), selected per user. New UI must keep reading the
  CSS variables and `.fc-*` classes — never a literal color — so it works
  under every palette × light/dark combination automatically.

## 2026-08-02 — Amp orb lifecycle setup

Fresh Amp orbs now bootstrap through executable `.agents/setup`: it installs
Node 22 and the repository-pinned pnpm, system/Postgres prerequisites, locked
workspace dependencies, a Playwright Chromium bundle, provisions and tunes the
default local database for ephemeral test speed, and applies migrations and
patches. `.agents/resume` performs only a fast database health/repair check on
wake and respects an externally supplied `DATABASE_URL`.

Verified in a clean orb from Node 20 with no Postgres or Chromium: setup
completed, a second run converged with all 62 migrations and the patch already
current, a clean non-interactive login shell resolved Node 22.18.0 / pnpm
10.33.0 / psql / Chromium, healthy resume took 0.11s, and resume restarted a
stopped Postgres cluster in 2.35s. `./init.sh` then passed server smoke and both
Playwright smoke checks.

## 2026-08-02 — PR #104 review round: seven findings fixed

All findings from the owner's review of the recent-actions branch:

- **Queue attribution (P1).** The client's debounced event queue is now
  owner-tagged and fail-closed: a flush only ships events whose owner IS
  the session the sink authenticates as; everything else is discarded,
  never re-attributed. Logout drains the departing user's queue first,
  while their credentials still exist. 3 new unit tests.
- **Storage vs contract (P1).** `user_event`'s key/label/sub_label/path
  were `Data` (varchar 140) while the API accepts 400/1000 chars — one
  long filtered-list key failed its whole batch. 0064 rewritten to
  'Long Text' for fresh installs; 0066 converges existing databases
  (alter to text + column_def update + `occurred_at` index). New test
  writes at the contract limits.
- **Saved-view permission bypass (P1).** list/create now
  `assertPermission(user, table, 'read')`; sharing re-checks it. New
  test: 403 without read, opens after a Permission row grants it.
- **Dependency pin (P1).** The earlier `git+https` change never changed
  the transport — pnpm resolves GitHub git URLs to the codeload tarball
  either way, and the lockfile said so. package.jsons + lockfile
  restored to main's `github:` pin; the real remote-exec requirement is
  attaching the feather-testing-postgres repo to the session proxy
  (frozen install verified here).
- **Dead feed channel (P2).** `canSubscribe` never allowed 'feed', so
  the live ping reached nobody. Now: 'feed' is System Manager-only and
  payload-free (`changed`); each `POST /api/events` pings the poster's
  own `user:` channel (`feed_mine`) for the Mine tab. ActivityFeed
  subscribes accordingly.
- **OAuth beacons (P2).** The Google OAuth callback now sets the `sid`
  cookie — without it, an OAuth user's unload-time beacon batch was
  silently rejected.
- **Dormant-user retention (P2).** The write-path prune is global (any
  batch expires ANY user's >90-day rows), backed by the new
  `occurred_at` index. Test covers a dormant user's rows.

Verified: affected server suites 23/23, recents unit 15/15, all 12
#101-related e2e + palette green, both typechecks clean, full web e2e
re-run green (see below), `pnpm install --frozen-lockfile` passes.

## 2026-08-02 — Relational navigation MERGED (PR #102 → main)

PR #102 merged to `main` as `ec8dd61` with all four review findings fixed
(see the "Review fixes" block in the entry below). Issue #100 stays open as
the standing design reference for relational navigation. Noted follow-ups
remain: per-table curation of related tabs, and a server-side join surface
so Explore can chain via-sub-table backlinks past the client-side cap.

## 2026-08-01 — #101 Phases 2–6 complete: recent actions shipped end to end

All six phases of [#101](https://github.com/siraj-samsudeen/featherbase/issues/101)
are now built (Phase 1 below). One commit per phase on this branch.

- **Phase 2 — more recall surfaces.** Sidebar gains Recent (5 destinations)
  + Frequent (frecency top 3) groups; ListView gains a strip of this
  table's recent rows and filter sets. Same localStorage buffer as ⌘K.
- **Phase 3 — server truth.** Migration 0064 adds the `User Event` system
  table (append-only via direct insert like `audit.ts`; no role
  permissions — reads only flow through caller-scoped endpoints).
  `POST /api/events` takes client batches (≤50, timestamps clamped to a
  7-day trust window, 90-day retention pruned on the write path);
  `GET /api/events/summary` returns per-key aggregates that the client
  unions into its buffer at sign-in → cross-device recents. Client
  flushes on a 3s debounce; `sendBeacon` (cookie-auth) carries the final
  batch through unload.
- **Phase 4 — homepage feed.** `GET /api/activity_feed`: `mine` = own raw
  trail; `team` = Version rows + logins ONLY (reads never surface),
  System Manager-gated. Feed card on every Home Page, live via a new
  websocket `feed` ping in `publishDocEvent`, 30s refetch fallback.
- **Phase 5 — resuming.** ResumeStrip (last row / view / search tiles;
  the search tile refills the command bar via a `fc:prefill-search`
  event). `GET /api/routine_suggestion` detects destinations opened on
  ≥5 distinct days in 14 (lists/pages only, ≥2 targets); RoutineCard
  pins them as a per-user workspace chip row.
- **Phase 6 — saved views.** Migration 0065 adds `Saved View` (owner +
  jsonb filters + shared flag; owner-scoped `/api/saved_views` CRUD,
  sharing opens read-only). ListView Views bar with share/delete on own
  chips; the nudge fires when one filter set is applied 3× in a week
  (re-mounts within 500ms deduped — StrictMode double-fires effects).

Verified end-to-end: **web e2e 96 passed / 0 failed / 6 skipped** (skips
are all "already exists in this dev DB" guards), **server 519 passed**,
**web unit 24 passed**, both typechecks clean. 15 new server vitest
cases, 9 new e2e tests across recents/activity-feed/home-recall/
saved-views specs.

Gotchas (beyond the 07-31 entry's): (1) storing pre-stringified JSON into
a jsonb column double-encodes — use `sql.json(...)`. (2) The e2e suite
itself now generates user_event rows (beacons + batches), so specs must
never assume "newest" without making the data in-test; both feed specs
were hardened accordingly. (3) `ticketing.spec.ts` re-installs helpdesk
every run — uninstall via `POST /api/uninstall_app {"name":"helpdesk"}`
before running the server suite, or its app-fixtures test fails.

Next: owner review of the whole #101 branch. Candidate follow-ups:
frecency-boosted ranking inside `/api/search` itself, a modal ⌘K overlay
(the dropdown was kept deliberately — "under the search" was the ask),
edit-weighted frecency, and Team-feed pagination.

## 2026-07-31 — #101 Phase 1: the command bar remembers recent actions

Issue [#101](https://github.com/siraj-samsudeen/featherbase/issues/101) is the
owner's "system remembers where I've been" capability; the design reference
(interactive exploration of six patterns + brainstorm) lives in
`docs/design/recent-actions/`. This session shipped Phase 1 of six:

- **`apps/web/src/lib/recents.ts`** — per-user localStorage ring buffer
  (80 entries × 10 visits, dedup by key). Records rows, lists (with their
  filter sets — the JSON `?filters=` param is part of the identity), list
  view modes, reports/dashboards, and submitted searches. Home Pages,
  builders and `/new` forms deliberately excluded. Ranking helpers:
  recency, Firefox-style bucketed **frecency** (<4d→100 … older→10, 2+
  visits required), prefix-matched past searches.
- **AdminLayout**: a `useRouterState` hook records every admin navigation;
  the awesomebar's *empty focused state* now shows **Recent** and
  **Frequent** groups (ArrowUp/Down + Enter to replay, Esc closes), and
  typing offers matching past searches (`↻` rows refill the bar).
- **Security fix found by this work**: SPA logout dropped the bearer token
  but never expired the HttpOnly `sid` cookie, so token-less requests after
  logout re-authenticated as the departed user (observed: a post-logout
  whoami refetch poisoning the cache with user A's palette for user B —
  the exact UI-025 leak). Fixed with a public `POST /api/logout` (expires
  the cookie; SPA awaits it before clearing state), cache clear moved to
  after `/login` renders, `useWhoAmI` gated on a session existing, and no
  hard 401-redirect when already on `/login`.
- **Env fix**: `feather-testing-postgres` pin switched from `github:` (a
  codeload tarball the remote-exec proxy 403s) to `git+https` — same
  commit, git transport, works everywhere. Keep this form when moving back
  to `^0.2.0`.

Verified: 12 vitest cases (`test/recents.test.tsx`), new `recents.spec.ts`
e2e (trail building, click + keyboard replay, filter round-trip, search
recall), server auth suite incl. new cookie-expiry case. Full regression:
web e2e 89 passed / 6 skipped / 0 failed, server 505 tests green, web unit
24 green, both typechecks clean.

Gotchas: (1) in this container set `CHROMIUM_PATH=/opt/pw-browsers/chromium`
for Playwright — the project pins a newer bundled build that isn't
installed. (2) `ticketing.spec.ts` installs the helpdesk app into the dev DB
and leaves it; the server `app-fixtures` "fresh deployment" test then fails
until `POST /api/uninstall_app {"name":"helpdesk"}` — did that here. (3) Do
not run the vitest suites while the Playwright suite runs: the vitest
globalSetup empties `background_job` mid-e2e.

Next: #101 Phase 2 — sidebar Recent group + per-table recents strip over the
same local store; then the `user_event` server log (Phase 3).
## 2026-07-31 — Relational navigation: all six patterns from issue #100

The design exploration in `docs/design/explorations/relational-navigation.*`
(issue #100) is now implemented — six ways to move between related rows, all
derived from Table metadata with zero per-table configuration:

- **Server (NAV-001)** — `getBacklinks()` in `meta.ts`: the reverse-reference
  map (every Reference column targeting a table, with sub-table references
  resolved to their OWNING tables, Frappe's "internal links" shape), cached
  whole and invalidated with the meta cache. Two generated-layer actions:
  `GET /api/table/:t/:name:connections` (per-row, permission-scoped counts +
  ready-to-use ListView `filters` arrays; via-links get a `name in [...]`
  filter over owning rows, capped at 500) and `GET /api/table/:t:backlinks`
  (table-level shape, no counts). `test/connections.test.ts` covers direct,
  via-sub-table, zero-count, and 404 cases.
- **Pattern 1, Connections panel** — `ConnectionsPanel.tsx` in the FormView
  sidebar: each backlink group with a live count, linking to
  `/admin/$table?filters=…`; ◎ peeks; + opens a pre-filled new row via the
  new `?prefill=<json>` search param on the form route (FormView seeds
  `values`, not `baseline`, so a pure-prefill save stays possible).
  `LinkControl` finally links out: ◎ peek + ↗ open on any set Reference.
- **Pattern 2, counters + related tabs** — `RelatedTabs` under the form:
  count tiles double as tabs over an embedded read-only list (8 rows) with
  "Open as filtered list ↗" and pre-filled "+ New" escapes.
- **Pattern 3, peek stack** — `Peek.tsx`: `PeekProvider` (mounted in
  `AdminLayout`) + stacked read-only slide-over panels for any record/list.
  References and connection rows inside a panel push deeper; ← pops, Esc/✕
  close all, ↗ commits to real navigation; any route change clears the stack.
- **Pattern 5, expandable rows** — ListView rows of tables with Sub-table
  columns get a chevron; expansion renders the child rows inline (read-only,
  Σ over Currency columns), several rows at once.
- **Pattern 4, cross-filter Explore** — `/admin/explore` (sidebar entry):
  chain up to three panes over direct backlinks and child sub-tables;
  clicking rows IS the filter (in-filters downstream), chips release,
  footers aggregate (Σ prefers Currency > Float > Int). Via-sub-table
  backlinks are deliberately not offered as chain steps (their filter is
  per-row, not per-column).
- **Pattern 6, relation map** — `/admin/map/$doctype/$name` ("Map" button on
  every form): SVG neighborhood — forward references left, child tables +
  backlink collections right (dashed, with counts); collections open their
  rows below; any record click re-centers with a `?trail=` breadcrumb.

Verified end-to-end: demo dataset (Supplier ← Purchase Order ▸ PO Line →
Item; Employee ← Attendance/Payroll Slip, `reports_to` self-reference)
created through the real metadata + save_doc APIs — the seed script is
committed as `tools/seed-relational-demo.mjs` (idempotent-ish: rerun skips
existing tables) — then a 13-check Playwright script exercised every
pattern in the browser (counts, chips, URL filters, peek stack depth 3,
Esc, two rows expanded at once, Acme → 3 POs cross-filter, map hop with
trail). `pnpm test` fully green (server 99 files / 507 tests, web 12),
`pnpm smoke` green, both typechecks clean.

Gotchas for future sessions:
- Adding a search param to a TanStack route makes `search` REQUIRED at
  every `<Link>`/`navigate` to it — the `?prefill=` addition touched ~15
  call sites (`search={{ prefill: undefined }}`). Budget for that when
  adding params to shared routes.
- `column_def` names like `status`/`parent` are reserved (STANDARD_COLUMNS)
  — the demo tables use `att_status`/`slip_state`/`stage` instead.
- In this container, Playwright needs `CHROMIUM_PATH=/opt/pw-browsers/chromium`.

Next: consider per-table metadata to curate related tabs (order/visibility)
once real usage shows which hubs need it; an Explore pane for via-sub-table
backlinks would need a small server join surface (`name in (select parent …)`).

**Review fixes (same PR, #102):** (1) via-sub-table connections now derive
BOTH owner names and count from one permission-scoped EXISTS query
(`relatedOwners` in `query.ts`) — a caller can no longer learn names of
parent rows they cannot read, the count matches their scoped list, and the
500-name cap is deterministic (ordered by name); covered by own_rows, Data
Scope, and 501-owner tests. (2) Prefill now seeds the form's INITIAL state
(no race with client-script `onload`) and the form route keys on the
prefill string, so switching/clearing `?prefill=` remounts instead of
retaining stale values. (3) An Explore pane whose upstream name set is
truncated (>100 rows, no selection) renders a "Selection needed" notice
instead of a silently-incomplete subset — grandparent truncation propagates
— and Σ labels say "(shown rows)" when partial. (4) Explore's root picker
uses new `GET /api/navigable_tables` (kind='table' filtered by each table's
own read permission), not a read of the metadata `Table` table.

## 2026-07-31 — UI-025: user-selectable color palettes (second theming axis)

The Desk now ships four palettes — **Classic** (the original Frappe blue),
**Ivory** (warm paper + clay, Anthropic-inspired), **Graphite** (pure
neutrals + near-black primary buttons, Frappe-v15-inspired), and **Indigo**
(indigo + pill controls, Glide-inspired) — chosen from a navbar select,
orthogonal to light/dark. Every combination (4 × 2) works.

Mechanics mirror UI-024 dark mode exactly, one axis over:
- **CSS** (`apps/web/src/index.css`): each palette is a `[data-palette=…]`
  token override block with a `[data-palette=…][data-theme='dark']`
  companion (2 attributes out-specifies the generic dark block). `classic`
  is the absence of the attribute. Three structural tokens were promoted so
  palettes can reshape controls with zero component edits: `--radius-card`,
  `--radius-control` (Indigo's pills), and a
  `--color-primary-btn`/`-hover`/`-ink` trio (Graphite's black button,
  which inverts to white in dark). Defaults reproduce Classic exactly.
- **Server**: migration `0062_user_palette.ts` (mirror of `0035_user_theme`)
  adds a `palette` Choice column to User; `whoami` returns it;
  `POST /api/set_palette` validates against the four names (417 otherwise).
- **Web**: `lib/palette.ts` is a line-for-line sibling of `lib/theme.ts`
  (server-authoritative, localStorage mirror applied at module load so
  there's no flash); `DeskLayout` grows a `palette-select` beside the
  theme toggle.

Verified end-to-end: HTTP (`set_palette` persists, `whoami` round-trips,
bad value 417s) and in the real browser via the preview pane — logged in,
switched all four palettes in both modes on the ToDo list view, confirmed
computed styles (`--color-primary-btn` resolves per palette), reloaded to
prove persistence with no flash. `e2e/palette.spec.ts` (new, sibling of
`dark-mode.spec.ts`) covers switch/persist/reload/compose-with-dark/reject.
Both typechecks clean, `pnpm smoke` green.

Design references for the three new palettes (mockups the user picked from)
are archived at the session artifact "Featherbase — three UI directions".

**Review fixes (same day, PR #92):** (1) The navbar's controls don't wrap,
so the new select overflowed 390px viewports — the language + palette
selects are now `hidden md:block` and live in the account menu below md
(`palette-select-mobile`); `responsive.spec.ts` passes again. (2)
Cross-user leak: logout only removed the token, so the next account in the
same tab inherited a still-fresh `['whoami']` cache (5-min staleTime) and
the previous user's global `fc_theme`/`fc_palette` mirrors. `logout()` now
calls `queryClient.clear()` and un-stamps `data-theme`/`data-palette`, and
both mirrors are scoped per user (`fc_palette:<name>`). Deferred as issues:
#96 (serialize preference writes / handle failures), #97 (WCAG AA role
tokens — `--color-link`, `--color-on-brand`, status text).

**Next:** Ivory was designed with serif page titles (self-hosted Source
Serif via a `--font-display` token) — deferred to keep this change
token-only. Also consider: palette-aware record avatars (deterministic
hash→hue) from the Indigo mockup.

## 2026-07-31 — the "Frappe Clone" brand string is gone, and the product has a mark

The July 2026 rename to Featherbase left the *displayed* name behind: the
navbar, the login header, the browser tab, the System Settings `app_name`
default (server and web), the test-email subject, the `public_info` guest
method, and the feature board all still said "Frappe Clone".

- **Every user-visible occurrence is now "Featherbase"** —
  `apps/web/index.html`, `AdminLayout.tsx`, `Login.tsx`,
  `apps/web/src/lib/settings.ts`, `apps/server/src/settings.ts`,
  `apps/server/src/email.ts`, `apps/server/src/methods/_test_guest.ts`,
  `apps/server/migrations/0024_singles.ts`, `harness/render-features.mjs`,
  and the `methods.test.ts` assertion that pins `public_info`.
- **`0064_rename_app_name.sql` converges existing local databases.** Editing
  the 0024 seed only helps a database built from scratch — 0024 returns early
  when `System Settings` already exists. The migration rewrites the
  `column_def` default and any `single_value` row, *only* where the value is
  still the untouched `'Frappe Clone'`, so an owner-customised `app_name`
  survives. Verified against the dev database: the seeded default flipped, the
  locally-customised value was left alone.
- **What deliberately still says it.** `PROGRESS.md` history, `docs/adr/0006`
  (it records the working name as part of the decision), `site/*.html` dumps of
  those docs, `docs/research/frappe-architecture.md` (there `frappe_clone` is a
  filesystem path to an upstream Frappe checkout), `docs/archive/`, and
  `harness/evaluation/diff-request.sh` plus the `clone.json` it writes — there
  "clone" names an artifact the harness emits, not the product. These are dated
  records or real filenames.
- **The docs sweep found one live offender, not many.** `.claude/agents/evaluator.md`
  called the product "the Frappe clone" in present tense, in an *active* agent
  definition rather than a dated record — now Featherbase (its line 52
  `clone.json` reference was left, being a filename `diff-request.sh` actually
  emits). Everything else in `docs/` that mentions cloning describes the
  project's *history* as a replication of Frappe, which is accurate and stays.
  `CLAUDE.md`'s own claim that the name survived in only two places was stale;
  it now carries the full sanctioned list and the rule that distinguishes a
  dated record from present-tense naming.
- **The mark.** `apps/web/src/components/Logo.tsx` replaces the "F" letter tile
  on the navbar and login header; `apps/web/public/favicon.svg` is the same
  art, linked from `index.html` (first use of `apps/web/public/`). It is a
  tilted feather with a single wedge cut out of its vane — the notch is the
  only detail, which is why it survives 16px where barb-by-barb designs mush.
  Drawn as a solid brand tile with the notch and shaft in the tile colour
  rather than punched out, so it needs no transparency and holds on any
  background. Shaft weight is 2.1 deliberately: thinner hairlines vanish at
  16px.
- **How it was chosen** (owner picked from rendered sheets, every candidate
  shown at 16/24/64 plus light and dark wordmark lockups). Ruled out along the
  way: a symmetric leaf that read as a pill; open-stroke and herringbone
  versions that read as a fishbone; a "dissolve" that read as a paintbrush; a
  fanned version that read as a crown. Double-F monograms in calligraphic
  faces were explored and dropped — mirroring two F's back-to-back makes a
  face, not a vane, and "FF" reads as a type-foundry monogram rather than
  Featherbase. Single calligraphic F's (Snell, Zapfino, Chancery, Savoye) were
  also dropped: they are macOS-only system fonts, so shipping one would have
  meant outlining the glyph to paths anyway, and the swashiest faces clipped
  their own tile at 64px.

Verified: `pnpm --filter server migrate` applied 0064; `./init.sh` boots and
both smoke suites pass; web suite 12/12 and both typechecks clean; Playwright
screenshots of `/login` and the `/admin` navbar confirm the mark and wordmark
render. Server suite is 501/504 with one **pre-existing, unrelated** failure —
`app-fixtures.test.ts` "a fresh deployment has zero helpdesk tables" fails
because this dev database has `helpdesk` in `installed_app` from an earlier
session; its sibling test skips for that same reason.

Next: that app-fixtures test asserts a fresh-deployment fact against a
long-lived dev database, so it fails for anyone who has ever installed an app
locally — worth making it state-independent.

## 2026-07-31 — a guard so a sixth missing `E` prefix cannot land (#93 follow-up)

#93 fixed five `.sql` sites that wrote `'basic\nrestricted'` where
`E'basic\nrestricted'` was meant — with `standard_conforming_strings = on` the
plain form stores a backslash and an `n`, so `tableSchemaToZod` (which splits
`choices` on `'\n'`) collapsed the Choice enum to one member and every affected
save failed `417`. Nothing stopped a sixth site. This session added the guard,
not more fixes; #93 landed on `main` independently while this was in progress.

- **Two guards, because neither subsumes the other.** Both live in
  `apps/server/test/choices-newline.test.ts`. *Runtime* asserts no `choices`
  value in the migrated database contains a literal backslash-n, across all
  three places one can live — `column_def`, `custom_field`, and
  `metadata_override` where `property = 'choices'` — so a bad value arriving
  from a `.ts` migration, a patch or the import wizard is caught too, not just
  a `.sql` one. Plus a regression pin asserting `Table.kind` / `Column.tier` /
  `Permission.tier` parse back to their full option sets, which survives a
  truncation that loses options *without* a backslash. *Static*
  (`apps/server/scripts/check-sql-escapes.ts`, also
  `pnpm --filter server lint:sql`) scans the `.sql` sources and fails in the
  diff that introduces the mistake.
- **Why both.** The runtime check is closer to the real failure mode but only
  sees the database it is pointed at: the shared dev database had already had
  `0063` applied by a sibling worktree, so it stayed green while the sources
  were still wrong. The static check is database-independent but covers only
  the one route in. Each caught a situation the other missed during this
  session — that is the argument for keeping both, not belt-and-braces.
- **The scanner is quote-aware, not a grep.** It skips `--` and block comments
  (`0063` explains this very bug in prose, backslash-n and all — a grep flags
  its own comments), tracks multi-line literals, `''` escapes and `do $$ … $$`
  bodies, and reports **only** backslash-n so the legitimate
  `regexp_replace(…, '\s+', …)` literals in `0010`/`0055` stay quiet. An empty
  `ALLOWED` set is the escape hatch if a deliberate raw backslash-n appears.
- **Verified red → green, not just green.** On the pre-#93 source the scanner
  reported exactly the five known sites and nothing else; on the post-#93
  source, zero. Four synthetic offenders — inside a `$$` block, spanning a
  multi-line literal, after a `''`, and after a `--` *inside* a string — were
  caught at the right line numbers. A scratch database migrated from the
  unfixed source failed both runtime checks and named `Table.kind` and
  `Column.tier`. Re-verified after rebasing onto post-#93 `main` (`cc8118b`):
  scanner clean, guard 3/3, full server suite **504 passed, 98 files** on a
  scratch database.
- **Gotcha — rebasing across a renumbered migration resurrects the old
  number.** #93's branch created `0059_fix_literal_newline_choices.sql` and a
  later merge on that branch renumbered it to `0063`. Rebasing this branch
  dropped the merge commits and replayed only the original, so `0059` came
  back — colliding with `main`'s `0059_app_fixtures.ts` while `0063` also sat
  there. It applied without conflict, so nothing announced it; only
  `git diff origin/main..HEAD --stat` showed the stray file. After any rebase
  that crosses a migration rename, diff the migrations directory against
  `main` rather than trusting a clean rebase.
- **Gotcha — `RLS_TEST_URL` guidance in `CLAUDE.md` is stale.** #85 renamed the
  RLS role `desk_client` → `app_client` (`0010_rls.sql` now grants to
  `app_client`, and `rls.test.ts` defaults to it), but `CLAUDE.md`'s Environment
  section still says the suite connects as `desk_client`. Overriding with the
  old name yields four `permission denied for table rls_vault` failures that
  look like an RLS regression and are not. Not fixed here — out of scope for
  this branch.
- **Next:** `harness/features.json` untouched, per instruction. Worth
  considering whether `apps/server/scripts/` should join the server
  `tsconfig.json` `include` (today only `src` is typechecked, so none of the
  four scripts there are); the new scanner typechecks clean standalone under
  the same flags, but the other three were not audited.

## 2026-07-31 — Frappe's "Desk" is retired: `/admin` routes, `app_client` role, `renderApp` helper, and typed filter URLs that work (#84, #86, #87)

"Desk" was Frappe's name for the back-office UI, and the URL prefix was the
last place the term still met users. Frappe itself retired the URL (modern
Frappe serves `/app`); `/admin` says what the surface is without the lore.
GLOSSARY already called it the Admin — the routes had not caught up.

- **Every route moved:** `/desk/...` -> `/admin/...`, including the Home
  Page routes (`/desk/home/$name`), the table list/form routes, the view
  routes (report/kanban/calendar/gantt), and the static segments
  (`new-table`, `import`, `jobs`, `all-tables`, `permissions/$doctype`,
  `dashboard/$name`, `query-report/$name`, `script-report/$name`).
- **No `/desk` redirect, deliberately.** #84 asked for one and it was built
  and tested first; the owner then cut it, and CLAUDE.md gained a
  "Project stage" section recording why: nothing is deployed, there are no
  users, and no URL is consumed outside this repo. A redirect would have
  been compatibility machinery for a migration burden that does not exist,
  and would have kept the retired prefix in the route tree forever for
  every future reader to reason about. `/desk/...` is simply gone — the SPA
  fallback still serves `index.html`, so the client renders its
  not-found rather than the server answering 404.
- **Server touchpoints:** the Frappe-parity login response's
  `home_page` is now `/admin`; the workflow pending-approval mail and the
  SLA escalation notice link to `/admin/<Table>/<row>`. The server's OAuth
  bounce needed no change — it targets `/oauth-callback`, and it is that
  page (plus the login form) that now lands the user on `/admin`.
- **`DeskLayout.tsx` -> `AdminLayout.tsx`** (symbol too), and its two test
  ids `desk-sidebar`/`desk-index-empty` -> `admin-*`. `e2e/desk.spec.ts` ->
  `e2e/admin.spec.ts`. The FormView breadcrumb read **Desk** and now reads
  **Admin** — the one user-facing string carrying the old term.
- **`desk_client` -> `app_client` (#86).** The direct-client login role
  carried the same retired term. 0010_rls.sql is rewritten in place so a
  FRESH database only ever knows `app_client` (0055 and 0060, which also
  name the role in generated policies, plus the runtime DDL in
  `doctype-engine.ts`, follow suit). **0010a_rename_rls_role.sql**
  converges databases that already applied 0010: a plain
  `alter role ... rename to`, because **policies and grants bind by OID,
  not by name** — every `to desk_client` policy follows the rename with
  nothing recreated. The password is re-set explicitly: an MD5-hashed
  password is derived from the role name and is cleared on rename (SCRAM
  hashes survive), so setting it unconditionally makes both cases
  identical.
  **The `0010a` name is load-bearing, and this was a real bug first.**
  The migration originally shipped as `0061`, at the end of the chain.
  `applyRls` grants to `app_client` on every table it creates as soon as
  `fc_has_read()` exists, so a database that stopped between 0010 and 0011
  reached 0011's `createTable` with the role still called `desk_client` and
  died with `42704: role "app_client" does not exist` — never reaching a
  convergence migration numbered at the end. Reproduced, then fixed by
  sorting the file between `0010_rls.sql` and `0011_report.ts`. Caught in
  review; neither suite covers an interrupted migration chain.
  **Roles are cluster-wide, policies are per-database**, and that asymmetry
  shapes the branching: "both roles exist" is ordinary on a developer
  cluster holding one converged database and one legacy one, so the test is
  not which roles exist but whether THIS database still binds anything to
  the old one. Four states — converged (no-op), old-only (rename),
  both-without-local-refs (no-op), and the two genuinely broken ones
  (neither role; both roles with local refs) — and the broken ones
  `raise exception` so the transaction rolls back rather than recording a
  migration over unusable RLS.
  **Heads-up: your existing `featherbase` database gets the rename the next
  time you migrate**; a checkout of an older branch will then look for a
  role that no longer exists.
- **Typed filter URLs actually filter (#87).** `/admin/<Table>?filters=...`
  used to drop the parameter unless the app itself built the link.
  TanStack's default search parser runs `JSON.parse` over every value, so a
  pasted URL delivered `filters` as an Array and `?report=2024` as a
  Number; the `typeof === 'string'` guard then discarded them and stripped
  them from the address bar — quietly breaking the "filters are URL state
  so they are shareable" promise written above that very route. One
  `searchString()` helper coerces back to the string the app expects, and
  it is applied to **every** search param (`filters`, `report`, `group_by`,
  `table`, `format`, `key`, `token`), since the same latent bug bites any
  all-digit value — a reset-password `key` of `12345` parsed to a Number
  and was dropped.
  **`filters` is then shape-validated, which the first cut got wrong.**
  Coercing alone turned a silent drop into a crash: `?filters={}` and
  `?filters=[null]` are valid JSON, so they sailed through to `ListView`,
  which indexes every entry as a `[field, op, value]` triple and threw,
  blanking the page. A URL is user input — `parseFilters()` now validates
  the parsed value and discards anything malformed, as before. Caught in
  review.
- **`renderDesk` -> `renderApp`**, the last of the vocabulary. The name was
  never ours to change here: it is feather-testing-postgres' published API
  (that repo's #1, fixed and merged there — a clean rename, no deprecated
  aliases, since this is the only consumer). `apps/web/test/pg-test.ts` and
  its three test files follow.
  **The dependency now resolves from git, not npm** — the library's rename
  is on `main` but unreleased (npm still serves 0.1.0, which exports
  `renderDesk`). The specifier pins the exact commit
  (`github:siraj-samsudeen/feather-testing-postgres#310ad8e`) rather than
  the bare branch, so a lockfile refresh cannot silently drift onto a later
  `main`. **Swap both `package.json`s back to `^0.2.0` once it publishes** —
  `pnpm install --frozen-lockfile` (what CI runs) is reproducible either
  way, but the registry is the intended source per the Stack section above.
- **Left alone on purpose:** the Frappe design-lineage comments in
  `index.css` and `ListView.tsx` that credit the Desk *look*.

Because a role rename is **cluster-wide**, verification ran on a throwaway
Postgres cluster built with `initdb` on port 55432 — the local 5432 cluster
was never touched, so its `desk_client` is still intact until you migrate.
The server served the built SPA on port 8906, exercising the real SPA
fallback rather than the Vite proxy.

- Server 501 passed / 97 files, web unit 12 passed (the `renderApp`
  consumer), both typechecks clean.
- Full e2e on a freshly migrated database, after merging main: **88 passed,
  2 skipped, 0 failed**. Earlier runs of this tree hit RT-002/RT-003 — the
  realtime family already recorded here as flaky, which passes on re-run in
  isolation — so treat a lone realtime failure as noise, not a signal.
- **Merging main is where this nearly went wrong.** Git's auto-merge
  silently dropped main's content twice in files both sides had touched:
  the `data-testid="dt-row-id"` / `data-columnrow` markers in TableBuilder
  and ImportWizard, and the NAM-002 assertions reading them in the builder,
  import-file and import-wizard specs. Nothing conflicted; six e2e specs
  simply failed. The fix, and the habit worth keeping: for a sweeping
  mechanical rename, **re-derive every file the other side also changed
  from their version and re-apply the transform**, then diff the result
  against their branch and account for every removed line.
- **#86, all five paths on throwaway clusters:** pristine fresh install ->
  `app_client`, policies granting to it; **interrupted chain** (stopped
  after the legacy 0010) -> upgrades to the end, role renamed, every policy
  on `app_client`, RLS suite green against it — this is the path that
  failed before the `0010a` rename; **mixed cluster** (a fresh database
  while another still holds `desk_client`) -> no-op, other role untouched;
  **both roles with local refs** -> `raise exception`, migration not
  recorded; **neither role** -> `raise exception`, migration not recorded.
  With `scram-sha-256` forced in `pg_hba.conf`, `app_client` authenticates
  by password and all 44 table grants survive the rename.
- **#87 pinned both ways:** the spec fails without the coercion (0 filter
  chips) and without the shape validation (malformed URLs blank the list),
  and passes with both. Two earlier drafts were themselves wrong: the first
  borrowed `listview.spec`'s fixture and silently *skipped* on a fresh
  database; the second reconciled its fixture by title but the list API
  returns only `name` unless `fields` is passed, so every run added ten
  more rows and the assertions drifted. It now empties and refills the
  table it owns, and was checked against a dirty database and a re-run.

Next: the Frappe "Desk" vocabulary is gone from routes, roles, components
and test helpers. One loose end, and it is a release chore rather than
work: publish feather-testing-postgres 0.2.0, then move both `package.json`
entries off the pinned git commit back to `^0.2.0`.

## 2026-08-03 — one name everywhere: the prod instance is `featherbase`

The `rama-dw-os` slug was retired: three months from now it would have read
as a second, unrelated project sitting next to the real one. Renamed the
Railway service, its database and its domain — `featherbase`,
`featherbase-db`, **https://featherbase-rama.up.railway.app** — so the
identifier matches the folder (`rama_dw/featherbase/`) and the app name, the
way `dbt_runner` already does. The old prod URL is a hard 404, not a
redirect.

The UI display name is `Featherbase` on both instances (prod) and
"Featherbase Dev" (dev), applied to the live instances directly as well as
in the manifest, so repo and running state agree rather than drifting.

Gotcha worth keeping: `DATABASE_URL` on prod was a **reference by service
name** (`${{rama-dw-os-db.DATABASE_URL}}`). Renaming the database service
could have left it dangling and broken the next deploy — Railway rewrote it
to `${{featherbase-db.DATABASE_URL}}` automatically, but VERIFY the
unrendered value (`variables(..., unrendered: true)`) after any service
rename rather than trusting the rendered one, which looks fine either way.

Also: the Railway CLI refreshes an expired OAuth token, but a token read
straight out of `~/.railway/config.json` does not — GraphQL calls start
returning "Not Authorized" for no visible reason. Run any `railway` command
first to refresh, then re-read the file.

Rama's manifest now lives in the `rama_dw` repo
(`featherbase/manifest.json`, merged as data-warehouse#1606/1607/1608) with
a README covering install, adopt-never-clobber semantics, and the MotherDuck
blocker.

## 2026-08-03 — Rama's instance becomes reproducible: prod on GitHub, config as a manifest

Two gaps closed, both surfaced by the owner asking the right question:
"should the deployment live in its own repo?"

**No — a fork of the framework is the expensive mistake.** Featherbase's
premise is that customizations are metadata, not code; forking to hold them
throws that away and buys a permanent merge burden. But the instinct behind
the question was right: Rama's configuration existed **only** inside one
Railway database, and prod deployed from an *upload off a laptop* (its
Railway source was literally `null`), so nobody else could reproduce the
build.

- **Prod deploys from GitHub.** `rama-dw-os` is connected to
  `siraj-samsudeen/featherbase` @ main, with build config moved off the
  untracked `railway.json` onto the service itself (preDeployCommand,
  healthcheck, `RAILWAY_DOCKERFILE_PATH`) — a GitHub build now needs nothing
  that isn't in the repo. Verified green from main, keeping its "Rama DW OS"
  brand (which lives in its database, not in code). Both instances deploy
  the same way now.
- **Config as code.** `AppManifest` gained `sources`: which Data Sources to
  connect (by env-var NAME — never a connection string) and which relations
  to reflect. Install creates the sources and runs reflection, so column
  shape is derived from the live source instead of frozen into the manifest;
  a relation the source lacks fails the install rather than half-configuring
  it. Sources follow the adopt-not-recreate discipline roles already use,
  with a new `installed_app.sources` ledger column (migration 0068), and are
  torn down LAST — a Data Source with bound Tables refuses deletion by
  design.
- **The manifest lives in `rama_dw/featherbase/manifest.json`, NOT here.**
  It is Rama-specific config — it names Rama's control plane and Rama's gold
  tables — so it belongs beside the pipelines it points at, in the repo that
  already runs one-folder-per-service (`dbt_runner/`, `gofrugal_extract/`, …).
  Naming follows that convention too: folder `featherbase`, app name
  `featherbase`, guessable the way `dbt_runner` is. The decisive argument is
  CSV: when seed editing reaches production the container must commit back to
  `rama_dw`, and it should already be a checkout of that repo. What stays here
  is the MECHANISM plus the rule the manifest relies on (a manifest may never
  carry a credential, only an env-var name).

**Installed against prod, and it correctly refused.** The control-plane half
is fine; the motherduck reflection cannot run because **MotherDuck is
unreachable from Railway containers** — `UNAVAILABLE` on `CREATE_SLT` from
both prod and dev, while the identical token, client version and URL return
99 gold tables from a laptop. Not a token, version, extension-load or
transient problem; all four were ruled out. Filed as issue #113. The failed
install left prod **unchanged** (no ledger row, sources adopted, Control Run
still serving 1,612 rows), which is the fail-loudly-rather-than-
half-configure property working as designed.

Gotcha worth keeping: the first version of the manifest test *installed* the
shipped manifest to prove it parsed — and on a dev machine `apps/server/.env`
carries the real credentials, so the unit test dialled production and timed
out. The shipped manifest is now checked for SHAPE only; the mechanism is
proved against local fixture schemas (`test/app-sources.test.ts`).

Not done: prod's live instance still holds hand-made config (it predates the
manifest). Installing the manifest there would ADOPT the existing sources
rather than duplicate them, but that has not been exercised against prod —
do it deliberately, not casually.

## 2026-08-03 — the dev server becomes featherbase-dev (shareable, credential-free)

`rama-dw-os-dev` is now **featherbase-dev** — a general testing instance the
owner can also show to outside contributors, rather than a Rama-specific
staging box: **https://featherbase-dev.up.railway.app** — project
`featherbase-dev`, service `featherbase-dev`, database `featherbase-dev-db`,
brand "Featherbase Dev". The old `featherbase-server-production...` URL is
gone (404), not redirected.

Getting a clean host took one non-obvious step: Railway's generated domain
is `<service>-<environment>.up.railway.app`, so renaming the service alone
would still have produced `featherbase-dev-production...`. The GraphQL
`serviceDomainUpdate` refuses a bare label ("Problem processing request"
for every candidate); `railway domain update <current> --domain
featherbase-dev` does exactly what is wanted.

**Sharing it meant de-provisioning it**, which is the part worth
remembering: the instance held *production* credentials
(`RAILWAY_CONTROL_URL`, `MOTHERDUCK_URL`) and had the real Rama control
plane reflected into browsable Tables. Anyone given a look would have been
given those rows. So before renaming: the three `Control *` bound Tables
and both Data Sources were removed, and both credential env vars deleted
from the Railway service (`DATABASE_URL`, `FILE_STORAGE_DIR`, `JWT_SECRET`
are all that remain). Bound Tables are engine-managed and have no delete
API — their `table_def`/`column_def`/`home_page_link` rows were removed
directly in the dev database.

**Credentials are deliberately trivial: `Administrator` / `admin`** — an
owner decision for a box whose whole purpose is "here, take a look". That
is only safe *because* of the de-provisioning above: there is nothing on
this instance worth stealing, and no credential on it that reaches
anything else. The residual risk is bounded and accepted — a visitor is a
System Manager, so they can create Tables, install sample apps, or wire a
Data Source to a store of **their own**; none of that touches Rama data.

Re-adding a source later is a two-minute job through the Source Browser
(set the env var on the service, create the Data Source, reflect) — but
**do not point featherbase-dev at production data again while it is
shared with a public admin password**. Prod (`rama-dw-os`, Jeyarama-ETL
project) is untouched, keeps both sources, and keeps its rotated password
in the gitignored `apps/server/.env`.

Still true: the service is GitHub-connected, so merges to `main`
auto-deploy here — verified end-to-end when PR #103 merged (the deploy of
the merge commit went green and the instance kept its own brand, since
`app_name` lives in its database, not the image).

## 2026-08-02 — PR #103 re-review: write-time scopes, tier parity, symlinks, required revisions

A second review round read the whole PR against current `main` rather than
only the first eight findings, and found nine more. Two lessons worth
keeping: **fixing the path a review names is not the same as fixing the
class of bug** (round one fixed read scoping and left write scoping open),
and **a gap the new code shares with the old code is still a gap**.

- **Merge conflict (blocking).** `main` had moved `/desk` → `/admin` and
  added relational navigation. Merged deliberately: the source browser now
  lives at `/admin/source/$name`, every new link carries main's required
  search params, main's `ListRow` extraction is kept with the read-only
  selection gate threaded through as a `selectable` prop, and main's Map
  button coexists with the bound-row Rename suppression.
- **Data Scopes judged the row as loaded, not as written.** A caller with
  `region = north` could edit a permitted row's Reference *to* `south` —
  and a hook could do the same. Both bound write paths now re-check the
  finalized row (post defaults/validation/hooks) just before the source
  write.
- **Field tiers were missing from list/count/group** — a basic-tier caller
  could select, filter, sort or group by a restricted column that detail
  reads correctly hid. **This gap existed on native Tables too** (the
  PERM-006 test only covered detail reads), so the fix lands in both
  places: `columnSet` takes the caller's read tiers, and the bound binding
  is narrowed before the request is built. A caller-supplied `order_by`
  that does not resolve is now rejected rather than silently falling back
  to the pk — that fallback was itself the hole the tier test exposed.
- **CSV containment was lexical only**, so a symlinked file (or parent
  directory) escaped `root_path` on read and write. Now canonical:
  realpath on root and parent, plus an lstat that refuses a symlinked
  target outright.
- **Deletes required a revision only if the caller offered one.** Where a
  binding has one, it is now mandatory — the positional-CSV hazard was
  closed for the Desk but open to every other API caller.
- **Read-only flips could be defeated by a cache race**: invalidation ran
  *inside* the save transaction, so a concurrent request could repopulate
  from pre-commit state. Invalidation moved to a new **`after_commit`**
  hook event — and, because after-commit invalidation still leaves a
  narrow window, the write gate now **re-reads the access mode from the
  control DB** instead of trusting the cache. One indexed read per write
  closes the race outright.
- Also: a credential-named PRIMARY KEY (surfacing through `name`) makes a
  relation unbindable; bound detail reads gate before the foreign fetch so
  an own-rows caller cannot trigger foreign lookups; Data Source
  administration is System Manager-only *at the controller*; and a
  hand-written binding is validated against the live source (exists,
  allowlisted, every mapped column present) instead of failing later at
  query time.

Verified: 7 more regression tests; **server 107 files / 570 passed / 2
skipped**; web e2e green on the merged tree. Gotcha for the next session:
`app-fixtures.test.ts` fails whenever a web e2e run has left the helpdesk
app installed in the shared dev DB — uninstall it
(`POST /api/uninstall_app {"name":"helpdesk"}`) rather than hunting a
regression.

## 2026-08-02 — PR #103 review: authorization parity, secret hygiene, real locking

Eight review findings on the sources PR, all legitimate, all fixed. The
theme is the one a new storage path always invites: **the bound path had
drifted from the native path's guarantees.**

- **Authorization parity (critical).** Bound list/count/group checked only
  `permissionScope` and skipped Data Scopes; detail/update/delete called
  `assertPermission`, which *accepts* an `own_rows` grant — and since bound
  rows have no owner, such a user could read or mutate any external pk.
  Now one `assertBoundScope(meta, user, action)` gate rejects `own_rows`
  for **every** action (a bound Table can never satisfy it), Data Scopes
  push into source filters as a new internal `in_or_null` operator
  (matching the native NULL-passes semantics), concrete rows are re-checked
  with `assertUserPermissions` on detail/write/delete, and **authorization
  runs before the foreign fetch** rather than after.
- **Secret hygiene (critical).** `password_hash`/`api_key`/… were stripped
  natively but sailed straight through reflection and bound reads. The
  predicate now lives in one module (`sensitive-columns.ts`) used by
  query.ts, document.ts, reflect.ts (never reflected) and dispatch.ts
  (dropped from the binding, so they can't be selected, filtered, sorted,
  read or written even if a column_def is hand-added later).
- **Optimistic locking was decorative (high).** The mapped `updated_at` was
  checked in the WHERE but never advanced in the SET — a plain
  `DEFAULT now()` column only changes on insert, so two Desk editors
  silently overwrote each other. The old test hid it because its fake CLI
  set `updated_at = now()` itself. The driver now advances the revision in
  the same statement, and the empty-payload branch no longer skips the
  check. Test: two clients load the same revision, A saves, B's stale save
  must 409.
- **Positional CSV deletes (high).** Only updates carried a revision, so a
  delete spliced whatever now sat at that row number. Deletes now carry
  `?updated_at=` end-to-end (API → engine → driver) and conflict; temp
  files got unique names (a fixed `.fb-tmp` let two writers clobber each
  other). The in-process lock is documented as single-replica.
- **Schema ambiguity (high).** Candidates were keyed by bare table name,
  server and browser alike, so `public.customer` and `archive.customer`
  fought over one entry. Both sides now key by `schema.table`; a bare name
  is accepted only while unambiguous and otherwise skipped with both
  qualified options named.
- **PK introspection (medium):** `key_column_usage` is joined on catalog +
  schema + constraint name **and table name** — Postgres allows two tables
  in a schema to share an explicit constraint name, which inflated
  `pk_size` and made single-column PKs look composite.
- **Write affordances (medium):** meta now exposes server-derived
  `source_writable` (engine capability AND access); the Desk gates badge,
  Save, Import and row selection on it, and a `read_write` duckdb source is
  rejected at configuration time instead of rendering an editable form the
  server refuses.
- **Mixed line endings (medium):** the parser picked one global EOL and
  rewrote every record with it, so mixed `\r\n`/`\n` files (and lone `\r`)
  were normalized — breaking the byte-stability promise. Each record now
  keeps its own terminator; authored records use the file's dominant one.

Verified: 9 new regression tests (`sources-security.test.ts` + CSV cases)
covering non-admin list/get/update/delete, api_key invisibility, the
two-client conflict, stale-delete conflict, ambiguity rejection, mixed-EOL
round trips; **server suite 101 files / 537 passed / 1 skipped**; the 45
real seed files still round-trip byte-identically through the rewritten
parser.

## 2026-08-02 — rama-dw-os-dev: the old featherbase Railway project becomes the dev server

The orphaned `featherbase` Railway project (GitHub-connected, both services
failing on every push) is now **rama-dw-os-dev**, a working dev/staging
install at https://featherbase-server-production.up.railway.app:

- It had **no database at all** — no Postgres service, no `DATABASE_URL`,
  so the container fell back to `localhost:5432` and every deploy since
  creation had failed. It now has its own `rama-dw-os-dev-db` Postgres, a
  `/data` volume, and the same env-var credential set as prod (control
  plane over the **public proxy** — Railway private networking does not
  cross projects). The obsolete `web` service (pre-#57 two-service layout)
  was deleted on owner confirmation.
- **Gotcha that cost three failed deploys: Railway's `startCommand` is not
  a shell** — `pnpm --filter server release && pnpm --filter server start`
  ran the release (pnpm swallowed the rest as script args) and then the
  container simply exited; logs show migrations, then silence. And two
  traps on top: clearing the field via GraphQL `startCommand: null` is
  ignored (send `""`), and `railway redeploy` reuses the previous
  deployment's recorded config, so config fixes need a NEW deploy. The
  working shape is prod's: `preDeployCommand` for the release step, image
  CMD for serving.
- The service stays GitHub-connected (`siraj-samsudeen/featherbase`), so
  pushes auto-deploy it — real staging once the sources branch merges;
  today it runs the branch via `railway up`.
- Configured live: brand "Rama DW OS Dev"; `railway-control` source
  **read_only** (a test server must not write production control tables)
  with the 3 bindable tables reflected; `motherduck` source registered
  but MotherDuck again UNAVAILABLE from containers (same as prod — retry
  in the Source Browser). Administrator password rotated (old `admin`
  verified dead) and stored in gitignored `apps/server/.env.dev-admin`.

## 2026-07-31 — Rama DW OS: first production deployment (Railway)

Featherbase now runs in production as **Rama DW OS** at
https://rama-dw-os-production.up.railway.app — a new `rama-dw-os` service
in the Jeyarama-ETL Railway project (beside the pipeline services), with
its own fresh Postgres (`rama-dw-os-db`), a `/data` volume for file
storage, and env-var credentials. Built with the existing
`apps/server/Dockerfile` (single-origin SPA+API); the release step
(migrations+patches under the advisory lock) runs as Railway's
`preDeployCommand` via an **untracked** `railway.json` at the repo root —
untracked on purpose (the repo stays vendor-neutral) but required for any
future `railway up`, so don't delete it from the deploy checkout.

- **The first deploy caught a real fresh-database bug** the shared dev DB
  could never show: createTable/updateTable wrote
  `data_source`/`external_*`/`source_column` unconditionally, which the
  pre-0064 migrations (0005 core seeds…) hit before those columns exist.
  Fixed by including the binding keys only when set; verified by running
  the entire chain + patches against a brand-new local database.
- Instance branding shipped: System Settings `app_name` now drives the
  navbar, tab title, and (via new public `GET /api/brand`) the login
  page. Prod is named "Rama DW OS"; the default stays "Frappe Clone".
- Prod state after configuration: `railway-control` source connects over
  Railway **private networking** (`${{Postgres.DATABASE_URL}}` reference —
  no public proxy) and its 3 tables are reflected (Control Run counted
  1,493 live rows over the public URL). `motherduck` source is configured
  but MotherDuck returns UNAVAILABLE (RPC CREATE_SLT) **from the
  container only** — the same token works from the laptop, value verified
  byte-identical in Railway; retry "Test connection" in the Source
  Browser when MotherDuck stabilizes. CSV seeds are deliberately
  local-only (deferred; M1-proper is the plan).
- Administrator password was rotated immediately after deploy (default
  `admin` rejected, verified); it lives in the gitignored
  `apps/server/.env` as `RAMA_DW_OS_ADMIN_PASSWORD`. JWT_SECRET is a
  fresh random value in Railway variables.
- The old `featherbase` Railway project (services `featherbase-server`,
  `web`) is superseded by this install and can be retired — owner call,
  not done.
- Dev-DB hygiene from this session's live testing: the web e2e run leaves
  the helpdesk app installed (its uninstall spec is among the
  conditionally-skipped), which fails `app-fixtures.test.ts` afterwards —
  uninstalled via API; a lost `desk_client` SELECT grant on `"user"`
  (source unknown; possibly a parallel worktree) failed `rls.test.ts` —
  re-granted. Both files green again.

## 2026-07-31 — External data sources land: PG reflection, DuckDB/MotherDuck, CSV folders (spec 0001 / M1+M3 slice)

One coherent slice built to the existing design contract (spec 0001, design
doc §3, execution plan M3 — with M1's seed-editing need served by a
`csv-folder` driver instead of native-table import). Three user-facing
capabilities, one seam:

**What exists now.** A `Data Source` registry Table (EDS-1: engine
`postgres`/`duckdb`/`csv-folder`, credentials as *env-var names* only,
`access` read-only/read-write, allowlist, pool/timeout knobs, Test
Connection); row actions `:test_connection`, `:introspect`, `:reflect`
(System Manager only, P3); a Source Browser page at `/desk/source/$name`
(reached via "Browse & Reflect" on the Data Source form). Reflection
(EDS-2/3) generates *bound* Tables — `table_def` rows carrying
`data_source`/`external_schema`/`external_table`/`external_pk`/
`external_modified`, `column_def.source_column` for renamed columns — with
**no DDL and no RLS ever** (BV1). Reads (`getList`/`getDoc`/`count`/
`groupCount`) dispatch through `apps/server/src/sources/` with filters,
sort and paging pushed down (EDS-5); writes (postgres + csv-folder only)
run control-side hooks, write **only payload columns** (BV2), optimistic-
lock on the mapped modified column / file mtime (EDS-8), and are refused
entirely on read-only sources and the duckdb driver (EDS-7). Source
failures surface as `DataSourceError` 502, never an empty list (EDS-11).
The generic ListView/FormView show a source badge and drop write
affordances on read-only sources (EDS-13).

**Live wiring on this machine** (creds in gitignored `apps/server/.env`,
loaded by a tiny opt-in parser in `config.ts`): `railway-control` →
the Railway control-plane PG (3 of 11 tables bindable; the rest have
composite PKs, excluded per BV6 — revisit read-only browse for those);
`motherduck` → the warehouse via the read-scaling token (read-only);
`rama-seeds` → `rama_dw/dbt_runner/dbt/seeds` (42 CSVs, read-write).

**Verified.** Live Railway: introspect/reflect, filtered list + getDoc +
count over 1,483 `control.run` rows, in Desk and over HTTP (no writes
against production). CSV: in-memory parse→serialize round trip of all 42
real seed files is byte-identical (16 MB budget file included); a Desk
edit of `division_labels.csv` produced a one-line git diff in rama_dw and
the UI revert left `git diff` **empty**. 26 new sandbox tests
(`sources-postgres/duckdb/csv.test.ts`) cover conflict detection,
read-only enforcement, path traversal, no-trailing-newline preservation;
full server suite green (`98 files, 540 passed, 1 skipped`), both
typechecks clean, web e2e suite green.

**Gotchas.**
- **MotherDuck was degraded mid-session**: every catalog RPC
  (`information_schema`, even `SHOW TABLES FROM gold.main`) hit
  DEADLINE_EXCEEDED for ~1h, on two different tokens and duckdb 1.4.1 and
  1.5.4, while `show databases` stayed fast — it worked at session start,
  so transient on their side. The duckdb driver is fully covered by
  local-file tests (same code path); when MD recovers, reflect `gold`
  from the Source Browser (schema `gold.main`, e.g. prefix `Gold`).
- `@duckdb/node-api` is pinned **exactly 1.5.4-r.1** — MotherDuck rejects
  DuckDB 1.5.5. Do not bump without checking their support matrix.
- Reflection must call `ensureHomePageForTable` (it does now) — creating
  Tables without a home-page link breaks 0060's idempotency test on the
  next migration re-run, which is exactly how it was caught.
- Source columns whose names collide with standard columns are renamed by
  `sanitizeHeaders` (`status` → `status_1`) with the true name kept in
  `source_column`; the source's `updated_at`/`modified` timestamp column
  and its PK surface as the standard `updated_at`/`name` instead of
  columns.
- csv-folder rows are addressed by **row number** (`_row`), so inserting/
  deleting renumbers later rows; the mtime lock turns concurrent edits
  into 409s rather than corruption. Byte stability comes from keeping
  untouched records' raw text verbatim (`sources/csv.ts`) — only edited
  records are re-serialized.
- Deviations from spec 0001, deliberate and small: no Reconciliation Log,
  no drift re-sync UI (EDS-9), no `conflict_check: row` mode (only
  `modified`/last-write-wins), no cross-source Link validation (EDS-10 is
  companions-only, which work), import into bound Tables blocked. Local
  reads do NOT yet flow through the seam (M3's stretch goal) — bound
  dispatch is an early-return, native path untouched (rule 4: no refactor
  the slice didn't need).

**Next.** ~~When MotherDuck recovers: reflect a gold schema~~ — done later
the same day: MD recovered, `gold.main` introspected (94 tables, 33s) and
4 tables reflected as module "MotherDuck Gold" (prefix Gold); `Gold
Category` lists 1,514 live rows read-only in the Desk, form fully
disabled, no Save/Rename. Then candidates: read-only browse for
composite-PK PG tables; drift re-sync (EDS-9); features.json entries for
the three capabilities (owner action — agents may not add entries).

## 2026-07-31 — Missing `E` prefix corrupted seeded `choices`; 32 tests were failing

63 server tests failed with `417 ValidationError: Invalid values for Permission`
— `tier: 'basic'` rejected against an enum whose only member was the
seven-character string `basic\nrestricted`. Two independent defects, both from
SQL migrations, both invisible on a fresh database in the ways that mattered.

**1. Literal backslash-n in `choices` (5 sites).** Postgres runs with
`standard_conforming_strings = on`, so a plain `'basic\nrestricted'` literal is
a backslash followed by `n` — only `E'...'` escapes. `0004_bootstrap.sql:11,32`
and `0055_terminology_rename.sql:221,240,259` omitted the `E`; their immediate
neighbours (`E'Data\nInt\n...'`, `E'queued\nsent\nerror'`) had it, which is how
it slipped through. The `.ts` seeds were never wrong — `'\n'` in TypeScript *is*
a newline — so `0005_core_seeds.ts:55` was correct all along and made this look
like local drift. It was not: I rebuilt a scratch database through the whole
chain and **`Table.kind` and `Column.tier` are corrupt on every fresh database**.
Only `Permission.tier` was true drift — 0005 seeds it correctly and 0055's
`where column_name = 'permlevel'` no-ops on a fresh DB, so just pre-0055
databases got it clobbered. `Table.kind` was a third corrupt row nobody had
noticed. Fixing the choices alone took the failures 63 → 32.

**2. `0055` renamed `permlevel` → `tier` but left the numeric default.** The old
column was a level (0 = base) with `default_value = '0'`; the rename swapped in
the `basic`/`restricted` Choice list and never touched the default. So every
save that *omitted* `tier` defaulted to `'0'` — outside the Choice list — and
failed identically. Same blind spot: no-op on fresh databases, so CI never saw
it. This is what the remaining 32 failures were.

The `exportCustomizations`/`importCustomizations` path was suspected and is
**cleared** — it passes `choices` through verbatim (`f.choices ?? null`), no
escaping, no JSON round-trip.

- All 5 SQL sites now carry the `E` prefix, and 0055 migrates `default_value`
  alongside the rename, so neither can recur.
- **New `0063_fix_literal_newline_choices.sql`** repairs databases already built
  from the broken chain — every developer's, not just this laptop. Normalises
  literal `\n` in `column_def.choices` *and* `custom_field.choices`, and maps a
  numeric `tier` default back to the vocabulary. Written with `chr(92) || 'n'`
  and `chr(10)` rather than escaped literals so the repair itself cannot fall
  into the same quoting trap. Idempotent — matches nothing on a correct DB.

Verified: fresh scratch DB through the fixed chain has **zero** literal-`\n`
rows; a full `column_def` diff (type/choices/default/reqd, every row) between
that fresh DB and the repaired dev DB is **empty**. `pnpm --filter server test`
→ 95 files, 470 passed, 1 skipped, 0 failed; no stale-`background_job` noise.
Typecheck clean. End-to-end over HTTP against the running server: Permission
save with `tier` omitted → `'basic'`; with `tier: 'restricted'` → accepted; with
`tier: 'bogus'` → correctly rejected, and the message now reads
`Expected 'basic' | 'restricted'`, proving the enum has both members again.

Gotcha: `0063` had already been recorded as applied under its original number when I extended it, so
re-running meant deleting its `migration` row first — safe only because it is
idempotent. Note the dev database also had 0057/0058 pending; they applied here.

Gotcha — **the shared dev database, from the other side.** This repair was
authored as `0059`, and the NAM-001 entry below documents seeing exactly that
filename applied in a `migration` table whose worktree had no such file: "54
test failures … appeared and then fixed themselves when another branch's 0059
landed" was this fix reaching the shared `featherbase` DB from this worktree
mid-session. Merging main then made the number a real collision (main landed
`0059_app_fixtures`, `0060_home_pages`, `0061_fix_sort_column_default`), and the
shared DB also carries `0062_user_palette.ts` from a third, still-unmerged
branch — so this settled at **0063**, past everything currently in flight. The
orphaned `0059_fix_literal_newline_choices.sql` row was deleted from `migration`
so nobody else hits the phantom-file confusion; other branches' orphans were
left alone. The runner keys on full filename, so a duplicate *number* never
fails loudly — it just misleads. Check `select name from migration` against
`ls apps/server/migrations/` before trusting a red suite.

Next: worth a guard so this class of bug can't return — either a test asserting
no `column_def.choices` contains a literal backslash-n after migration, or a
lint over `migrations/*.sql` for non-`E` literals containing `\n`. The five
sites are fixed, but nothing stops a sixth.


## 2026-07-31 — fix #94: the e2e specs address column rows by marker, not position

`main` was red: NAM-002 inserted a locked **Row ID** row at the top of the
column grid (Table Builder and Import Wizard), and six e2e specs still
assumed row 0 was the first *data* column — two timed out filling
`[data-rowfield=column_name]` on the locked row, two asserted counts that
came back +1, and two read/dropped the neighbouring column.

- **Durable fix, not an offset.** The editable column rows now carry
  `data-columnrow`; specs select `tbody tr[data-columnrow]` instead of
  `tbody tr`, so *any* future decorative row is invisible to them. The
  locked rows gained `data-testid` (`dt-row-id`, `iw-row-id-{i}`) and both
  specs now **assert the contract** — the first `tbody tr` IS the Row ID
  row — so the next such change fails loudly instead of silently reading
  the wrong rows. (Offsetting `nth(i+1)` would have re-broken next time.)
- **Verified red → green on identical state**, not just green: with the
  marker removed, UI-011 fails exactly as CI did (`waiting for
  … tr[data-columnrow] …`); restored, it passes. All six originally
  failing specs pass. Full suite locally: **83 passed, 5 skipped, 1
  failed** — that one (`naming-series` NAM-001) was *my own* local
  pollution: I had dropped the `Naming Demo` table but not its `ND-`
  counter in the `series` table, so the row came back `ND-2`; after
  clearing the counter it passes. CI provisions a fresh database, so this
  cannot occur there. Server 500 passed, web unit 12, both typechecks clean.
- **features.json correction (same PR).** The previous session applied
  ADR 0007's `name` → `id` record-identity rename to eight entries — but
  the ADR is **Accepted, not implemented**: `STANDARD_COLUMNS` and every
  generated table still use `name` (verified against a live table). Those
  entries now describe what ships, and the file's `$comment` records the
  pending ADR so the next session doesn't re-apply it prematurely.
- **Gotchas for whoever runs e2e locally:** (1) the specs self-skip when
  their Table already exists, so a second run silently skips the create
  paths — drop the Table *and restart the server* (the meta cache holds
  it) to re-exercise them; (2) dropping a Table does not drop its `series`
  counter, which will name later rows off-by-N; (3) this container's
  Playwright wants a browser build it lacks — run with
  `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`;
  (4) `pkill -f` on a pattern matching your own command string kills the
  shell (exit 144) — kill the server by listening port instead.

## 2026-07-31 — features.json catches up with main (126 → 145)

Owner: "main has moved a lot. update features.json now." Merged main (36
commits: import subsystem, Home Pages, app fixtures, system flag, naming
series, single-origin deploy, ADR 0007) and brought the inventory current.

- **ADR 0007 applied** (record identity is `id`; `name` is now an ordinary
  human-readable column): META-005's standard-column list, DOC-001/008/012,
  API-001's route shape, UI-006/UI-014, META-006. Also fixed a double-word
  artifact from the 2026-07-26 rename ("Settings Table Tables") and
  updated UI-027 to the shipped reality (Workspaces → **Home Pages**).
- **19 entries added** for work built after the harness froze, using the
  IDs the code and tests *already reference* (so the Explorer's ID scan
  links them): **IMP-001…013** (new `import` category — inference,
  TZ-independent dates, header sanitization, coercion, the `:import`
  collection action, drag & drop, dry run, multi-sheet, Choice detection,
  wizard mapping, Import Log, overlap-scored targeting, selective import),
  **NAM-001/002** (id patterns in the UI; row id as column one),
  **PLAT-009/010/011** (app fixtures, `system` flag, single-origin
  deploy), **ACCT-001** (account menu + in-app password change).
  Verify criteria written from each PR's documented verification.
- **Status honesty**: the new entries are marked `passing` on the strength
  of the end-to-end verification recorded in their own PROGRESS entries
  and PRs (e2e suites, browser runs) — *not* re-verified in this session.
  Anything later found wrong flips back to `failing` per the standing rule.
- Governance updated in three places: features.json `$comment`,
  `harness/README.md` (no longer claims a frozen 126), and CLAUDE.md's
  session protocol (the inventory is a record, not a backlog; new work
  should be added with owner sign-off rather than left in history).
- Explorer rebuilt: 145 features, new `import` category card and
  explanation, **138/145 now resolve to test files** (was 124/126).
  Verified headlessly — IMP-011 links its real action/wizard/e2e files,
  zero render errors. Artifact republished (same URL).

## 2026-07-26 (v13) — features.json renamed to new vocabulary (owner instruction); rename debt filed as #64

Owner ruled the #63 leftovers unacceptable ("proportionately named") and
authorized renaming `harness/features.json` now that the build is done:

- **features.json**: all 126 titles/verify strings renamed to
  Table/Row/Column vocabulary via a scripted, protected replacement pass
  (code identifiers that genuinely still exist — `save_doc`,
  `Document class`, `parentfield` — deliberately preserved). Invariants
  asserted programmatically: IDs, order, deps, priorities, categories,
  statuses byte-identical. Header `$comment` rewritten with the new
  governance; **CLAUDE.md hard rule amended** (owner-authorized): IDs/
  order/deps immutable, status flips remain the only agent-permitted
  change, wording changes require explicit owner instruction.
- **Issue #64 filed** — the deferred rename debt inventoried: file
  renames (doctype-engine → table-engine, document → row-lifecycle,
  DeskLayout → AdminLayout, test names) as one mechanical PR; behavioral
  renames (`POST /api/doctype` — owner flagged it — `desk_client` role,
  `/desk/` routes, `save_doc` wire shape pinned by the published
  feather-testing-postgres package) as a second, decided-per-row PR.
- Explorer rebuilt with the renamed titles (test-scan still 124/126,
  zero render errors); Features-page note updated; artifact republished.

## 2026-07-26 (v12) — reconciled with PR #63 (Table/Row/Column rename)

Merged #63 into main (owner's call), merged main into this branch
(PROGRESS conflict resolved keeping both histories; CLAUDE.md
auto-merged), then updated everything this branch owns to the new
reality:

- **`docs/LEARNING-PATH.md` rewritten** in Table/Row/Column vocabulary
  and the new API: POST /api/doctype with `columns`/`column_type`,
  Reference/Choice/Sub-table types, `PATCH /api/table/:table/:name` with
  `updated_at` optimistic lock, bare physical names (`todo_item`), the
  reserved-`status` gotcha as a deliberate exercise, Permission/tier/
  own-rows-only in Stage 5, id_pattern in Stage 6. Vocabulary-bridge
  note added (features.json IDs stay Frappe-era; frozen by rule).
- **Explorer updated**: category explanations (metadata → table_def/
  column_def + no prefix; REST → the actions.ts registry, PATCH-not-PUT,
  effect read|write; permissions → tiers/own-rows-only/Data Scope; Desk
  → Admin UI; DocTypeBuilder → TableBuilder file link; actions.ts added
  to key files), lifecycle steps, and a vocabulary note atop the
  Features page linking the Glossary. Rebuilt: docs picked up the
  rewritten TUTORIAL/TESTING/GLOSSARY/ARCHITECTURE automatically;
  feature→test scan still lands 124/126 (harness IDs survived the
  rename); zero render errors; artifact republished (same URL).
- **Design doc §4.1**: status note — #63 landed the prefix-drop half of
  D2; the store-the-name-in-metadata half still stands.

## 2026-07-26 (v11) — Featherbase Explorer site + todo learning path

Built the owner's phone-readable learning/navigation surface:

- **`site/`** — a zero-dependency builder (`node site/build.mjs`) that
  emits one self-contained `index.html` (769 KB): all 126 harness
  features (search + category filters; per-feature page with the verify
  contract, deps/dependents, and *scanned* links to the test and source
  files that literally name the ID — 124/126 have direct test mentions),
  a Map page (save-lifecycle in 8 steps, the 7 axes, milestones,
  category grid with per-category "how it works" explanations + key
  files), the full 39-document library rendered from markdown with
  feature IDs auto-linked, the learning path, and a Questions tab —
  notes saved to localStorage with JSON download/copy for feeding back
  into agent sessions. Desk visual identity (PROGRESS tokens), light +
  dark, mobile-first. Also emits `artifact.html` for Claude-artifact
  publishing; GitHub Pages option documented in `site/README.md`.
- **`docs/LEARNING-PATH.md`** — the staged todo app: Stage 1 plain CRUD
  `Todo Item`, then Projects (Link/integrity/rename), Subtasks (child
  table atomicity), Checklists (Select/flags/first controller hooks),
  a second user (permissions over raw HTTP), optional live stage
  (series/jobs/email/web form). Each stage names the feature IDs it
  exercises, a verify checklist, and questions to answer before moving
  on.
- Verified: built and screenshotted at phone viewport (light + dark,
  home/map/features/feature-detail/doc/questions) via headless Chromium
  — zero console errors. Fixed the design doc's stale "v3" status label
  caught in the screenshot. Docs+tooling only; app untouched.

## 2026-07-26 (v10) — execution plan resequenced per owner; harness lineage documented

Owner feedback: start with the concrete slices, refactor later. Plan
updated: **M1** dbt seeds → native DocTypes + PR-based CSV egress (zero
framework change), **M2** the external CRUD manager's tables move into
DocTypes and the tool retires, **M3** MotherDuck warehouse browser —
which is where the storage seam arrives, but only its **read-only half**
(getList/getDoc/count/introspect), explicitly citing `tenancy.ts` as the
bolt-on anti-pattern the browser must not repeat, **M4** full seam +
D2 table_name migration, now informed by a real second backend, **M5**
egress config generation (byte-match) + reassess. Added §3b: the
harness (`harness/` — frozen features.json, coder/evaluator prompts,
run.sh loop) is the *lineage*, not extended: milestone feather-specs in
docs/specs/ are the successor artifact (capability IDs = feature IDs,
EARS criteria = verify fields, DoD = evaluator checklist; CLAUDE.md
protocol unchanged). Docs only. Rides PR #60.

## 2026-07-26 (v9) — execution plan; main merged in

- **Merged `origin/main`** (PR #58 app-platform gaps) into the docs
  branch — notable: main's entry records a report server POSTing
  feedback over REST as Featherbase's *first external consumer*, i.e.
  one of the three target use cases is already live and battle-testing
  the engine.
- **`docs/design/execution-plan.md`** — the how-to-build-without-
  disappointment answer (4–5 prior attempts failed on oversized units of
  promise). Rules: product slices not framework layers; one feature per
  session with pre-written verify; spec → validate-against-D1–D21 →
  build; refactor only at the seam under green tests; visible NOT-NOW
  list. Milestones: **M0** seam refactor (D2 table_name + D5/D7 adapter
  seam, zero behavior change), **M1** MotherDuck warehouse browser
  (read-only, spec-0001 slice), **M2** dbt seeds → MDM DocTypes with
  PR-based CSV egress, **M3** egress config generation (byte-match the
  hand-written configs), **M4** reassess. Agent workflow per milestone:
  plan session produces spec+features, validated before build; build
  sessions are one-feature; owner does an ownership pass per milestone.

Docs only. Rides PR #60.

## 2026-07-26 (v8) — layer economics (D21) + the MotherDuck warehouse browser

Clarifications from the user: "who do" meant **Odoo** (already studied);
Hudi kept as a welcome accident. DLT-META checked: not abandoned but
thinly active (last release 2025-09) and a no-SLA Labs project — caveat
added to the study; verdict: adopt the Dataflowspec *idea*, generate our
own spec, never depend on the project. Design doc → v7:

- **§3.3 layer economics (D21)** — answering "does a clean SoR need
  bronze/silver?": bronze's jobs (replay, audit-of-source, decoupling,
  uniformity) are already done by Axis E when Featherbase is the SoR, so
  bronze collapses to a thin generated landing (kept only for compute
  isolation + pipeline uniformity) and silver is emitted directly from
  DocType metadata; human modeling starts at gold. Full medallion stays
  justified for messy foreign sources (SAP). Warehouse mapping/seed
  tables — currently homeless hand-edited seeds in the warehouse — are
  master data and become MDM DocTypes.
- **§3.3 warehouse browser** — new reverse-direction use case: Desk over
  MotherDuck (bronze/silver/gold currently SQL-only). Maps onto existing
  machinery verbatim: `duckdb` driver + foreign read-only mode + spec
  0001's read-only sources/allowlists + reflection; schemas-per-system
  surface as Desk modules; saved views give analysts a
  Datasette-for-the-lakehouse. Featherbase fronts both ends of the pipe.

Commits ride open PR #60. No code, no features.json changes.

## 2026-07-26 (v7) — analytics egress / ETL story (D20) + Hudi-lakehouse study

The forgotten dimension: how master data flows OUT into the bronze/silver
medallion layers — the MDM app's whole strategic purpose. Added
`docs/research/studies/hudi-lakehouse.md` (Apache Hudi: record keys +
precombine + timeline + incremental queries; Debezium CDC; dbt; and
Databricks **DLT-META** — the direct precedent for metadata-driven
bronze/silver pipelines driven by an onboarding spec). Design doc → v6
with **D20**: analytics egress is a declared push binding (transport by
capability: logical replication > outbox > snapshot), and the warehouse
artifacts — the existing bronze/silver CSV config, dbt sources/staging
models with tests, HoodieStreamer/Dataflowspec configs — are **generated
from DocType metadata** as one-way D19 artifacts, regenerated on
metadata promotion; D16 history/effectivity maps to SCD2; Featherbase
emits configs and streams, never runs lake infrastructure. Sequencing:
the CSV-config generator joins the MDM now/next bucket (cheap, replaces
hand-maintained config immediately). Commits ride open PR #60.

## 2026-07-26 (v6) — three more studies (react-admin, Avo, NocoDB); PR opened

Added on request to `docs/research/studies/`: **react-admin** (frontend
dataProvider adapter ecosystem; **guessers** = generation as one-way
copyable suggestion — the cleanest D19 UX, adopt as the Desk's "eject
this view"; headless ra-core split; optimistic-with-undo), **Avo** (the
modern Rails admin — the **escape-hatch ladder** "designed so you can't
get stuck" as a testable product property for D11/D14; custom fields as
generatable component packages; actions as scoped first-class objects),
**NocoDB** (spreadsheet UI over existing DBs — distinct from NocoBase;
adopt **saved views** as first-class shareable objects, form views as the
portal intake primitive, and lookup/rollup/formula virtual columns tied
into drift detection; reject UI-direct writes that bypass the lifecycle).
Studies README index/reading-order updated. Research-only session series
ends here — **PR opened** for the whole branch (research notes, ADR 0007
+ specs 0001/0002, design framework v5 with 7 axes / D1–D19, 12 study
documents). No code, no features.json changes.

## 2026-07-26 (v5) — system study series + generation-vs-interpretation (docs only)

Requested reading material: one document per inspiration system (four
questions each: key dimensions / what it enables / downsides / what to
adopt). Created **`docs/research/studies/`**: README (rubric + the
two-families framing), JHipster, generator-family (ScaffoldHub, Rails
scaffolding/ActiveAdmin/Administrate, the author's ~2006 XML→EJB MDM
generator — five answers to the round-trip problem tabulated), NocoBase,
Salesforce, Jira, Directus, Odoo, ServiceNow. Adopt-verdicts reference
D-decisions; notable new lessons captured: permission sets over
monolithic roles (Salesforce), schemes-as-named-objects + never fork the
config paradigm (Jira), snapshot/diff/apply not update-sets for promotion
(Directus vs ServiceNow), auto-install bridge capabilities + extensions
must target declared contracts (Odoo), task-table inheritance at scale
(ServiceNow).

Design doc → v5: new §6.6 **generation vs interpretation** and **D19**
(runtime interpretation is the source of truth; codegen one-way derived
only — types/stubs/tests/seeds; DocType eject as one-way off-ramp,
re-entry via adoption). Survey §8 now indexes into the studies dir.

No code, no features.json changes.

## 2026-07-26 (v4) — parallel branch merged; three missed axes added (docs only)

- **Merged** `claude/frappe-multi-app-db-866jdv` (a parallel session's take
  on the same research task): ADR 0007 (foreign data bound per DocType,
  never per app; no DDL against sources; no 2PC — with rejected
  alternatives incl. postgres_fdw), spec 0001 External Data Sources
  (EDS-1…13 — far more rigorous than this branch's one-pager: standard-
  column map-or-synthesize contract, permission-before-query, constraint→
  field error mapping, optimistic locking with whole-row fallback, drift
  detection, definition-of-done), spec 0002 Virtual DocTypes (VDT-1…5),
  specs README + CLAUDE.md pointer, and its research note (deeper Frappe
  code-level mechanics). **Retired** this branch's thinner
  `docs/specs/external-database-doctypes.md` in favour of 0001/0002;
  updated all XDB references in the design doc and research note. The two
  research notes now cross-link. Its PR was closed after the merge.
- **Design doc → v4**, answering "any axis missed?": **Axis E — time**
  (audit trail, append-only versions, effectivity dating for MDM, as-of
  reads; git driver gets history free, sync needs replay), **Axis F —
  change lifecycle** (environments, promote-with-plan-preview, layer
  rollback — the Salesforce sandbox lesson, Frappe's known weak spot),
  **Axis G — actors & identity** (internal/portal/machine/AI-agent
  principals, on-behalf-of chains, identity propagation declared per
  driver/sync binding). Cross-cutting non-axes named (observability,
  compliance, surfaces, i18n, offline, perf). New decisions **D16–D18**;
  MDM "now" bucket gains audit+versions+effectivity from day one.

No code, no features.json changes.

## 2026-07-26 (v3) — design framework: Axis D, extensibility & plugin ecosystem (docs only)

More requirements: Salesforce's design admired; WordPress-style
contribution loop + VS Code-style extensions (tables, workflows, UI
elements as plugins); micro-apps where you can take *only parts* (unlike
VS Code's all-or-nothing); survey leading OSS (Strapi-class systems).
Updated `docs/design/data-and-admin-topology.md` to v3 with a fourth axis:

- **§6 Axis D**: microkernel/dogfooding rule (NocoBase model — platform
  features use the same public plugin API); typed contribution points
  (VS Code static declaration + Directus's nine-type extension taxonomy);
  **package ≠ capability** — capability-level dependency graph so subsets
  of a macro app are installable (Medusa modules precedent; fixes VS
  Code's all-or-nothing); upgrade-safe layered metadata (Salesforce 2GP
  manageability → N package layers + site overlay, extending ADR 0003's
  package|site sources); trust tiers (reviewed npm packages / sandboxed
  site scripts / out-of-process driver services).
- Survey extended: NocoBase, Directus extensions, Salesforce 2GP, Medusa,
  Strapi/Payload, WordPress, VS Code.
- New decisions **D10–D15**; sequencing note: D10/D11 are disciplines to
  adopt immediately (AppManifest evolves into contribution points as
  features are built); D13 designed together with D2; marketplace later.

No code, no features.json changes.

## 2026-07-26 (v2) — design framework reworked for pluggable backends (docs only)

Further requirements: apps on Convex or InstantDB, legacy-app mirroring (a
doctor's clinical system — mirror, then adapt on top while part of the team
stays on legacy), future backends (SQLite, DuckDB, REST, filesystem), and a
proposed rule "different database ⇒ different app". Rewrote
`docs/design/data-and-admin-topology.md` (v2):

- Axis B decomposed: five v1 "storage classes" → **driver × ownership mode
  (owned/adopted/foreign) × sync bindings** (separate first-class objects).
  Adapter interface with per-driver **declared capabilities** and explicit
  degradation (Hasura NDC / Trino connector model); capability matrix for
  postgres/sqlite/duckdb/convex/instantdb/rest/git-files.
- Engine-level laws: cross-backend links reference-only, transactions never
  span backends, permissions/series/hooks always on core Postgres.
- Legacy coexistence = strangler fig with the per-field ownership map as
  the migration dial (mirror → co-write → extend → retire).
- "Different DB = different app" resolved as **policy, not constraint**
  (D9): per-DocType descriptor stays (strangler + sync cases demand it);
  one *primary* backend per app is a flagged default.
- New decisions D7 (ship the adapter seam + conformance suite now,
  postgres-only driver first) through D9; sequencing unchanged — MDM
  foundation first, git-files driver as first non-SQL proof.

No code, no features.json changes.

## 2026-07-26 (later) — design framework: storage classes & scoped admin (docs only)

Follow-up discussion moved past Frappe's design to Featherbase's own
requirements (multi-tenancy explicitly NOT key). Wrote
`docs/design/data-and-admin-topology.md`, organizing the requirement space
into three orthogonal axes:

- **Axis A — organization/delegation**: module = admin delegation boundary
  (module admins author *types/field-sets* of shared base entities, never
  DDL); helpdesk generic→routed ticket case solved as base DocType + scoped
  Type registry (Salesforce record-types / JSM request-types pattern);
  generalizes to ERP as subtypes + config + dimensions + row partitions.
- **Axis B — storage/system-of-record**: five storage classes behind one
  adapter — native, adopted, external-live (= existing XDB spec), mirrored
  (push/pull/bidirectional sync engine: outbox, key crosswalk, per-field
  survivorship, reconciliation), git-backed (UI edits become commits/PRs,
  diffability preserved — the medallion-config CSV case). Single DB/single
  schema stays the default; multi-DB-per-instance rejected.
- **Axis C — naming/reflection/augmentation**: `table_name` moves into
  DocType metadata (kills derived `tab_` — configurable policy, none for
  adopted tables), reflection API, opt-in audit-column augmentation ladder.

Six candidate ADRs (D1–D6) + sequencing: MDM app first (reflection +
adoption + audit columns + module admin), then push-mode sync, then
git-backed class; type/field-sets and XDB later. No code, no
features.json changes.

## 2026-07-26 — research: multi-app / external-DB support (docs only, no code)

Question from the user: how does Frappe run multiple apps in one instance, do
they share one DB, can one app use a remote Postgres (Railway control schema,
live CLI writers) while others stay local — and can Featherbase do it?

- **Findings** (full write-up: `docs/research/frappe-multi-app-multi-db.md`):
  Frappe apps on a site share ONE database and one flat namespace — no
  per-app schema, no per-app connection; the isolation unit is the *site*.
  Remote/external data is only reachable via hand-coded Virtual DocTypes
  (`is_virtual` + db_insert/load_from_db/db_update/delete/get_list protocol),
  which need zero changes to the external schema but are not code-free.
- **Featherbase audit**: not supported today. Single scalar `DATABASE_URL`
  through the `sql` singleton (`db.ts`), no `is_virtual`/external-table
  concept in `doctypeDefSchema`, `createTableDDL` assumes it owns every
  table (no `IF NOT EXISTS`), `updateDocType` never reads
  `information_schema`. `tenancy.ts` (PLAT-008) is same-DB schema-per-site,
  not a multi-connection abstraction.
- **Spec written** (feather-spec): `docs/specs/external-database-doctypes.md`
  — XDB-1 connection registry (env-var creds, never DDL), XDB-2 table
  adoption by reflection (read-only when no PK), XDB-3 live Desk/API reads,
  XDB-4 hooked writes + conflict detection, XDB-5 app↔connection binding.
- Verified: docs-only session; no code, no `harness/features.json` changes,
  app untouched.
- **Next session**: review/approve the XDB spec, then implement XDB-1+XDB-2
  first (registry + reflection) — they unlock read-only value before the
  write path.
- Gotchas: docs.frappe.io and discuss.frappe.io block the container's fetch
  proxy (HTTP 403); research had to lean on web-search summaries plus the
  in-repo Frappe study.
## 2026-07-26 — multi-app / multi-database topology researched and specced (parallel session, merged into this branch)

Question raised: how does Frappe run many apps in one instance, do they share a
database or a schema, can one app sit on a *remote* Postgres while others stay
local — and specifically, can a management app be put on top of an existing
control schema in a Railway-hosted Postgres that CLIs keep writing to, without
changing that schema?

Answered from the upstream source, then written up as requirements. **No code
changed this session** — everything here is documentation.

- **`docs/research/frappe-multi-app-and-multi-db.md`** — the corollary research.
  Frappe: bench/app/site; one database *per site*, shared by every installed
  app, in one schema, with a flat `tab<DocType>` namespace (hence `HD Ticket`,
  `CRM Lead` prefixes); app ownership is metadata only (`Module Def.app_name`).
  A *site* can point at a remote host via `db_host` in `site_config.json`, but
  an *app* cannot — the connection is per site, per request. Foreign data is
  reached only through `frappe.database.get_db(host=…)` (a raw handle) or the
  **Virtual DocType** protocol (`load_from_db`/`db_insert`/`db_update`/`delete`
  + static `get_list`/`get_count`/`get_stats`, enforced by
  `frappe/model/virtual_doctype.py`). Frappe has *no* way to bind a normal
  DocType to a pre-existing table. Featherbase already matches Frappe on apps
  and app ownership; the gaps are the second connection, the virtual protocol,
  and table binding.
- **`docs/adr/0007-app-and-database-topology.md`** (Proposed) — decision: apps
  keep sharing one control DB; foreign data is bound **per DocType**, not per
  app; Featherbase never issues DDL against a source; cross-source saves are
  explicitly not atomic. Records why per-app DB routing, `postgres_fdw` as the
  primary transport, and ETL were all rejected.
- **`docs/specs/0001-external-data-sources.md`** (EDS-1…13) — the answer to the
  Railway case. A `Data Source` registry (credentials by env-var *name*, never
  stored), introspection, DocTypes bound to `{source, schema, table}` with a
  column map, SQL-pushdown reads, guarded writes, read-only sources, conflict
  detection with a whole-row fallback when there is no `modified` column, drift
  detection, control-side comments/attachments/versions, failure semantics, and
  the transaction boundary. Carries a **"what this requires of the foreign
  schema"** table: a single-column primary key is the only hard requirement;
  audit line, optimistic locking, `if_owner` scoping and submit/cancel each need
  one column and degrade loudly without it.
- **`docs/specs/0002-virtual-doctypes.md`** (VDT-1…5) — the escape hatch for
  non-Postgres sources, mirroring Frappe's protocol but validating it at
  registration and *rejecting* what it cannot honour (child tables, unique
  constraints) instead of silently dropping rows the way Frappe does.
- `docs/specs/README.md` indexes both; `CLAUDE.md` gained a pointer under "Where
  decisions live". `harness/features.json` untouched — capability IDs live in
  the specs.

Verification: documentation only, so no runtime verification applies and nothing
was marked passing. Each spec carries its own "definition of done" section
listing the end-to-end checks the implementation must pass (second Postgres
seeded by a fixture that mimics a CLI, HTTP CRUD against it, an out-of-band
concurrent write, a dropped column, Playwright on the generic list/form, and a
before/after schema comparison proving no DDL was issued).

Next: implement spec 0001, smallest slice first — `Data Source` + introspection
+ **read-only** bound DocTypes (EDS-1, 2, 3, 4, 5, 7, 13). That alone makes the
Railway control schema browsable in the Desk and needs no write-path or
conflict-detection machinery. Gotcha for whoever picks it up: `apps/server/src/
db.ts` exports one `sql` proxy used for both metadata and document data, and the
sandbox seam swaps its delegate — the per-DocType client resolver has to keep
metadata on the control pool, or the test harness will try to roll back a
transaction on the wrong connection.
## 2026-07-30 — NAM-001: naming series in the UI (imports no longer get hash ids)

Imported Tables named their rows with random hashes (`a0373bac75`) and there
was **no way to ask for a series** anywhere in the Admin. The engine had
supported it all along — `resolveName` (`document.ts:81`) implements `hash`,
`prompt`, `field:<column>`, and `PREFIX-.###` series, and `tableDefSchema`
accepts `id_pattern` — but **no client ever sent the field**, so
`createTable` fell through to its `?? 'hash'` default. `docs/TUTORIAL.md:44`
already noted the builder "exposes only a subset of the definition — notably
not `id_pattern`". This wires it up.

- **`packages/shared`**: `seriesPrefix('Sub Registrar Office')` ->
  `'SUB-REGISTRAR-OFFICE-'` (words uppercased, `-` joined, capped at 20
  chars, non-alphanumerics dropped so a `.` can never reach the prefix —
  `resolveName` splits the pattern at the first dot). `idPatternFor(name,
  digits=3)` composes `PREFIX-.###`. `inferTableDef` now returns
  `id_pattern`, so **an imported Table defaults to a readable series**
  instead of hashes — the actual bug the user hit.
- **`NamingControl.tsx`** (new, shared): kind picker (Series / Random / Set
  by user / From a column) + prefix + digit count, with a live preview
  ("First rows: ZONE-001, ZONE-002, ZONE-003…"). Digits go down to 1, so a
  bare `ZONE-1, ZONE-2, ZONE-3` is reachable. `parseIdPattern` /
  `composeIdPattern` round-trip the stored string; an empty prefix always
  composes back to `hash`, so it can never reach the server.
- **Table Builder**: Naming row under Table name; the prefix follows the
  Table name until the user edits it (`namingOverride ?? idPatternFor(name)`).
- **Import Wizard**: per-sheet "Row id prefix" for new-Table plans.
- **Existing Tables**: the builder only *creates*, so it could not fix the
  already-imported Zone. New `PUT /api/doctype/:name/id_pattern` +
  `setIdPattern()` and a **Naming** button on the list view (System Manager
  only) -> `/desk/naming/$doctype`. Deliberately narrow: the full
  `PUT /api/doctype` round-trip makes the client resend every column, and an
  omission there silently rewrites the schema. `validateIdPattern` now also
  guards the create/update paths.

**Also fixed (found while verifying, one line, same code path):** migration
`0055_terminology_rename` renamed `sort_field` -> `sort_column` and rewrote
existing rows, but left the column DEFAULT at the pre-rename `'modified'`.
Every Table created *since* — i.e. every Table built or imported through the
Admin: Zone, SRO, Registration District, Import Log — got
`sort_column='modified'`, a column that no longer exists, so `getList()`
rejected its own default `order_by` and **the Table's list view rendered
empty**. Zone showed "0 total" with 11 rows in the table.
`0061_fix_sort_column_default.sql` sets the default and repairs the rows.

Verified end-to-end in the browser (Playwright MCP, real CSV through the real
UI): dropping `sub registrar office.csv` derived prefix
`SUB-REGISTRAR-OFFICE-`, shortened to `SRO-`, created + imported 3 rows named
**SRO-001/002/003**; Zone's list view came back to 11 rows; Zone's Naming
page round-trips `ZONE-.###`. Plus `naming-series.spec.ts` (2 tests: build
with a series incl. 1-digit `ND-1`, and switch an existing Table to a series
with a 417 on a bad pattern) and 4 new shared unit tests. 68 pass in
`import-infer.test.ts`; `e2e` builder/import/listview/smoke all green.

**Gotcha — the dev database is shared across worktrees.** The `migration`
table here lists `0057_drop_helpdesk.ts`, `0058_system_flag.ts`, and
`0059_fix_literal_newline_choices.sql` — applied, but absent from this
worktree's `migrations/` directory. Parallel sessions on other branches are
migrating the same `featherbase` database. Consequences seen this session:
(1) 54 test failures ("Invalid values for Permission", literal `\n` in
`column_def.choices`) appeared and then fixed themselves when another
branch's `0059` landed; (2) `test/helpdesk.test.ts` fails 9 tests with
"Table HD Ticket not found" because another branch's `0057_drop_helpdesk`
dropped it while this branch still has the test file. **Neither is caused by
this change** — both are cross-worktree contamination. This migration was
renumbered 0057 -> 0060 to dodge the collision. Treat a red suite here as
suspect until you check `select name from migration` against `ls
apps/server/migrations/`.

- Next: the derived prefix for a long Table name is verbose
  (`SUB-REGISTRAR-OFFICE-001`); consider an acronym form for 3+ word names.

---

## 2026-07-31 — NAM-002: the row id is column one, not a setting above the grid

Follow-up to NAM-001, same branch. Two complaints, one root cause: naming was
modelled as a *setting* rather than as the identity *column* it is.

- The two screens disagreed. The Table Builder got the full `NamingControl`;
  the Import Wizard got a lone "Row id prefix" textbox hardwired to 3 digits
  (`planIdPattern` composed `${prefix}.###`), so a bare `ZONE-1, ZONE-2,
  ZONE-3` was reachable when building a Table but not when importing one —
  for the same file.
- The row id didn't look like a column. Users think of a record as having an
  ID and a name; when a sheet is mapped column-by-column, the id belongs in
  that grid.

**Both screens now open the grid with a locked, tinted "Row ID" row** carrying
the shared `NamingControl` — the same component, not a lookalike, so they
cannot drift again. `SheetPlan.naming_prefix: string | null` became
`id_pattern: string | null`, so the wizard can express every kind rather than
just a prefix.

**One dropdown replaces two.** `NamingControl` used to render a kind picker
plus, for the `field` kind, a second column picker. The columns now live in an
optgroup inside the kind select, because naming a row after a column *is*
picking that column. Selecting one encodes `field:<column>` directly, which is
what `resolveName` already implements — so "generate an id" and "take the id
from the sheet" stop being two mental models. The unreachable "field kind with
no column chosen" state disappears with it.

Preview copy is id-centric now ("Each row takes its id from district_id").

Verified in the browser, end to end: `registration_district.csv` imported as
`Rowid Check` with the row id sourced from `district_id` landed rows named
**50001 / 50002 / 50003**, not hashes. Series mode previews
`REGISTRATION-DISTRIC-001…` in the same row.

**Deliberately not built:** an *editable label* for the row id ("Zone Id").
There is nowhere to store it — `table_def` has `title_column` but no id label,
and ADR 0007 (#88) argues that field becomes unnecessary once the primary key
is renamed `name` -> `id` and `name` becomes an ordinary labelled column. The
row shows a fixed "Row ID" until #89 lands. Tracked in #90.

- Gotcha: the builder/import e2e specs self-skip when their fixture Table
  already exists (Tables cannot be deleted), so a green local run does not
  mean those paths ran — verify in the browser.
- Next: #90 (acronym prefixes for 3+ word names; the duplicate-identity-column
  question when the id is sourced from a file column), then #89.

---
## 2026-07-30 — Home Pages: curated navigation replaces the table-list sidebar (#80)

The sidebar listed raw table metadata — every table, grouped, in the user's
face on every screen. Frappe's answer is the Workspace: a curated landing
page per module. This session ships that as **Home Pages** — navigation
ONLY, deliberately: no page builder, no content blocks, no charts or number
cards, and no fields anticipating them.

- **The Table is renamed: `Workspace` -> `Home Page`** — the user-facing name
  everywhere (sidebar, headings, GLOSSARY), and the internal Table name too.
  UI-027's frozen wording ("configurable module home pages… a workspace
  lists its shortcuts") is satisfied by the renamed reality, so the full
  rename won over a surface-only one; its spec (now `home-page.spec.ts`)
  still pins shortcuts rendering + navigation. Mechanics follow the 0055
  discipline: 0036 is rewritten in place (same FILENAME, so upgraded
  databases — which recorded it as applied — never re-run it) to create the
  final shape fresh; new 0060 converges upgrades: copy-rename the table_def
  row (FK order: copy, re-point children, delete), physical rename, RLS
  policy recreated with `fc_has_read('Home Page')`, and a ref sweep
  (every `ref_table` column + share/data_scope/user_settings spellings).
- **Schema, minimal Frappe Workspace-Link model:** `module`, `sequence`,
  `links` sub-table (`Home Page Link`: label, type Link|Card Break,
  link_to -> Table) and `roles` sub-table (`Home Page Role`). The legacy
  JSON `shortcuts` column is KEPT WORKING, not migrated into links — links
  are Table references while shortcuts also target dashboards/reports/urls,
  which links deliberately cannot express (navigation only).
- **Sidebar flip (Frappe parity):** the sidebar lists Home Pages only, from
  the new `GET /api/home_pages` — the caller's visible pages with their
  card links, computed SERVER-SIDE (Admin UI stays generic): a page with
  empty roles is visible to everyone, otherwise to role-holders,
  Administrator always; each link is dropped unless the caller can read the
  target table (Frappe's is_item_allowed), dead links (dropped tables) are
  filtered, a card with no surviving links disappears. Role visibility is
  presentation scoping, NOT a security boundary — table access is still
  Permission rows. An **All tables** entry keeps the #74 grouped list (user
  modules first, collapsed System group) as a page — nothing unreachable.
  /desk now lands on the first visible page.
- **Seeds + auto-membership:** 0060 seeds one 'System' page grouping all 45
  engine tables into six cards (Users & Access / Automation / Email /
  Reports & Dashboards / Website / Platform catch-all — enumerated from
  table_def, so future engine tables land in Platform), and sweeps existing
  user tables onto per-module pages. A system=false table with module
  'Core' (production's pre-#74 'Zone') lands on a plain 'Home' page.
  `ensureHomePageForTable` runs on POST /api/doctype and app installs — a
  table you build NEVER vanishes from navigation. Deliberately NOT inside
  createTable: migrations 0037–0057 create engine tables before the system
  flag exists and must not seed spurious pages. Home pages stay ordinary
  documents — the generic FormView curates them; no dedicated editor.

Verified on throwaway DBs (never the local `featherbase`, ports 8905 only):
migration proven BOTH ways — fresh-from-zero (1 System page, 45 links,
idempotent under a double `up()`), and an upgrade from the previous tip
shaped like production (user table 'Zone' module 'Core' + a legacy Workspace
row with shortcuts): Workspace renamed with rows carried, shortcuts intact,
Zone linked on the seeded Home page, RLS predicate updated, column positions
identical to fresh. Server suite 493 green (14 new in home-pages.test.ts:
role scoping empty/held/Administrator, ordering, link + shortcut permission
filtering, card pruning, dead-link filtering, module page on demand, append
not duplicate, Core->Home, sub_table exclusion, seed idempotency + reseed).
Web unit 12 green, both typechecks clean. Full e2e against a fresh
single-origin stack on :8905 (built SPA served by the API): 85 passed,
2 skipped, 0 failed — including the flip exercised as a user (login ->
sidebar lists System -> cards -> open a table -> All tables shows everything
incl. collapsed System group -> builder-created table appears on its
module's page WITHOUT a reload).

Gotchas for later sessions:
- 0036 keeps its filename (`0036_workspace.ts`) although it now creates
  'Home Page' — the migration table records filenames; renaming the file
  would re-run it on production. Same trap as 0051/0057.
- ENGINE_TABLES (0058) now lists Home Page (+ Link/Role) and not Workspace:
  any DB reaching 0058 with this code created 'Home Page' at 0036; DBs that
  had Workspace recorded 0058 long ago and converge via 0060's rename.
- The FormView can curate pages but saving one does not invalidate the
  sidebar's ['home-pages'] query — the next mount/refetch picks it up.
  Realtime invalidation is a follow-up nicety.
- App uninstall leaves the module page and its (now dead) links behind;
  GET /api/home_pages filters them, so nothing breaks. Cleanup on uninstall
  is a follow-up.

Next: a Desk surface for /api/apps (list, install, uninstall buttons) so the
app system is operable without curl; realtime invalidation of the sidebar's
home-pages query on Home Page saves.

---

## 2026-07-30 — Apps ship fixtures; Helpdesk is a real installable app (#78)

An app manifest could declare tables, roles, permissions and code hooks — but
not DOCUMENTS: no way to ship a Workflow, Email Rule, Server Script, SLA,
Email Account, or Web Form with an app. That is why the Helpdesk survived
only as an imperative installer (`installHelpdesk()`) glued to a seed script.
Two changes (PLAT-006):

- **`fixtures` on AppManifest** — `{ table, rows[] }[]`, materialized through
  the NORMAL saveDoc lifecycle (validation, automation, id patterns,
  sub-tables) AFTER tables/roles/permissions, in declaration order (a
  Workflow before rows that reference it), with the app's own doc_events
  wired first so fixture saves run under them. New `installed_app.fixtures`
  jsonb column (migration 0059, the 0053 pattern) records `{ table, name }`
  for only what the install genuinely CREATED — a declared row whose name
  already exists is **adopted**: not overwritten, not recorded, exactly the
  roles/grants discipline. Uninstall deletes recorded fixture rows in
  reverse order via the real deleteDoc (on_trash + child rows), BEFORE the
  app's tables drop (fixtures may live on/reference app tables), skipping
  rows the user already deleted. Declarative manifests accept `fixtures` too
  (pure data — survives JSON); and an app table claiming `system: true` is
  now refused at install, same 417 the /api/doctype routes give — app tables
  are user-space and group under their own module.
- **Helpdesk is a genuine app now.** `src/sample-apps/helpdesk.ts` is an
  exported AppManifest (HD Ticket table, 3 roles, 13 grants, and six fixture
  docs: workflow, default email account, email rule, server script, SLA +
  4 priorities, published web form), `registerApp`'d in index.ts —
  REGISTERED, NOT INSTALLED: a fresh deployment has zero helpdesk tables;
  `POST /api/install_app { name: 'helpdesk' }` brings the whole thing up and
  uninstall removes exactly what install created. The helpdesk suites
  (server + web component) install the app per-test through the real
  installApp() path inside their sandbox transactions; the ticketing e2e now
  installs over the public endpoint instead of hand-building a slice.
  `seed:helpdesk` installs the app over HTTP first, then seeds demo content
  — and got fixed in passing: it still used pre-#61 `/api/resource` URLs
  (its exists() check always 404'd) and the pre-0055 `document_type` field
  on Assignment Rule, so it could not run twice.

Verified on throwaway DBs (never the local `featherbase`): migration proven
both ways — fresh migrate from zero (fixtures column present, zero helpdesk
tables) and a DB migrated to the previous tip then upgraded (0059 the only
change). Server suite 479 green (8 new in app-fixtures.test.ts: fixture
round trip incl. a core-table Email Rule referencing the app table,
adoption-survives-uninstall, user-deleted-row skip, declarative fixtures
over the API, failed-fixture abort, system:true refusal, full helpdesk
install→file-ticket-through-web-form→uninstall round trip with a
pre-existing look-alike Email Account left standing). Web unit 12 green,
both typechecks clean. Full e2e against a single-origin stack on :8904
(built SPA served by the API server): 84 passed, 2 skipped, 0 failed.
seed:helpdesk run twice against that stack — second run all "= exists",
round-robin alternates agents, SLA stamps present.

Gotchas for later sessions:
- The helpdesk Email Account fixture keeps `is_default: true` — install
  makes notifications deliverable out of the box; uninstall deletes the
  account (it is a recorded fixture) and deliberately leaves NO default:
  email.ts defaultSender() falls back to the oldest account, then
  no-reply@localhost (the exact call 0057 made).
- The Customer grant is create-without-write BY DESIGN (portal files via the
  web form, which whitelists columns) — provisionAccess now warns about that
  shape on every helpdesk install; the warning is expected noise, not a bug.
- CI-only flake, diagnosed and fixed after the first push: the web workflow
  test ended the moment it clicked Start — its `assertText('In Progress')`
  was satisfied by the status select's OPTION list, which contains
  "In Progress" from the first render — so WorkflowActions.apply()'s POST +
  refetch tail was still in flight when the test finished. On a slow box
  that tail ran after the sandbox rollback (stderr 42P01 on hd_ticket) and
  after jsdom teardown, and its final setState threw "window is not
  defined" as an unhandled rejection: every test green, run red. Fixed by
  asserting the workflow-state PILL and then waiting for the status
  select's VALUE to become In Progress (the doc refetch is the last network
  call apply() awaits). Reproduced deterministically before fixing by
  wrapping the fetch bridge with latency on the apply_workflow_action POST.
  Mid-file strays of the same class (form-create's post-save refetches) are
  harmless noise — jsdom is still alive between tests of one file; only an
  end-of-file tail is fatal.
- `scripts/verify-helpdesk.ts` is bit-rotted on main: it still speaks
  `/api/resource`, PUT + `modified`, `owner`/`creation`/`status`, and the
  removed `/api/apply_workflow_action` RPC. Untouched here (the helpdesk
  test suites cover the same ground in-sandbox); fix or retire it in its own
  session.

Next: a Desk surface for /api/apps (list, install, uninstall buttons) so the
app system is operable without curl; consider fixture UPDATE semantics on
re-install (today: uninstall + install).

---

## 2026-07-30 — De-ship the Helpdesk demo; `system` flag groups platform tables (#74)

A fresh deployment used to boot with 46 tables, one of them a full demo app:
0051 shipped the HD Ticket helpdesk (table, 3 roles, 14 grants, workflow,
SLA, a DEFAULT email account, email rule, server script, published web form)
into every database. And the sidebar inferred "engine table" from the magic
module string `'Core'` — which mis-filed every Table-Builder table (the
builder never sent `module`, so user tables defaulted into Core). Two
changes:

- **Helpdesk is opt-in now.** 0051 is deleted from the chain; its body moved
  verbatim to `src/sample-apps/helpdesk.ts` (`installHelpdesk()`, idempotent).
  New migration 0057 tears down everything 0051 created on upgraded
  databases — existence-checked, post-0055 names, no-op on databases that
  never had it; the three roles are removed only if nothing references them,
  and deleting the default email account deliberately leaves NO default
  (email.ts defaultSender falls back safely). `seed:helpdesk` installs the
  structure first (direct engine calls), then seeds demo users/tickets over
  HTTP as before; `reset:helpdesk` was still using pre-0055 names
  (tab_-prefixed, reference_doctype) and got fixed in passing.
- **`system` boolean on table_def** (0058 + rewritten 0002/0004 for fresh
  installs, same pattern 0055 set): backfilled `true` for the 45
  chain-created tables, declared in both TableMeta mirrors, accepted by
  `tableDefSchema` so migrations/seeds can set it — but REJECTED (417) on
  POST/PUT /api/doctype, so a user table can never claim it (save_doc was
  already refused for Table/Column via ENGINE_MANAGED). The Desk sidebar now
  groups on the flag: user tables by module on top, every system table under
  ONE "System" group, collapsed by default with a count badge, expandable,
  every entry a normal link, state remembered in localStorage — GROUPING,
  never hiding; the awesomebar still spans system tables (user tables just
  sort first in suggestions). Table Builder gained a Module input (default
  "Custom") so user tables land in a real module.

Verified: migration proven BOTH ways on throwaway DBs — (a) fresh migrate
from zero: 45 tables, no HD Ticket, zero `system = false` rows; (b) a DB
migrated on the OLD chain (0051 applied), then migrated with 0057+0058: all
helpdesk artifacts gone, table set and flags byte-identical to the fresh DB
(diffed). Helpdesk suites now install the structure per-test inside their
sandbox transactions; the ticketing e2e seeds the structure slice it needs
through the public API. After merging main (#71/#72/#75) into the branch,
everything re-run against the throwaway DBs: server 471 green (incl. 6 new
system-flag tests), web unit 12, both typechecks clean, full e2e on an
alternate-port stack (API :8902 / web :8903): 84 passed, 2 skipped, 0
failed. (An earlier pre-merge run hit IMP-006's local-timezone inference
flake, filed as #76 — #75 fixed it and the failure no longer reproduces.)

Gotchas for later sessions:
- A migration that creates a NEW engine table must pass `system: true` to
  createTable AND extend ENGINE_TABLES in 0058 — the CI-side regression
  test (system-flag.test.ts: zero `system = false` on a fresh DB) fails
  otherwise. On dev databases that test skips (user tables are legitimately
  system = false).
- POST /api/doctype still defaults `module` to 'Core' server-side; a user
  table posted without module therefore shows under a user group named
  "Core" (visible, just oddly named). Deliberate — changing the server
  default would touch every migration; the Builder now always sends one.
- The e2e ticketing spec leaves the HD Ticket structure behind on the dev DB
  (no DELETE /api/doctype yet, #66) — same footprint as seed:helpdesk minus
  demo content.

Next: consider dropping the dead `custom` boolean on table_def (superseded by
`system`), and a DELETE /api/doctype (#66) so specs can clean up structure.

## 2026-07-30 — avatar account menu + in-app Change password (#72)

The navbar avatar was a static initials badge and "Log out" a bare text
button beside it; there was no in-app way to change a password (the email
reset flow needs an outbound account a fresh deployment doesn't have).
Now (`DeskLayout.tsx`):

- **The avatar opens an account menu** (fc-card dropdown): the user's full
  name/email, **Change password**, and **Log out** (moved in here, same
  `data-testid="logout"`). Closes on Escape and on outside mousedown. Theme
  toggle and notification bell untouched.
- **Change password modal**: new password + confirm (`.fc-input`/`.fc-label`/
  `.fc-btn`, mirroring the ResetPassword page), client-side match check,
  POST `/api/set_password` with `{ password }` — the endpoint already scopes
  to the session user, so **zero server changes**. Success state
  ("Your password has been updated.") with a Done button; Escape and Cancel
  close.
- Four e2e specs that reached for the bare logout button now open the menu
  first (`desk`, `list-settings`, `i18n`, `i18n-login`).

Verified: new component suite `test/account-menu.test.tsx` (3 tests — menu
open/Escape/outside-click; change password posts and the NEW password then
logs in through the in-process server while the old one 401s; mismatch
blocks the submit and sends nothing) — web unit 12 green; new e2e
`account-menu.spec.ts` (ACCT-001: full loop incl. logout, old password
rejected, new accepted; `afterEach` restores the Administrator password
even on failure). Server suite 458 green, both typechecks clean. Full e2e
suite on a scratch stack (API :8901 / web :5901, throwaway DB): 83 passed,
2 skipped, 1 failed — the failure is IMP-006 (`import-file.spec.ts`),
pre-existing on unmodified main: SheetJS `cellDates: true` parses
`2026-01-15` to UTC midnight and `dateOnly()` in
`packages/shared/src/import.ts` checks LOCAL hours, so on any non-UTC
machine (here IST, hours=5) date columns infer as Datetime. Passes in UTC
CI; needs a timezone-independent `dateOnly`.

Gotchas: Playwright's `selectOption` fires no real mousedown, so the menu's
outside-click close never triggers around a language switch — `i18n.spec.ts`
closes the menu with Escape before switching. **Next**: the same modal can
serve the User form for System Managers setting another user's password
(#72 notes it); fix the IMP-006 timezone inference flake.
## 2026-07-30 — Single-origin deployment: the SPA ships inside the server image (#57)

Deploying used to require two services (server container + static SPA host)
and a reverse proxy wired so `/api` reaches the server — a shape nobody had
actually stood up correctly. Now one container does the whole job:

- **Dockerfile grows a `web-build` stage** that runs `pnpm --filter web
  build` and copies `dist/` into the final image. The serving stage is
  byte-for-byte the old prod-only server image otherwise.
- **`index.ts` serves the SPA when `apps/web/dist` exists** — static files
  plus an index-html fallback so client-side routes deep-link. The
  server-owned prefixes (`/api`, `/files`, `/private/files`, `/web`, `/ws`)
  pass through untouched, so unknown API routes keep the JSON error
  envelope (API-006). A dev checkout has no `dist/`, so `./init.sh` and the
  vite proxy are completely unaffected.
- **`railway.json`** at the root encodes the deploy contract for Railway
  (and documents it for everyone else): Dockerfile build, `pnpm --filter
  server release` as the pre-deploy step, `/api/ping` healthcheck.
- `docs/DEPLOY.md` gains a "Single-origin deployment" section; the
  separately-hosted-SPA path is still documented but demoted.

Verified: web build + dist-present boot exercised for real — `GET /` serves
index.html, hashed assets serve `text/javascript`, `/desk/...` deep-links
fall back to index.html, `/api/definitely-not-a-route` still answers the
JSON envelope, `/files/nope.png` still 404s as JSON, and
`POST /api/method/login` answers `{"message":"Logged In", ...}`. Server
suite 458 green, web unit 9 green — both run with `dist/` present, pinning
that the static block coexists with the API surface.

Gotcha for posterity: the web component tests import the server app under
vitest/jsdom, where `import.meta.url` resolves to a realm-foreign URL —
`fileURLToPath(new URL(...))` throws `ERR_INVALID_URL_SCHEME` there. The
static block therefore hands `import.meta.url` to `fileURLToPath` as a
*string*, guarded on the `file:` scheme.

Next: stand a real deployment up on a container platform and run the
DEPLOY.md smoke check against it.

## 2026-07-29 — Import Log: every import is answerable after the fact (IMP-011)

First real-use feedback on the wizard: an import reported "N rows imported",
but the user couldn't tell *which* Table the rows landed in (their DB has
hundreds of Tables, two of them zone-ish) — and there was no record to
consult. Two fixes:

- **`Import Log` Table** (migration 0056, engine-created): one row per
  `:import` request — ref_table, file_name, sheet_name, table_created,
  inserted, failed, error_summary (first 20 row errors), part/parts for
  chunked sheets. Written **server-side** in the collection action with
  `skipPermissions` (system log; the importer needs no grant on it),
  best-effort (`.catch(() => {})` — logging never breaks an import), so
  plain API imports are recorded too, with the wizard passing
  file/sheet/chunk context. Dry runs are not logged. Because it's an
  ordinary Table, the generic ListView *is* the history UI — zero new
  frontend surface; the wizard's "Import complete" line links to it.
- **Auto-match is now loud.** When the wizard's column-overlap scoring
  routes a sheet at an existing Table, the mapping panel shows an amber
  notice ("rows will be added to <Table> — pick New Table… if you meant to
  create one") — the silent-misdirection hazard the user hit. Manually
  retargeting clears it.

Verified: `import-action.test.ts` grows to 13 (log row content incl.
context and error summary; no-context imports log bare counts; dry runs log
nothing); wizard e2e extended to assert the notice, the history link, and
both sheets' log rows via the API (2/2 on a reset DB); server suite 443
green, web unit 9. Full e2e suite: 80 passed, 4 skipped, 0 failed (the
RT-003 flake from the previous round did not recur).

Follow-up (same day, user feedback): the wizard's existing-Table target and
the auto-match notice now carry a "view ↗" peek link opening that Table's
list in a new tab (plain `<a target="_blank">`, so wizard state survives) —
you can inspect what a matched Table already contains before importing into
it. Asserted in the wizard e2e. Gotcha from verifying it: deleting fixture
Tables with raw SQL leaves the dev server's meta cache stale — restart the
server (or hit invalidateMeta) after out-of-band deletions, or specs
skip/fail confusingly. Issues #66 (dev-DB fixture cleanup + the missing
DELETE /api/doctype) and #67 (awesomebar subtitle ambiguity) filed from the
same feedback session.
Second follow-up (same feedback session) — matching polish (IMP-012):
- **Labels are normalized, not copied.** A header row like `Zone ID,
  Zone Name, Reg_District_ID, Active_flag` used to become labels verbatim
  (mixed spacing/underscores forever). `prettifyLabel` now derives
  consistent labels ("Reg District ID", "Active Flag") — underscores/
  camelCase to spaces, Title Case for lone-case words, short all-caps
  tokens (ID/SKU) and mixed tokens ("(kg)") preserved. Machine
  `column_name`s were already consistent; matching is unaffected by
  construction (it compares sanitized forms, which erase exactly these
  differences).
- **Auto-match is bidirectional now.** `tableMatchQuality` returns both
  the sheet-side score AND target coverage; `shouldAutoMatch` requires
  score ≥ 0.6 AND (coverage ≥ 0.8 OR a shared name token). The real case
  that motivated it: a 3-column "Zone" sheet scored 100% into the 5-column
  "Registration District" Table and silently auto-selected it — now it
  defaults to New Table and shows a blue **near-match hint** ("a similar
  existing Table matches: X (3 of its 5 columns) — pick it to append
  instead"), with the peek link. Full-coverage matches under junk names
  (the e2e's renamed-export case) still auto-select.
- Mapping dropdown shows both identities (`Zone ID · zone_id (Int)`) so
  label-vs-machine-name is visible exactly where the confusion arose.
- Verified: 15 new unit tests (prettify cases; the exact Zone/Registration
  District geometry asserted not-auto-matched; junk-name/full-coverage
  still matched; name-token rescue) — server suite 458 green; wizard +
  import e2e specs re-run green on a reset DB. Full e2e suite: 80 passed,
  4 skipped, 0 failed. Third follow-up from the same session: the wizard's
  new-Table grid gained an editable **Label** column beside the machine
  name (it showed only snake_case column_names, reading as inconsistent
  next to the mapping panel's Title-Case labels) — asserted in the wizard
  e2e, re-run green.
Fourth follow-up (same session) — selective import + the target picker
(IMP-013):
- **Per-sheet skip**: every sheet's target can be "Skip this sheet" —
  all-or-nothing workbooks are gone. Skipped sheets show a gray note,
  count for nothing, and the import button disables when everything is
  skipped; single-active-sheet imports still navigate to their Table.
- **Per-column include**: the new-Table grid gained a "Use" checkbox per
  column (unchecked rows gray out and are excluded from both the created
  schema and the imported rows). Existing-Table mode already had this via
  the mapping's "— skip —".
- **The target picker replaces the native select** (unusable over hundreds
  of Tables: "New Table…" needed a full scroll-back, best candidates were
  buried alphabetically). Now a combobox: pinned "+ New Table…" and
  "⊘ Skip this sheet" actions always on top, a **Best matches** section
  (top 3 by tableMatchQuality, shown with "k of its n columns"), and a
  search box filtering the rest. Enter picks the first hit; Escape closes.
- Verified: new `IMP-013` e2e spec (skip a sheet via the picker, uncheck a
  column, search-with-no-hits keeps the pinned actions, import → excluded
  column absent from meta, skipped sheet's Table 404s, row count right) —
  3/3 wizard specs green on a reset DB; web typecheck clean; web unit 9.
  Full e2e suite: 80 passed, 5 skipped, 0 failed (the 5th skip is the new
  IMP-013 spec's own idempotency guard on the re-run DB). Issue #68 filed
  (import dedupe/upsert on a key column — non-binding proposal) for a
  second PR; #66/#67 remain from earlier feedback.
Fifth follow-up (same session) — two comprehension fixes from live use:
- **Sheet counts vs Table counts were conflatable.** The card header
  "Zone — 11 rows, 3 columns" described the FILE's sheet, but read as a
  statement about the (empty) target Table of the same name. Header now
  says `Sheet "Zone" — 11 rows, 3 columns in the file`, and an
  existing-mode target shows its CURRENT count beside the peek link
  ("holds 0 rows now", live via `:count`).
- **Skipping a mapped column is a checkbox now** ("Use", same as the
  new-Table grid; unmapped columns start unchecked; picking a column in
  the select re-checks the row) — the "— skip —" select option was hard
  to see and operate. The select's empty state reads "— pick a column —".
  One `include` array now drives both modes' column selection.
- e2e extended: target-count text, uncheck-a-mapped-column → imported row
  has null there, mapped-count honors the checkbox. 3/3 wizard specs
  green on a reset DB. First full-suite run caught the new list-view
  assertion being non-idempotent (fixed 'Cog' row accumulating in the
  persistent Table — the product's documented append semantics, see #68);
  spec now uses a per-run unique SKU, verified twice back-to-back.
  Final full e2e: 80 passed, 5 skipped, 0 failed.
Next: same as before — background import via the job queue for large files.

## 2026-07-29 — 0055 upgrade path fixed: pre-rename databases now migrate (#63 follow-up)

Running this branch against a real pre-rename database (a laptop last
migrated at 0054, before #63 merged) crashed `./init.sh` inside
`0055_terminology_rename.sql`. Root cause class: **0055 was only ever
verified against fresh databases**, where the rewritten 0001–0054 already
produce the new schema and 0055 is a no-op. Against a genuinely old
database it had four kinds of bugs, all fixed in place (safe to edit: 0055
never successfully committed on any upgraded DB — it crashed — and on fresh
DBs it's recorded and won't re-run):

- **FK dropped by assumed name.** Constraint names survive table renames:
  a DB that began life with `docfield` carries `docfield_parent_fkey`
  through both later renames, so `drop constraint if exists
  column_def_parent_fkey` was a silent no-op and the very next
  `update ... parent='Table'` tripped the still-armed FK (the exact error
  reported). Now dropped by pg_constraint lookup.
- **`create or replace function fc_has_read`** 42P13s when the old function
  had a different parameter name — now dropped with cascade first (§5
  recreates every policy anyway).
- **Domain-column renames missing entirely.** The rewritten migrations seed
  ~25 per-Table columns under new names that 0055 never renamed on upgrade:
  `document_type`/`reference_doctype`/`ref_doctype`/`doc_type` → `ref_table`
  across 16 Tables, `webhook_doctype`→`webhook_table`, Custom Field's
  `fieldname`/`fieldtype`/`options` (with the Link/Select/Table value map
  and the options→reference_table/choices/row_table split),
  `single_value.doctype`→`table_name`, `installed_app.doctypes`→`tables`,
  Workflow Document State `doc_status`→`target_status` including the
  0/1/2→draft/submitted/cancelled *value* conversion — plus the matching
  `column_def` metadata rows (incl. Table's own autoname/issingle/istable→
  id_pattern/kind and Column's fieldname/fieldtype/options/permlevel).
  §2 had also renamed Permission's ref column to `reference_table` where
  the engine reads `ref_table`.
- **Ordering data-loss trap**: §3's docstatus→status conversion does `add
  column if not exists status` + overwrite — on Tables with a *domain*
  `status` column (Email Queue/HD Ticket/ToDo/Background Job) it would have
  silently destroyed queue/ticket/todo/job state. The domain renames
  (`send_status`/`ticket_status`/`todo_status`/`job_status`) now run in a
  new §2c *before* §3.

Verified by construction, not inspection: scratch DB migrated with the real
pre-rename chain (worktree at ece91fd, 53 migrations), seeded with live
domain rows (a ToDo, Link+Select Custom Fields, a queued email, a done
job), then upgraded with the fixed chain — **information_schema column
diff and column_def metadata diff against a from-scratch database are both
empty**, every seeded value survived (Link→Reference split included), and
the real server booted against the upgraded DB: login with the preserved
password hash, ToDo list, Table create, and `:import` all green. Fresh
path re-verified byte-identical; full server suite 441 green.

Gotcha for future schema work: constraint names do NOT follow table
renames — never drop/alter a constraint by its fresh-install name in an
upgrade migration; look it up in pg_constraint. And any migration verified
"end-to-end" must be run against a database migrated by the *previous
release's chain*, not only from scratch.

## 2026-07-29 — the Import wizard: multi-sheet, existing Tables, dry-run, Choice detection (IMP-007..010)

Round 2 of the import feature (same branch/PR #65), per the agreed sequence:
"the import you can trust" plus multi-sheet workbooks and rename-tolerant
targeting. New Desk page `/desk/import` (sidebar "Import Data"; every list
view gains an "Import" button that preselects that Table).

- **Import into existing Tables.** Every sheet gets a target: create a new
  Table (inferred grid, editable names/types) or append to an existing one
  through a **column-mapping step** — file columns auto-matched by sanitized
  column name, then by label (`autoMapColumns`), unmatched left as "— skip —"
  for manual mapping. Mapped cells are coerced to the *target* column types.
- **Rename-tolerant suggestions.** The suggested target is scored by column
  overlap (`scoreTableMatch` = fraction of headers that auto-map), NOT by
  file/sheet name — so `export-final-v2 (3).xlsx` still finds its Table.
  ≥ 0.6 auto-selects; `?table=X` (the list-view button) wins at ≥ 0.3.
- **Dry-run** (`POST :import { rows, dry_run: true }`): same create-permission
  gate, every row through the same field-filter/defaults/zod pass an insert
  runs (`checkRowForInsert` in document.ts), plus prompt-name-required,
  existing-name conflicts, and duplicate-names-within-the-file — zero writes.
  Automation triggers do NOT run in the dry pass (documented); real import
  still reports per-row failures. The wizard's "Check" button surfaces
  "N ready, M with problems: row 7: …" before anything is written, and the
  import button becomes "Import anyway (skip M bad rows)".
- **Multi-sheet workbooks**: `parseWorkbook` yields every non-empty sheet
  with a header row; each becomes its own import plan. CSV = one sheet. The
  quick builder (`/desk/new-table`) still uses only the first sheet and now
  links to the wizard when it sees more.
- **Choice detection** (`inferChoices`): a would-be-Data column whose values
  repeat a small set (2–8 distinct, ≥ 6 samples, each option seen ~3x on
  average, ≤ 60 chars, no newlines) becomes a Choice column with the options
  pre-filled — surfaced in both the builder grid (target field) and the
  wizard grid, editable before create.
- **Verified**: server suite 441 green (10 new: dry-run trio + inference/
  mapping additions); web typecheck + 9 unit tests; new
  `e2e/import-wizard.spec.ts` (2 specs: the junk-named two-sheet workbook —
  new Table with detected Choice + auto-matched existing Table + dry-run
  catching a bad Int row + import skipping it; and the list-view Import
  button preselecting its Table) — both green on first run. Full e2e suite:
  79 passed, 4 skipped (create-path idempotency guards + pre-existing), 1
  failed — realtime RT-003 (@mention unread count), which passes on an
  isolated re-run and passed in this session's earlier full run before this
  round existed: a load-timing flake, not an import regression.
- Gotchas: a dropped file can beat the targets query — `loadFile` awaits
  `ensureQueryData` for the suggestion corpus rather than reading
  `targets.data`. E2e fixture columns must be unique per spec: two Tables
  with identical column sets legitimately tie on `scoreTableMatch`, and the
  suggestion picks the first alphabetically.
- Next (per the agreed sequence): background import over the
  `background_job` queue + realtime progress for large files; then paste-
  from-clipboard; then reference detection / auto-normalization (split
  repeated values into a linked Table).

## 2026-07-29 — drag & drop a CSV/Excel file, get a Table + its data (IMP-001..006)

Drop a `.csv`/`.xlsx` onto the Table builder (`/desk/new-table`) and
Featherbase infers the whole Table definition — snake_case column names from
the headers, types sampled from the data (Int/Float/Check/Date/Datetime/
Data/Text), labels from the original headers — prefills the existing editable
column grid plus a data preview, and on "Create Table & Import N rows"
creates the Table and bulk-inserts every row. The generic ListView/FormView
render it immediately with zero new frontend code (invariant #3).

- **Shared inference layer** (`packages/shared/src/import.ts`, pure):
  `sanitizeHeaders` (blank → `col_N`, duplicates and reserved standard
  columns get `_1` suffixes), `inferColumnType` (>140 chars or newlines →
  Text; `0/1` reads as Int, not Check — user can flip it in the grid;
  midnight JS Dates from SheetJS `cellDates` → Date, with time → Datetime),
  `inferTableDef`, `tableNameFromFile` ("customer orders.csv" → "Customer
  Orders"), `coerceRows` (yes/true → boolean, local-time Date → `YYYY-MM-DD`
  — `toISOString` would shift the day east of UTC).
- **Server: the first real collection action** (`:import`), which the #61
  registry had been waiting for. `POST /api/table/:table:import { rows }`
  (`apps/server/src/actions/collection-import.ts`) pushes every row through
  `saveDoc(..., 'insert')` — full permission/validation/id-pattern/trigger
  chain, duplicate names conflict instead of updating. Best-effort: bad rows
  come back as `{ index, message, fields }` while good rows land;
  PermissionError still fails the whole request; 10k-row cap per request
  (the client chunks at 500). `settings`/`sub_table` kinds refused.
- **Web**: SheetJS (`xlsx`, already a dependency for report export) parses
  both formats in the browser via dynamic import (`lib/parse-file.ts`,
  `cellDates: true`); the builder keeps its manual path untouched (the
  UI-011 spec still passes unchanged). Grid rows remember their
  `source_index` into the file so deleting/renaming inferred columns still
  imports the right cells.
- **Verified**: 46 new server tests (`import-infer.test.ts`,
  `import-action.test.ts`) in the full 431-green suite; new
  `e2e/import-file.spec.ts` (3 specs: real drag-drop via in-page
  `DataTransfer`+`File`, a real `.xlsx` built with SheetJS through the file
  picker, and a bad-file refusal) against real browser + server + Postgres;
  `doctype-builder.spec.ts` + smoke re-run green; both typechecks clean.
  Full e2e suite then re-run: 77 passed, 5 skipped, 0 failed (skips are
  the create-path idempotency guards — the import/builder specs skip once
  their Tables exist in the dev DB — plus the two pre-existing skips).
- Gotcha: in this container the pinned Playwright wants a browser build that
  isn't installed — run e2e with `CHROMIUM_PATH=/opt/pw-browsers/chromium`
  (the config already honors it). Also: Postgres `bigint` columns serialize
  back as *strings* through the API — assert with `Number(...)`.
- Next: the import currently targets only *new* Tables. A natural follow-up
  is dropping a file onto an existing Table's ListView to append rows
  (the `:import` action already supports it — it's UI-only work), plus
  Choice-type inference for low-cardinality columns.

## 2026-07-26 — terminology rename + API surface redesign (#59, #61, #62)

Two rounds landing as one PR, per the decided design in #59/#61: round 1
strips Frappe's `DocType`/`Doc`/`Field` vocabulary for `Table`/`Row`/`Column`
(plus ~25 related renames — `Permission`/`Share`/`Data Scope`,
`ref_table`/`reference_name`, `status`/`position`/`created_by`/`updated_at`,
`kind`/`tier`, `id_pattern`, `Reference`/`Choice`/`Sub-table`, `Metadata
Override`, dropped `tab_` prefix); round 2 replaces the ad hoc ~60-route
REST/RPC surface with one action registry (`src/actions.ts`): Generated
(`GET/POST /api/table/:table`, `GET/PATCH/DELETE /api/table/:table/:name`,
plus `:count`/`:meta`/`:actions`), Row action (`:submit`/`:cancel`/`:amend`/
`:apply_workflow_action`/`:rename`, colon-suffixed — not a slash sub-path,
since row names can already contain arbitrary characters), Collection
action (registry exists, none registered yet — no real bulk_update/
bulk_delete/import existed to migrate), and Method (`methods.ts`'s existing
whitelist). PATCH replaces PUT for row updates (a Custom Field added at
runtime would otherwise be silently nulled by a stale PUT). `/api/resource`,
`/api/doc`, `/api/list`, `/api/meta/:name`, and the five body-based action
routes (`submit_doc` etc.) are gone — collapsed onto `/api/table/...`.
`/api/save_doc` is untouched (the `feather-testing-postgres` npm package's
`seed()` fixture depends on its `{doctype, doc}` shape structurally).

- **#62, both bugs, fixed at the root, not worked around.** Every
  `whitelist()`/action registration now declares `effect: 'read' | 'write'`
  (default 'write' — the safe default requires POST, never silently allows a
  mutating GET). The RPC dispatcher (`/api/method/:path`) runs its own
  `rateLimit` + auth middleware chain instead of relying on the global
  `app.use('/api/*', ...)` registered after it (which it never reached,
  since Hono matches routes in registration order) — API-007 now covers it.
  `GET /api/method/frappe.client.delete` now 405s instead of executing the
  delete. Regression tests in `methods.test.ts`/`rate-limit.test.ts` pin
  both.
- **A real product bug surfaced by round 1, found via e2e, fixed at the
  root**: Background Job's own delivery state (queued/running/done/failed,
  written by `src/jobs.ts`) and the generic per-Table `status` column
  (draft/submitted/cancelled) collided on one physical column once
  `docstatus` was renamed to `status` — `saveDoc` protects `status` as a
  system-managed field, so no client could ever set a job's delivery state
  through the generic API. Fixed by moving `jobs.ts`/`apps.ts`/`index.ts`'s
  scheduler-job checks onto the `job_status` column the metadata already
  declared (migration 0018) but nothing read; `JobMonitor.tsx` follows.
  `test/global-setup.ts` also still truncated `tab_background_job` (a
  no-op silently disabling the once-per-run queue-empty safety net) — fixed
  to `background_job`.
- **e2e was not actually migrated despite earlier reports.** ~50 of 59
  Playwright specs under `apps/web/e2e/` still built fixtures in the raw
  pre-rename Frappe wire shape (`fields`/`fieldname`/`fieldtype`/`options`/
  `autoname`, `DocPerm`, `ref_doctype`, `document_type`/`doc_type`) — every
  one would have 417'd at `POST /api/doctype` the moment it ran, since
  `tableDefSchema` requires `columns`/`column_name`/`column_type`. Fixed via
  4 parallel agents (each verifying uncertain field names against the live
  migrations rather than guessing), plus a manual pass for the 5 files that
  used the now-reserved column name `status` for their own business field
  (renamed to `stage`) and one more real find (`doc_status`→`target_status`
  on Workflow, values, not just the key). `docs/TUTORIAL.md`/`TESTING.md`
  had the same gap — rewritten and the whole HTTP walkthrough re-verified
  against a live server.
- **Verified end-to-end, not just typechecked**: `pnpm --filter server
  test` 385/385, `pnpm --filter web test` 9/9, `pnpm --filter web
  typecheck`/`server typecheck` clean, and the full Playwright suite
  (`pnpm --filter web e2e`, real browser + real server + real Postgres) —
  78/79, the one skip being `doctype-builder.spec.ts`'s own idempotency
  guard on a second run against the same DB. Manually curled the entire new
  `/api/table/...` lifecycle (create → list → count → meta → actions
  discovery → patch → submit → cancel → amend → verb-enforcement 404s) and
  the full TUTORIAL.md walkthrough against the live dev server.
- **Deliberately out of scope, left as direct routes**: the ~40 remaining
  one-off utility endpoints (tenancy, apps, email, jobs, print, tags,
  permissions, reports, oauth, dashboard widgets, ...) were not forced into
  the `/api/method/:name` shape. They're already thin adapters over shared
  engine functions (the actual "ban the drift" requirement), so the
  remaining work is a URL-taxonomy pass, not a design or correctness one —
  lower priority than closing the two real security bugs and shipping the
  Generated + Row-action core. Also residual: `/api/upload_file`'s
  multipart field is still literally `ref_doctype` (client and server agree
  on it, so it isn't broken, just inconsistent) — a candidate for the same
  future pass.
- Gotcha for the next session: `apps/server/tsconfig.json` only includes
  `src`, so `pnpm --filter server typecheck` never checks `test/*.ts` —
  actually running the suites, not just typechecking, is the only real
  signal for test-file correctness.
- Next: the collection-action case has no real registrant yet (bulk_update/
  bulk_delete/import) — add one the first time a feature actually needs it,
  rather than inventing a speculative example now.

## 2026-07-26 — the app platform closes its four gaps (#54, #55, #56, #57)

Featherbase's first external consumer (a report server POSTing feedback rows
over REST) proved the engine sound but exposed four framework gaps. All four
closed, one commit each, nothing application-specific added to the framework:

- **#54 — manifests declare roles + permissions.** `AppManifest` gains
  `roles?: string[]` and `permissions?: AppPermission[]` (doctype, role,
  optional permlevel/if_owner, seven `can_*` flags); a grant may target a
  DocType the app doesn't own (same latitude as `doc_events`). Install
  creates roles before perms; an existing role or same-identity DocPerm
  (doctype, role, permlevel) is **adopted, never redefined**. The install
  ledger (`tab_installed_app.roles`/`perms`, migration 0053) records only
  what was genuinely created, so uninstall removes exactly that; a role is
  dropped only when no DocPerm links to it and no user holds it. A
  `can_create`-without-`can_write` grant warns at install — inserts strip to
  WRITE permlevels (the #45 trap) — and a test pins the empty-document
  behaviour. `test/app-grants.test.ts`, 7 tests.
- **#55 — declarative apps over the API.** `POST /api/install_app` accepts
  `{ manifest }` (DocTypes + roles + permissions as pure data) alongside the
  unchanged `{ name }`. The manifest persists (`manifest` jsonb, migration
  0054); uninstall tears everything down from stored data; boot has nothing
  to wire and neither warns nor fails. `doc_events` / `scheduler_events` /
  `override_whitelisted_methods` in a manifest are rejected with an error
  pointing at `registerApp()` — functions don't survive JSON. A declarative
  name owned by a code-registered app is refused (no shadowing). Still
  System-Manager-only, asserted by test — `{ manifest }` is a define-schema
  surface. `test/declarative-apps.test.ts`, 7 tests.
- **#56 — slug URLs.** `/api/resource/report-feedback` and
  `report_feedback` resolve to `Report Feedback`; the exact name (encoded or
  not) always wins; ambiguity is a 409, never a silent pick; unknown slugs
  fall through to the usual 404. The slug map lives in `meta.ts` and dies
  with every `invalidateMeta()`. Spaces in DocType names stay legal.
  Gotcha: two *table-backed* DocTypes can never share a slug — `tableName()`
  collapses the same variants, so the second create collides on its table;
  genuine ambiguity is only reachable via singles, which is how the test
  builds it. `test/slug-resolution.test.ts`, 6 tests.
- **#57 — production boot.** `pnpm --filter server start` (tsx, no watcher;
  tsx moved to dependencies), `PORT`/`DATABASE_URL` from the environment as
  before. `pnpm --filter server release` runs migrations + patches inside
  one `pg_advisory_xact_lock(hashtext('featherbase-release'))` so N booting
  instances serialize — documented as the once-per-deploy step that runs
  before new code serves. Vendor-neutral `apps/server/Dockerfile` (no
  browser downloads; Chromium still resolves from the environment) and
  `docs/DEPLOY.md` runbook, which supersedes the deployment half of issue
  #25. `prepare: false` and the `DATABASE_URL` default are untouched.
  `./init.sh` unchanged — it uses none of the new scripts.

Verified: `pnpm test` (382 server / 9 web) green **before and after** the
e2e run; `pnpm smoke` 2/2; full e2e 77 passed, 2 skipped (pre-existing
conditional skips); both typechecks clean. Production path exercised live:
`release` twice concurrently (serialized cleanly), `start` on `PORT=8010`,
ping + smoke + Frappe-shape login. Live HTTP transcript against :8000: a
declarative feedback app installed from a manifest, admin-minted API key for
a scoped user, slug-URL insert + filtered list, 401/403/417 refusals all
correct, uninstall dropping doctype + grant + (once unheld) role — and the
shared-role-survives rule observed live when uninstalling while a user still
held the role.

Next: QA the four PR-mapped commits from the branch; the owner decides
issue #25's disposition (docs/DEPLOY.md is written as its replacement).
Gotcha for future declarative work: `save_doc` updates require the loaded
`modified` timestamp (optimistic concurrency) — a bare role-strip on User
417s, which is what turned transcript step 16 into a live demo of the
shared-role rule.

## 2026-07-24 — one ticketing system: HD Ticket promoted to a migration, `Ticket` retired (issue #45)

The repo carried two parallel ticketing demos (audit #44): the migration-seeded
`Ticket` (TICK-, tested everywhere, basic) and the script-seeded `HD Ticket`
(HDT-, the richer helpdesk — status-field workflow, SLA, assignment, web form,
portal — but guarded by nothing). Consolidated onto HD Ticket:

- **`0051_helpdesk.ts`** seeds the helpdesk *structure* (roles, DocType — now
  with proper field labels — DocPerms, `HD Ticket Flow` on `state_field:
  'status'`, Email Account/Rule, Server Script, SLA, Web Form). Skips cleanly
  on databases the old seed script already populated. Demo *content* stays out
  of the migration chain (audit #49): `seed-helpdesk.ts` now seeds only demo
  users, the round-robin Assignment Rule (it links those users), and five
  sample tickets filed through the public web form; `reset-helpdesk.ts`
  removes exactly that content and leaves the structure.
- **`0052_drop_ticketing.ts`** removes `Ticket`/`Ticket Comment` (workflow,
  roles, perms, tables) from existing databases; `0047_ticketing.ts` is
  deleted so fresh databases never create them.
- **Tests ported and strengthened:** `test/helpdesk.test.ts` (9 tests: HDT
  series, SLA stamping, server-script defaults, if_owner scoping, workflow
  role gates + resolution condition + status save-protection, resolved-email
  queueing, web-form owner attribution), `web/test/helpdesk.test.tsx` (5 MECE
  component states), `e2e/ticketing.spec.ts` (self-seeding, cleans up after
  itself). Tests create their own documents — nothing relies on demo content.
- **Two framework findings while porting.** (1) A `can_create`-without-
  `can_write` DocPerm can never populate fields on insert —
  `stripUnwritableFields` strips to WRITE permlevels — so the Comment/File
  collab grants now include `can_write` (the old seed's create-only grants
  were silently broken for agents). (2) `tab_email_queue` stores the raw
  template; rendering happens at delivery, so queue-level assertions must
  expect `{{ doc.name }}` unrendered.
- `verify-helpdesk.ts`'s "customer sees only own tickets" check now asserts
  scoping membership, not an exact count (sample tickets are owned by the
  demo customers).

Verified: fresh migrations applied on the dev DB (0051 built the structure,
0052 dropped the old system); `pnpm test` → e2e (78) → `pnpm test` green both
times; `seed:helpdesk` then `verify:helpdesk` — **all 32 checks pass**;
typecheck clean.

Next: merge the CI (#46) and newcomer-docs (#47) branches; then the test
reorganization (#48) can drop its ticket-file references.

## 2026-07-22 (follow-up 5) — the e2e suite no longer poisons `pnpm test` (issue #42)

`pnpm test` was order-dependent: green on a clean database, four failures in
`test/i18n.test.ts` after any e2e run. Reproduced before fixing — 5/5, run the
two i18n specs, 4 failed — and the same cycle is now green.

`tab_translation` carries a unique index on `(language, source_text)`. The two
i18n e2e specs seed French strings through the running server, so those rows are
**committed, not sandboxed**, and they were never deleted. The sandboxed server
test then tried to seed `(fr, 'Save')` under its own `name` and hit the index —
rollback cannot help, because the row blocking it belongs to a different,
already-committed transaction.

- **`apps/web/e2e/translations.ts`** (new) owns seeding and cleanup for both
  specs. It clears whoever currently occupies `(language, source_text)` rather
  than just the name the spec uses, derives the name from the pair so only one
  row per pair can exist, and deletes what it created in `afterAll`.
- **The seeds were also failing silently.** Both specs ignored the `save_doc`
  status, so a seed rejected by the index looked like successful setup —
  `i18n.spec.ts` was in fact running with two of its three translations missing
  and passing only because `i18n-login.spec.ts`'s leftovers happened to carry
  the same strings. The helper now throws on a bad status.
- **`mapDbError` blamed the wrong field.** It derived the field from the
  constraint name, which only works for our generated `tab_x_field_uq` singles;
  a plain unique index, a composite, or the primary key all fell back to
  reporting `name`. So this collision surfaced as "Duplicate value for **name**"
  while `name` was fine — the single biggest reason it was hard to diagnose. It
  now parses the columns out of Postgres's error `detail`
  (`Key (language, source_text)=(fr, Save) already exists`) and falls back to the
  old constraint-name logic only when `detail` is absent.

Verified: both new tests confirmed **red before the fix and green after**, not
merely green — the mapper test asserts the message names `language, source_text`,
and `flags.test.ts` still passes, so the single-column `_uq` path is unchanged.
Full sequence `pnpm test` → e2e → `pnpm test`: 359/359 server and 10/10 web
**both times**, e2e 78/78, zero `tab_translation` rows left behind, both
typechecks clean.

Next: nothing outstanding from #42. #38 (verify the container path) is still
open.

## 2026-07-22 (follow-up 4) — `init.sh` can no longer report success for someone else's server

Two bugs found while verifying #33, both of which had been quietly producing
wrong results rather than failures.

**`./init.sh` reported `init OK` while its own server was dead.** A dev server
from a *different checkout* held `:8000`; this run's server died with
`EADDRINUSE`, but the health check passed because the other process answered.
The script then ran the smoke suite — and an e2e suite — against a tree whose
code was not the one under test. Three separate defects fed this:

- **The port kill matched clients, not just listeners.** `lsof -ti tcp:8000`
  also returns processes merely *connected* to 8000, so cleaning the API port
  would have killed the web dev server, whose proxy holds a client connection
  to it. Verified directly: `lsof -ti tcp:8000` returned the vite pid. Now uses
  `-sTCP:LISTEN`.
- **A single SIGTERM with a fixed `sleep 2` was assumed to work.** Now waits for
  the port to actually clear, escalates to SIGKILL, and *fails loudly* if the
  port is still held rather than starting a server that cannot bind.
- **A responding port was treated as proof of our own server.** After boot the
  script now asserts the process listening on each port is a descendant of the
  one it started, naming the intruder if not.

Also scoped the leftover-process cleanup: `pkill -f vite` killed the dev servers
of every other worktree on the machine. It now matches `$PWD/apps/*`.

**`getBrowser()` cached a dead Chromium forever.** `browserPromise` was memoized
unconditionally, so once the browser died under a long-lived server — killed
with a process group, OOM, crash — every later call got the dead handle. PDFs
would 500 and thumbnails would come back `null` *silently*, because
`makeThumbnailDataUrl` swallows the error, until someone restarted the server.
This is what made `thumbnail.spec.ts` fail reproducibly against a long-running
server while passing against a fresh one. `getBrowser()` now checks
`isConnected()` before reuse and does not cache a failed launch.

Verified: the new test in `thumbnails.test.ts` closes the browser and asserts the
next thumbnail still renders — confirmed failing without the fix and passing with
it, not just passing after. `descends_from` was exercised both ways against the
live process tree (accepts the real ancestor, rejects the web server and pid 1).
`./init.sh` boots clean with no `EADDRINUSE` and both ports owned by this
worktree. Suites: server 359/359, web 10/10, e2e 78/78, typecheck clean.

Gotcha for the next session — **the e2e suite poisons `pnpm test`**, filed
separately as issue #42. `tab_translation` carries a unique index on
`(language, source_text)`; `apps/web/e2e/i18n.spec.ts` and `i18n-login.spec.ts`
commit rows there and never delete them, so the sandboxed `i18n.test.ts` cannot
seed `(fr, 'Save')` afterwards and four tests fail.

## 2026-07-22 (follow-up 3) — the database is called `featherbase` (issue #32)

The Postgres database kept the project's former working name. Renamed to
`featherbase` across the three places that name it, plus the existing database.

- `init.sh` — the `DATABASE_URL` default (one site now, since follow-up 2
  consolidated the two `su postgres` calls into it)
- `apps/server/src/config.ts` — the `DATABASE_URL` fallback, which must stay in
  sync with `init.sh`
- `apps/server/test/rls.test.ts` — the `RLS_TEST_URL` fallback. The
  `desk_client` **role** name is unchanged; only the database moved.
- the live database, via `ALTER DATABASE frappe_clone RENAME TO featherbase` —
  instant, copies no data, so nothing was reseeded

Deliberately not touched: `docs/research/frappe-architecture.md`, where
`frappe_clone` is a *filesystem path* to an upstream Frappe checkout, and the
dated entries in this file, which are historical records.

CLAUDE.md's "Known rough edges" section is gone — this was the last real entry
in it, and the remaining Chromium note describes correct behaviour, so it moved
to Environment.

**Verified on macOS 15 / Homebrew postgresql@17:** `./init.sh` to `init OK`,
`pnpm test` 358/358 server + 10/10 web, e2e 78/78.

**Gotcha found while verifying — not caused by this change.** The first
`pnpm test` failed 4/358 in `i18n.test.ts` with
`417 ValidationError: Duplicate value for name` from `seedFrench`. The cause is
that the **e2e suite commits `tab_translation` rows that outlive the run**
(`fr-e2e-Save`, `fr-e2e-Priority`, `fr2-Log-out`), so any `pnpm test` after an
e2e run fails. Reproduced deterministically: clear the table, unit suite is
358/358; run e2e, three rows come back. This is the same "state outlives the
run" family as the job queue in #35 and the portal tickets fixed in #37 —
tracked separately. **Fixed in follow-up 5 above (issue #42).**

## 2026-07-22 (follow-up 2) — the repo boots outside the container (issue #33)

`./init.sh` was Debian-only and the Playwright config pointed at a container-only
binary, so the documented "run `./init.sh` first, every session" protocol was
impossible on macOS. Both are now environment-driven. Verified on macOS 15 with
Homebrew `postgresql@17` (login user `siraj`, trust auth, port 5432) — the
Debian container path is unverified, see the caveat at the end.

- **`init.sh` no longer manages Postgres it does not need to.** `DATABASE_URL`
  is the single source of truth (default unchanged: `frappe_clone`, matching
  `apps/server/src/config.ts` — #32 has not landed). The script probes that URL
  with `psql` and does nothing at all if it answers, so an already-up
  container is a no-op. Only on failure does it (a) start a cluster, branching
  `pg_ctlcluster` (Debian) vs `brew services` (macOS), then (b) create the role
  and database over whichever superuser connection the host accepts — the
  current login user first, `su postgres` when running as root. `pg_lsclusters`,
  the hardcoded `16`, and the unconditional `su postgres` are gone.
- **Port cleanup used `fuser "$port/tcp"`, which silently did nothing on macOS.**
  BSD `fuser` exists but rejects that syntax (`'5173/tcp' does not exist`), so
  stale dev servers were never killed and the "idempotent restart" was a no-op.
  Now prefers `lsof -ti tcp:$port`, falling back to `fuser`.
- **`( … & )` around the dev servers hung the script on macOS.** The subshell
  outlives the script holding its stdout, so `./init.sh | tee` never saw EOF and
  appeared to hang forever after printing nothing. Now `( … exec … ) &`.
- **Chromium is resolved, not hardcoded.** `playwright.config.ts` sets
  `executablePath` only when `CHROMIUM_PATH` is set, otherwise letting Playwright
  find its own install. `print.ts` keeps its `PLAYWRIGHT_BROWSERS_PATH` scan but
  no longer assumes the Linux-only `chrome-linux/chrome` layout (mac and win
  layouts added), and still falls through to the default launch.
- **Playwright now runs `workers: 1`.** It defaults to half the host's cores —
  1 on the container, 6 here — and the specs share one server and one database,
  several mutating global state (System Settings, active language, client
  scripts). Parallel runs failed a *different* 1–5 specs every time. Same
  rationale as the suites' existing `fileParallelism: false`.

Two pre-existing bugs surfaced, both invisible until a database was built from
scratch or a suite run twice:

- **`getActiveWorkflow` broke every fresh-database migration.** It queries
  `tab_workflow` (created in 0015) and its `state_field` column (added in 0048),
  but bootstrap migrations from 0005 on save documents, and every save asks for
  the active workflow. So `pnpm --filter server migrate` could never complete on
  an empty database — it died at 0005, then at 0047. Guarded with the probe idiom
  `meta.ts` already uses for `tab_property_setter`, checking the newest column so
  one probe covers both cases; only the positive is cached, so the schema
  completing mid-process is picked up.
- **`portal.spec.ts` was not idempotent.** `beforeAll` recreates its users but
  never deleted their tickets, so Alice accumulated one more per run and the
  `toHaveCount(1)` assertion failed on every run after the first (6 rows after 6
  runs). Now clears leftovers first, like `dashboard.spec.ts` and `calendar.spec.ts`
  already do.

Verified end-to-end on macOS: `./init.sh` from an empty database through all 50
migrations to `init OK` (exit 0, both smoke suites green); `pnpm test` 358/358
server + 10/10 web; the full e2e suite 78/78, **twice consecutively** — the
repeat run is the point, since it is what caught the portal bug. Both typechecks
clean. `print-pdf.test.ts` passes, which exercises the real Chromium launch
through the new resolution path.

Caveat: the Debian/container path could not be exercised from this machine. The
container branch is reached only when `DATABASE_URL` does not answer, and it
keeps `pg_ctlcluster`/`su postgres`, but it is unverified — worth one run inside
the container before trusting it.

Next: #32 (rename `frappe_clone` → `featherbase`) now touches a much smaller
surface — `init.sh` reads the name from `DATABASE_URL`, so only
`apps/server/src/config.ts` and `apps/server/test/rls.test.ts` hardcode it.

## 2026-07-22 (follow-up) — an interrupted test run no longer poisons the next one (issue #35)

`tab_background_job` was the one piece of state surviving a run. Test bodies are
transaction-isolated by the sandbox and roll back on their own, but a run killed
partway through (Ctrl-C, crash, restart) leaves `queued` rows committed by tests
that DID finish and never got drained. The next run then failed
`jobs-recurring.test.ts` with `expected 2 to be 1` — `drainJobs()` counts any job
it runs, and JOB-003's `setup()` only clears its own `demo_heartbeat` rows, so an
orphan of any other method inflated the count. Nothing in that failure pointed at
stale state, so it read as a real bug or as flake.

- **`apps/server/test/global-setup.ts`** empties the queue once per run, wired in
  as `globalSetup` in both vitest configs. It runs in the main Vitest process,
  outside any sandbox transaction, so the delete actually commits. Guarded with
  `to_regclass` so an unmigrated database is a no-op rather than a confusing
  hard failure.
- Global rather than per-file on purpose: the queue is shared across files, which
  is also why both suites set `fileParallelism: false`. This closes the same hole
  at run scope.
- **`postgres` added as an `apps/web` devDependency.** The web config reuses the
  server's setup file, but Vite resolves that file's bare imports from the web
  root, and pnpm's isolated layout will not supply `postgres` transitively via
  the `server` dependency.

Verified by reproducing the bug, not just by re-running a green suite: injected
an orphaned `queued` row, confirmed the old config fails (`expected 4 to be 1`),
then confirmed the same state passes with the fix. Full suite run from a
deliberately polluted queue: server 358/358, web 10/10, both typechecks clean,
`pnpm install --frozen-lockfile` passes.

Next: nothing outstanding from #31/#35. `./init.sh` is still Debian-only and
cannot boot on macOS — see the gotchas in the entry below for the local
Postgres 17 setup that replaces it.

## 2026-07-22 — feather-testing-postgres is now a published npm dependency (issue #31)

The harness existed twice — `packages/feather-testing-postgres` here and its
own public repo — with byte-identical `src/`. Deleted the workspace copy and
consumed the published package, so the two can no longer drift.

- **Published `feather-testing-postgres@0.1.0` to npm.** The public repo was
  packaging-ready but had never been published. Added the missing `types`
  field upstream (commit `620da8c`); the `peerDependencies` fix issue #31
  called for was already done upstream, so only `types` was outstanding.
- **Swapped `workspace:*` → `^0.1.0`** in `apps/server` and `apps/web`,
  deleted `packages/feather-testing-postgres`.
- **Added `test.server.deps.inline: ['feather-testing-postgres']`** to both
  vitest configs. Required: the package ships raw TypeScript (`main:
  src/index.ts`, no build step), and Vitest does not transform `node_modules`
  by default. It only worked before because pnpm symlinks workspace packages.
- **Verified the risky part.** A testing library must share the consumer's
  React instance; a nested copy causes "invalid hook call" or silently broken
  hooks. `node_modules/.pnpm` holds exactly one `react@19.2.7` and one
  `react-dom@19.2.7`, and the lockfile resolves every peer to those same
  instances. `apps/web/vitest.config.ts`'s existing `resolve.dedupe` stays.

Verified: green baseline captured BEFORE the swap, then again after —
server 358/358 (88 files), web 10/10 (2 files), both typechecks clean. The
swap was first validated against an `npm pack` tarball, whose shasum
(`acc3cfe…`) matches what the registry now serves, so the tested bytes and the
published bytes are identical.

Gotchas:
- `./init.sh` is Debian-only (`pg_lsclusters`/`pg_ctlcluster`) and cannot boot
  on macOS. Ran against Homebrew Postgres 17 instead, creating the `postgres`
  and `desk_client` roles and an empty `frappe_clone` that `pnpm --filter
  server migrate` filled (50 migrations). Stayed on 17 rather than 18 to avoid
  changing two variables at once; 17 is also Supabase's current default.
- **An interrupted test run poisons the next one.** Orphaned `queued` rows
  survive in the shared `tab_background_job` table and fail
  `jobs-recurring.test.ts` with `expected 2 to be 1` — nothing in the failure
  points at stale state. `delete from tab_background_job` clears it. Worth
  fixing in global test setup; not done here to keep this change single-purpose.

Next: consider the queue-contamination fix above, and note the package is
source-only — if a non-Vitest consumer ever appears, give it a real `tsc`
build with declarations instead of relying on `deps.inline`.

## 2026-07-18 — Adopted PR 2's genuinely-better pieces + merged the testing library (beyond the 126)

A deliberate best-of-both pass after the PR 1 vs PR 2 verdict: PR 2 loses the
architecture war but four of its ideas were superior and are now adopted here.

- **Frappe wire-format compat (additive)**: sessions ride an HttpOnly `sid`
  cookie alongside the Bearer token; Frappe-shaped `POST /api/method/login`
  ('Logged In' + cookie) and `/api/method/logout`; error bodies carry
  Frappe's `exc_type` (NotFound → DoesNotExistError); and the
  `frappe.client.*` RPC namespace (get_list/get/get_count/get_value/insert/
  set_value/delete/get_doctype + frappe.ping) as thin engine adapters. A
  frappe-js-sdk-style client works unchanged. `test/frappe-compat.test.ts`.
- **Lifecycle + hooks.py parity**: new controller events in Frappe's exact
  order — before_validate, on_update (fires on insert, update, submit,
  cancel), before_submit/before_cancel (pre-write, abortable);
  `doc_events['*']` wildcard controllers; app manifests gained
  `scheduler_events` (guarded recurring job, dropped on uninstall) and
  `override_whitelisted_methods` (restored on uninstall).
  `test/hook-parity.test.ts`.
- **Desk affordance pack**: Frappe-style standard filter bar (typed
  per-column inputs; Selects as dropdowns) feeding the same URL filter list
  as the advanced builder; colored indicator pills for Select values;
  module-grouped sidebar (app modules first, Core under System — reordering,
  not hiding); Cmd/Ctrl+K focuses the awesomebar which now also surfaces
  command actions; breadcrumbs + monospace names. Playwright e2e: 77 passed.
- **Harness upgrade (PR 2's best idea)**: `harness/evaluation/` brings the
  default-FAIL contract (`enhancements.json` + `results.json` — build
  sessions never self-approve; only the fresh-context evaluator in
  `.claude/agents/evaluator.md` flips a result after reading evidence) and
  the differential oracle (`diff-request.sh` + `normalize.jq` — same request
  to a real Frappe at $FRAPPE_REF and the clone, normalized deep-diff).
  `features.json` stays frozen; this governs everything after the 126.
- **Merged the testing agent's main**: feather-testing-postgres (Ecto-style
  per-test rollback sandbox) + their 74-file suite migration + their
  migration-seeded `Ticket` demo app. My helpdesk was renamed **HD Ticket**
  (real Frappe Helpdesk's name) on its own HDT-.##### series so both
  metadata apps coexist; my migrations renumbered 0048-0050; my new tests
  rewritten onto the sandbox (incl. the frozen-now() job nudge).
- **Coverage**: touched modules driven to 99.2% statements / 100% functions
  (`test/coverage-gaps.test.ts`); remaining lines are defensive guards
  (early-migration table checks, readdir catch).
- **Verified**: server suite 358 green ×2 consecutive runs, web component
  suite 10 green, Playwright 77 green, `verify:helpdesk` 32/32.
- **Gotchas**: (1) the shared dev DB couples suites — a Playwright i18n run
  leaves tab_translation rows that collide with the sandboxed i18n unit
  test; clean tab_translation if it flakes. (2) The 0047 demo Ticket tests
  assert absolute TICK-000N names — don't seed other apps onto the TICK-
  prefix (HD Ticket uses HDT-). (3) `/api/method/login` must stay registered
  BEFORE the generic /api/method dispatcher.
- **Not adopted, on purpose**: PR 2's JSONB single-table store (generated
  DDL is the more faithful + indexable clone), the NestJS/Drizzle stack
  swap, and Supabase (was aspirational in PR 2's docs, never in its code).

## 2026-07-17 — PR 1 vs PR 2 verdict + Helpdesk built from metadata (beyond the 126)

**Verdict**: both parallel implementations were booted and driven over HTTP
against a 16-point ticketing checklist. PR 1 (this codebase) wins decisively —
PR 2 (NestJS/Drizzle/JSONB) has a solid, honestly-reported metadata core but
no workflow/assignments/email/comments/attachments/web-forms/realtime, plus an
owner-stamping bug that breaks if_owner. Full write-up: `docs/archive/PR-COMPARISON.md`.
Features missing in BOTH (now built here): Assignment Rules, SLAs, workflow
state binding. Still open in both: inbound email → ticket.

**Framework additions** (all beyond the 126 — `features.json` untouched):
- `state_field` on Workflow (migration 0047): binds the workflow to an
  existing field (e.g. `status`) instead of the parallel `workflow_state`;
  validated on save; inserts are forced to the initial state; direct saves
  cannot change the bound field (transitions only via the workflow endpoint,
  so role gates can't be bypassed).
- Email Rules: `on_create`/`on_save` events now fire (they existed in the UI
  but were never called); conditional on_save rules fire only on the
  transition into the match (old-doc snapshot); recipients support
  `{{doc.field}}`; workflow transitions count as saves (rules + realtime
  `updated` events fire from `applyWorkflowAction`).
- Assignment Rules (migration 0048): condition + user pool, round-robin ToDo/
  notification per matching creation, optional `assign_to_field` stamps the
  document. Shared `createAssignment` helper also backs `/api/assign`.
- Service Level Agreements (migration 0049): per-priority response/resolution
  windows stamp `response_by`/`resolution_by`/`sla_status` on insert (fields
  are declared by the target DocType); recurring `check_sla` job (60s) flips
  overdue open docs to `Overdue` once and emails the escalation role.
- Web-form owner attribution: a logged-in submitter owns the created doc
  (saveDoc `skipPermissions` — web form only), closing the if_owner portal
  loop. Anonymous submits still create as Administrator.
- PERM-005 fix: user-permission list narrowing passes NULL links (`IN`
  excluded them, emptying agents' lists and disagreeing with detail reads).

**Helpdesk app** (pure metadata over HTTP — the concrete proof):
`pnpm --filter server reset:helpdesk && pnpm --filter server seed:helpdesk`
seeds roles/users/Ticket DocType/DocPerms/workflow/email rule/server script/
assignment rule/SLA/web form. `pnpm --filter server verify:helpdesk` exercises
the whole flow as customer → agent → manager over HTTP: **32/32 checks pass**
(intake+attribution+round-robin+SLA stamps, if_owner portal, role-gated +
conditional transitions on the bound `status` field, save-protection,
resolved email to requester, comments, ToDos, Overdue escalation email).
Server suite: **324 tests green** (16 new). Desk renders it all with zero
frontend changes (list/kanban/form screenshots verified via Playwright).

**Gotchas**:
- Demo logins: agents `agent1|agent2@helpdesk.test`, manager
  `manager@helpdesk.test`, customers `cust1@acme.test`/`cust2@globex.test`,
  all `demo1234`; intake at `/form/new-ticket`, portal at `/portal/Ticket`.
- The bound `status` Select still renders editable in the form; a direct save
  is refused server-side (417) — making the form render it read-only when a
  workflow binds it would be a nice follow-up.
- `workflow.test.ts` updated: docs under a workflow now START at the initial
  state (was NULL), per WF-003 semantics.
- Next up: inbound email → ticket (the one ticketing gap still open in both
  implementations), and PR 2 can be closed (see docs/archive/PR-COMPARISON.md).

## 2026-07-17 — Legacy server suite migrated to the SQL sandbox (74/79 files)

The entire pre-existing server test suite now runs on feather-testing-postgres:
every migrated test executes inside its own rolled-back transaction — all
manual DELETE/DROP/`sql.end()` cleanup is gone. Full suite **320/320**, web
10/10, typechecks clean, browser smoke + ticketing e2e green.

- **Migrated in 7 verified batches** (each independently re-run before
  commit): document-engine (11 files), meta/DDL (11), permissions (10),
  misc endpoints (14), features/workflow/reports (11), jobs/email/webhooks
  (9), special files (realtime, files, signed-files, print-pdf, thumbnails).
- **5 files stay legacy BY DESIGN**, each annotated in-file:
  `cli` (subprocess opens its own PG connection), `tenancy` (per-site pools
  bypass the db.ts seam), `patches` (tests the runner's real commit
  semantics), `rls` (verifies native RLS via a second desk_client
  connection that cannot see an uncommitted tx),
  `schema-sync-stale-plan` (needs multiple warm pooled connections; the
  sandbox pins one).
- **Gotchas discovered, for future test authors**:
  1. `now()` freezes at BEGIN inside the sandbox but `enqueue()` stamps
     wall-clock `run_at` — drain-based job tests must nudge due jobs onto
     the tx clock (`run_at <= clock_timestamp()` → `now()`) before
     `drainJobs()`. Candidate for lifting into pg-test as a helper.
  2. Process-global state does NOT roll back: controller registrations
     (`clearControllers` in finally), installed apps (uninstall in
     finally), `stopWorker()` in finally; job/script-report registries
     have no unregister — unique names keep leaks benign.
  3. A failing RAW SQL statement authored in a test body aborts the whole
     sandbox tx (no savepoint) — only safe as the test's last DB op;
     errors raised through the API always roll back to a savepoint.
  4. `SET TRANSACTION READ ONLY` works under a savepoint (PG only forbids
     read-write after queries) but leaves the OUTER test tx read-only —
     order writes before `runQueryReport` calls.
  5. Legacy suites with order-dependent tests need per-test "replay
     helpers" that re-execute earlier tests' mutations as setup.
  6. Disk state (file uploads) does not roll back — file tests keep
     `deleteStored` cleanup in finally blocks.
- **Infra note**: mid-migration the system Postgres AND both dev servers
  were killed (no crash log — likely resource pressure from concurrent
  agent runs); `pg_ctlcluster 16 main start` + `./init.sh` recovered, no
  data loss. Full suite re-verified afterwards.
- **Next**: consider lifting the job-clock nudge into the library; evaluate
  per-file parallelism for the sandboxed majority (needs the 5 legacy
  files quarantined to a sequential project and shared naming-series row
  locks assessed).

## 2026-07-17 — feather-testing-postgres: Phoenix-style testing library + ticketing demo (beyond the 126)

New net-new infrastructure (no features.json changes): a testing library in
`packages/feather-testing-postgres` that brings the Ecto SQL Sandbox model to
this stack, proven end-to-end by a metadata-only ticketing app.

- **SQL sandbox (Ecto pattern)**: `db.ts` now exports `sql` through a
  delegating Proxy with a test-only seam (`_setSqlDelegate`). `withSandbox`
  opens a real transaction, swaps the delegate, runs the test, ALWAYS rolls
  back; while sandboxed, app-level `sql.begin` calls are intercepted into
  `SAVEPOINT`s (a real BEGIN/COMMIT would commit the outer test txn). The
  proxy is transparent when unsandboxed — the pre-existing suite is
  unaffected.
- **Fixtures**: `createPgTest(bindings)` → vitest `test.extend` with `db`
  (auto — every test sandboxed), `api`/`admin`/`client` (in-process
  `app.request` clients with real JWTs), `seed` (real save lifecycle),
  `createUser` (real User rows + roles, rolled back). Bindings per app:
  `apps/server/test/pg-test.ts`, `apps/web/test/pg-test.ts`.
- **Web component testing (NEW - there was none)**: vitest+jsdom+RTL in
  `apps/web`; `installFetchBridge` routes the app's relative `fetch('/api/…')`
  to the in-process Hono app; `renderDesk(path, client)` mounts the REAL
  routeTree on a memory history with a fresh QueryClient. Component → fetch →
  Hono → sandboxed Postgres in milliseconds. Fluent Session DSL
  (`fillIn/selectOption/clickButton/assertText/within…`) with chain-trace
  errors; `clickButton` refuses disabled buttons.
- **Ticketing demo (migration 0047)**: Ticket + Ticket Comment DocTypes
  (TICK-.#### series, child comments), Ticket Manager/Reporter roles
  (if_owner), 4-state workflow (Open→In Progress→Resolved→Closed, Resolve
  requires a resolution via WF condition), 5 DW-flavored seed tickets. Zero
  frontend code — the generic Desk renders all of it.
- **Verified**: server `test/sandbox.test.ts` (4 — incl. root-connection
  proof the DB is untouched after the file) + `test/ticket.test.ts` (8 —
  twin tests both get TICK-0006 proving series rollback; child-table
  round-trip; if_owner scoping; role-gated workflow with condition), full
  server suite **320/320**; web `test/infra.test.tsx` +
  `test/ticket.test.tsx` **10/10** (list/empty/create/validation/workflow
  through the real UI, with cross-test rollback assertions); typechecks
  clean; live-browser `e2e/ticketing.spec.ts` + smoke green.
- **Gotchas**: (1) a thenable whose `then` resolves with `this` makes
  `await` recurse to heap exhaustion — resolve chains with `undefined`;
  (2) migrations run WITHOUT the controller registry, so a migration that
  saves a Workflow must call `initDocState` itself for `workflow_state`;
  (3) FormView's Save is dirty-gated — a pristine form can't be saved, so
  the validation-error state needs a dirty form with the required field
  empty; (4) `assertText` reads textContent — input VALUES are not text;
  (5) web tests keep `fileParallelism: false`: parallel FILES are safe
  transactionally but contend on the shared naming-series row lock.
- **Next**: migrate legacy server tests to the sandboxed `test` (drops all
  manual cleanup + could re-enable file parallelism for converted files);
  optional `Ticket Reporter` portal flow; extract the package to its own
  repo/npm once the API settles.

## 2026-07-17 — Enhancement: conditional workflow transitions (beyond the 126)

Closes the workflow gap called out in the Frappe comparison. This ENHANCES
WF-001/002/003 — it is not a new harness feature, so `features.json` is
untouched.

- **Schema**: `Workflow Transition` gains a `condition` field
  (`0046_workflow_condition.ts`) — a boolean expression over `doc`. Because it's
  a normal child docfield, it renders as an editable **Condition column in the
  Workflow form's transitions grid** — i.e. the Frappe-style workflow builder
  (Frappe's Workflow form is also just states/transitions child tables, not a
  visual graph).
- **Safe evaluator**: `evalCondition(expr, doc)` in `server-scripts.ts` reuses
  the **hardened node:vm sandbox** — the context carries only the doc's JSON
  (parsed inside), no host object is exposed, so a condition can read `doc` but
  cannot reach `process`/`require`/`fetch`. Blank condition = always true.
- **Engine**: `WorkflowTransition.condition` is loaded in `getActiveWorkflow`;
  `availableActions(wf, state, roles, doc?)` filters out transitions whose
  condition is false; `applyWorkflowAction` **enforces the condition for
  everyone — Administrator included** (a condition is a property of the
  document, not the user) and independently of the UI. The status endpoint
  passes the doc so the form's buttons auto-hide.
- **Verified**: `test/workflow-condition.test.ts` (4 — sandbox reads doc but
  process/require are undefined; per-doc availability; apply refused when the
  condition fails even for admin; the holding branch applies) and
  `e2e/workflow-condition.spec.ts` (2 — the form offers only the action whose
  condition holds for that doc; the builder grid exposes the editable Condition
  column). Live HTTP: a doc with amount 500 is offered only "Auto Approve" and
  gets 417 on "Approve"; amount 5000 is offered only "Approve". Existing
  workflow unit + e2e green; full server suite **308/308**.

## 2026-07-16 — PLAT-008 passing: multi-tenancy (schema-per-site) — ALL 126 DONE

- **`tenancy.ts`**: each site is an isolated Postgres **schema** (`site_<name>`)
  holding its own `tab_*` tables. A per-site pooled client sets `search_path` to
  **only** that schema, so a query physically cannot reach another site's tables
  — isolation is enforced by Postgres, not app-level filters (verified directly:
  two clients each see only their own rows).
- **Site resolver (Host header)**: a `public.tab_site` registry
  (`0045_site_registry.ts`) maps host → site/schema. `resolveSite(host)` matches
  the full host, then the leading subdomain label (`alpha.example.com` →
  `alpha`), else 404 — no cross-site fallback.
- **Per-site migrate**: `createSite` creates the schema and runs `siteMigrate`
  (its own `tab_doctype`/`tab_docfield`/`tab_user`). Site-scoped ops
  (`siteCreateDoctype` — real per-site `tab_<name>` table + metadata,
  `siteCreateUser`, and the list counterparts) all run on the site's schema.
- **Endpoints**: provisioning `POST/GET /api/tenancy/sites` (System Manager);
  data endpoints `/api/tenancy/{doctype,doctypes,user,users}` resolve the site
  from the request **Host header**. Kept self-contained — the existing global
  `public`-schema app is untouched, so nothing regressed.
- **Verified**: `test/tenancy.test.ts` (4 — two sites with independent
  DocTypes+users; Host resolves by exact host and by subdomain label; unknown
  host → 404; each site's `tab_widget` lives only in its own schema) + a live
  HTTP run with real `Host:` headers (acme sees only Invoice/ceo@acme.test,
  globex only Shipment/no-users, unknown host → 404). Full server suite 304/304.
- **This completes all 126 features.**

## 2026-07-16 — PLAT-006 passing: Google OAuth (mocked in dev)

- **`oauth.ts`**: a provider abstraction. With no `GOOGLE_CLIENT_ID`, a **mock
  provider** stands in for Google: `googleAuthorizeUrl` points at a local
  consent page, and `exchangeCode` decodes a signed authorization code. Real
  Google's authorize URL + token/userinfo exchange live behind the same
  interface (used only when credentials are set). State + mock code are
  stateless **HMAC-signed** tokens with a 10-min expiry.
- **Flow** (all public, before the auth middleware):
  `GET /api/oauth/google/login` → `GET /api/oauth/mock/consent` (a small consent
  page) → `GET /api/oauth/mock/approve` (verifies state, issues a signed code) →
  `GET /api/oauth/google/callback` (verifies state, exchanges the code,
  find-or-creates the User, issues a session) → 302 to the SPA
  `/oauth-callback?token=…`, which stores the token, hydrates via whoami, and
  lands in the Desk.
- **Mapped to the User DocType**: `findOrCreateGoogleUser` links an existing
  account by email (case-insensitive) or creates one, re-enables it, and stamps
  the new read-only `User.social_login = 'google'` (`0044_user_social_login.ts`,
  set with a direct write since read-only fields are ignored by save). The
  Login page gained a "Sign in with Google" link.
- **Same-origin in dev**: the mock flow uses **relative** redirect URLs so the
  Vite `/api` proxy keeps the browser on the SPA origin end to end (real Google
  needs an absolute redirect_uri, so that path stays absolute).
- **Verified**: `e2e/oauth.spec.ts` (3 — mock sign-in creates the User, stamps
  `social_login=google`, lands in the Desk; a second sign-in links the same User
  (no duplicate); a **tampered state → 401**) + a full HTTP walk of the redirect
  chain. Full server suite 300; login/user-mgmt e2e unaffected.
- Gotcha: an HTML GET form **discards its action URL's query string** — carry
  `state`/`redirect_uri` as hidden inputs, not in the action.
- Next: 1 P3 remains (PLAT-008 multi-tenancy).

## 2026-07-16 — PLAT-001 + PLAT-002 passing: app system + doc_events

- **`apps.ts`**: an app is a code-defined `AppManifest { name, doctypes?,
  doc_events? }`. `registerApp` adds it to the in-process registry; `installApp`
  creates its DocTypes (via the engine → real tables) and **wires its
  doc_events** as controllers, recording owned DocTypes in `tab_installed_app`
  (`0043_installed_app.ts`); `uninstallApp` unwires the hooks and drops the
  owned DocTypes + record; `loadInstalledApps` re-wires installed apps' hooks at
  boot (their tables persist). App code lives in the process; the DB only holds
  installed-state.
- **PLAT-002 mechanism**: `doc_events` register as normal controllers, and the
  controller registry is a **list per DocType**, so an app hook on a DocType it
  doesn't own (e.g. Task) runs *alongside* the core controller. Added
  `unregisterController(ref)` so uninstall removes exactly the app's hooks
  without disturbing the core one.
- Endpoints (System-Manager only): `GET /api/apps`, `POST /api/install_app`,
  `POST /api/uninstall_app`. Ships a sample app **hello-crm** (a `CRM Lead`
  DocType + a `before_save` hook that normalizes the lead email).
- **Verified**: `test/apps.test.ts` (3 — install creates the DocType + fires its
  hook + records state; uninstall drops the DocType/table/record; **an app hook
  on a foreign DocType fires alongside the core controller → `['core','app']`,
  and after uninstall only `['core']`**). Live HTTP: install hello-crm → create
  a `CRM Lead` (email normalized `  Bob@ACME.COM ` → `bob@acme.com` by the app
  hook) → uninstall → the DocType 404s. Full server suite 300/300.
- Gotchas: (1) hooks run **after** schema validation, so a `before_save` hook
  can't fix a value the field's own constraints already rejected (the sample
  hook normalizes a free-text field, not the Select). (2) jsonb columns:
  passing a JSON *string* double-encodes — use `sql.json(value)` and parse
  defensively on read.
- Next: 2 P3 remain (PLAT-006 Google OAuth [mocked], PLAT-008 multi-tenancy).

## 2026-07-16 — WEB-003 passing: customer portal

- **`Portal.tsx`** with two routes outside the Desk shell:
  `/portal/$doctype` (list) and `/portal/$doctype/$name` (read-only detail),
  each gated on a token (redirect to `/login` otherwise). A minimal portal
  chrome (brand + user + log out), no Desk sidebar.
- The list reads `/api/resource/:doctype`, which is already **if_owner-scoped**
  (PERM-007), so a website user sees only the documents they own. The detail
  page fetches the doc and, on a **403/404** `ApiError`, renders an access-denied
  panel (`portal-forbidden`) instead of the fields.
- No new server code — the whole feature rides the existing
  permission-scoped resource API. "Website user" = any User holding a role with
  an if_owner grant on the DocType.
- **Verified**: `e2e/portal.spec.ts` (3 — Alice sees only her own ticket (1 row,
  not Bob's); Alice opening Bob's ticket URL shows the forbidden panel; Bob CAN
  open his own) plus a direct API check (Alice lists 1 own doc; `GET` Bob's doc
  → **403**). Existing web-form/web-page/desk routing e2e unaffected.
- Next: 4 P3 remain (PLAT-001/002/006/008).

## 2026-07-16 — FILE-004 passing: image thumbnails

- **`thumbnails.ts`**: `makeThumbnailDataUrl(content, mime, maxDim=128)` decodes
  a raster image and canvas-downscales it **in Chromium** (reusing the exported
  `getBrowser()` singleton already used for PDFs — no new dependency; `sharp`
  isn't installed), returning a self-contained `data:image/jpeg;base64,…`
  thumbnail. `isThumbnable` gates to png/jpeg/webp/gif (svg excluded).
- **File DocType** gains a read-only `thumbnail_url` (Long Text) via
  `0042_file_thumbnail.ts`. On upload (`/api/upload_file`), images get a
  thumbnail generated best-effort (a decode failure never blocks the upload).
- **Persistence gotcha**: `thumbnail_url` is `read_only`, and the save
  lifecycle deliberately ignores client values for read_only fields
  (`pickFieldValues`) — so the server sets it with a **direct `update tab_file`
  after `saveDoc`** (the same pattern naming/workflow use) and reflects it on
  the returned doc. Storing it as a data URI avoids any extra storage object or
  signed-URL handling (works for private images too).
- **Attachments UI** shows the thumbnail (`<img src={thumbnail_url}>`) beside
  image rows; non-images render as before.
- **Verified**: `test/thumbnails.test.ts` (4 — recognizes raster types;
  300×200→128×85 aspect-preserved; no upscaling of small images; null for
  non-image, all measured back in Chromium) + `e2e/thumbnail.spec.ts` (attach a
  real 240×160 PNG → an `attachment-thumb` with a JPEG data URI ≤128px renders;
  a .txt gets none). Live HTTP confirmed an 87KB PNG → 1.3KB thumbnail, private
  images included. Full server suite 297/297; attachments e2e unaffected.
- Two infra notes: (1) the Chromium instance is a process-wide singleton — tests
  must NOT close it (it's shared with the PDF tests); (2) a stale dev server can
  keep port 8000 (EADDRINUSE on restart silently routes requests to old code) —
  verify `server listening` after a restart.
- Next: 5 P3 remain (WEB-003, PLAT-001/002/006/008).

## 2026-07-16 — UI-025 passing: responsive Desk

- **DeskLayout** shell is now responsive. On `md+` the workspace sidebar is a
  static `w-60` column as before; below `md` it becomes a slide-in **drawer**
  (`fixed … -translate-x-full` → `translate-x-0`) toggled by a **hamburger**
  (`data-testid=sidebar-toggle`, `md:hidden`) with a tap-to-close backdrop.
  Clicking any link inside the drawer closes it (delegated `closest('a')`).
- Navbar tightened on small screens (brand text `hidden sm:inline`, smaller
  gaps/padding); canvas padding `p-4 sm:p-6`. FormView already stacked to one
  column (`grid-cols-1 md:grid-cols-2`) and ListView tables already scroll in
  their own `overflow-x-auto` container, so no page-level horizontal scroll.
- **Verified**: `e2e/responsive.spec.ts` at 375px — sidebar starts off-screen,
  hamburger opens it (backdrop appears), tapping a DocType navigates + closes
  the drawer, the list view shows with **no horizontal page overflow**, and the
  new-form fields **stack** (qty below title) with no overflow; a second test at
  1280px confirms the sidebar stays static and the hamburger is hidden. Broad
  DeskLayout e2e (desk/awesomebar/workspace/keyboard/dark-mode) still green.
- Next: 6 P3 remain (FILE-004, WEB-003, PLAT-001/002/006/008).

## 2026-07-16 — UI-022 passing: Gantt view

- **`GanttView.tsx`** (route `/desk/$doctype/view/gantt`): for any DocType with
  ≥2 Date fields, uses the first as start and the second as end. Renders a day
  grid (40px/day) with one horizontal bar per document spanning [start, end].
  Bars carry `data-start`/`data-end`/`data-days` for precise assertions.
- **Resize**: each bar has a right-edge handle; dragging it snaps to whole day
  columns (`round(Δx / 40)`), previews live, and on release PUTs the new end
  date back (carrying the loaded `modified` stamp, like the calendar's drag).
  Only forward/backward of the end date; clamped so end ≥ start.
- Date math is done in UTC whole-day numbers (`Date.UTC(...) / 86_400_000`) to
  stay timezone-independent. The timeline range is the data's min-start..max-end
  padded one day each side.
- **View switcher**: the ListView shows a **Gantt** link only when the DocType
  has ≥2 Date fields (Calendar still needs just one).
- **Verified**: `e2e/gantt.spec.ts` (2) — a task dated Mar 2→5 renders
  `data-days=4` and a 160px-wide bar; dragging the handle +80px moves the end
  Mar 5→7 (`data-days=6`) and the new date is persisted server-side. Existing
  ListView/calendar/desk e2e unaffected.
- Next: 7 P3 remain (FILE-004, WEB-003, PLAT-001/002/006/008, UI-025).

## 2026-07-16 — RPT-006 passing: report charts pinned to dashboards

- **`report-chart.ts`**: `runReportChart(spec, user)` derives a
  `{label,value}[]` series from a saved report's rows (reusing
  `runReportRows`) — with `group_by` it returns per-group counts, otherwise one
  bar per row via `label_field`/`value_field` (sensible defaults: first
  non-`name` column for labels, first numeric column for values).
  `pinChartToDashboard(dashboard, chart, user)` appends/updates (idempotent on
  chart label) a report-driven chart in the Dashboard's `config.charts` and
  saves it. Endpoints: `POST /api/report_chart`, `POST
  /api/pin_chart_to_dashboard`.
- **DashboardView** now renders report-driven charts: a chart config with a
  `report` field queries `/api/report_chart` (recomputed from live report data)
  instead of `/api/dashboard/chart`. Existing DocType+group_by charts unchanged.
- **ReportView** gained a Chart panel: bars derived from the on-screen rows
  (grouped → per-group counts, matching the table; ungrouped → a selectable
  numeric value field), plus a dashboard picker + **Pin to dashboard** button
  (enabled once the report is saved). The client derivation mirrors the server
  so the pinned dashboard chart reproduces the preview.
- **Verified end-to-end**: `test/report-chart.test.ts` (4 — per-row, grouped,
  default-field, and idempotent pin) and `e2e/report-chart.spec.ts` (group the
  report by region → chart shows North 2 / South 1 → pin → the dashboard shows
  the same chart from live data). Existing dashboard/report e2e + full server
  suite (293) all green.
- Gotcha: `saveDoc` updates enforce optimistic concurrency on `modified`; a bare
  `Date` stringifies without milliseconds and spuriously conflicts — pass the
  loaded stamp back as a full-precision ISO string.
- Next: 8 P3 remain (FILE-004, WEB-003, PLAT-001/002/006/008, UI-022/025).

## 2026-07-16 — EML-007 passing: Auto Email Report

- **Auto Email Report** is a new Core DocType (`0041_auto_email_report.ts`):
  `report` (Link→Report), `recipients` (Text, comma/space/semicolon list),
  `file_format` (CSV|HTML), `frequency` (Daily|Weekly|Monthly), `enabled`,
  `last_sent` (read-only stamp). It's a normal DocType, so the generic Desk
  ListView/FormView already create + edit it — no bespoke UI.
- **`auto-email-report.ts`**: `runReportRows(report, user)` runs any saved
  report server-side — Query Report via `runQueryReport`, Report Builder via a
  permission-scoped `getList` over `ref_doctype` with the saved
  columns/filters — returning uniform `{columns, rows}`. `toCsv` (RFC-4180
  quoting) / `toHtmlTable` render the attachment.
  `deliverAutoEmailReport(name)` runs the report, builds the attachment, and
  queues one email per recipient referencing the Report; stamps `last_sent`.
  `runDueAutoEmailReports(now)` is the scheduler pass — delivers every enabled
  report whose cadence (Daily/Weekly/Monthly) has elapsed since `last_sent`.
- **Attachments now survive the email queue**: `queueEmail` persists
  `msg.attachments` as `attachments.files` in the queue row, and the
  `send_email` job prepends them to the delivered attachments — so the CSV
  reaches the Email Sink (EML-002/003 path). Existing email tests unaffected.
- **Scheduler**: `jobs/auto-email-report.ts` registers the `auto_email_reports`
  handler → `runDueAutoEmailReports`; boot seeds it once with `repeatEvery`
  daily (guarded against duplicate recurring jobs across restarts). Manual
  trigger endpoint `POST /api/run_auto_email_report` (System Manager only).
- **Verified end-to-end**: `test/auto-email-report.test.ts` (3 — CSV quoting;
  deliver → queued email with CSV attached → **worker delivers to sink with the
  CSV intact** → `last_sent` stamped; cadence skip/elapse) plus a live HTTP run:
  `run_auto_email_report` → `{recipients:1,rows:2}`, the sink received
  `Aer Http Report.csv` with correctly comma-quoted rows, and a non-SM caller
  got **403**. Full server suite 289/289.
- Next: 9 P3 remain (RPT-006, FILE-004, WEB-003, PLAT-001/002/006/008,
  UI-022/025).

## 2026-07-16 — WF-004 passing: workflow action notifications

- After a successful transition, `applyWorkflowAction` calls
  `notifyPendingApprovers` (`workflow.ts`): a document that lands in a state
  **with outgoing transitions** is now pending someone's action, so the holders
  of those transitions' `allowed` roles are emailed. Terminal states (no
  outgoing transitions) notify no one.
- Approvers = enabled users holding any outgoing-transition role, resolved via
  `tab_has_role ⋈ tab_user` (uses each user's `email` field, falling back to the
  user name). The **acting user is excluded** (no self-notification).
- Each approver gets a queued email (`queueEmail`) referencing the document
  (`reference_doctype`/`reference_name`), subject `Approval required: <DT>
  <name>`, body with the **available actions** and a **deep link**
  (`/desk/<DocType>/<name>`) — the "action links" the feature asks for. Delivery
  rides the existing EML-002 queue + worker, so it's persisted, retried, and
  sent exactly once.
- Verified end-to-end: `test/workflow-notify.test.ts` (2 — email queued to the
  approver on entering Pending with the right subject/link/action; terminal
  state queues nothing) plus a live HTTP run where the **worker actually
  delivered** the mail to the Email Sink (recipient = approver, subject
  `Approval required: … wf-http-1`, body contains the deep link + `Approve`).
  Existing `workflow.test.ts` still green; full server suite 286/286.
- Note: `workflow.ts` now imports `email.ts` — no import cycle (email's graph
  never re-enters workflow). Only `index.ts` imports workflow.

## 2026-07-16 — PRN-004 passing: letterheads

- **Letter Head** is a new Core DocType (`0040_letterhead.ts`, prompt-autoname):
  `is_default` (Check), `header_html` (Text), `footer_html` (Text). The same
  migration appends a `letter_head` Link field to **Print Format** via
  `updateDocType` (in-place column + docfield add).
- **Server render** (`print.ts`): `renderPrintHtml(..., letterHead?)` resolves a
  letterhead with precedence **explicit choice > format-named > default**
  (`is_default`), the literal `'none'` suppresses it. Header/footer are
  interpolated with the same `{{ field }}` syntax as a Print Format template and
  wrapped in `<header class="letter-head">` / `<footer class="letter-foot">`, so
  they flow into the Chromium PDF. Endpoint takes `?letter_head=` query param.
- **Single default enforced** by a new controller
  (`controllers/letter-head.ts`, `before_save`): saving a letterhead with
  `is_default` clears the flag on all others — the resolver uses `limit 1`, so a
  unique winner is required. Verified over HTTP (save B default → A un-defaulted;
  exactly 1 default remains).
- **Desk UI** (`PrintView.tsx`): a "Letterhead" picker (default / none / each
  Letter Head) next to the format picker; header renders above the body, footer
  below, both interpolated. Letter Heads are listed generically (no per-DocType
  code).
- **Verified end-to-end:** server unit tests (`test/letterhead.test.ts`, 4 —
  default applied + interpolation, explicit override, `none` suppresses,
  format-named) produce real PDFs whose text contains the header/footer; a live
  HTTP call returns a valid `%PDF-` with the interpolated header + footer and
  `letter_head=none` suppresses; Playwright `e2e/letterhead.spec.ts` drives the
  picker (default → switch → suppress). Full server suite still 284/284 green.
- Gotcha: stray `is_default` letterheads from ad-hoc probes made the "default"
  resolution non-deterministic before the single-default controller existed —
  the controller both fixes correctness and makes tests deterministic. A new
  controller file needs a hard server restart (tsx watch doesn't pick up a
  brand-new, not-yet-imported file).
- Next: 11 P3 features remain (WF-004, RPT-006, EML-007, FILE-004, WEB-003,
  PLAT-001/002/006/008, UI-022/025).

## 2026-07-16 — Evaluation pass #14 (adversarial) — all held

- Probed the newest batch (UI-015, I18N-001/002, JOB-004/005) + regressions.
  All held; no status flips, no product code.
- **JOB-004:** non-System-Manager retry → 403; retry a non-existent job → 417;
  retry an already-done job → 417 (only 'failed' jobs re-queue).
- **I18N-001:** a non-admin sets their OWN language (set_language keys off the
  caller, not a target) → ok; reads any catalog → 200; unknown language → `{}`.
  Field-label translation is generic (t() over field.label) — works on any
  DocType.
- **UI-015:** typing "g" then "d" INSIDE a text field does NOT trigger the g→d
  leader navigation (the handler guards on INPUT/TEXTAREA/SELECT/contentEditable
  targets); the field keeps the typed value. Ctrl+S/Ctrl+B are inert off a form.
- **JOB-005:** progress publishes to the job OWNER's user channel only, and
  canSubscribe restricts user:* to self — no cross-user progress leakage.
- Regressions: CUST-004 sandbox still closed (`Object.constructor("return
  typeof process")()` → "undefined"); RPT-004 read-only still blocks an UPDATE
  query (417).

## 2026-07-16 — UI-015 passing: keyboard shortcuts

- A global keydown handler in DeskLayout: **Ctrl/Cmd+S** clicks the form's Save
  button, **Ctrl/Cmd+B** opens a new document of the current DocType (parsed
  from the path), and the **g then d** leader sequence (only when not typing in
  a field) goes to the Desk home. Ctrl+S/Ctrl+B preventDefault the browser
  defaults.
- Verified: e2e (Ctrl+S → Saved banner; Ctrl+B → /desk/<DocType>/new form; g
  then d → /desk). 62 web e2e green. 114/126.
- Also de-flaked e2e/i18n-login.spec (I18N-002): it no longer sets the shared
  global System Settings date_format (which raced with SET-004's test) — it
  asserts the date renders through the formatter in ANY valid order, and
  targets the first list cell.

## 2026-07-16 — I18N-002 passing: per-user language on login + configured formats

- Satisfied by composition of I18N-001 (per-user `language` returned by whoami,
  applied by `useI18n` on load) and SET-004 (dates rendered via System Settings
  `date_format`). No new product code needed.
- Verified: e2e — a user whose stored language is `fr` logs in fresh and
  immediately sees French chrome (Log out→Déconnexion, language switcher shows
  fr) with no manual switch, and a Date field renders in the configured
  dd-mm-yyyy format. 113/126.

## 2026-07-16 — I18N-001 passing: translation infrastructure

- Migration 0039: `Translation` DocType (language, source_text, translated_text)
  with a unique (language, source_text) index. `i18n.ts`: `getCatalog(lang)`
  builds a source→translated map (empty for 'en'); `t(text, catalog)` looks up
  with source fallback.
- Endpoints: `GET /api/translations/:lang` (catalog), `POST /api/set_language`
  (per-user, validated code); whoami now returns `language`.
- Web `lib/i18n.ts`: `useI18n()` reads the user's language from whoami, fetches
  the catalog, and returns `t()` + `setLanguage`. Wrapped chrome (form Save
  button, navbar Log out) and FIELD LABELS (FieldControl) in `t()`. A language
  switcher (EN/FR/ES) sits in the navbar.
- Verified: e2e (switch to fr → navbar "Log out"→"Déconnexion", form Save→
  "Enregistrer", a field labelled "Priority"→"Priorité"; switching back to en
  reverts) + server test (catalog build, en-empty, t() fallback, HTTP catalog,
  per-user language persistence + bad-code 417). 280 server + 58 web e2e green.
  112/126. Unblocks I18N-002.
- Also hardened the JOB-005 progress test to filter events by the specific job
  name (the shared job queue can hold other files' jobs).

## 2026-07-16 — JOB-005 passing: long-job progress over realtime

- Job handlers now receive a `JobContext` with `setProgress(percent, message)`;
  the worker wires it to `publishUserEvent(<job owner>, 'job_progress', {job,
  method, percent, message})` (percent clamped 0–100, rounded). Existing
  handlers ignore the new arg (backward-compatible). Demo job
  `src/jobs/demo-progress.ts` reports 5 steps → 20/40/60/80/100%.
- Web JobMonitor: a "Run demo job" button enqueues demo_progress and subscribes
  to the user channel; a live progress bar (`demo-progress`) climbs to 100% as
  `job_progress` events arrive.
- Verified: e2e (click Run demo job → progress bar reaches 100% with the final
  step message, driven purely by realtime) + server test (setProgress calls
  arrive as job_progress events on user:Administrator with the right percents;
  values clamped/rounded). 275 server + 57 web e2e green. 111/126.
- Gotcha: after adding a new src/jobs/*.ts file, tsx-watch didn't always reload
  it cleanly — a stale server kept "No handler registered". A hard restart
  (kill :8000, `pnpm dev`) fixed it; init.sh's clean boot handles this normally.

## 2026-07-16 — JOB-004 passing: job monitoring UI + retry

- `retryJob(name)` in jobs.ts re-queues a FAILED job (status→queued, attempts→0,
  error cleared, run_at=now) so the running worker picks it up; returns false
  for a non-failed/missing job. `POST /api/retry_job` (System-Manager-gated)
  exposes it (417 for a non-failed job). Added a no-op `ping_job` (src/jobs/
  ping.ts) as a benign demo/health job.
- Web `JobMonitor` + route `/desk/jobs`: a live table (3s refetch) of Background
  Jobs (method/status/attempts/error), with a Retry button only on failed rows;
  clicking it calls retry and refetches.
- Verified: e2e (a seeded failed ping_job shows in the monitor with Retry;
  clicking Retry flips it to done and the button disappears) + server test
  (retry re-queues and drains to done; non-failed job not retried; HTTP retry
  200 then 417 on the now-done job). 273 server + 56 web e2e green. 110/126.

## 2026-07-16 — CUST-004 re-passing: sandbox escape closed

- Rewrote the `node:vm` sandbox to expose NO host objects. All inputs/outputs
  cross the boundary as JSON string PRIMITIVES: `doc`/`args` are injected as a
  JSON string and `JSON.parse`d INSIDE the context (context-native), `frappe`/
  `console` are defined inside the context, and NO host built-ins are injected
  (the fresh context has its own). Document-event scripts merge back only the
  fields they changed (system fields keep native host values). API scripts
  return their `result` round-tripped through JSON.
- Now `Object`, `Function`, `[].constructor.constructor`, `this`, `globalThis`
  all resolve to context-native values, so `process`/`require`/`fetch` are
  undefined. Verified every escape vector from the eval is closed:
  `Object.constructor("return process.pid")()` → "process is not defined";
  `this.constructor…` → no-this (strict mode); `(function(){}).constructor(
  "return typeof process")()` → "undefined"; `globalThis.process` → undefined.
  Functionality intact: reject-negative → 417, field-set → 'big', API double(21)
  → 42, runaway loop → timeout. Server test adds explicit escape assertions.
- 270 server + CUST e2e green. 109/126 (CUST-004 back to passing).

## 2026-07-16 — Evaluation pass #13 (adversarial) — CUST-004 sandbox ESCAPE

- **CUST-004 → FAILING.** The node:vm sandbox is escapable, so it does NOT
  "block filesystem/network/process access" as the verify requires.
  Reproduction: create an API Server Script with
  `result = Object.constructor("return process.pid")()` and call it via
  `POST /api/server_script/<method>` → returns a real host PID (observed 3149).
  Root cause: `server-scripts.ts` injects HOST built-ins (Object, Array, String,
  JSON, Math, …) into the vm context; a host built-in's `.constructor` is the
  HOST `Function`, and `hostFunction("return process")()` executes in the HOST
  realm, reaching `process` (and from there require/fs/network). Any host object
  reachable from the script (including `doc`, `frappe`, `console`) leaks the same
  way via its constructor chain.
  Expected: process/require/fetch unreachable. Actual: reachable.
  Fix direction (next coder step): never expose host objects to the script —
  pass `doc`/`args` in as JSON string primitives, `JSON.parse` them INSIDE the
  context (context-native), define `frappe`/`console` inside the context, inject
  NO host built-ins (the fresh context already has its own), and read results
  back as a JSON string. Then `Object.constructor` resolves to the CONTEXT's
  Function, which runs in the context where `process` is undefined.
- CUST-003 (client scripts) and CUST-005 (export/import) held: CUST-005 empty
  bundle → 0/0, garbage custom field (unknown DocType) → clean 417 (no 500);
  CUST-003 endpoints reachable and e2e-verified. No other flips.

## 2026-07-16 — CUST-005 passing: export/import customizations as JSON

- `customizations.ts`: `exportCustomizations(doctype)` returns a JSON bundle of
  the DocType's Custom Fields + Property Setters; `importCustomizations(bundle)`
  recreates each through saveDoc (so the Custom Field controller re-materializes
  the column and Property Setters re-apply via getMeta), skipping any that
  already exist (idempotent). Custom Field / Property Setter are prompt-autoname
  DocTypes, so import supplies deterministic names (`dt-fieldname`,
  `doctype-field-property`).
- Endpoints (System-Manager-gated): `GET /api/export_customizations/:doctype`
  and `POST /api/import_customizations`.
- Verified: HTTP + server test — export a Select custom field + a reqd property
  setter, delete both (meta loses them), import (counts 1/1), meta regains the
  field with its options AND the backing column, title becomes reqd again;
  re-import is a no-op (0/0); non-System-Manager export → 403. 269 server tests
  green. 109/126.

## 2026-07-16 — CUST-003 passing: Client Scripts (form-event hooks)

- Migration 0038: `Client Script` DocType (reference_doctype, script, enabled).
- Web `lib/client-scripts.ts`: fetches enabled scripts for a DocType and
  evaluates each (`new Function('frappe', src)`) against a minimal
  `frappe.ui.form.on(doctype, handlers)` API, collecting handlers keyed by
  fieldname / `onload` / `before_save`. Compile errors are captured, not thrown.
- FormView wiring: a `valuesRef` mirrors live values so a handler always sees
  current data; `setField` fires the field's change handler with the updated
  doc; `onload` fires once when the form is ready; `before_save` fires before
  validation. Every handler runs in try/catch — an error shows in a dismissible
  `client-script-error` banner and never crashes the Desk (the form stays
  usable). `frm.set_value` cascades through setField.
- Verified: e2e (a script auto-fills total = qty×10 on qty change, re-running
  each change; a script that throws surfaces the error while the form/Desk stay
  interactive). 55 web e2e green.
- **Test-infra fix:** set `fileParallelism: false` in a new
  apps/server/vitest.config.ts. All test files share one Postgres DB — hence one
  `tab_background_job` queue — so parallel files' `drainJobs()` calls stole each
  other's jobs, flaking email/jobs/webhooks tests non-deterministically (a
  different one failed each run). Running files sequentially makes the 265-test
  suite deterministic (~60s). 108/126.

## 2026-07-16 — CUST-004 passing: sandboxed Server Scripts

- Migration 0037: `Server Script` DocType (script_type Document Event|API,
  reference_doctype, event validate|before_save|after_save, api_method,
  script, enabled).
- `server-scripts.ts`: runs scripts in a fresh `node:vm` context whose only
  globals are `doc`, `frappe` (`.throw`), a no-op console, and the standard JS
  built-ins — require/process/fetch/Buffer/module are simply out of scope, so a
  script cannot touch the filesystem, network, or process (they resolve to
  ReferenceError). Execution is time-boxed to 500ms, so a runaway loop errors
  instead of hanging the server. `doc` is shared by reference, so a script can
  set fields; a throw / frappe.throw aborts the save.
- `runDocEventScripts` wired into document.ts at validate/before_save/after_save
  in both save paths — CRUCIALLY it runs on the caller's TRANSACTION connection
  (`ctx.tx`), not the global pool: the first version queried the global pool
  inside the save txn and deadlocked under concurrent saves (naming.test's 50
  parallel inserts hung). `POST /api/server_script/:method` runs API-type
  scripts.
- Verified: HTTP + server test (validate rejects negatives / allows valid;
  before_save sets a field; sandbox blocks require/process/fetch; disabled
  script skipped; API script returns a value; runaway loop times out) + e2e
  (a form save blocked by a server script shows the error and the Desk stays
  live; a valid save goes through). 265 server + 53 web e2e green. 107/126.

## 2026-07-16 — UI-027 passing: workspaces (configurable shortcut home pages)

- Migration 0036: `Workspace` DocType (label, icon, shortcuts JSON —
  `[{label, type, link_to}]`, type ∈ doctype/report/dashboard/url).
- Web `WorkspaceView` + route `/desk/workspace/$name` renders each shortcut as
  a card; clicking navigates to the computed route (doctype→list,
  dashboard→/desk/dashboard, report→/desk/query-report, url→as-is). A
  "Workspaces" section in the Desk sidebar lists all Workspaces (only shows
  when any exist; DocTypes moved under a "Doctypes" heading).
- Verified: e2e (open a workspace from the sidebar; its shortcuts list; a
  doctype shortcut opens that list, a dashboard shortcut opens that dashboard).
  Frontend-only over the generic doc API. 106/126.
- Also hardened test/webhooks.test.ts against a pre-existing shared-job-queue
  flake (all test files share one Postgres queue, so another file's drainJobs
  can claim this file's deliver_webhook job — but its fetch still hits this
  worker's receiver): tests now clean webhooks per-test and poll for the
  expected hits instead of asserting right after drainJobs. Full suite now
  259 server + 52 web e2e green across repeated runs.

## 2026-07-16 — UI-024 passing: dark mode with per-user preference

- Dark theme is pure token overrides: a `[data-theme='dark']` block in
  index.css redefines the `--color-*` variables, so every generic view
  re-skins with no per-component work. Switched the two hardcoded `bg-white`
  spots (fc-input/fc-btn) to `bg-[var(--color-surface)]` so controls adapt.
- Migration 0035: `theme` (Select light/dark) on User. whoami now returns the
  theme; new `POST /api/set_theme` persists it per user (validated).
- Web `lib/theme.ts`: applies the saved theme from localStorage at module load
  (no flash), syncs the authoritative value from whoami, and a navbar toggle
  (☀️/🌙 in DeskLayout) flips + persists it. localStorage mirrors the server
  value so a reload stays dark instantly.
- Verified: e2e (toggle → html[data-theme=dark] + darker body background;
  server whoami reflects the choice per-user; survives reload) + server test
  (default light, per-user persistence not affecting Administrator, invalid
  value 417). 259 server + 51 web e2e green. 105/126.

## 2026-07-16 — PLAT-007 passing: audit logs (Activity Log + Access Log)

- Migration 0034: `Activity Log` (user, operation, full_name, ip_address) and
  `Access Log` (user, operation, reference_doctype/name, method) DocTypes.
- `audit.ts`: `logActivity` / `logAccess` write directly (not saveDoc) with the
  user as owner — so a login can be recorded before a session exists and a user
  can't mutate the record of their own actions. Both stamp `creation`.
- Hooks: `login()` writes an Activity Log 'login' row; the print endpoint
  (`/api/print`) writes an Access Log 'print' row; a new authed
  `POST /api/access_log` writes an 'export' row (requires READ on the exported
  DocType — you can only log an export of data you could read). ReportView's
  CSV/XLSX export calls it (fire-and-forget).
- Verified: e2e (a UI login increments Activity Log 'login' rows; a CSV export
  from the report view increments Access Log 'export' rows for that DocType) +
  server test (login row w/ user+timestamp, export via endpoint, 403 for a
  non-readable DocType, direct writes owned by the user). 256 server + 49 web
  e2e green. 104/126.

## 2026-07-16 — Evaluation pass #12 (adversarial, website + platform batch)

- Re-drove the newest features end-to-end plus regressions. All held; no
  status flips, no product code changed.
- **WEB-002 (web forms):** injection is structurally blocked — an anonymous
  submit with a smuggled `document_type: "User"` and `values` carrying
  `owner`/`docstatus`/`name`/`roles` created a doc in the CONFIGURED DocType
  (Ev12 Lead), with owner=Administrator, docstatus=0, a generated name; NO
  User was created and the non-whitelisted fields were dropped. Works on a
  second DocType generically. Caveats (hardening, not failures): (a) a form
  that excludes a REQUIRED field of the target DocType can never submit (every
  submit 417s) — should be validated at Web Form save time; (b) the public
  /api/web_form endpoints sit before the auth middleware so API-007 (per-user)
  doesn't throttle anonymous spam — a future IP-based limit; (c) creates as
  Administrator, so an admin who whitelists a privileged field on a sensitive
  DocType could enable escalation (mitigated: only whitelisted fields apply).
- **PLAT-005 (webhooks):** after_insert fires with a valid signature; a
  DISABLED webhook does not fire; a webhook pointing at a dead URL does NOT
  block the save (201 in ~29ms — delivery is async + retried). 
- **WEB-001:** published page served publicly (200), flips to 404 on unpublish.
- **RPT-005:** run endpoint returns columns+rows.
- Regressions: RPT-004 read-only guard blocks a DELETE query (417); UI-026
  dashboard count works; a bad login → 401.

## 2026-07-16 — WEB-002 passing: public web forms

- Migration 0033: `Web Form` DocType (title, unique route, document_type,
  web_fields [JSON whitelist of fieldnames], published, success_message).
- `webform.ts`: `getWebFormConfig(route)` returns the whitelisted fields
  (label/type/reqd from the target DocType meta); `submitWebForm(route, values)`
  keeps ONLY whitelisted fields and creates the doc via the normal save
  lifecycle (as Administrator — a trusted server surface — but strictly limited
  to the configured DocType + fields), so reqd/type validation still applies.
- Public endpoints (before auth): `GET /api/web_form/:route` (config) and
  `POST /api/web_form/:route` (submit). Anonymous.
- Web `/form/$route` public page renders typed controls and submits; server
  validation errors show inline, success shows the configured message.
- Verified: e2e (anonymous visitor: blank required field → validation error;
  full submit → success + the doc exists) + server test (whitelist exposure,
  non-whitelisted field dropped, required-field validation, unpublished form
  404, session-less HTTP submit 201). 252 server + 48 web e2e green. 103/126.

## 2026-07-16 — WEB-001 passing: public server-rendered Web Pages

- Migration 0032: `Web Page` DocType (title, unique route, content [Long Text
  HTML], published). Module 'Website'.
- `website.ts` `renderWebPage(route)` returns server-rendered HTML for a
  PUBLISHED page (title escaped; authored HTML content rendered in the body);
  unpublished/missing → a 404 page.
- Public Hono route `GET /web/:route{.+}` (before the auth middleware) — no
  session required. Vite proxies `/web` → the server so the page is reachable
  on the app origin too.
- Verified: e2e (a published page renders its content in a session-less browser
  and never redirects to login; an unpublished route is not served) + server
  test (render published/unpublished, HTTP 200/404 with no session, title
  escaping vs authored-HTML content). 247 server + 47 web e2e green. 102/126.
- Opens the website block (WEB-002 web forms, WEB-003 portal).
- Gotcha: the /web vite-proxy addition needed a web dev-server restart (vite
  reloads config automatically but the running instance had to pick it up).

## 2026-07-16 — PLAT-005 passing: webhooks (signed, retried)

- Migration 0031: `Webhook` DocType (webhook_doctype, webhook_event
  [after_insert/on_update/on_submit/on_cancel], request_url, webhook_secret,
  enabled).
- `webhooks.ts`: `evaluateWebhooks(event, doctype, doc)` enqueues a
  `deliver_webhook` job (with a doc snapshot) per enabled matching webhook. The
  job POSTs the doc JSON with `X-Webhook-Signature` (HMAC-SHA256 of the body
  with the secret) + `X-Webhook-Event`; a non-2xx response throws so the job
  system retries (up to max_attempts) before landing in failed.
- Wired post-commit into document.ts at all four lifecycle points (create →
  after_insert, update → on_update, submit/cancel via setDocstatus). Also
  awaited loadChildren at those return points (was returning the promise).
  Existing email-rule firing (submit/cancel only) is unchanged.
- Verified: server test with a local HTTP receiver — on_update delivers the
  doc JSON with a signature that verifies against the body+secret; a receiver
  that 500s once is retried and then succeeds (job ends 'done'); a doctype with
  no matching webhook fires nothing. 243 server + 45 web e2e green. 101/126.

## 2026-07-16 — RPT-005 passing: script reports (server-side TS + filters UI)

- `script-report.ts`: a registry of server-side report functions
  (`{ name, filters[], execute(filters,user) → {columns,rows} }`), loaded at
  boot from `src/reports/*.ts` (mirrors the controller loader). A Report of
  report_type 'Script Report' names its function in `report_script`
  (migration 0030 adds the field + the Select option).
- Sample `reports/user-report.ts`: lists users via `getList` (permission-scoped)
  with an `enabled` Select filter.
- Endpoints: `GET /api/script_report/:name` (declared filter defs, read-perm on
  the Report) and `POST /api/run_script_report`. A Report naming an
  unregistered script fails cleanly (ValidationError).
- Web `ScriptReportView` + route `/desk/script-report/$name` renders a typed
  control per declared filter (Select/Check/Date/Int/Data) and the returned
  columns+rows; runs on load and on Run.
- Verified: e2e (filter control + data columns render; filtering to disabled
  users changes the rows and drops Administrator) + server test (declared
  filters exposed, execute runs with filters, file-based sample scoped,
  unregistered script rejected). 240 server + 45 web e2e green. 100/126.

## 2026-07-16 — API-007 passing: per-user rate limiting

- `rate-limit.ts`: a fixed-window (60s) per-user counter middleware, wired on
  `/api/*` right after the auth middleware so it keys by the resolved user.
  Budget = the User's `api_rate_limit` (migration 0029; 0/unset → a high global
  default from `RATE_LIMIT_MAX`), cached ~5s to avoid a per-request DB hit.
- Exceeding the budget returns **429** with a **Retry-After** header (seconds
  until the window resets) and a `RateLimitError` envelope. Other users are
  unaffected — only the throttled user's window fills.
- `resetRateLimit(user?)` exported for tests/maintenance.
- Verified: HTTP probe (budget 3 → reqs 1-3 = 200, 4-5 = 429 w/ Retry-After 11;
  admin unthrottled) + server test (budget exceed → 429 + Retry-After +
  RateLimitError; a second user stays 200). Global default (100k/min) keeps the
  236 server + 44 web e2e suites green. 99/126.

## 2026-07-16 — SET-002 passing: user management + password reset

- Migration 0028: `password_reset` table (token pk, user, expires_at) + a
  `user_image` (Attach Image) avatar field on User.
- `password-reset.ts`: `requestPasswordReset(usr)` mints a single-use,
  1-hour token, stores it, and mails a `/reset-password?key=…` link to the
  dev sink — but ONLY for a real, enabled account (returns null otherwise, so
  it can't enumerate users or mail disabled accounts). `resetPassword(key,pw)`
  validates + expiry-checks the token, sets the password, and consumes all of
  the user's tokens (single-use).
- Public endpoints (before the auth middleware): `POST /api/reset_password_request`
  (always returns ok) and `POST /api/reset_password`.
- Disabled login was already enforced (login + resolveToken both check
  `enabled`), so a disabled user cannot log in and an active session is cut
  off on its next request.
- Web: `/reset-password` page (the emailed-link target — new password + confirm)
  and a "Forgot password?" flow on the login page. User profile/avatar edit
  through the generic FormView (user_image field).
- Verified: e2e (forgot-password from the login UI → open the emailed link →
  set new password → log in with it; disabled user's login shows an error and
  stays on /login) + server test (token issue/reset, single-use, expiry,
  no token/mail for disabled or unknown accounts). 234 server + web e2e green.
  98/126. All P2 features now complete.
- Gotcha: e2e beforeAll must delete-then-create the test user — save_doc won't
  re-enable an existing (disabled) user without a modified stamp, which left
  the account disabled and the reset mail unsent.

## 2026-07-16 — Evaluation pass #11 (adversarial, focused on the P2 batch)

- Probed the security-sensitive features shipped this session. All held; no
  feature regressed to failing, no product code needed.
- **RPT-004 (SQL execution):** a Query Report whose SQL is a valid
  `WITH x AS (INSERT … RETURNING …) SELECT` is blocked by the read-only
  transaction ("cannot execute SELECT in a read-only transaction") — the guard
  is the txn, not just the SELECT/WITH regex — and the injected user is never
  created. Filter values remain bound params (injection inert).
- **FILE-003 (signed URLs):** a valid signature for file A pasted onto file B's
  path → 401 (the HMAC binds the exact path); expired → 401; outsider without
  read on the linked doc → 403.
- **UI-026 (dashboard aggregates):** an owner-scoped role sees only its own
  rows in both `countDocs` and `groupCount` (admin count 4, owner-user count 1;
  the owner-user's chart shows only their single doc) — no cross-owner leak;
  Guest (no read) → PermissionError.
- **SET-003:** non-System-Manager → 403 on both read and write of the perm
  matrix; upsert never duplicates. **SET-004:** /api/settings exposes only the
  display subset (no session_hours/time_zone).

## 2026-07-16 — UI-026 passing: dashboards (number cards + bar charts)

- Refactored `query.ts` to extract `scopedWhere()` (the permission scope +
  owner/user-permission narrowing + filter building shared by list/count/
  group). New `countDocs()` and `groupCount()` reuse it, so a dashboard widget
  can never show data the user couldn't list. groupCount returns
  {label, value} ordered by count desc.
- Migration 0027: `Dashboard` DocType (label + JSON `config`:
  `{ cards:[{label,doctype,filters}], charts:[{label,doctype,group_by,filters}] }`).
- Endpoints `POST /api/dashboard/count` and `/api/dashboard/chart`.
- Web `DashboardView` + route `/desk/dashboard/$name`: number cards (big count)
  and CSS bar charts (width ∝ value/max), each fetched live per widget.
- Verified: e2e (a board with All=6 / Open=3 cards and an Open3/Closed2/
  Pending1 bar chart, all matching the seeded data) + server test (count,
  filtered count, grouped counts ordered, filter in groups, Guest→403). The
  getList refactor left all 230 server + 42 web e2e green. 97/126.
- Unblocks RPT-006 (report charts pinned to dashboards) and UI-027 (workspaces).

## 2026-07-16 — SET-003 passing: role & permission manager UI

- Endpoints (System-Manager-gated): `GET /api/permissions/:doctype` returns all
  roles + the DocPerm rows for the doctype at permlevel 0; `POST` upserts a
  single row per (doctype, role) — finds the existing row and updates through
  the save lifecycle (or creates one), so toggling never leaves duplicates.
- Web `PermissionManager` + route `/desk/permissions/$doctype`: a roles×actions
  (Read/Write/Create/Delete/Submit/Cancel/Amend) checkbox matrix with a
  dirty-tracked Save. A "Permissions" link appears on every list header for
  System Managers (new `useIsSystemManager()` hook off /api/whoami).
- Because permissionScope reads DocPerm live per request, a revoke takes effect
  immediately — no cache to bust.
- Verified: e2e drives the UI to uncheck Write for a role and Save, then the
  role's user's update returns 403 (was 200), and the revoked state persists on
  reload; server test covers the SM gate (non-SM → 403 on read+write) and
  upsert-no-duplicate. 226 server + 41 web e2e green. 96/126.

## 2026-07-16 — RPT-004 passing: query reports (admin SQL, bound filters, gated)

- Report DocType gains `report_type` (Report Builder | Query Report) and
  `query` (migration 0026 — adds both docfields AND the tab_report columns,
  since Report is a normal doctype; idempotent + repairs a missing column).
- `src/query-report.ts`: `runQueryReport(name, filters, user)` loads the Report
  (read-permission enforced), requires report_type='Query Report', validates
  the SQL is a single SELECT/WITH, replaces `{name}` placeholders with `$n`
  BOUND params (never interpolated), and runs inside a `set transaction read
  only` block so a report can never write. Column names come from the result
  metadata so headers render even for 0 rows. Any DB/type error (e.g. a bad
  date filter value) is wrapped as a clean 417, never a 500.
- Authoring gate (`controllers/report.ts`): a non-System-Manager — even one
  with full write on Report — is rejected (PermissionError) when creating a
  Query Report or changing an existing one's query. Report Builder reports are
  unaffected.
- Endpoints: `POST /api/run_query_report` (run with filters) and
  `GET /api/query_report/:name` (returns filter names parsed from the SQL — the
  raw SQL is never sent to the client).
- Web: `QueryReportView` + route `/desk/query-report/$name` — fetches filter
  names, renders an input per filter (date input for *date* names), runs on
  load and on Run, shows a results table.
- Verified: server test (bound date filter, future-date→0 rows, injection
  inert, read-only rejects UPDATE, authoring gate for create+edit) + e2e
  (date filter runs and renders in the browser; non-System-Manager blocked
  from authoring SQL). 223 server + 40 web e2e green. 95/126.

## 2026-07-16 — PLAT-004 passing: developer CLI over the document API

- `src/cli.ts` (`pnpm --filter server cli <cmd>`) with subcommands:
  `migrate`, `patches`, `seed`, `create-doctype`, `create-user`, `console`.
  A tiny flag parser handles `--key value` (repeatable → array), bare
  `--flags`, and positionals.
  - `create-doctype --name "X" --field title:Data --field status:Select:Open|Closed [--single]`
    (pipe-separated Select options split to newlines).
  - `create-user <email> <pwd> [--full-name ..] [--roles "A,B"]` — creates the
    User through the normal save lifecycle + sets the password; login works.
  - `seed` re-applies the idempotent core seed migrations (0005/0006).
  - `console` — interactive REPL with sql/getDoc/saveDoc/getList/getMeta/
    createDocType in scope; when stdin isn't a TTY it runs the piped script as
    an async function and AWAITS it (scriptable: `cli console < script.js`).
- Refactored `migrate.ts` to export `runMigrations()` (no longer closes the
  connection) with an entry-point guard so importing it (from the CLI) has no
  side effect; standalone `pnpm migrate` (init.sh) still works.
- Verified: all six commands run against the dev DB (create-user login
  confirmed via /api/login; console script prints Administrator); server test
  spawns the CLI as a subprocess and asserts DB effects for create-doctype,
  create-user, and console. 218 server tests green. 94/126.
- Unblocks PLAT-008 (multi-tenancy per-site migrate/CLI).

## 2026-07-16 — PLAT-003 passing: ordered, recorded patch runner

- New patch system distinct from the doctype-seed migrations: `src/patches.ts`
  (`runPatches`, `appliedPatches`, `ensurePatchLog`) records applied patches in
  a `patch_log` table and runs each unapplied patch — in registry order —
  inside a single transaction that also writes its log row, so a patch's
  changes and its "applied" record commit together or not at all.
- A failing patch throws, rolling back its partial work AND its log entry, and
  aborts the run — prior patches stay applied, the failing one stays
  un-recorded so the next run retries it (verified: partial insert before a
  thrown error leaves no row and no log entry; re-run applies it once).
- Registry: `patches/index.ts` (Frappe's patches.txt equivalent, append-only,
  names are stable). First real patch `0001_file_ref_index` adds a
  `tab_file (ref_doctype, ref_name)` index (speeds FILE-002/003 lookups).
- CLI `pnpm --filter server patches` (`src/run-patches.ts`), wired into
  init.sh after `migrate`. Verified: first run applies, second run is a
  no-op, index present; server test covers run-once/idempotency/clean-abort.
- Unblocks PLAT-004 (CLI) and PLAT-008 (multi-tenancy). 215 server tests
  green. 93/126.

## 2026-07-16 — FILE-003 passing: private files gated by linked-doc permission + signed URLs

- Private files (`/private/files/:stored`) now enforce a permission check on
  the document they are attached to: `serveFile` looks up the File row's
  `ref_doctype`/`ref_name` and calls `getDoc(...)` as the requesting user, so
  a user without read on that document gets a 403 (previously any signed-in
  user could read any private file). Standalone private files (no ref) require
  read on the File doc itself.
- Signed URLs (`storage.ts`): `signFileUrl()` mints a short-lived HMAC
  signature bound to the exact path + expiry (`?expires=..&signature=..`);
  `verifyFileSignature()` timing-safe-compares and rejects expired/tampered
  sigs. New `GET /api/signed_url?file_url=..` checks the caller's permission
  on the linked doc, then returns a signed URL that serves with NO session
  header (usable in <img>/<a>). Public files return their plain URL.
- `serveFile` accepts EITHER a valid signature (skips auth — the grant was
  proven at mint time) OR a session that passes the linked-doc read check.
- Verified end-to-end (HTTP + test/signed-files.test.ts): outsider → 403 on
  both serve and mint; permitted non-admin reader → mints a signed URL that
  serves anonymously with the right bytes; tampered/expired signature → 401.
  The Desk's attachment links keep working (token-auth now permission-checked).
- Full suite: 213 server + 38 web e2e green. 92/126.

## 2026-07-16 — SET-004 passing: System Settings applied globally

- Migration 0025: System Settings single gains `currency` (Select, USD/EUR/
  GBP/INR/JPY, default USD), `currency_precision` (Int, 2), `float_precision`
  (Int, 2) — added idempotently as docfields (singles have no table).
- Server: `settings.ts` `getSystemSettings()` reads the single's EAV values
  with typed defaults. New `/api/settings` endpoint exposes only the display
  subset (app_name, date_format, currency, currency_precision, float_precision)
  to any signed-in user. `login()` now derives JWT lifetime from
  `session_hours` (clamped 1–720h) instead of a hardcoded constant.
- Web: `lib/settings.ts` — `useSettings()` (cached fetch) + `formatValue()`
  (Date→date_format, Currency→symbol+precision, Float→precision). ListView
  cells format by field type via these; FormView shows a formatted preview
  under each Date/Currency/Float input (native inputs can't honor a custom
  format). `listColumns()` now carries `fieldtype` so cells know how to
  render. Zero per-DocType code — one formatter drives every list and form.
- Verified end-to-end: e2e/system-settings-global.spec.ts (dd-mm-yyyy date +
  $1,234.50 currency render in list AND form previews; switching the global
  format to mm-dd-yyyy re-renders the same list to 03-09-2026; bumping
  precision to 3 → $1,234.500) + server settings.test.ts (defaults, typed
  overrides, endpoint subset). Full suite: 209 server + 38 web e2e green.
- 91/126.

## 2026-07-16 — Evaluation pass #10 (adversarial) + single-list hardening

- Ran the every-~3rd-wakeup adversarial pass over the newest features
  (EML-001..006, UI-017/020/021, SET-001, plus the eval-#9 realtime channel
  authorization fix). Probed: permlevel field-stripping on single reads,
  view-move (Kanban/Calendar) permission enforcement, email-rule condition
  matching / disabled rules / no-condition rules, tag add/list/remove, and a
  normal non-single doc lifecycle with child tables. **All held — no feature
  regressed to failing.**
- **One robustness gap found and fixed (coder follow-up):** `getList` on a
  Single DocType returned a 500 (it queried the nonexistent `tab_*` table).
  Singles have no table, so `getList` now short-circuits with a clean
  `ValidationError` (417: "… is a Single DocType and has no list …") right
  after the read-permission check, so auth still takes precedence. Verified
  live: single list → 417 (was 500), normal-doctype list → 200, direct
  single open → 200. Added a server test asserting the guard.
- No status flips. 90/126 unchanged.

## 2026-07-16 — SET-001 passing: Single DocTypes

- Migration 0024: `single_value` EAV table (doctype, field, value) + a
  seeded 'System Settings' single (app_name, time_zone, date_format,
  session_hours, allow_signup). Singles have NO generated table.
- Engine: getDoc routes issingle → getSingle (loads EAV values, applies
  field defaults, coerces Int/Float/Check back to JS types, name = the
  DocType name); saveDoc routes issingle → saveSingle (upserts changed
  fields into single_value, permission + validation enforced). Router:
  navigating to a single DocType renders its FormView directly (no list).
- Verified: e2e/single-doctype.spec.ts (System Settings opens as a form,
  no list-view; edit+save persists across reload; API confirms one
  instance named after the doctype) + test/single-doctype.test.ts (no
  table created; defaults before save; typed round-trip; update-in-place =
  one instance).
- 205 server + 37 web e2e green. 90/126.
- De-flaked: single test uses a unique app_name per run (System Settings is
  a persistent global — a repeated value left save disabled); RT-002 waits
  ~1s for B's socket before A saves (parallel-load WS race).

## 2026-07-16 — UI-021 passing: Calendar view with drag-to-reschedule

- `CalendarView.tsx` at /desk/:doctype/view/calendar — a 6-week month grid
  (defaults to the current month, prev/next nav) for DocTypes with a Date
  field. Documents render as events on their date cell; pointer-based DnD
  (same pattern as Kanban) drops an event on another day and PUTs the date
  field to that cell's YYYY-MM-DD. "Calendar" link on lists whose DocType
  has a Date field.
- Verified: e2e/calendar.spec.ts (event on the 10th of the current month →
  drag to the 20th → moves on screen AND doc.due updates in the DB). Full
  web suite 3× green (36).
- 89/126. View block progressing (Kanban + Calendar done; UI-022 Gantt,
  UI-026 dashboards remain).

## 2026-07-16 — UI-020 passing: Kanban board with drag-and-drop

- `KanbanView.tsx` at /desk/:doctype/view/kanban — groups docs by a Select
  field into columns (one per option), cards per doc. Pointer-based DnD
  (onPointerDown marks the dragged card; root onPointerUp uses
  document.elementFromPoint → closest [data-column] to find the drop
  column), then PUTs the grouping field to the target value and refetches.
  Group-by picker over Select fields; the list shows a "Kanban" link only
  when the DocType has a Select field. Route via kanbanRoute (?group_by).
- Pointer events (not HTML5 draggable) so Playwright's mouse API drives it
  reliably.
- Verified: e2e/kanban.spec.ts (drag Card A Todo→Done: card moves on
  screen AND doc.stage='Done' in the DB). Full web suite 2× green (35).
- 88/126.
- Next: UI-021 (Calendar) is the sibling view; both depend only on UI-002.

## 2026-07-16 — UI-017 passing: form sidebar (assignments + tags + attachments)

- Migration 0023: `tag_link` table (ref_doctype, ref_name, tag). Endpoints
  GET/POST/DELETE /api/tags gated by document read permission (dup insert
  is a no-op, missing doc → 404, blank tag → 417). `Tags.tsx` panel added
  to the FormView sidebar alongside the existing Assignments and
  Attachments panels.
- Verified: e2e/form-sidebar.spec.ts (assign Administrator, add tag
  'urgent', attach spec.txt → reload → all three persist; remove tag
  persists) + test/tags.test.ts (add/list[sorted]/remove, dup no-op, 404,
  417).
- 202 server + 34 web e2e green. 87/126.

## 2026-07-16 — EML-006 passing: assignments (ToDo + notification)

- Migration 0022: ToDo DocType (allocated_to, reference_doctype/name,
  description, status, priority). POST /api/assign creates a ToDo for the
  assignee (through the normal save lifecycle), writes a Notification Log
  row, and publishes a realtime user event so the assignee's unread badge
  pops live (RT-003). Assigner must be able to read the doc; unknown
  assignee → 404. FormView sidebar gained an Assignments panel
  (assigned-to list + assign input).
- Verified: e2e/assign.spec.ts (two contexts — admin assigns to user B; B's
  unread badge pops live and the ToDo appears in B's ToDo list) +
  test/assign.test.ts (ToDo+notification created, 404 unknown user, 417
  missing args, 401 unauth).
- 199 server + 33 web e2e green. 86/126. Email block COMPLETE
  (EML-001..006).

## 2026-07-16 — EML-004 passing: email rules on lifecycle events

- Migration 0021: Email Rule DocType (document_type, event
  [on_create/save/submit/cancel], optional condition_field+condition_value,
  recipient, subject, message, enabled). `src/email-rules.ts`
  evaluateEmailRules(event, doctype, doc) loads enabled rules for the
  doctype+event, checks the equality condition (blank field = always), and
  queues a rendered email per match. Wired post-commit into setDocstatus
  (fires on on_submit/on_cancel) so a rolled-back submit sends nothing.
  Table-existence guarded for early-migration getMeta safety.
- Verified: test/email-rules.test.ts (fires for priority=High on submit,
  NOT for Low, exactly once per matching submit) + live (submit a High
  Live Task via API → rule → queue → worker delivers to sink).
- 195 server tests green. 85/126.
- GOTCHA: document.ts→email-rules→email→document is an import cycle;
  resolves because all cross-refs are runtime calls, not module-init.

## 2026-07-16 — EML-003 + EML-005 passing: PDF attachments + templates

- queueEmail gained render/attach_pdf/print_format options, stored on the
  Email Queue row (in the attachments JSON) so the send_email job is
  self-contained. At send time, if a reference doc is set: EML-005 renders
  {{ doc.field }} in subject+body against the doc; EML-003 renders the
  document to PDF (renderPrintHtml+renderPdf, honoring a print format) and
  attaches it (base64) to the sink message. /api/queue_email exposes the
  flags.
- Verified: test/email.test.ts (+2 — templated queued mail lands rendered
  in the sink; attach_pdf delivers inv-1.pdf whose extracted text contains
  the doc's field value) + live (subject "Re: Live Report", attachment
  "e1.pdf").
- 192 server tests green. 84/126.
- Remaining email: EML-004 (submit rule), EML-006 (assignment→ToDo).

## 2026-07-16 — EML-001/002 passing: outbound email + queue + dev sink

- Migration 0020: Email Account (email_id, smtp_*, is_default), Email Queue
  (recipient, subject, body, status queued/sent/error, error,
  reference_*, attachments JSON), Email Sink (the local dev mailbox —
  mail_from/to, subject, body, attachment_names/b64). `src/email.ts`:
  deliverToSink (dev transport), sendTestEmail (EML-001), queueEmail →
  enqueues a `send_email` JOB that atomically claims the row
  (queued→sent, idempotent so no double-send) and delivers (EML-002).
  renderTemplate for {{ doc.field }} (EML-005 groundwork). Endpoints
  /api/send_test_email + /api/queue_email (System Manager).
- Verified: live (account → test mail lands in sink; queue → worker flips
  queued→sent, sink gets exactly one copy, job execution logged) +
  test/email.test.ts (4: test send, queued→sent single delivery, re-drain
  no double-send, template render).
- 190 server tests green. 82/126.
- Next: EML-005 (template in queued mail), EML-003 (PDF attachment),
  EML-004 (submit rule), EML-006 (assignment→ToDo+notification).

## 2026-07-16 — RT channel authorization fixed: RT-001/002/003 passing again

- `canSubscribe(user, channel)` in realtime.ts gates every subscribe frame:
  user:<name> only for the connecting user; list:<DocType> / doc:<DocType>:*
  only if the user has READ permission on that DocType; anything else
  rejected. The socket message handler now awaits authorization and silently
  drops unpermitted channels. Connection auth (no/bad token → close 4001)
  was already fine.
- Verified: two-user WS repro now leaks NOTHING (attacker subscribing to
  user:Administrator / list:User / doc:User:Administrator receives zero
  events); a permitted user (admin) still receives list:User + own
  notification. test/realtime.test.ts +4 authz cases. RT e2e green 3×.
- 186 server + 32 web e2e green. 80/126 restored.

## 2026-07-16 — Evaluation pass #9 (adversarial): RT block FAILED (channel auth leak)

Re-drove the 6 newest (JOB-001/002/003, UI-013, RT-001/002/003) on a second
DocType + a restricted non-admin, plus 2 regressions. Verdicts:

- **JOB-001/002/003 HOLD**: non-admin enqueue → 403; no-method → 417; queue
  drains; retries/failed states correct (already covered, re-confirmed
  enqueue authz).
- **UI-013 HOLDS**: user_settings is per-user — a non-admin reading
  /api/user_settings/User sees their own null, NOT the admin's saved
  {sort,hiddenCols}; admin reads back own.
- **Regressions HOLD**: REST CRUD round-trip (create/update/delete +
  404-after-delete) works through the now-event-publishing endpoints;
  permission denial still 403s a role-less user on list + create.
- **RT-001/002/003 → FAILING**: the WebSocket layer performs NO
  authorization on channel subscription. `for (const ch of msg.subscribe)
  client.channels.add(ch)` accepts any channel. REPRO: attacker logs in as
  a low-priv user, opens /ws?token=<their jwt>, sends
  {subscribe:["user:Administrator"]}; when Administrator is @mentioned, the
  attacker's socket receives {channel:"user:Administrator",
  event:"notification", payload:{subject:"Administrator mentioned you in a
  comment"}} — a cross-user confidentiality leak. Same gap lets any user
  subscribe to list:<AnyDocType> / doc:<AnyDocType>:<name> without read
  permission and learn doc names/changes. Connection auth itself is fine
  (no/garbage token → close 4001); only per-channel authz is missing.
  FIX (next, this session): authorize each subscribe — user:<name> only for
  the connecting user; list:/doc: only if the user can read that DocType.

80 → 77 passing. Fixing RT channel authz next in coder mode.

## 2026-07-16 — RT-001/002/003 passing: realtime over WebSockets

- `src/realtime.ts`: a WS server (ws) attached to the shared HTTP server at
  /ws?token=<jwt>. Clients subscribe to channels; the personal user:<name>
  channel is auto-subscribed. Channels: list:<DocType>, doc:<DocType>:<name>,
  user:<name>. publish() also feeds an in-process EventBus (onEvent) for
  tests. Mutation endpoints (save_doc, resource POST/PUT/DELETE) emit
  publishDocEvent; the Comment controller emits publishUserEvent per
  @mention (RT-003). New GET /api/unread_count and POST /api/set_password
  (self, or any user for a System Manager — enables second-user e2e).
- Web: `lib/realtime.ts` — one shared auto-reconnecting socket + useRealtime
  hook. ListView invalidates its list query on list: events (RT-001).
  FormView shows a "changed in another session" refresh banner on doc:
  events, suppressed for ~2s after the user's own save (RT-002). DeskLayout
  shows a live unread badge, refetched on user notification events (RT-003).
  Vite proxies /ws (ws:true).
- Verified: e2e/realtime.spec.ts — two browser contexts: (1) create in A
  appears in B's list; (2) A's save pops B's refresh banner (not A's own),
  refresh loads the new value; (3) A's @mention of user B pops B's unread
  badge live. Ran 3× green. Server: test/realtime.test.ts (event bus
  channels) + direct WS probe.
- GOTCHA: startup race — if the mutation fires before the other context's
  socket has subscribed, the event is missed; the e2e waits for the list to
  render + ~1s before mutating. Real users only hit a sub-second window on
  first open (the list already shows current data; realtime keeps it fresh).
- 182 server + 32 web e2e green. 80/126.

## 2026-07-16 — UI-013 passing: saved list settings per user

- Migration 0019: `user_settings` table (user, doctype, settings jsonb,
  PK (user,doctype)). Endpoints GET/PUT /api/user_settings/:doctype —
  per-user, only the caller's own row.
- ListView: a Columns picker (hide/show any list column) + column sort now
  persist to the user's settings and restore on next load (per DocType).
  Filters stay URL-driven (UI-003) and are deliberately NOT persisted here
  — auto-restoring saved filters double-handled the URL mechanism and made
  list tests non-idempotent (a filter saved in one run narrowed the next).
- Verified: e2e/list-settings.spec.ts (hide City + sort asc by Rank →
  logout → login → both restored). Full web suite 3× green (29).
- 179 server + 29 web e2e green. 77/126.

## 2026-07-16 — JOB-001/002/003 passing: background job queue + worker

- Migration 0018: Background Job (method, payload JSON, status, attempts,
  max_attempts, run_at, error, repeat_every) + Job Execution (per-attempt
  audit) DocTypes — durable, queryable via the API/UI.
- `src/jobs.ts`: registerJob registry, enqueue, runOneJob (atomic claim via
  `update … where name = (select … for update skip locked)`), drainJobs,
  startWorker/stopWorker (in-process setInterval poll, JOB_POLL_MS), loadJobs
  (src/jobs/*.ts self-register at boot). JOB-002 retries until max_attempts
  then → failed with the error; JOB-003 recurring jobs re-enqueue at
  run_at+repeat_every after each success. Worker starts at boot (off under
  NODE_ENV=test; tests drive runOneJob/drainJobs directly). Endpoint
  POST /api/enqueue_job (System Manager).
- Verified: test/jobs.test.ts (enqueue→drain→row written→done, queue
  drains; flaky job 3 attempts error/error/success; always-fails → failed
  after 3 with error + 3 error execs; unknown method fails cleanly),
  test/jobs-recurring.test.ts (1s cadence fires ≥2 with executions logged,
  a queued job always waiting; future re-enqueue not picked up early) +
  LIVE: enqueued demo_write_row via HTTP → the real in-process worker
  processed it (status done), row written, queue drained to 0.
- Interval note: production cadence is minutely; the recurring test uses a
  1s interval to exercise the identical re-enqueue path in seconds.
- GOTCHA: Int columns come back as bigint STRINGS from postgres.js —
  Number()-coerce attempts/max_attempts/repeat_every before arithmetic
  (a raw `+1` concatenates).
- 179 server tests green. 76/126.

## 2026-07-16 — Evaluation pass #8 (adversarial): all held, no findings

Re-drove the 5 newest (WF-001/002/003, CUST-001/002) on a SECOND DocType
(Ev8 Doc, never the demo) as Administrator + a restricted non-admin
(Ev8 Role), plus 2 regressions on the riskiest recent core changes.
Verdicts — all HOLD:

- **CUST-001**: custom Select field (with options) added to Ev8 Doc appears
  in meta + saves; an invalid enum value → 417 with the enum message; a
  custom field over an existing base field → 409 ConflictError.
- **CUST-002**: hidden=1 setter hides the field in meta (base row untouched
  = f); a DocType-level setter (empty field_name) overrode sort_field;
  removing both reverted cleanly.
- **WF-001**: workflow created on the second DocType.
- **WF-002/003**: role-holding user drove New→Review; a non-existent action
  → 417; a valid action from the wrong state → 417; after stripping the
  user's role, the SAME user's transition → 403 PermissionError with state
  unchanged (Review→Review).
- **Regression — child tables (document.ts hook change)**: save with 2
  child rows round-trips; update replacing the rows persists correctly.
- **Regression — PRN-003**: PDF still generates (200, application/pdf,
  17KB, %PDF- magic) on a doc carrying a custom field.

No status changes. 73/126 unchanged. Cleaned all Ev8 fixtures + any
property setters (they are global on shared doctypes).

## 2026-07-16 — CUST-002 passing: property setters

- Migration 0017: 'Property Setter' DocType (doc_type, field_name [empty =
  DocType-level], property, value). getMeta now overlays property setters
  onto the effective meta after loading base rows — booleans (hidden/reqd/
  read_only/in_list_view/unique) coerced from '1'/'true'. Base docfield
  rows are NEVER mutated; the override lives only in the loaded object.
  controllers/property-setter.ts invalidates the target meta on save/trash.
- Table-existence guarded (cached flag) so early bootstrap migrations that
  call getMeta before 0017 don't hit a missing table.
- Verified: test/property-setter.test.ts (label override in meta / base row
  unchanged; reqd coercion; removal restores) + e2e/property-setter.spec.ts
  (form shows 'Headline', reverts to 'Title' when removed) + live curl.
- 173 server + 28 web e2e green. 73/126.
- GOTCHA: property setters on CORE doctypes (User) are global — a probe
  that set User.full_name reqd=true broke 26 tests until deleted. Always
  clean up property-setter probes on shared doctypes.

## 2026-07-16 — CUST-001 passing: custom fields

- Migration 0016: `custom` boolean on tab_docfield + 'Custom Field'
  DocType (dt, fieldname, label, fieldtype, options, reqd, in_list_view).
- `src/custom-fields.ts`: applyCustomField (ALTER add column if the
  fieldtype has one + upsert a docfield row marked custom, guards against
  clobbering a base field), removeCustomField (drops the docfield, KEEPS
  the column/data — non-destructive), reapplyCustomFields (re-materializes
  every Custom Field record). controllers/custom-field.ts wires
  after_insert/on_trash. reapplyCustomFields() runs at boot + via
  POST /api/reapply_custom_fields (System Manager).
- Stored separately from the base definition, so a core re-seed (which
  rewrites base docfields) doesn't remove them — boot re-applies.
- Verified: test/custom-field.test.ts (meta+custom flag, API round-trip,
  docfield-wipe → reapply restores + value preserved, delete keeps column
  data) + live curl + e2e/custom-field.spec.ts (field in form with value,
  column in list).
- 170 server + 27 web e2e green. 72/126.
- Next: CUST-002 (Property Setters — override label/hidden/reqd) builds on
  this.

## 2026-07-16 — WF-001/002/003 passing: workflow engine (definition, execution, enforcement)

- Migration 0015: Workflow (+ child Workflow Document State, Workflow
  Transition) and Workflow Action (audit log) DocTypes.
- `src/workflow.ts`: getActiveWorkflow, validateWorkflow (WF-001: rejects
  transitions to/from undefined states — no orphans), ensureStateField
  (adds a read-only `workflow_state` field to the target DocType, on-demand
  ALTER + docfield insert + invalidateMeta), applyWorkflowAction
  (WF-002/003: resolves the transition from the doc's current state,
  enforces the `allowed` role — Administrator/System Manager bypass — then
  updates workflow_state + docstatus and logs a Workflow Action with
  who/when), availableActions (privileged users see all).
- controllers/workflow.ts: validate hook (orphan check) + after_save hook
  (ensureStateField when active). Endpoints GET /api/workflow/:dt/:name
  (state + permitted actions) and POST /api/apply_workflow_action.
- FormView: WorkflowActions in the header — state pill + transition buttons.
- **Core change**: saveDoc/updateDoc now attach child-table rows to
  `ctx.doc` under their fieldnames before running validate/before_save
  hooks (columnValues ignores non-scalar keys), so controllers can validate
  child grids. All 167 server tests still green — no regression.
- Verified: test/workflow.test.ts (5: persist+field-added, orphan 417,
  role-less 403 state-unchanged, admin drives Draft→Pending→Approved with
  docstatus 0→0→1 + audit trail, invalid-from-state 417) + live curl +
  e2e/workflow.spec.ts (Approve button flips Draft→Approved, audit row).
- De-flaked: workflow/timeline specs use per-run doc names (a submitted doc
  can't be API-deleted; versions accumulate). Web suite 3× green (26).
- 167 server + 26 web e2e green. 71/126.

## 2026-07-16 — PRN-003 passing: server-side PDF generation

- `src/print.ts`: renderPrintHtml builds the same HTML the browser print
  view shows (interpolated Print Format template, or metadata auto-layout,
  server-side {{ field }} + HTML-escaping) → renderPdf drives headless
  Chromium (page.setContent + page.pdf A4). Browser launched lazily and
  reused. GET /api/print/:doctype/:name?format= returns application/pdf.
- Chromium resolution: PLAYWRIGHT_BROWSERS_PATH isn't exported to the
  server process, so resolveChromium() globs /opt/pw-browsers/chromium-*/
  chrome-linux/chrome (newest first). Added playwright to apps/server.
- Verified: test/print-pdf.test.ts (auto-layout PDF contains Umbrella
  Corp/9876; a Print Format template interpolates RECEIPT + values;
  %PDF- header asserted; text via pdf-parse v2 PDFParse) + live curl
  (200 application/pdf 16KB; 401 unauthenticated).
- 162 server + web e2e green. 68/126. Printing block (PRN-001/002/003)
  COMPLETE.
- GOTCHA: pdf-parse v2 exports a { PDFParse } class (new + getText()), not
  a default function; pypdf is unusable here (broken cryptography native
  dep). Chromium PDFs font-subset text, so raw stream grep fails — must
  use a real extractor.

## 2026-07-16 — PRN-002 passing: print formats + interpolation

- Migration 0014: 'Print Format' DocType (doc_type Link, is_default Check,
  template Text). PrintView loads formats for the doctype; {{ field }}
  tokens interpolate from the doc (admin-authored templates are trusted →
  dangerouslySetInnerHTML, like Frappe Jinja). Selection: ?format=<name>
  wins, ?format=standard forces the auto layout, no param → the DocType's
  is_default format. Picker in the header; the auto metadata layout
  extracted to <AutoLayout>.
- Verified by e2e/print-formats.spec.ts: Invoice(default)+Receipt formats;
  no param → Invoice interpolated (Bill to: Stark Industries / Total 500),
  no RECEIPT; switch → Receipt output, no Invoice; ?format= URL restores;
  Standard(auto) → metadata layout.
- 160 server + 24 web e2e green. 67/126.

## 2026-07-16 — PRN-001 passing: print view

- `PrintView.tsx` at /print/:doctype/:name — a ROOT route (outside the
  Desk layout, so no navbar/sidebar/awesomebar). Metadata-driven: scalar
  fields as a label/value grid, each Table field as a bordered child-table
  (framework columns hidden), a print-hidden "Print" button calling
  window.print(). Form gained a Print link.
- Verified by e2e/print-view.spec.ts: reach via form Print button; app
  chrome absent (awesomebar/doctype-nav count 0); labels+values shown;
  child table renders 2 rows (Widget/Gadget).
- 160 server + 23 web e2e green. 66/126.
- Next: PRN-002 (print formats/templates) then PRN-003 (server PDF) build
  on this.

## 2026-07-16 — UI-019 passing: activity timeline

- `ActivityTimeline.tsx` in the form sidebar merges Comment + Version docs
  for the document, sorted by creation. Comments show author + text;
  versions show author + the field diff (field: old → new) from DOC-009's
  data.changed. Workflow actions will slot in once WF lands (recorded as
  versions/comments). FormView save() now also invalidates
  ['versions', doctype, name] so the timeline updates live after an edit.
- Verified by e2e/timeline.spec.ts: edit title → version entry with diff
  (title: original → revised title); add comment → entry after it; the two
  render in chronological order (version then comment).
- 160 server + 22 web e2e green. 65/126.

## 2026-07-16 — UI-018 passing: comments + @mentions + notifications

- `Comments.tsx` in the FormView sidebar (existing docs): comment stream
  (author avatar/initials + timestamp + content) filtered by
  ref_doctype/ref_name, a textarea with @-triggered mention autocomplete
  from the user list, @mentions rendered highlighted. Posts create Comment
  docs through save_doc.
- Migration 0013: 'Notification Log' DocType (for_user, subject,
  ref_doctype, ref_name, read). controllers/comment.ts after_insert hook
  parses @handles, resolves them to real users, inserts a Notification Log
  row per mentioned user (inside the comment's txn). Unknown handles
  ignored.
- Verified: e2e/comments.spec.ts (post, @mention autocomplete →
  "@Administrator ", highlighted render, persist across reload, +
  Notification Log row created); server test/comments.test.ts (real+Guest
  notified, ghost ignored, no-mention → no notifications).
- GOTCHA: tsx watch didn't hot-load the NEW controller file — a stale
  server on :8000 (EADDRINUSE after a prior crash) served without it.
  Always `bash init.sh` (kills by port) after adding a controller/method
  module, not just edit-in-place.
- 160 server + 22 web e2e green. 64/126.

## 2026-07-16 — Evaluation pass #7 (adversarial): all held, 1 robustness fix

Checked the 3 newest (DOC-012, API-003, API-005) + regressions (PERM
scope, credential leak sweep, link search) as Administrator AND a
read-only non-admin ('Ev7 Role', read-only on Ev7 Cust). Verdicts:

- **DOC-012 HOLDS**: read-only user rename → 403 and NO cascade (Acme
  intact); empty/whitespace new_name → 417; rename-to-same-name → 200
  no-op; cascade updates MULTIPLE linking docs (O1+O2) and child-table
  links; save after rename works (version logic intact).
- **API-005 HOLDS**: non-admin generates own key; token auth scoped to
  their perms (Ev7 Cust 200, Role 403); all malformed token headers →
  401; Bearer-with-key-pair → 401 (won't accept a key as a JWT).
- **API-003 HOLDS**: count_docs on missing doctype → 404, on unpermitted
  doctype (non-admin) → 403, path traversal → 404, non-whitelisted → 403.
- **Regressions HOLD**: list scope correct for restricted user; NO
  credential leak (User doc has no hashes; selecting api_key → 417); link
  search permission-filtered.
- **Robustness gap (not a failure)**: a whitelisted method that throws a
  plain Error (count_docs with no doctype arg / a POST with a non-JSON
  body → {} → missing arg) surfaces as 500 InternalError instead of a
  clean 4xx. The RPC layer is correct; the sample method should throw
  AppError. Fixing next in coder mode — API-003 stays passing (its verify
  criteria all pass).

63/126 unchanged. Next (coder): harden count_docs to ValidationError.

## 2026-07-16 — DOC-012 passing: rename document + cascade Link refs

- `renameDoc(doctype, old, new, user)` in document.ts: one transaction —
  update the PK, re-point this doc's own child rows (parent col), then
  UPDATE every Link field in every DocType whose options = this doctype
  (child-table links included). Write-permission checked; collision →
  409, missing → 404; single/child/engine-managed refused.
  POST /api/rename_doc. FormView gained a Rename control (button →
  inline input → confirm → navigate to new name).
- Verified: vitest (parent + child-table Link cascade, collision 409,
  missing 404) + live curl (cascade confirmed) + e2e/rename.spec.ts
  (rename from the form; linking doc's Link now shows the new name).
- Fixed a rules-of-hooks slip: the rename useState were placed after the
  early returns first (Vite error overlay); moved them up.
- 157 server + 21 web e2e green. 63/126 — HALFWAY.

## 2026-07-16 — API-003 passing: RPC for whitelisted methods

- `src/methods.ts`: whitelist(path, fn, {allowGuest}) registry +
  callMethod; method modules in src/methods/*.ts self-register at import
  (loadMethods() at boot, mirroring loadControllers). Route
  /api/method/:path{.+} (GET query args / POST JSON args) sits BEFORE the
  auth middleware: guest-allowed methods run session-less, all others
  resolveToken. Result wrapped as {message}. Non-whitelisted → 403
  PermissionError, so internal helpers stay unreachable.
- Reference methods: ping (echoes args+user), count_docs (runs through the
  permission-checked query layer), public_info (allowGuest).
- Verified: vitest (5 cases incl. guest bypass + 401 for non-guest) + live
  curl (JSON args, query args, 403 non-whitelisted, 401 unauth).
- 154 server tests green. 62/126.
- Session tally (this wakeup): eval #6 + 2 fixes, RPT-002, RPT-003,
  UI-012, UI-014, API-008, API-005, API-003 → 55→62.

## 2026-07-16 — API-005 passing: API key/secret auth (+ credential hardening)

- Migration 0012: api_key + api_secret_hash raw columns on tab_user
  (unique partial index on api_key). auth.ts: generateApiKeys (returns the
  secret ONCE, scrypt-hashed at rest), revokeApiKeys, and resolveToken now
  accepts `Authorization: token key:secret` alongside Bearer JWTs.
  Endpoints POST /api/generate_api_key + /api/revoke_api_key (self, or any
  user for a System Manager).
- Security hardening surfaced while building this: the generic doc API was
  serializing password_hash (a hidden DocField). Added a SENSITIVE_COLUMNS
  denylist — stripInternalColumns in document.ts drops password_hash/
  api_secret_hash/api_key/new_password from every read (parent + child
  rows), and query.ts removes them from the selectable/filterable column
  set (selecting one now 417s). getDoc/save/submit/cancel/amend all funnel
  through loadChildren so one strip point covers them.
- Verified: vitest (generate→auth→wrong-secret 401→revoke→401; non-SM
  can't target another user; no credential leaks) + live curl (token auth
  lists users, password_hash absent, revoke kills it).
- 149 server + 20 web e2e green. 61/126.

## 2026-07-16 — API-008 passing: CORS + security headers

- hono/cors on /api/* limited to config.allowedOrigins (WEB_ORIGINS env,
  default localhost+127.0.0.1 :5173), registered BEFORE auth so preflight
  OPTIONS (no Authorization) succeeds. hono/secure-headers globally
  (nosniff, frame-options, referrer-policy…).
- Verified: vitest preflight/echo/deny cases; live curl (204 preflight
  with ACAO for Desk origin; zero ACAO for evil origin); real browser on
  :5173 fetched :8000/api/ping cross-origin OK (temp spec).
- 146 server + 20 web e2e green. 60/126.

## 2026-07-16 — UI-014 passing: awesomebar documents + new-X actions

- Server GET /api/search: global typeahead over every regular DocType the
  user can READ (hasPermission per doctype) — name ilike + title_field
  ilike, LIKE-escaped, 3/doctype, 15 total. New `src/search.ts`.
- DeskLayout awesomebar: 150ms-debounced doc hits under the DocType
  matches, "+ New X" action rows for matched DocTypes, Enter opens exact
  DocType list else the first document hit's form.
- Verified by e2e/awesomebar.spec.ts (doc hit surfaces + click navigates,
  Enter navigates, New X opens the new-doc form).
- De-flaked two more cross-worker races: report specs each own their
  DocType now (RPT Saved/Export Task), and bulk-actions asserts exact-match
  stage cells. Full suite ran 6× green (20 passed).
- 143 server + 20 web e2e green. 59/126.

## 2026-07-16 — UI-012 passing: list bulk actions

- ListView: leading checkbox column (row-check + select-all over the
  visible page), a bulk bar when selection non-empty (count, Delete,
  Edit-field select + value + Apply). Bulk ops run per-doc through the
  normal endpoints (DELETE resource / GET+PUT with modified) — no
  side-channel; Check fields coerce 'true/1/yes'. Selection clears on
  page/filter/doctype change.
- Verified by e2e/bulk-actions.spec.ts: 5 seeded rows → select 3 →
  bulk-edit stage='done' (3 rows show it; API confirms 5 docs remain) →
  select-all → bulk delete → 0 total on screen AND via API.
- 19 web e2e green (server untouched). 58/126.

## 2026-07-16 — RPT-003 passing: CSV/XLSX export

- ReportView exports exactly the on-screen grid in display order:
  header, group header rows (value (n) + numeric sums) interleaved with
  member rows, grand total. CSV built inline (RFC-quoted); XLSX via
  dynamically-imported SheetJS (`xlsx` pkg, local, no network).
- Verified by e2e/report-export.spec.ts: real browser downloads of both
  formats; CSV line order equals the on-screen titles order, group sums
  (Open 3 / Closed 5 / Total 8) checked, XLSX parsed back with SheetJS in
  node and grid compared.
- 143 server + 18 web e2e green. 57/126.
- Session tally so far: eval #6 (2 bugs found+fixed), RPT-002, RPT-003.

## 2026-07-16 — RPT-002 passing: saved reports

- Migration 0011: 'Report' DocType (autoname prompt; ref_doctype Link,
  config JSON). ReportView gained filters (reuses the exported FilterBar
  from ListView — filters now count into RPT-001's view too), a saved-
  report picker, and Save-report popover (name → save_doc). Config
  {columns, group_by, filters} restores from ?report=<name> (URL state via
  reportRoute validateSearch) or the picker.
- Verified by e2e/saved-report.spec.ts: configure (drop qty column, filter
  status=Open, group by status) → save → fresh navigation to the URL
  restores all three (column gone, groupby=status, 2 rows, Open (2));
  picker from a clean view restores too.
- 143 server + 17 web e2e green. 56/126.

## 2026-07-16 — Eval #6 findings fixed: API-006 + META-004 back to passing

- META-004: `prepare: false` in db.ts — a system that ALTERs its own
  tables at runtime cannot use per-connection statement caches (PG 0A000).
  Regression test hammers a doc with reads/updates across 3 sync cycles
  (test/schema-sync-stale-plan.test.ts); live re-drive of the evaluator
  repro: 30 requests across 2 syncs, zero non-200s.
- API-006: listArgsFromQuery validates pagination with Number.isFinite →
  400 BadRequestError envelope ("limit_start must be a number"); NaN and
  Infinity never reach SQL. Covered in error-envelope.test.ts.
- 143 server + 16 web e2e green. 55/126 again — now with both bugs dead.

## 2026-07-16 — Evaluation pass #6 (adversarial): 2 real bugs found

Checked the 6 newest passing features as a NON-admin user ('Eval Role'
granted CRUD on a fresh 'Eval Ticket' DT + CRUD on File) plus 2 older
regressions. Verdicts:

- **RPT-001 HOLDS**: report math correct for restricted user (Open (2)
  sum 3 / Closed (1) sum 5, grand total 8); /desk/Role/view/report leaks
  zero rows to a non-permitted user; a DocType with no numeric columns
  renders (no grand-total row) and groups by Check fine.
- **UI-023 / FILE-001 / FILE-002 HOLD** for non-admin with proper grants:
  upload 201 (403 with clean envelope when File create not granted),
  attachments list via ref filters, delete removes the storage object
  (404 after), Attach value persists via PUT.
- **PERM-004 HOLDS**: desk_client as eval-user sees granted tables only,
  all writes denied, post-migration tables carry the generated policy.
- **DOC-009 / PERM-006 HOLD** (regressions): version diffs recorded;
  permlevel-1 field invisible to level-0 user and hostile write dropped.
- **API-006 → FAILING**: `GET /api/list/X?limit_start=abc` (or
  limit_page_length=xyz) → 500 InternalError. Number('abc') = NaN reaches
  the SQL layer. Malformed client input must be a 4xx envelope
  (BadRequestError). Repro: any list endpoint with non-numeric pagination.
- **META-004 → FAILING**: after `PUT /api/doctype/:name` adds a column,
  postgres.js per-connection prepared statements go stale: the next
  request served by each warm pooled connection 500s with PG 0A000
  "cached plan must not change result type" (document.ts:424 seen; any
  `select *`/`returning *` on the altered table). Repro: create DT → save
  doc → PUT doc (warms conn) → PUT /api/doctype adding a field → repeat
  PUT doc a few times → one returns 500, then heals. Fix direction for
  coder: disable prepared statements (`prepare: false` in db.ts) or
  catch 0A000 and retry once.
- Also cleaned leftover probe fixtures (RLS Widget/Secret DTs,
  rls-probe/eval users, eval DocTypes) from the DB.

55→53 passing (two honest regressions beat two false positives).

## 2026-07-16 — RPT-001 passing: report view (columns + group-by totals)

- `ReportView.tsx` at /desk/:doctype/view/report (3-segment route, no
  clash with $doctype/$name); "Report" button on ListView opens it.
  Metadata-driven like everything else: column picker (checkbox dropdown,
  defaults to in_list_view fields), group-by select over
  Select/Link/Data/Check fields, groups render header rows with count +
  sums of numeric (Int/Float/Currency) columns, collapsible; grand-total
  row across all rows. Fetches up to 500 rows via the normal list API.
- Verified by e2e/report-view.spec.ts: seeded Open(1,2)/Closed(5),
  grand total 8; grouped: Open (2) sum 3, Closed (1) sum 5; collapse
  hides member rows; unchecking qty removes the column.
- 141 server + 16 web e2e green. 55/126.
- Session tally (this wakeup): API-006, PERM-004, FILE-001, FILE-002,
  UI-023, RPT-001 — 50→55. Next: RPT-002 (saved reports) or RPT-003
  (CSV/XLSX export) build on this; UI-017 partially exists (attachments
  panel done, needs assignments/tags/shares). An evaluator pass is due
  next wakeup (~3 wakeups since pass #5).

## 2026-07-16 — UI-023 passing: Attach / Attach Image fields

- New fieldtype 'Attach Image' added to all three layers (server
  FIELD_TYPES + COLUMN_TYPES text, shared zod string, web FIELD_TYPES so
  the builder offers it). 'Attach' already existed as a column type but
  rendered as a bare text input.
- `AttachControl` in FormView: empty → "Attach file/image" button (hidden
  input, image/* accept for Attach Image); uploaded → filename link
  (+ inline <img> preview for Attach Image, ?token= for private) and a
  Clear button that nulls the value. Value is the file_url string; the doc
  saves like any field. Uploads tag ref_doctype/ref_name when editing an
  existing doc.
- Verified by e2e/attach-field.spec.ts: upload → preview renders (real
  naturalWidth > 0), URL stored on save, survives reload, Clear + save
  nulls the field, plain Attach gets link only.
- 141 server + 15 web e2e green. 54/126.
- Gotcha: `page.request` carries NO auth — pull fc_token from localStorage
  for API asserts in browser tests.

## 2026-07-16 — FILE-002 passing: attachments panel + delete cleanup

- `controllers/file.ts`: `on_trash` hook deletes the storage object when a
  File doc is deleted — no orphaned files.
- `Attachments.tsx` panel in a new FormView right sidebar (existing docs
  only): lists File docs filtered by ref_doctype/ref_name, + Attach uses a
  hidden input → multipart /api/upload_file with the ref fields, × deletes
  the File doc. Private links carry ?token=. FormView widened to max-w-5xl
  with a flex main+aside; all existing testids untouched.
- Verified: Playwright attaches two files to /desk/User/Guest, both listed,
  deletes one → row gone AND storage 404s, survivor still serves
  (e2e/attachments.spec.ts); server-side flow in files.test.ts FILE-002.
- **Flake fixed**: link-autocomplete.spec grabbed the NEWEST 'UI Form A'
  doc (order_by creation desc), racing with parallel-worker specs editing
  their own docs → "modified after you loaded it". It now creates its own
  fixture doc. Full web suite ran 3× green (14 passed).
- 141 server tests + 14 web e2e green. 53/126.
- Gotcha: REST list returns only `name` by default — pass fields=[...]
  explicitly in tests.

## 2026-07-16 — FILE-001 passing: disk-backed file storage + File docs

- `src/storage.ts`: uploads land in `apps/server/storage/{public,private}`
  (gitignored; FILE_STORAGE_DIR overrides) with a random-prefix sanitized
  name. POST /api/upload_file (multipart, authed) writes the object then
  creates the File doc through saveDoc (file_name, file_url, mime_type,
  file_size, is_private, ref_doctype/ref_name).
- Serving: GET /files/:stored public; GET /private/files/:stored needs a
  bearer header or ?token= (for <img src>). Files serve ONLY via a File-row
  lookup on file_url — unregistered/traversal paths 404. Vite now proxies
  /files and /private/files.
- Verified live via curl (upload public+private, 401 unauthed upload and
  private read, token read OK, traversal 404, through :5173 proxy) and 6
  tests in test/files.test.ts.
- Also fixed latent server typecheck: @types/node was missing in
  apps/server (tsc always failed); document.ts:384 cast + smoke.ts
  top-level-await module-ness. `npx tsc -p tsconfig.json --noEmit` green.
- 140 server tests + 13 web e2e green. 52/126.
- Next: FILE-002 (attachments panel + delete cleanup) or UI-023 (Attach
  fields) now unblocked; RPT-001 still queued.

## 2026-07-16 — PERM-004 passing: generated RLS (native PG, Supabase-equivalent)

- Migration `0010_rls.sql`: `desk_client` login role stands in for
  supabase-js/PostgREST direct access; session user rides in the `app.user`
  GUC (analogue of PostgREST's jwt claims — set by the trusted connection
  layer). Security-definer `fc_has_read(dt)` checks DocPerm × tab_has_role
  (permlevel 0, can_read; Administrator bypass). Every DocType table gets
  RLS + a generated SELECT-only policy; child tables gate per row on
  `fc_has_read(parenttype)`. No write policies/grants → all direct writes
  denied; server (postgres, table owner) bypasses RLS and stays the only
  write path. `applyRls()` in doctype-engine covers tables created after
  the migration (guarded on fc_has_read existing, for bootstrap ordering).
- Verified live via psql as desk_client: granted DT visible (child rows
  too), non-granted DT + tab_user 0 rows, Guest 0 rows, Administrator all,
  INSERT/UPDATE/DELETE all "permission denied", `migration` table not
  exposed. Fresh-DB migration run confirmed all 11 bootstrap tables get
  rowsecurity=t. Permanent coverage: test/rls.test.ts (6 tests, real
  second PG connection as desk_client).
- 134 server tests + 13 web e2e green. 51/126.
- Gotcha: a plpgsql `for r in select … from tab_doctype` cursor blocks
  `alter table tab_doctype` (55006) — snapshot into a temp table first.

## 2026-07-16 — API-006 passing: consistent error envelope

- Probed every error class against the live server. Two gaps found and
  fixed: unknown routes past auth returned Hono's plain-text 404 (now an
  enveloped NotFoundError via `app.notFound`), and a malformed JSON body
  surfaced as 500 InternalError (now 400 BadRequestError — SyntaxError from
  `c.req.json()` is mapped in `errorResponse`). New `BadRequestError` type
  → 400 added to the envelope.
- Verified live via curl: 400/401/403/404/409/417 all return
  `{error:{type,message,fields?}}` with application/json. Permanent
  coverage in `test/error-envelope.test.ts` (8 tests, incl. a role-less
  probe user getting an enveloped 403 on /api/doctype).
- 128 server tests + 13 web e2e green. 50/126.
- Gotcha: features.json is single-line-per-entry formatted — flip statuses
  with a string Edit, never a JSON rewrite (reformats the whole file).
- Next: PERM-004 (p1, generated RLS — satisfy with native PG RLS per
  CLAUDE.md invariant 2), then RPT-001/FILE-001 (p2).

## 2026-07-16 — Frappe reskin (Interleave polish pass)

- Reskinned Login, Desk shell, ListView, FormView, DocTypeBuilder to the
  Frappe Desk look (tokens + fc-* classes above). Self-hosted Inter to keep
  the offline test browser fast (a Google Fonts `<link>` had blocked the
  `load` event → 30s goto timeouts). Kept all data-testids; avatar shows
  initials with the full name as sr-only text so UI-001 still asserts it.
- 13 web e2e green in ~11s (was 2.9m with the network font). Verified all
  four screens by screenshot.

## 2026-07-16 — Evaluation pass #5 + UI-010 passing: submit/cancel/amend UI

- **Evaluator pass #5** (all held, no findings): permlevel-1 field injection
  via save_doc (not just PUT) is stripped (secret NULL in DB); a write-only
  DocShare does NOT grant read (403); fieldtype change via PUT rejected
  (417); amending a non-cancelled draft rejected (417).
- UI-010: FormView gained a docstatus badge (Draft/Submitted/Cancelled) and
  contextual action buttons for submittable DocTypes — Submit (draft, when
  clean), Cancel (submitted), Amend (cancelled → navigates to the new
  draft). Submitted docs render all fields read_only and disable Save.
  `runAction()` posts to submit/cancel/amend endpoints and invalidates
  caches. Playwright drove the full draft→submit→cancel→amend lifecycle.
- 13 web e2e + 120 server tests green. 49/126.
- Gotcha: inline `npx tsx -e` with top-level await fails (CJS) — use a
  .mts helper file for one-off password sets in probes.
- Next: the big remaining blocks — reports (RPT), printing (PRN), workflow
  (WF), jobs (JOB), realtime (RT), email (EML), files (FILE). FILE-001 and
  RPT-001 are good next picks (both priority 1-2, deps met).

---

## 2026-07-16 — PERM-006 + PERM-008 passing: permlevel + DocShare (permissions engine COMPLETE)

- PERM-006: `permittedLevels()`, `filterReadFields()`, `stripUnwritableFields()`.
  getDoc strips fields above the user's read permlevels; save paths drop
  writes to fields above write permlevels (silent, no escalation). Admin/
  System Manager see all levels (sentinel -1). Verified: level-1 'salary'
  hidden from level-0 user; their write to it ignored (server + live).
- PERM-008: DocShare DocType (migration 0009); `isSharedWith()` grants
  read/write on ONE doc bypassing role perms. getDoc/updateDoc consult
  shares FIRST; a share grants full permlevel access (else a shared reader
  with no role read-levels would get every field stripped — fixed both read
  and write paths). Verified: no-role user 403 → read-share → 200 with body
  → read-only can't write (403) → write-share edits → unshare → 403.
- **Permissions engine is now feature-complete**: roles, DocPerm CRUD grants,
  server enforcement, generated intent (RLS deferred), if_owner, user
  permissions, permlevel field-level, DocShare, admin bypass, link-search
  filtering. (10 of the 10 PERM features passing.)
- 48/126. Next: UI-010 (submit/cancel/amend buttons in FormView — engine
  ready), UI-003-adjacent list views (Kanban/Calendar), then reports/print/
  workflow/jobs/realtime/email/files blocks.

---

## 2026-07-16 — META-004 + UI-011 passing: schema sync + DocType builder

- META-004: `updateDocType()` + PUT /api/doctype/:name. Adds columns for new
  fields, updates docfield rows for property edits, drops docfields for
  removed fields but KEEPS the column (data) unless drop_columns:true.
  Fieldtype changes and istable/issingle changes rejected. Unique
  constraints added/dropped to match. Verified: 114 vitest + live (column
  added, 'keepme' row preserved).
- UI-011: `DocTypeBuilder` page at /desk/new-doctype (+ sidebar link). Field
  grid (fieldname/label/type/options/reqd/list), create via POST /api/doctype,
  navigates to the new list. Playwright: built a 5-field DocType from the UI,
  its list+form worked immediately, doc created and listed, server meta real.
- **init.sh BUG FIXED (important)**: pkill patterns matched only the tsx
  WRAPPER, not the node child holding :8000 — stale servers survived
  restarts and served stale meta caches (this masked deleted DocTypes as
  200). init.sh now kills by listening port via `fuser`. This was the root
  cause of intermittent 'deleted DocType still 200' behavior noted in prior
  sessions — RESOLVED.
- Gotcha: Select options in the builder grid are entered comma/newline
  separated and normalized to newlines (single-line input can't hold \n).
- Note: doctype-builder.spec skips if 'Builder Widget' already exists (no
  delete-DocType endpoint yet) — runs on fresh DB.
- 46/126. Next: PERM-006 (permlevel), PERM-008 (DocShare), UI-010 (submit
  buttons), then the reports/print/workflow blocks.

---

## 2026-07-15 — Evaluation pass #4 + DOC-008/DOC-009 passing: versions, amend

- **Evaluator pass #4**: child-row server errors surface in the banner and
  never corrupt the doc (per-cell child error highlighting logged as
  polish); child Link cells in the grid are plain text inputs (autocomplete
  is parent-level only — noted, within UI-007's verified scope).
- **DOC-009**: `recordVersion()` inside updateDoc's tx — field-level diff
  ([field, old, new]) into tab_version when track_changes (skips
  Version/DocType/DocField); no-op saves record nothing. GOTCHA: pass
  objects (not JSON.stringify strings) to jsonb columns via the postgres
  lib, or the value double-encodes as a JSON string scalar.
- **DOC-008**: submittable DocTypes auto-gain a hidden amended_from Link
  (createDocType + backfill migration 0008); `amendDoc()` requires
  docstatus=2, copies fields + children (fresh child names), derives
  NAME-n from the amended_from count, resolveName honors the pre-derived
  name. POST /api/amend_doc. Amended docs are editable and resubmittable;
  amending twice yields NAME-2.
- Verified: 110 vitest + live e2e (version diff [["t","one","two"]] via
  /api/resource/Version; amend produced <name>-1 draft).
- 44/126. Next: PERM-006 (permlevel), PERM-008 (DocShare), META-004
  (schema sync) + UI-011 (DocType builder), UI-010 (submit buttons in UI).

---

## 2026-07-15 — UI-007 + UI-008 + UI-016 passing: grid ops, sections, breadcrumbs

- ChildGrid gained ↑/↓ reorder buttons (swap-based move). Playwright drives
  the full loop: edit cell, delete row, add row, move it up, save — then
  asserts the DB via API returns exact [item, qty, idx] order.
- Section testids + first:border styling; 'UI Section DT' fixture with
  Section Break + Column Break renders two grouped sections in metadata
  order (fields provably in the right section, b1 absent from section 0).
- Breadcrumbs (Desk / DocType / name) on FormView; doctype crumb navigates
  back to the list; title bar Saved/Not saved cycle re-verified.
- 12 web e2e + 107 server tests green. 42/126 — one-third done.
- Next: DOC-008 (amend) + DOC-009 (versions) close the document engine;
  then PERM-006 (permlevel), PERM-008 (DocShare), UI-011 (DocType builder
  UI), META-004 (schema sync — needed by UI-011 editing).

---

## 2026-07-15 — PERM-010 + UI-006 passing: filtered link search, autocomplete

- PERM-010: dedicated suite proves the autocomplete query shape (list API,
  name-like filter) is permission-filtered: no-read 403, if_owner returns
  only own docs, user permissions narrow further, bypass unaffected.
- UI-006: `LinkControl` in FormView — debounced (150ms) search over
  listResource, dropdown with matches, mousedown-select stores the name,
  'No matches' state, '+ Create new <target>' footer navigating to
  /desk/$target/new. Playwright: filter narrows 2→1, pick persists through
  save+reload, create-new lands on a blank form.
- 9 web e2e + 107 server tests green. 39/126.
- Next: UI-007 (child grid verification), UI-008 (section layout — code
  exists, needs breaks fixture + Playwright), UI-016 (title bar — mostly
  built), PERM-006 (permlevel), DOC-008/009.

---

## 2026-07-15 — PERM-005 passing: user permissions

- Migration 0007 installs 'User Permission' DocType (user, allow→DocType,
  for_value). permissions.ts: `getUserPermissionMap` + `checkUserPermissions`
  + `isBypassUser`. getList injects name-in / linkfield-in filters for
  non-bypass users; document paths (read/insert/update/delete/docstatus)
  assert against the map — insert checks OUTGOING link values too.
- Verified: 104 vitest (list narrowing on link + target doctype, 403 direct
  reads, create-with-forbidden-link 403, admin unaffected) + live e2e
  (restricted user lists only CoA, CoB read 403).
- 37/126. Next: PERM-010 (its verify is now implementable: restricted link
  search), then UI-006 (link autocomplete), PERM-006 (permlevel), PERM-008
  (DocShare).

---

## 2026-07-15 — UI-009 + META-013 passing: shared zod schema on the client

- Web app now depends on the `shared` workspace package; FormView.save()
  runs `metaToZod(meta.fields).safeParse(values)` BEFORE the network — the
  literal same generator the server validates with. Field errors render
  inline; the save request is never sent (verified with a Playwright route
  counter: 0 calls on invalid, 1 on valid).
- Note: UI-009 and META-013 were mutually-dependent halves (client usage
  was META-013's missing clause; UI-009's dep was META-013) — implemented
  and flipped together as one unit; recorded here per protocol.
- 8 web e2e + 99 server tests green. 36/126.
- Next: PERM-005 (user permissions) → unlocks PERM-010 → unlocks UI-006
  (link autocomplete). Then UI-007/UI-008/UI-016.

---

## 2026-07-15 — Evaluation pass #3 + UI-004/UI-005/META-012 passing: generic FormView

- **Evaluator pass #3** (UI probes): core DocTypes render in ListView,
  malformed filters URL doesn't crash, sort+filter compose. Finding fixed:
  TanStack Query retried 4xx errors leaving missing/forbidden doctypes
  stuck on "Loading…" — query client now fails fast on ApiError < 500.
- **FormView** (components/FormView.tsx): one component renders + saves any
  DocType. Controls per fieldtype (number/date/datetime-local/checkbox/
  select/textarea/JSON mono/link combobox/child grid), Section/Column Break
  layout grouping, reqd asterisks, read_only disabled, dirty tracking
  (Save disabled when clean), field-wise server errors inline, create mode
  at /desk/$doctype/new. ChildGrid: editable cells, add/remove rows (full
  verification of grid ops is UI-007).
- **API fix found by tests**: REST POST stripped doc.name, making
  prompt-named DocTypes impossible to create via REST. POST now keeps the
  name but is create-only (saveDoc mode='insert' → 409 on existing).
- **Round-trip fix**: DB date columns serialize as full ISO timestamps and
  failed Date re-validation on save; shared schema now normalizes.
- META-012 flipped: FormView renders /desk/DocType/User with meta fields
  and the DocField child grid (verified via Playwright probe).
- 7 web e2e + 99 server tests green. 34/126.
- Next: UI-006 (link autocomplete), UI-009 (client zod → flips META-013),
  UI-007 (child grid verification), UI-016 (title bar indicator — mostly
  done inside FormView already).

---

## 2026-07-15 — UI-003 passing: list filters with URL persistence

- FilterBar in ListView: field select (name + non-hidden data fields),
  operators = != like > < >= <= (like auto-wraps %…%), Enter-to-add,
  removable chips. Filters live in the route's `filters` search param
  (JSON) via validateSearch on /desk/$doctype — reload/share-safe;
  paging resets on filter change. Sidebar Links needed explicit
  `search={{ filters: undefined }}` after adding validateSearch (TanStack
  Router makes search params required on Links).
- Playwright: stacked three filters (qty>=25 → 5; +title like; +title = →
  1), URL contains filters=, reload restores chips + narrowed results,
  chip removal widens. All 5 web e2e + server suite green.
- 31/126. Next: UI-004 (generic FormView — all field types) + UI-005
  (save with field-wise errors); those also complete META-012 and
  META-013's client half.

---

## 2026-07-15 — UI-002 passing: generic ListView

- `components/ListView.tsx` + `lib/meta.ts`: ONE component renders any
  DocType — columns from `listColumns()` (name + in_list_view fields,
  fallback first two data fields), click-to-sort headers (toggles asc/desc,
  resets paging), pagination (20/page, prev/next, page-info), keepPreviousData
  for smooth paging, Check renders ✓/✗, name column links to
  /desk/$doctype/$name (placeholder until UI-004).
- Playwright verified on TWO DocTypes with zero doctype-specific code
  ('UI List A' 30 docs: columns/pagination/sort asc+desc; 'UI List B':
  different columns, Check rendering, row-link navigation). Fixtures are
  idempotent via API (create-if-missing) since no DocType-delete path
  exists yet — 'UI List A/B' persist in the dev DB deliberately.
- All 4 web e2e + 99 server tests green.
- 30/126. Next: UI-003 (filter UI) then UI-004/005 (FormView + save).

---

## 2026-07-15 — PERM-007 + UI-001 passing: if_owner scoping, Desk shell live

- PERM-007: `permissionScope()` returns all/owner/none; unconditional rows
  override if_owner rows. Doc-scoped checks (`assertDocPermission`) run
  after the FOR UPDATE/select so ownership is authoritative: update, delete,
  submit/cancel, getDoc; getList injects an owner=user filter for
  owner-scope. Verified with two restricted users (vitest + live curl).
- UI-001: Desk shell wired to the real API — `src/lib/api.ts` (token in
  localStorage, 401 auto-logout redirect, listResource helper), functional
  login page (error display), DeskLayout sidebar listing non-child DocTypes
  via TanStack Query, session user footer, logout, route guards, and a
  /desk/$doctype placeholder for UI-002. Playwright e2e covers: wrong
  password error → login → sidebar shows User/Role/DocType → navigate →
  reload persistence → logout → guard redirect. @types/node added to web.
- 29/126. Next: UI-002 (generic ListView — columns from in_list_view,
  sort, paginate), then UI-003 (filters), UI-004 (FormView). The UI block
  is now unblocked end-to-end.

---

## 2026-07-15 — Evaluation pass #2 + PERM-001/002/003/009 passing

- **Evaluator pass #2**: tampered tokens 401, unauth doctype-create 401,
  disabled-user tokens die immediately (resolveToken re-reads the user row),
  submitted docs immutable via REST PUT, migrate idempotent. Known-risk
  note: meta cache serves stale meta after OUT-OF-BAND (psql) doctype
  deletes — no product delete-DocType path exists yet; when META-004/
  UI-011 add one, it MUST call invalidateMeta.
- **Permission engine** (permissions.ts): getRoles (implicit 'All'; Guest
  special), hasPermission via tab_docperm (role in user-roles, permlevel 0,
  can_<action>), Administrator + System Manager bypass, assertSystemManager
  for /api/doctype. Enforcement at engine level: create/write in saveDoc,
  read in getDoc/getList/meta, delete/submit/cancel in their fns. Engine
  callers default to 'Administrator' (seeds/hooks unaffected).
- Verified: 97 vitest incl. restricted-user matrix + live e2e (read 403 →
  DocPerm grant → read 200, create still 403).
- Gotcha: deleting Users via SQL leaves tab_has_role orphans (no FK) —
  test cleanups must delete child rows explicitly.
- 27/126. Next: PERM-007 (if_owner) or PERM-005 (user permissions), then
  UI-001 (login+shell) — auth + read APIs are ready for the Desk.

---

## 2026-07-15 — API-004 passing: authentication

- `auth.ts`: scrypt password hashing (32-byte key — 64-byte overflowed the
  varchar(140) password_hash column), login by name OR email (enabled users
  with a hash only), HS256 JWT (8h, secret env JWT_SECRET). Auth middleware
  guards ALL /api/* except /api/ping and /api/login; `GET /api/whoami`.
  AuthenticationError type → 401 (PermissionError stays 403 for authz).
  User identity threads into saveDoc/submit/cancel/delete (owner/modified_by
  = actual session user — verified with a non-admin user via live HTTP).
  Migration 0006 sets Administrator password (env ADMIN_PASSWORD, default
  'admin').
- **GOTCHA: this hono version's `verify()` requires the alg argument** —
  `verify(token, secret, 'HS256')`; without it every token 403s.
- Tests all authenticate via `test/helpers.ts` `areq()` (cached admin token);
  any new test file must use areq, not app.request (except auth negative
  tests). Web login page still a shell — UI-001 will wire it to /api/login.
- 23/126. Next: PERM-001..003 (roles/DocPerm/enforcement — DocPerm doctype
  already seeded), then UI-001 (login + shell) since auth is ready.

---

## 2026-07-15 — META-011 + META-014 passing; META-012 half done

- META-011: meta cache in meta.ts (loads/hits stats exported for tests);
  invalidateMeta() called by createDocType. NOTE: dev server caches meta —
  e2e probes that delete DocTypes via psql leave stale entries until a
  create invalidates or the server restarts.
- Bootstrap refactor: doctype/docfield → tab_doctype/tab_docfield (migration
  0004) with standard columns; DocType + DocField described by meta rows, so
  /api/resource/DocType works generically (verified live: list + doc with 8
  child fields). Generic writes/deletes to DocType/DocField are 417 —
  DDL path is /api/doctype. **META-012 stays failing**: its verify also
  needs the Desk form view to render DocType (UI-004).
- META-014: migrate.ts now supports .ts migrations (export up());
  0005_core_seeds.ts installs Role, Has Role, User, DocPerm, Comment,
  Version, File through the engine + seeds System Manager/All/Guest roles,
  Administrator (with System Manager) and Guest users. Verified per
  criterion: scratch DB + migrate → all core DocTypes + Administrator; then
  dropped. NOTE: psql -c can't run drop+create database in one call.
- 22/126. Next: API-004 (auth/login vs User table), PERM-001/002/003 block,
  or META-004 (schema sync). Auth unlocks the UI work.

---

## 2026-07-15 — DOC-007 + API-001 + API-002 passing: submit lifecycle, REST resource

- DOC-007: `submitDoc`/`cancelDoc` via shared `setDocstatus` (FOR UPDATE,
  from-state check, on_submit/on_cancel inside tx). Updates and deletes of
  submitted docs 417; cancelled docs terminal for edits. Endpoints
  /api/submit_doc, /api/cancel_doc.
- API-001/002: /api/resource/:doctype[/name] — GET list (same query-param
  parser as /api/list: filters/fields/order_by/limit_*), POST insert (name
  stripped), GET one, PUT update (name from path), DELETE. All driven by
  the same engine; unknown doctype 404s everywhere; field-wise errors
  surface through.
- Verified: 76 vitest + live e2e (submit→immutable→cancel; REST create+list).
- 20/126. Next: META-011 (meta cache + invalidation), META-012 (bootstrap
  DocType-of-DocTypes), META-014 (core seeds) — then auth (API-004) and
  permissions block, then the Desk UI.

---

## 2026-07-15 — DOC-003/004/006 passing: hooks, controllers, safe deletes

- `controllers.ts`: registry + file loader (src/controllers/*.ts default-
  export {doctype, hooks}); chain runs INSIDE the save tx — insert:
  before_insert→validate→before_save→INSERT→after_insert→after_save;
  update: validate→before_save→UPDATE→after_save. Hooks mutate ctx.doc
  (re-filtered via columnValues so hooks can't inject unknown SQL keys);
  ctx has old/isNew/user/tx. Reference controller hook_file_demo.ts.
- `deleteDoc()` + DELETE /api/doc/:dt/:name: blocks when any Link field
  (parent or child row — child resolves to its parent doc in the message)
  references the doc; runs on_trash; removes own child rows; blocks direct
  child/single deletes. Gotcha found: don't select parent/parenttype from
  non-child tables (column doesn't exist → was 500).
- Verified: 71 vitest + live e2e (slug hook fired on running server;
  linked delete 417 naming holder, then clean delete).
- 17/126. Next: DOC-007 (submit/cancel), then API-001/002 (REST resource)
  or META-004 (schema sync) to unlock CUST-001 later. META-011/012/014
  (cache, bootstrap meta, seeds) also unblocked.

---

## 2026-07-15 — META-008 passing: Link integrity

- `validateLinks()` runs inside the save transaction for parents (insert +
  update) and each child row (prefixed error keys like allocs.1.customer).
  Empty links allowed; missing target DocType and missing target doc both
  produce field-wise 417s.
- Verified: 62 vitest + live e2e (bogus link 417, valid link 201).
- 13/126 passing. Next: DOC-003 (lifecycle hooks) + DOC-004 (controller
  registry) — they unlock DOC-006/007 and the whole business-logic layer.

---

## 2026-07-15 — META-007 + DOC-005 passing: child tables

- `pickChildInputs`/`saveChildren`/`loadChildren` in document.ts: Table
  fields carry arrays; rows validated against child meta (errors keyed
  `field.i.child_field`), existing names updated, new rows inserted with
  parent/parenttype/parentfield + idx by array order, omitted rows deleted
  (payload authoritative) — all inside the parent's transaction (child
  error rolls parent back; verified). Direct save of istable DocTypes is
  blocked. createDocType validates Table options target is istable.
  getDoc/save responses include children ordered by idx.
- Verified: 59 vitest + live e2e (order with 2 rows; psql shows linkage).
- Next: META-008 (Link integrity), then DOC-003/004 (hooks + controllers)
  to unlock DOC-006/007.

---

## 2026-07-15 — Evaluation pass #1 + META-010 passing

- **Evaluator pass** (3rd wakeup): re-drove META-006/009/003, DOC-002/011 on
  fresh DocTypes via public HTTP. Held up: injection-safe prompt names,
  stale-update 409s, SQL-keyword DocType names, empty-reqd/overlong-data
  417s. **Finding: Int of 1e20 leaked a 500** (passed zod int check, blew
  bigint range). No status flips warranted; defect fixed this session.
- **META-010**: `applyDefaults()` (typed defaults incl. read_only fields),
  read_only client values silently dropped in `pickFieldValues` (insert AND
  update), `mapDbError()` translates PG 23505 unique violations to
  field-wise 417s (constraint name → fieldname) and 22003/22001/22P02 range
  errors to 417. Int schema now bounded to JS safe-integer range (fixes the
  evaluator finding).
- Verified: 53 vitest + live e2e (huge int 417, duplicate unique 417 with
  fields.c).
- Next: META-007 (child tables) + DOC-005 (transactional child saves), then
  META-008 (link integrity).

---

## 2026-07-15 — DOC-011 + META-009 passing: metadata-driven validation

- `packages/shared/src/schema.ts`: `metaToZod(fields)` builds a zod object
  per DocType (type-correct per fieldtype, Select→enum from options, reqd
  enforcement, empty→undefined preprocess); `zodFieldErrors()` flattens to
  {fieldname: message}. Server dep: `shared` workspace package.
- document.ts `validateValues()`: full-object validation on insert,
  `.partial()` on update (only changed fields), provided-but-empty values
  become explicit SQL nulls so updates can clear fields.
- DOC-011 + META-009 verified (48 vitest; live e2e returned both title
  'Required' and qty NaN errors in one field-wise envelope).
- META-013 stays failing: the CLIENT must consume the same schema (lands
  with UI-009). META-010 (defaults, read_only, unique mapping) still open —
  reqd alone doesn't satisfy it.
- Next: META-010, then META-007/DOC-005 (child tables) or META-008 (link
  integrity).

---

## 2026-07-15 — META-006 passing: naming engine

- `resolveName()` in document.ts inside the save transaction: hash (default),
  prompt (client name required; if the name already exists it becomes an
  update), field:<fieldname>, and series `PREFIX-.####` via `series` table
  with INSERT..ON CONFLICT DO UPDATE RETURNING (row-lock serializes
  concurrent savers). Migration 0003 adds `series`.
- saveDoc name-routing changed: name present → update if exists, else 404
  unless autoname=prompt (insert-with-name).
- Verified: 44 vitest incl. 50 parallel inserts → exactly NMINV-0001..0050,
  no gaps/dupes; live e2e produced E2EINV-0001..0003.
- Next: META-013 + DOC-011 (zod validation, field-wise errors), then
  META-009/010.

---

## 2026-07-15 — DOC-010 passing: get_list query engine

- `query.ts`: `getList()` with [field, op, value] filters (=, !=, <, >, <=,
  >=, like/not like as ilike, in/not in), field projection, order_by parsing
  (regex-validated, identifier-quoted — injection attempts 417), pagination
  (max 500) + total count. Every field name validated against meta columns.
  `GET /api/list/:doctype` with JSON query params.
- Verified: 40 vitest incl. injection attempt + live e2e (like filter,
  unknown field 417).
- Next: META-013 (shared zod schemas) + DOC-011 (field-wise validation) go
  together; then META-006 naming series, META-009/010 flag enforcement.

---

## 2026-07-15 — DOC-002 + META-005 passing: updates with optimistic concurrency

- `saveDoc` now routes docs carrying a `name` to `updateDoc`: SELECT ... FOR
  UPDATE, compares client-echoed `modified` timestamp against DB (409
  ConflictError on mismatch, 417 if omitted), auto-bumps
  modified/modified_by, preserves owner/creation. Standard-field payload
  keys are ignored rather than rejected so clients can send whole docs back.
- META-005 flipped too: columns verified via information_schema (ddl.test),
  auto-set on insert (document.test) and update (update.test).
- Verified: 36 vitest + live e2e (fresh update 201 → v2 in psql; replay of
  same modified → 409; row unchanged).
- Next: META-006 (naming series with atomic counter) or DOC-010 (get_list) —
  both unlock a lot. Prefer DOC-010 next; then META-013/DOC-011 validation.

---

## 2026-07-15 — DOC-001 passing: save_doc insert path

- `document.ts`: `saveDoc()` loads meta, rejects unknown fields (field-wise
  errors), skips layout/Table fields, generates hash names, auto-sets
  standard fields (owner/creation/modified/modified_by/docstatus/idx),
  transactional insert, returns full doc. `getDoc()` reads back.
  Endpoints: `POST /api/save_doc` {doctype, doc}, `GET /api/doc/:dt/:name`.
- Verified: vitest (insert+readback, unknown-field 417, 404s, envelope) +
  live e2e (create DocType → save_doc → row visible via psql).
- Gotcha: postgres lib returns bigint columns as strings ('3' not 3) —
  typed value coercion should land with META-013 zod schemas.
- Gotcha: doctype tests that create DocTypes must also drop tab_* tables in
  cleanup now that DDL runs (fixed doctype-engine.test.ts).
- Note: DOC-001's dep META-005 is implemented (columns + auto-set on
  insert) but stays failing until update-path auto-set exists (DOC-002).
- Next: DOC-002 (update + conflict detection) → then META-005 flip.

---

## 2026-07-15 — META-003 passing: DDL generation

- `createTableDDL()` in doctype-engine: standard columns always, parent
  linkage + (parent,idx) index for istable, per-field columns via
  `columnType()`, unique constraints, no table for issingle. DDL runs in the
  SAME transaction as metadata rows (verified rollback: pre-existing table
  name → 500 and no orphan doctype row). `tableName()` = tab_<snake_case>.
- Verified: vitest column-type assertions via information_schema + live API
  created 'Task' → `\d tab_task` shows all columns/PK; cleaned up after.
- Next: DOC-001 (save_doc insert through Document engine), which will also
  complete META-005's auto-set behavior.

---

## 2026-07-15 — META-002 passing: field type system

- `doctype-engine.ts`: `columnType()` maps all 16 fieldtypes to PG column
  types (Table/Section Break/Column Break → no column); `createDocType()`
  validates via zod (`doctypeDefSchema`) + semantic checks (reserved
  `STANDARD_COLUMNS`, duplicate fieldnames, Link/Table/Select require
  options), inserts doctype+docfield rows transactionally, 409 on duplicate.
  `POST /api/doctype` endpoint. Field-wise 417 error envelope.
- Verified: 25 vitest cases + live HTTP (invalid fieldtype 417 with
  field-wise message; valid def persists rows).
- NOTE: `POST /api/doctype` stores metadata only — DDL is META-003, next.

---

## 2026-07-15 — META-001 passing: DocType metadata storage

- Migration `0002_doctype.sql`: `doctype` + `docfield` tables (FK cascade,
  `(parent, fieldname)` unique, ordered by `idx`). `src/meta.ts`: `getMeta()`
  loads a `DocTypeMeta` with ordered fields; `GET /api/meta/:doctype` serves
  it. `FIELD_TYPES` const defined (enforcement lands with META-002).
- Verified: vitest (loader, HTTP, 404 envelope) + live e2e — SQL-inserted
  'E2E Task' returned by the running server with fields; unknown doctype
  404s; doctype delete cascades docfields.
- Next: META-002 (fieldtype→pg column mapping + rejection of invalid
  fieldtypes on a DocType-save path), then META-003 (DDL generation).

---

Newest entries first. Every session appends: date, feature ID worked on,
what was done, how it was verified, what to pick up next, gotchas.

---

## 2026-07-15 — Initializer session complete: stack boots green

- Scaffolded pnpm monorepo: `apps/server` (Hono, `postgres` client, error
  envelope, SQL migration runner, `/api/ping`), `apps/web` (Vite + React 19 +
  Tailwind v4 + TanStack Router/Query, login + desk shells, Playwright),
  `packages/shared` (placeholder for META-013 zod generator).
- **Database decision (user-approved): local system Postgres 16 cluster on
  port 5432, NOT Supabase.** `init.sh` starts it via `pg_ctlcluster`, sets
  postgres password to 'postgres', creates `frappe_clone` db.
  `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/frappe_clone`.
  Supabase-flavored features map to local equivalents (see CLAUDE.md).
- Verified end-to-end: `./init.sh` exits 0 — migrations apply, server :8000
  and web :5173 boot, server smoke (ping+db) and Playwright smoke (login
  page renders, API via proxy) all pass.
- **Gotchas**: (1) Docker daemon is not running in this environment — do not
  try Supabase local or docker compose. (2) Playwright must use
  `executablePath: '/opt/pw-browsers/chromium'` (already in
  playwright.config.ts). (3) Piping `./init.sh | tail` never returns EOF
  because the spawned dev servers hold the pipe; run it as
  `bash init.sh > /tmp/init.log 2>&1` and read the log instead.
  (4) `pkill -f init.sh` will kill your own shell if the command string
  contains "init.sh" — use exact patterns.
- **Next session**: META-001 (doctype/docfield storage + Meta loader).

---

## 2026-07-15 — Harness initialized (no code yet)

- Repo contains strategy (`docs/ROADMAP.md`) and the agent harness
  (`CLAUDE.md`, `harness/`). No application code exists yet.
- **Next session**: run the initializer prompt (`harness/prompts/initializer.md`)
  to scaffold the monorepo, Supabase local config, and `init.sh`, then start
  on `META-001`.
- Gotchas: none yet.
