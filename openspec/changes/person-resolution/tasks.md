# Tasks

Test-first throughout: each task writes its failing tests, then the code, then
runs the named files. Builds on `person-identities` (#371, merged with M1 and
the clean-start renames C1/C2/C4) which archives first; this change modifies a
requirement that one adds, so the validator's "archive would refuse" note
clears once it is archived. Phases follow D-d. Auto-link is not in this change
(D-b).

## Phase 1a — identifiers with history, manual merge, undo (days)

### 1. Foundations

- [ ] 1.1 `identifiers.ts`: kind presets, Sensitivity → storage/display/tier, normalisation rules (`trim`/`lower`/`upper`/`digits`/`indian-mobile`), Verhoeff check, fingerprint with `IDENTIFIER_FINGERPRINT_KEY` (key id, key-check value, startup check, per-identifier `fingerprint_unavailable`, never a plain hash), hint = last 4, request-log redaction for Secret systems, `isPrivileged(principal)` helper used everywhere. Verify `test/person-identifiers.test.ts`, `test/identifier-systems.test.ts`.
- [ ] 1.2 Migration `0101_person_resolution.ts` (stacked on `0100` and the `person` rename): Identifier System Table + the two generic rows; `Data Quality Manager` and `Identity Sync` roles; `service_account` with rows and roles moved out of `person`; `person_identifier`, `person_identifier_fingerprint`, `person_match`, `person_match_member`, `person_merge` with the exclusion and partial indexes; `person.replaced_by` + check, `person.built_in`; `sign_in_identity.ended_at`/`ended_reason` and partial unique indexes; `sign_in_method.identifier_system`; `people_review` setting. Verify `test/migration-0101.test.ts` (DDL, idempotent).
- [ ] 1.3 Dev data migration + `cli people:plan`: mint `psn_` ids and rewrite references; code rows from the `employee_code` Custom Field (never the old subject); StyleHR subjects → record numbers from the resolve file, unresolved sign-ins ended and listed; `email` rows; drop both Custom Fields; plan parity. Verify `test/migration-0101.test.ts`.
- [ ] 1.4 Seed pack `seeds/jeyarama/identifier-systems.json` + `cli seed-pack apply` (idempotent). Verify `test/identifier-systems.test.ts`.

### 2. Identifier System and Person Identifier

- [ ] 2.1 Identifier System controller: `match ≠ Off ⇒ one_holder off`; Secret consistency; no delete while in use; one-holder on refused while duplicates exist; flag changes re-stamp rows; `sign_in_method.identifier_system` validation. Verify `test/identifier-systems.test.ts`.
- [ ] 2.2 Person Identifier controller and routes (`GET|POST /api/people/:id/identifiers`, `PATCH|DELETE /api/identifiers/:id` for end/correct): half-open periods, exclusion by assigner, one per person, `verified`, `edited_by` enforcement (source read-only; reviewers; self), display/tier filtering, search by value / hint / fingerprint with audit and rate limit, no log on unchanged writes, errors without values. Verify `test/person-identifiers.test.ts`.
- [ ] 2.3 Person id immutability guard; `replaced_by` semantics (cannot sign in, cannot be picked, resolves to survivor, writes redirect with a resolve key or 409); `built_in` rules. Verify `test/person-identifiers.test.ts`, `test/auth.test.ts`.

### 3. Sign-in write-through, ended identities, leaver rule

- [ ] 3.1 Write-through `sign_in_identity` → `person_identifier` (link, move, unlink ⇒ open/close rows); Google identities write `email` rows; sign-in never reads the copy except dev test mode (code → identifier → person), pinned. Verify `test/identity-linking.test.ts`, `test/person-identifiers.test.ts`.
- [ ] 3.2 Ended identities: partial indexes; `linkedBySubject`, `linkedUser`, `resolveToken` add `ended_at is null`; unlink ends; move ends + inserts and closes/opens `email` rows; an ended identity never opens an account. Verify `test/identity-linking.test.ts`, `test/delegated-login.test.ts`, `test/token-hardening.test.ts`.
- [ ] 3.3 Leaver rule: `left` ends the identity; liveness from roster-fed current employment rows (other assigner); unknown ⇒ disable as #371. Verify `test/delegated-login.test.ts`.

### 4. Manual merge and undo

