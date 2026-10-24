Nothing here is built until the instance owner has reviewed this change (#458). Each
stage runs on dev first. Prod gets each stage only after the owner approves, with a
rehearsal on a restored prod snapshot that uses prod's real environment variables
(`docs/DEPLOY.md`).

## 0. Owner review

- [ ] 0.1 Owner answers Q1–Q4 in `design.md`, or accepts the recommendations; record the answers in the design.
- [ ] 0.2 File follow-ups: "see Feather Dash as this person" for System Managers; shared Shop Floor tokens package for runtime clients.

## 1. Stage A — front door around today's page (platform only)

- [ ] 1.1 `front_doors` System Setting with validation (https origin outside dev/test, host unique and ≠ `SITE_URL` host, names a runtime package) and release-preflight checks.
- [ ] 1.2 Host matching against configured doors; door-host routing (`/` → app root; Desk pages and other apps → door root; sign-in, reset, callback, privacy, API served).
- [ ] 1.3 `/api/brand` and the login page use the door's name on a door host.
- [ ] 1.4 Google sign-in per door: `redirect_uri` from the door's configured address, door recorded in `state`, callback refused on any other host; DEPLOY.md step to register each door's redirect.
- [ ] 1.5 Cross-address handoff: one-time, one-minute code bound to the target door, minting a session for it; Desk-host landing hands people with no Desk capability to their door.
- [ ] 1.6 Interim target: until the package is installed, a door for `feather_dash` serves today's report page in a door-branded shell.
- [ ] 1.7 Tests: server (matching, header cannot invent an origin, redirects, OAuth state, handoff replay and expiry), browser (manager on door, System Manager on both hosts, sign-out per host).

## 2. Stage B — Feather Dash as a package

- [ ] 2.1 E1 `person_scope` policy, with today's derivation moved unchanged into a platform person-scope provider; refusal and audit as for `stores`.
- [ ] 2.2 E2 declared settings (`App Setting`, a security Table) and secrets in the handler context; preflight warning for missing required secrets.
- [ ] 2.3 E3 package datasets on the snapshot engine (declared columns and keys, platform-owned raw storage, `datasets.active().rows({ where })`), registered only for installed, active packages.
- [ ] 2.4 E4 declared frame origins on the app's own documents; remove the global embed frame source.
- [ ] 2.5 E5 outbound reads run after the authorization transaction; `recordView` writes the Access Log.
- [ ] 2.6 E7 release refuses when an installed, enabled package's exact version is missing.
- [ ] 2.7 D4 app-role bindings (`App Role Binding`, a security Table; manifest defaults applied once; role checks honour bindings); default `Sales Target Viewer → Feather Dash Reader`.
- [ ] 2.8 `runtime-apps/feather-dash` 1.0.0: manifest with every Table and grant stage D needs, the client with page parity, reads `me`, `report`, `embed_session`, the dataset definition. Dockerfile and `FEATHERBASE_APP_PATHS`.
- [ ] 2.9 Parity check on a restored dev snapshot: for every person with a scope, the app's answers equal the core endpoints' answers (scope, rows, totals, embed initial state).
- [ ] 2.10 Install on dev, switch the dev door to the app, run the trial; then prod with approval.
- [ ] 2.11 Clean-up release: delete the core page, route, `/api/sales_target/*`, `sales-target*.ts`, `datasets/sales-target-mtd.ts`, old snapshot tables (migration), `capabilities.report`, `landingFor`, `ReportOnlyShell`, the stage A interim target.
- [ ] 2.12 `cli app:upgrade <app> <version>` wrapping preview → upgrade → activate.

## 3. Stage C — roster redesign (after #449 and #392 land)

- [ ] 3.1 Person-scope provider reads `position`, `section`, `section_subcategory`; #449's per-person parity check is the gate.
- [ ] 3.2 Bindings move to the manager jobs; delete `Sales Target Viewer` and its binding.
- [ ] 3.3 Confirm Feather Dash needed no change.

## 4. Stage D — section editing (Feather Dash 1.1.0, code-only)

- [ ] 4.1 Scope entries carry section and mapping confirmation status.
- [ ] 4.2 Action `request_section_change` (scope-checked, either side of a move) and withdraw; my-sections page.
- [ ] 4.3 Action `decide_section_change` applying through the normal save path as the reviewer; reviewer page.
- [ ] 4.4 Tests: Team Leader refused outside their section; reviewer without the master Tables' writer role cannot apply; applied edit survives a re-import.
- [ ] 4.5 Upgrade dev, then prod with approval.

## 5. Close-out

- [ ] 5.1 Sync the deltas into the main specs and archive the change.
