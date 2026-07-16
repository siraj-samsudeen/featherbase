# Progress Log

## Visual identity (standing directive for all UI work)

The Desk is reskinned to look like Frappe. Every new UI feature MUST inherit
this look — do not introduce ad-hoc colors/spacing:
- Design tokens live in `apps/web/src/index.css` (`@theme`): canvas
  `#f4f5f6`, brand `#2490ef` (Frappe blue), ink `#1c2126`, hairline borders
  `#ebeef0`/`#d1d8dd`, Inter (self-hosted via `@fontsource-variable/inter`,
  NO network fonts — offline is a hard requirement for the test browser).
- Reuse the shared component classes: `.fc-card`, `.fc-input`, `.fc-btn`,
  `.fc-btn-primary`, `.fc-label`, `.fc-pill`. Prefer these over raw Tailwind.
- Shell (navbar + workspace sidebar + awesomebar + avatar) is in
  `DeskLayout.tsx`; new pages render inside its `<Outlet/>` canvas.

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
