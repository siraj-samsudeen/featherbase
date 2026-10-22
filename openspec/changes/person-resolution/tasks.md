# Tasks

Test-first throughout: each task writes its failing tests, then the code, then
runs the named files. Builds on `person-identities` (#371), which merges and
archives first (this change modifies requirements that one adds, so the
validator's "archive would refuse" note clears once it is archived).
Phase 1 alone delivers the 80 % case: identifiers with history, suggestions,
a reviewed merge, undo, and the Jeyarama defaults. Phases 2 and 3 are
separate PRs.

## Phase 1 — one person, identifiers, reviewed merge

### 1. Storage and defaults

- [ ] 1.1 Migration `0101_person_resolution.ts`: Identifier System Table + the five Jeyarama rows (design D2); Person Match Table; `person_identifier` and `person_merge` raw tables with indexes; `user.replaced_by`; `user_identity.ended_at`/`ended_reason`; `sign_in_method.identifier_system`; `Data Quality Manager` role. Read-only `cli people:plan` sharing the backfill code (D3, D5). Verify `test/migration-0101.test.ts` (dev-shaped fixture, idempotent re-run, plan parity).
- [ ] 1.2 Identifier System controller: the refusal rules (auto-link needs strong + one-per-person + not a sign-in subject; fingerprint needs restricted + last4/hidden; no delete while in use; one-holder flag refused while current duplicates exist). Verify `test/identifier-systems.test.ts`.
- [ ] 1.3 `identifiers.ts`: normalisation rules (`trim`/`lower`/`upper`/`digits`/`indian-mobile`), Verhoeff check, fingerprint with `IDENTIFIER_FINGERPRINT_KEY` (missing key ⇒ 503, never a plain hash), hint = last 4, request-log redaction for fingerprint systems. Verify `test/person-identifiers.test.ts`.
- [ ] 1.4 Person Identifier controller and routes (`GET|POST /api/users/:id/identifiers`, `PATCH|DELETE /api/identifiers/:id` for end/correct): one holder at a time, one per person, old rows may repeat, `edited_by` enforcement (source read-only; hr-roles; self for own contact systems), display and tier filtering in the generic read, search by value / hint / fingerprint, Activity Log rows with hint only. Verify `test/person-identifiers.test.ts`.
- [ ] 1.5 User id immutability guard (refuse renaming a User row) and `replaced_by` semantics: cannot sign in, cannot be picked in a Reference, resolves to the survivor on identifier lookup, search shows "→ survivor". Verify `test/person-identifiers.test.ts`, `test/auth.test.ts`.

### 2. Sign-in write-through and the leaver rule

- [ ] 2.1 Write-through from `user_identity` to `person_identifier` for methods with an `identifier_system` (link, rename, move, unlink ⇒ open/close rows); Google identities write `email` rows; the sign-in path never reads the copy (pinned). Verify `test/identity-linking.test.ts`, `test/person-identifiers.test.ts`.
- [ ] 2.2 `left` ends the identity (`ended_at`, reason) and disables the person only when no other HR-system identity is live; a moved link keeps a closed copy with `ended_at`; the mailbox move closes and opens `email` rows. Verify `test/delegated-login.test.ts`, `test/identity-linking.test.ts`.
- [ ] 2.3 A person created by Google gets `usr_` + random, never the address (M1), unless the caller supplies an id. Verify `test/oauth.test.ts`, `test/signup.test.ts`.

### 3. Suggestions and the reviewed merge

- [ ] 3.1 Match detection on identifier write (exact normalised value / fingerprint, same system, different person, policy ≠ off): upsert Person Match with reasons and strength; pair unique; `not-the-same-person` sticks; `withdrawn` when a side is merged; nightly re-scan job. Verify `test/person-matches.test.ts`.
- [ ] 3.2 Merge preview (`POST /api/people/merge?preview=1`): default survivor, survivorship per field, the list of gained roles / scope / shares / sign-in methods, the privilege guard. Verify `test/person-merge.test.ts`.
- [ ] 3.3 Merge (single transaction): moves `has_role`, `data_scope`, `share`, `user_identity`, `person_identifier` (old-code rule), every `Reference → User` column from metadata (bound sources reported, not skipped); history columns untouched; loser disabled + `replaced_by`; sessions end; Person Merge row with the move log; Activity Log on both. Verify `test/person-merge.test.ts`.
- [ ] 3.4 Undo (`POST /api/people/merge/:id/undo`): reverse the move log, restore survivorship losers, re-enable, mark the match, list post-merge rows, chain order enforced. Verify `test/person-merge.test.ts`.

### 4. Web

- [ ] 4.1 Identifiers panel on the User form (grouped by system, display rule, period, source, add/end where allowed, "Merge into…", replaced banner). Verify `apps/web/test/identifiers-panel.test.tsx`.
- [ ] 4.2 Duplicates page (review list, side-by-side records with reasons, Merge / Not the same person / Later; merge preview with the access acknowledgement; History tab with Undo). Verify `apps/web/test/duplicates.test.tsx`.
- [ ] 4.3 Playwright `e2e/person-resolution.spec.ts`: sync-shaped set-up → suggestion → merge → sign in through the merged-away StyleHR code opens the survivor → undo.

### 5. Docs and close-out

- [ ] 5.1 `docs/DEPLOY.md`: Identifier System rows and defaults, `IDENTIFIER_FINGERPRINT_KEY` (generation, never rotate casually, re-fingerprint procedure), the reviewer role, the identifier and merge endpoints; `PROGRESS.md`.
- [ ] 5.2 Gates: server and web typecheck, full suites, web e2e, `pnpm check:specs`, `git diff --check`.
- [ ] 5.3 File the follow-ups: data-warehouse roster sync (D11), CDC registration (D10), `gold.hr.person` and `person_identifier` (D10), report scoping by period-valid codes (#4332 C1), the bronze Aadhaar exposure (D8 flag), the lawyer review of the fingerprint approach.

## Phase 2 — auto-link policy and the warehouse

- [ ] 6.1 Auto-link (D7): strong + one-per-person + not a sign-in subject + neither record privileged or scoped ⇒ automatic merge recorded as `auto-link:<system>`; otherwise a suggestion with the reason. Default off everywhere. Verify `test/person-merge.test.ts`.
- [ ] 6.2 Warehouse: CDC registration declares the four tables; `gold.hr.person` and `gold.hr.person_identifier`; `gold.hr.employee.person_id`; a test that every current code maps to one person (data-warehouse repo).
- [ ] 6.3 `sales-target.ts` scoping reads codes valid in the report period from `person_identifier` instead of the one Custom Field.

## Phase 3 — fuzzy suggestions and review ergonomics

- [ ] 7.1 Name + date-of-birth suggestions (weak only), with a backlog cap and a weekly digest to reviewers.
- [ ] 7.2 Bulk actions on the Duplicates page; survivorship choices per field in the preview.