- [ ] 4.1 Merge preview (`POST /api/people/merge?preview=1`): configured survivor rule, survivorship, effective access per table (gains and losses, fail-closed scope default), refusals (different strong identifiers with Admin override note, privileged role or way-in, party to the merge, replaced or built-in). Verify `test/person-merge.test.ts`.
- [ ] 4.2 Merge: handler registry (metadata References, Dynamic References, raw tables, JSON paths, history "not rewritten"), **completeness test** over `pg_constraint` + metadata; deletions logged; loser emptied + `replaced_by`; chains repointed; email cleared; locks in order with re-check; Person Merge row; Activity Log on both. Verify `test/person-merge.test.ts`.
- [ ] 4.3 Undo (`POST /api/people/merge/:id/undo`): compare-and-set, recreate deletions, restore `enabled` and `email`, repoint back, leftovers listed, blocked by a later re-merge, allowed past an unrelated later merge, cluster left to the steward. Verify `test/person-merge.test.ts`.

### 5. Sync API, report scoping, web, docs

- [ ] 5.1 Sync API (D11): `identifiers:bulk` (upsert/refingerprint, `create_missing`, idempotent, redirect, per-row results), `sign-ins:bulk`, `resolve`; `Identity Sync` role limits; `sales-target.ts` scoping reads current codes from identifier rows. Verify `test/sync-api.test.ts`, `test/sales-target.test.ts`.
- [ ] 5.2 Web: Identifier System form (basic/Advanced, revert, disabled options); Identifiers panel on the Person form (display rule, banners, "Merge into…", merge preview with acknowledgement, History with Undo and leftovers). Verify `apps/web/test/identifiers-panel.test.tsx`, `apps/web/test/merge.test.tsx`.
- [ ] 5.3 `docs/DEPLOY.md` (Identifier System rows, seed pack, the key and its offline backup, the deploy order with post-deploy counts, the reviewer and sync roles, the endpoints); `CONTEXT.md` glossary (person, sign-in identity, identifier, identifier system, cluster, merge, replaced record); `PROGRESS.md`.
- [ ] 5.4 Gates: server and web typecheck, full suites, `pnpm check:specs`, `git diff --check`. File the follow-ups: data-warehouse roster sync against D11 (#4336), CDC registration (D10), the bronze Aadhaar exposure (D8), the lawyer review, the owner decision on direct StyleHR Aadhaar access.

## Phase 1b — suggestions as clusters, Aadhaar fingerprinting, review screen

- [ ] 6.1 Match detection on identifier write (exact normalised value / fingerprint, same system and assigner, different persons, verified rows, policy ≠ Off): clusters with members, strength (3+ = weak suspicious group), sticky `not-the-same-person` with reopen on a stronger reason, `later`, `withdrawn`, decisions carried to the survivor, re-run after merge/undo, daily cap with `deferred`. Verify `test/person-matches.test.ts`.
- [ ] 6.2 Reopen endpoint; scheduled re-scan (policy change + weekly), snooze expiry, erasure job; `/api/health` fingerprint indicator; gauges and counters (D13). Verify `test/person-matches.test.ts`, `test/jobs.test.ts`.
- [ ] 6.3 Duplicates screen: configured columns, side-by-side members, Merge / Not the same person / Later, header counts, Reopened filter. Verify `apps/web/test/duplicates.test.tsx`.
- [ ] 6.4 Playwright `e2e/person-resolution.spec.ts`: sync-shaped set-up → cluster → merge → sign in through the merged-away StyleHR login opens the survivor → undo → ended identity does not open the loser.

## Phase 2 — workforce, lanes and bulk, warehouse, period scoping, auto-link

- [ ] 7.1 Workforce population (~30k persons without sign-in) through the sync with `create_missing`; review lanes and bulk confirm for clean conversions.
- [ ] 7.2 Warehouse: CDC registration with the denies; `gold.hr.person` with `canonical_person_id`; `gold.hr.person_identifier`; period joins as-of the fact date (data-warehouse repo).
- [ ] 7.3 `sales-target.ts` scoping by codes valid in the report period (#4332 C1).
- [ ] 7.4 Auto-link per D7 (second signal, baseline-role gate, off by default, undoable), after the undo rate on clean conversions has stayed at zero.

## Phase 3 — fuzzy suggestions and review ergonomics

- [ ] 8.1 Name + date-of-birth suggestions (weak only), backlog cap, weekly digest.
- [ ] 8.2 Per-field survivorship choices in the preview.
