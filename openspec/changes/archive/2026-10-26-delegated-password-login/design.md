# Design

## Context

See `proposal.md` for the motivation. Featherbase signs people in three ways
today: password (`POST /api/login`), Google OAuth, and the preview link. All
three issue the session through `apps/server/src/auth.ts` (`login` /
`issueSession`, which share the clamped session lifetime from #337) and set
the `sid` cookie with the same helper in `src/index.ts`. Instance sign-in
configuration (`google_client_id`, `allowed_login_domains`) lives in the
System Settings single, added by migration `0070_oauth_settings.ts` and read
through `getSystemSettings()`. The pre-auth Login page learns the instance
name from the public `GET /api/brand`.

The first provider is StyleHR: `POST https://stylehr.in/api/login/` with JSON
`{"email": <StyleHR ID>, "password": <password>}`, 10 s timeout; 2xx means
authenticated, 4xx rejected, 5xx/timeout/network unavailable. Its success
body is undocumented, and StyleHR usernames are system-generated
(`name_9999999999`) rather than the employee code, so binding cannot use the
response and must use a stored per-User mapping.

## Goals / Non-Goals

**Goals:**

- One generic "delegated password" provider configured in System Settings,
  not a StyleHR-specific code path.
- Bind solely on a configured User column, never on the provider's response.
- Reuse password sign-in's rate limits, error message, session issuance,
  cookie and landing logic so the three paths cannot drift.

**Non-Goals:**

- More than one delegated provider per instance.
- Creating accounts on first sign-in (Google's allowed-domains behaviour).
  Accounts are linked by an administrator in advance.
- Caching credentials for provider outages, or reading employment status
  from the provider's response.
- Validating the URL at save time in the System Settings form. Singles have
  no controller hooks today; the setting is validated where it is used.

## Decisions

### Configuration: three System Settings columns, validated at use

`delegated_login_label`, `delegated_login_url` and
`delegated_login_user_column`, added by a new migration in exactly the
`0070` pattern and surfaced through `SystemSettings`. A single
`delegatedLoginConfig()` resolves them: blank URL → off; a URL that is not
`https:` (except `http:` on `localhost`/`127.0.0.1`, for test stubs) → off;
blank column → off. A blank label falls back to the URL's host so the button
is never unnamed. Off is fail-closed: the route answers 404 and
`/api/brand` reports `delegated_login_label: null`.

Alternative: refuse a bad URL when System Settings is saved. Rejected for
now — singles run no controller hooks, and adding a settings-specific branch
to the generic single save is a larger change than the feature needs. A bad
URL leaves the feature off, which is safe.

### Route: `POST /api/login/delegated` mirrors `/api/login`

Order: `publicLimit('LOGIN')` → off ⇒ `c.notFound()` (the same body as any
unknown route, so the route does not advertise itself) → body validation
`{usr, pwd}` → per-credential `passwordAttempt` (scoped `delegated`, so a
local username and a provider ID never share one budget) → verify the
configured column exists → provider call → bind → issue session, `forgive`
the ticket, set `sid`, attach `landing`.

The column check happens before the provider call so a misconfigured
instance never forwards a password it could not use. The column must match
`^[a-z_][a-z0-9_]*$` and appear in `information_schema.columns` for the
platform `user` relation; only then is it interpolated, and through the
driver's identifier escaping. A failure answers 503 ("not set up correctly"),
not 404, because the feature is on and an administrator needs to see it.

### Provider call: injectable fetch, outcome classification

`src/delegated-login.ts` owns the call through a module-level fetch swapped
by `_setDelegatedFetch(f | null)` (the `_setEmbedFetch` pattern). It sends
JSON `{email, password}` with `AbortSignal.timeout(10_000)` and
`redirect: 'manual'` (a redirected POST silently loses its body). Outcomes:

| Provider answer | Result |
| --- | --- |
| 2xx JSON object with a positive signal (`token`, `access`, `access_token`, `key`, `employee_id`, `employee_key`, `id`, or `success`/`ok`/`authenticated: true`, top level or under `data`/`user`/`employee`/`result`) | verified |
| 2xx JSON saying no (`error`/`errors`, `success`/`ok`/`status`/`authenticated: false`, `status` error/fail/invalid) | rejected → 401 |
| 2xx JSON showing the person has left (exit date, `is_active`/`active: false`, a resigned/terminated status) | left → 403 "no longer active" |
| 2xx anything else: empty, non-JSON, array, unreadable body, unrecognised object | unavailable → 503 |
| 4xx except 408/429 | rejected → 401 `Invalid login credentials` (password login's text) |
| 3xx, 408, 429, 5xx, thrown fetch, timeout | unavailable → 503 naming the label |

**Fail closed (review of PR #363).** The first version verified every 2xx unless
its body looked like an error, so an empty body, an HTML maintenance page or a
body cut off mid-stream signed anyone in. Only a positive signal verifies now;
an unrecognised success shape logs its key names (never values) so the first
real StyleHR sign-in is diagnosable. The left-the-organisation rules are ported
from the warehouse report server's `looks_resigned`, because StyleHR keeps
authenticating leavers.

Only key names of the body may ever be logged; the route logs nothing on the
happy path and a single line with the label and outcome otherwise. The
password lives in the request body variable and the outbound request only.

### Binding

Resolved BEFORE the provider is asked: `select … from "user" where
lower(trim(<column>)) = lower(trim($usr)) and user_type <> 'service'`. Zero
rows, one disabled row, or one row holding the Administrator account or the
System Manager role ⇒ 401 `Invalid login credentials` with no provider call.
Two or more ⇒ 409 refusal. One eligible row ⇒ ask the provider, then
`issueSession`.

Why before (review of PR #363): the first version asked the provider first and
answered 403 "not linked" afterwards, so for any StyleHR ID with no account
here a 403 meant "right password" and a 401 "wrong" — a password checker for
the whole of StyleHR, running from Featherbase's address. The cost of the fix:
an unprovisioned Team Leader is told "invalid credentials" rather than "not
linked", and must ask their administrator. Privileged accounts are excluded
because whoever administers StyleHR can reset a password there. The column
must be a text column; `lower(trim())` on anything else would fail after
verification.

### Errors

A new `ServiceUnavailableError` type maps to 503. The existing
`DataSourceError` (502) means an external *data* source failed and is
rendered as such; reusing it for sign-in would mix two meanings.

### Web

`/api/brand` gains `delegated_login_label`. The Login page shows a
`fc-btn` "Sign in with <label>" under Google when the label is non-null;
clicking it swaps the card's form to "<label> ID" + "Password" posting via a
new `loginDelegated()` in `lib/api.ts`, which stores the session exactly like
`login()`. Both forms then run one shared `finishSignIn` (safe `next` return
or `landingPath`). Errors show the server message, which already differs per
outcome. "Forgot password?" is hidden in delegated mode — the password is not
Featherbase's to reset.

## Risks / Trade-offs

- [Provider answers 2xx for a wrong password with an unrecognised body] →
  the error-body guard covers the shapes seen in practice; the binding still
  requires an administrator-linked account, so the blast radius is limited to
  linked accounts. Recorded for the first real StyleHR login.
- [Password leaks through an error path] → the route catches every provider
  failure itself; a test spies on every `console` method and asserts the
  password appears in no log line and no response body.
- [Misconfigured column interpolated into SQL] → regex plus
  information_schema check before use, plus identifier escaping.
- [A slow provider ties up a request] → 10 s timeout, counted as
  unavailable.

## Migration Plan

One additive migration adds the three System Settings columns (idempotent,
skipped where System Settings does not exist). Existing instances stay off
until an administrator fills in the URL. Rollback: blank the URL.
