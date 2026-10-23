# Tasks

Test-first throughout: each task writes its failing tests, then the code, then
runs the named files. Stack: `person-identities` (#371, 0100) → `person-rename`
(0101) → this change (0102). **Phase 1a-i deploys to dev together with 0101 in
one release** (DECISION). The earlier changes archive first; this one modifies
requirements they add, so the validator's "archive would refuse" note clears
once they are archived. Auto-link is not in this change (D-b).

## Phase 1a-i — identifiers with history, test-mode hardening (about a week)

- [x] 1.1 `identifiers.ts` (no fingerprinting yet): kind presets, Sensitivity → storage/display/tier incl. Restricted-hidden, normalisation rules, 12-digit + Verhoeff check for `national-id`. Verify `test/identifier-systems.test.ts`, `test/person-identifiers.test.ts`.
- [x] 1.2 Migration `0102_person_resolution.ts` (DDL): `btree_gist`; Identifier System Table + generic rows (`phone`, `email`); roles `Data Quality Manager`, `Identity Sync`; `person_identifier` (+ `record_identifier_id`, `worker_type`, exclusion and partial indexes), `person_identifier_fingerprint`, `person_match`, `person_match_member`, `person_merge`; `person.replaced_by` + check; `sign_in_identity.ended_at`, `ended_reason`, `subject_kind`, partial unique indexes; `sign_in_method.identifier_system`; core `people_review` default. Verify `test/migration-0102.test.ts` (idempotent).
- [x] 1.3 Seed pack `seeds/jeyarama/identifier-systems.json` (`stylehr-employee-id`, `stylehr-employee-code`, Jeyarama `people_review`) + `cli seed-pack apply`. Verify `test/identifier-systems.test.ts`.
- [x] 1.4 Identifier System controller: `match ≠ Off ⇒ one_holder off`; Secret consistency; delete/flag refusals; flag changes re-stamp rows; `identifier_system` on Sign In Method. Verify `test/identifier-systems.test.ts`.
- [x] 1.5 Person Identifier controller + routes (`GET|POST /api/people/:id/identifiers`, `PATCH|DELETE /api/identifiers/:id`): half-open periods, exclusion by assigner, one per person, `verified`, `record_identifier_id`, `edited_by`, display/tier (hidden), search by value, unchanged writes silent, errors without values; `replaced_by`/`built_in` semantics incl. pickers. Verify `test/person-identifiers.test.ts`, `test/auth.test.ts`.
- [x] 1.6 Dev data migration: code rows from the `employee_code` Custom Field (`assigner ''`, only where the StyleHR method exists), `email` rows, every live StyleHR sign-in kept by code (`subject_kind = employee-code`), parity through `testModeUser`; runs inside `people:plan --rehearse` with 0101. **No resolve file in the release** (review decision, 23-Oct): post-deploy `cli people:resolve <csv> [--dry-run]` moves subjects to record numbers, idempotent, with a report. Release preflight + 0101/0101a/0102 in one transaction. Verify `test/migration-0102.test.ts`, `test/people-resolve.test.ts`, `test/release-preflight.test.ts`.
- [x] 1.7 Write-through `sign_in_identity` → identifiers; ended identities (partial indexes, lookups filter, unlink ends, move ends + inserts and closes/opens `email` rows); **test mode**: code resolved through identifier rows, ambiguous refused, live not-ended identity required, boot refused unless `config.environment` is `development`, `test` or `staging` (a hosted trial instance; amended 23-Oct). Verify `test/identity-linking.test.ts`, `test/delegated-login.test.ts`, `test/token-hardening.test.ts`.
- [x] 1.8 Web: Identifier System form (basic/Advanced, revert, disabled options); Identifiers panel on the Person form (display rule, unresolved-sign-in note, banners). Verify `apps/web/test/identifiers-panel.test.tsx`.
- [x] 1.9 `docs/DEPLOY.md` for the joint release (with `person-rename` 3.2): staging re-stamp, snapshot + rollback, boot-check, CDC pause/resume, btree_gist, seed pack, `people:resolve` after the deploy, expected counts, leaver/joiner/correction procedures; `CONTEXT.md` glossary; `PROGRESS.md`; gates.
- [x] 1.10 The freeze (review B-M6): a System Manager records or ends a `source` employee code by hand with a required note (`verified = false`) until the feed first writes; test mode accepts it. Verify `test/person-identifiers.test.ts`, `apps/web/test/identifiers-panel.test.tsx`.
- [x] 1.11 The `employee_code` mirror until 2.1 (final review round): every write of a current `stylehr-employee-code` row copies the current code into the Custom Field in the same transaction; ending the last one clears it; the Person picker searches current employee-record rows. Verify `test/employee-code-mirror.test.ts` (superseded by 2.1: renamed `test/employee-code-scope.test.ts`).

## Sales-target scoping — separate PR after 1a-i

- [x] 2.1 (also delete the temporary `mirrorEmployeeCodeField` mirror and its call sites) `sales-target.ts` scoping on current identifier rows — (assigner, code) or record number, several codes, ambiguous ⇒ `no_assignment` + structured log — **and** drop the `employee_code`/`stylehr_username` Custom Fields in the same PR (migration `0106`, #408). Verify `test/sales-target.test.ts`, `test/employee-code-scope.test.ts`, `test/migration-0106.test.ts`.

## Phase 1a-ii — manual merge and undo

- [ ] 3.1 Merge preview: configured survivor rule; survivorship; effective access per table (gains and losses, fail-closed default); refusals (different strong identifiers with erased = unknown and Admin override note; privileged role or way in incl. tokens; party to the merge; replaced or built-in); picker excludes replaced/built-in. Verify `test/person-merge.test.ts`.
- [ ] 3.2 Merge: registry (merge mode) incl. conditional-id handlers (`data_scope.for_value` / `share.share_name` when their type column is `Person`), `access_token` by its `person` column under the privileged-way-in rule, invite-vs-identity rule, completeness test, deletions logged, loser emptied + `replaced_by`, chains repointed, email cleared, locks in order with re-check and 409 on a concurrent merge, `person_merge` row, result summary. Verify `test/person-merge.test.ts`.
- [ ] 3.3 Undo: dry-run preview, compare-and-set, recreate deletions, restore `enabled`/`email`, repoint back, leftovers with Mark handled (note), blocked/allowed rules, cannot be redone (confirm text), group left to the steward. Verify `test/person-merge.test.ts`.
- [ ] 3.4 Web: "Merge into…", preview with acknowledgement, result summary with survivor link and Undo shortcut, global merge History with Undo and leftovers, Undo on the replaced banner. Verify `apps/web/test/merge.test.tsx`.

## Phase 1b — Secret storage, Sync API v1, leaver rule, groups, review screen, health

- [ ] 4.1 Fingerprinting: `IDENTIFIER_FINGERPRINT_KEY`, key id + key-check, startup check, per-identifier `fingerprint_unavailable`, request-log redaction, fingerprint table only + **mirror test**, search by fingerprint (audited, rate-limited), erasure job, `refingerprint`; `aadhaar` seed row added to the pack. Verify `test/person-identifiers.test.ts`, `test/identifier-systems.test.ts`.
- [ ] 4.2 Sync API v1 (D11): `identifiers:bulk` (500-row cap, per-row transactions, exclusive `valid_to`, every result/error code, `person_fields` on creation only, rehire vs correction, unchanged, adopt `''`, per-call `create_missing` with duplicate warning, leaver via closing the last live record), `sign-ins:bulk` (never creates; subject resolution; ended-identity relink and `conflict`), `resolve`; `Identity Sync` limits; role/scope through the principal endpoints. Verify `test/sync-api.test.ts`.
- [ ] 4.2b Role and scope endpoints: `POST /api/people/:id/roles` and `/scope` plus `POST /api/service-accounts/:id/roles|scope` — thin wrappers over the existing role and Data Scope saves, idempotent, `Identity Sync` limits, privileged-role refusal (`not_allowed`), System Manager only for service accounts. Verify `test/principal-endpoints.test.ts`.
- [ ] 4.3 Record-based leaver rule replacing #371's (live = current verified row for a different record; unknown ⇒ disable; same-firm case); `--disable-leavers` parity documented for #4336. Verify `test/delegated-login.test.ts`.
- [ ] 4.4 Groups: anchor-keyed clusters on verified values; strength (national-id only: 2 members, or non-overlapping 3+ with employment rows for every member; unknown ⇒ weak); sticky with reopen on stronger reason or new member; reopen endpoint; `later`; 3+ stays open until one member remains, then `withdrawn`; carry to survivor; re-run after merge/undo; daily cap, strong promoted first. Verify `test/person-matches.test.ts`.
- [ ] 4.5 `/api/health` (key status, group counts, chain length, job status), structured log events, Activity Log counters; scheduled re-scan (policy change + weekly), snooze expiry, erasure; **exit criterion:** the daily-loading check for "fingerprint key degraded" is live in data-warehouse (#4336). Verify `test/health.test.ts`, `test/jobs.test.ts`.
- [ ] 4.6 Duplicates screen (configured columns, side by side, Merge / Not the same person / Later, header counts, Reopened filter). Verify `apps/web/test/duplicates.test.tsx`.
- [ ] 4.7 Playwright `e2e/person-resolution.spec.ts`: set-up → group → merge → merged-away StyleHR login opens the survivor → undo → ended identity refused.
- [ ] 4.8 DEPLOY.md (key + offline backup, erasure trade-off, sync contract pointer, fed-list cadence), follow-ups filed: data-warehouse#4336 (sync + resolve file + CDC registration + daily-loading checks), the bronze Aadhaar exposure, the lawyer review, the owner decision on direct StyleHR Aadhaar access.

## Phase 2 — workforce, lanes and bulk, warehouse, period scoping, auto-link

- [ ] 5.1 Workforce population (~30k persons) via the sync; review lanes and bulk confirm.
- [ ] 5.2 Warehouse: `gold.hr.person` with `canonical_person_id`, `gold.hr.person_identifier`, period joins (data-warehouse).
- [ ] 5.3 Sales-target scoping by codes valid in the report period (#4332 C1).
- [ ] 5.4 Auto-link per D7, after the undo rate on clean conversions has stayed at zero.

## Phase 3

- [ ] 6.1 Fuzzy name + date-of-birth suggestions (weak only), backlog cap, weekly digest.
- [ ] 6.2 Per-field survivorship choices in the preview.
