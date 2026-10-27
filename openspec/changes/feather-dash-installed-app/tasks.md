Each stage runs on dev first. Prod gets each stage only after the owner approves,
with a rehearsal on a restored prod snapshot that uses prod's real environment
variables (`docs/DEPLOY.md`). Each stage starts from its own GitHub issue. UI work
gets a numbered spec checklist and an independent verifier with screenshots before
the owner reviews. Server, security and data logic gets a Codex review.

## 0. Owner review

- [x] 0.1 Owner answers the open questions; record the answers in the design (decision log, 26-Oct-2026).
- [x] 0.2 Record ADR 0011 "Platform, App, Instance".
- [x] 0.3 File follow-ups: #484 (UI-built Tables to app code), #487 (client seed pack and runbook out of this repository).
- [ ] 0.4 File follow-ups: "see Feather Dash as this person" for System Managers; shared Shop Floor tokens package for app clients; the extension-point catalogue generated from the manifest schema.

## 1. Stage A — addresses and the shared bar (platform only)

- [ ] 1.1 `INSTANCE_ADDRESSES` replaces `SITE_URL`: parse and validate (https outside dev/test, unique hosts, opens `admin` or an app, exactly one marked for emails, at least one opens `admin`); every reader of `SITE_URL` moves to it; release checks.
- [ ] 1.2 Host matching against the list; on an app's address, `/` → the app's root, other `/featherbase/*` pages and other apps → the app's root; sign-in, reset, callback, privacy, API and shell assets served.
- [ ] 1.3 `/api/brand` and the login page use the opened app's title on its address.
- [ ] 1.4 Google sign-in per address: `redirect_uri` from the list, address recorded in `state`, callback refused on any other host; `DEPLOY.md` step to register each address.
- [ ] 1.5 Hand-off in both directions: one-time, one-minute code bound to the target address, minting a session there; landing rules (stay, Admin, the app's address, no-access).
- [ ] 1.6 Shared top bar component: Account menu (Sign-in methods, Log out), theme, "Open Admin" for people who can use Admin, the app's name on its address; replaces the report page's, Portal's and restricted shell's own headers.
- [ ] 1.7 Interim target: until the app is installed, an address that opens `feather_dash` serves today's report page inside the shared bar.
- [ ] 1.8 `docs/DEPLOY.md`: prod deploys from `main`; `INSTANCE_ADDRESSES` replaces `SITE_URL`.
- [ ] 1.9 Tests: server (matching, a header cannot invent an origin, redirects, OAuth state, hand-off replay and expiry, list validation), browser (manager on the app address, System Manager on both, sign-out per address, the bar on every address).

## 2. Stage B — Feather Dash as a client app (revised 27-Oct-2026, ADR 0013)

- [x] 2.1 E1 scope shape, the app-declared scope provider (one enabled provider per instance; install, enable, upgrade, activation and the release preflight refuse a second; a replay must still be covered by the places it ran under) and the `person_scope` policy, failing closed; refusal and audit as for `stores`; Tables marked `decides_scope` are guarded as security Tables (#559, migration 0131). The client's derivation is supplied by its app (B6′), never by the platform.
- [x] 2.2 E2 declared settings (`App Setting`, a security Table, set through the instance settings file) and secrets in the handler context; "not set up yet" before the handler; release warning and Instance health check for a missing required setting or secret (#620, migration 0133).
- [x] 2.3 E3 cached datasets declared by an app (source, query, columns, keys, filter mapping); snapshot and live read through one shaping function (#625, migration 0135).
- [x] 2.4 E4 declared outside sites on the app's own pages; remove the global embed frame source. The Sales Target page keeps MotherDuck, page-scoped, until B9 (#642).
- [x] 2.5 E5 outbound reads run after the authorization transaction; `recordView` writes the Access Log (#625).
- [x] 2.6 E7 release refuses when an installed, enabled app's exact version is missing; so does the server's start (#642).
- [x] 2.7 E8 declared bar controls (picker filled from the app's read, choice in the address): manifest validation and `GET /api/app_bar/:app`, and the top bar's picker built to the owner's checklist (#642).
- [x] 2.8 E9 `apiVersion` → `platformVersion` (dated by month) across the manifest schema, Tasker and fixtures.
- [x] 2.9 D4 app-role bindings (`App Role Binding`, a security Table, Admin-editable; manifest suggestions written once; role checks honour bindings; release refuses All/Guest) (#620, migration 0133). The stand-in binding `Sales Target Viewer → Feather Dash Reader` ships as Feather Dash's own `roleDefaults` in B6′ (2.10, ADR 0013).
- [ ] 2.10 B6′, in the client's repository (ADR 0013): Feather Dash 1.0.0 as a client app, with today's query and roster derivation moved out of this repository, the scope provider, the role suggestions and stand-in binding, and the Dive's lines for `cached` and the live-ready notice. Check real row counts against the 56 KB budget there. The app's spec moves there with it. The app: manifest with every Table and grant stage D needs; client with page parity; reads `me`, `report`, `embed_session`; the `cached` key in `initial_state` (Month to date only, 56 KB all-or-nothing budget); the generic quick view when the Dive cannot load; a client image built on the platform image, with `FEATHERBASE_APP_PATHS`.
- [x] 2.11 Publish the platform image for client images to build on: a GitHub Action publishes the server image to the GitHub Container Registry, tagged by commit SHA, after that commit's tests pass; `docs/DEPLOY.md` shows a client Dockerfile (D7, #587). First published from `main` at `64b25b0c` (27-Oct-2026), made public, pulled without credentials and boot-checked.
- [ ] 2.12 Parity check on a restored dev snapshot: for every person with a scope, the app's answers equal the platform endpoints' (scope, rows, totals, embed scope state).
- [ ] 2.13 Install on dev, switch the dev address to the app; then prod with approval. Done in the go-live cut-over (5.1), together with stage D, not on its own.
- [ ] 2.14 Clean-up release: delete the core page, route, `/api/sales_target/*`, `sales-target*.ts`, `datasets/sales-target-mtd.ts`, old snapshot tables (migration), `capabilities.report`, `landingFor`, `ReportOnlyShell`, the stage A interim target.
- [ ] 2.15 `cli app:upgrade <app> <version>` wrapping preview → upgrade → activate.
- [ ] 2.16 Local development of a client app: run a client app with hot reload against a featherbase checkout or version, without Docker images (D7); the mechanism is decided and built with B6′.
- [x] 2.17 An installed app's own pages carry the shared top bar (D3, E8): the platform's bar bundle draws it over the app's page; the runtime shell's header, switcher, stylesheet and script are removed; bar choices reach the app through the address and the `featherbase:bar-change` event; the bar's height is published as `--featherbase-bar-height` (#650).
- [x] 2.18 Optional secrets: a secret may be marked optional and each read or action names the optional secrets it needs; a missing optional secret holds up only those, a handler never gets an optional secret it does not need, and the release check and Instance health warn naming the secret and what needs it (#666).
- [ ] 2.19 With the clean-up release (2.14): remove every `feather_dash` / `INTERIM_APPS` literal from platform code (`landing.ts`, `TopBar.tsx`, `instance-addresses.ts`, `packages/shared` `app-routes.ts` and its export). Which app an address opens, and the name its bar shows, come only from `INSTANCE_ADDRESSES` `opens` and the installed app, so the platform names no app (ADR 0011). The literals were accepted in #672 only as part of the interim coupling 2.14 deletes. Then flip the `test.fails` pin in `apps/server/test/platform-names-no-app.test.ts` to a plain test.
- [x] 2.20 Dataset completeness guards: a dataset declaration may carry `guard`, a list of `min_rows`, `not_all_zero` and `max_drop_pct` checks, validated against its columns at discovery; a refresh that fails one keeps the last good snapshot and fails the `refresh_datasets` Job Execution, naming the dataset, guard and numbers (#669). The client app declares its target checks in B6′.

## 3. Stage C — roster redesign (after #449 and #392)

3.1 is stage C1, on the go-live path. 3.2 and 3.3 are C2 and may follow go-live.

- [ ] 3.1 The scope provider reads the #449 tables wherever #449 places them; #449's per-person parity check on the scope shape is the gate.
- [ ] 3.2 Bindings move to the manager jobs; delete `Sales Target Viewer` and its binding.
- [ ] 3.3 Confirm Feather Dash needed no change.

## 4. Stage D — section editing (Feather Dash 1.1.0, part of go-live; after #246 items 1–2, #462 and C1)

- [ ] 4.0 #246 items 1–2 for the section and mapping Tables: explicit scope columns and `scope_required` (no scope rows means no rows), with an empty-scope test. Built after B2.
- [ ] 4.1 Scope entries carry section and mapping confirmation status. Built in B2 (2.1), so D needs no shape change.
- [ ] 4.2 Action `request_section_change` (scope-checked, either side of a move) and withdraw; my-sections page.
- [ ] 4.3 Action `decide_section_change` applying through the normal save path as the reviewer; reviewer page; the Section Reviewer role bound to #462's role.
- [ ] 4.4 Tests: Team Leader refused outside their section; a reviewer without #462's role cannot apply; a System Manager is not the reviewer by default; applied edit survives a re-import.
- [ ] 4.5 Upgrade dev, then prod with approval, in the go-live cut-over (5.1).

## 5. Go-live cut-over (owner decision 27-Oct-2026)

- [ ] 5.1 One cut-over for B, C1 and D: the parity check (2.12), install 1.0.0 and upgrade to 1.1.0 on dev, switch the dev address; then prod with the owner's approval. Then the clean-up release (2.14).
- [ ] 5.2 In the same cut-over: the client's instance setup marks its roster Tables `decides_scope`; then a platform release removes their names from `security-tables.ts` (#559).

## 6. Close-out

- [ ] 6.1 Sync the deltas into the main specs and archive the change.
