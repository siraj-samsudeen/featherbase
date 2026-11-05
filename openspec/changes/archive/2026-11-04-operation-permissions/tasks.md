# Permissions per operation — tasks

Ported from PR #683's operation/Column commits onto current main, without its scopes,
approvals or platform-admin changes (pieces B–D).

## 1. Acceptance first

- [x] 1.1 Write the scenario "A detail that may be read but not changed" and its steps; it fails while ungranted changes are dropped.

## 2. Representation and migration

- [x] 2.1 Migration `0145_operation_permissions`: one Permission row per operation with `scope_mode` and `column_rule`; Permission Column selections; restricted rows as `every` grants requiring their basic grant; restricted Person read as `read_identifiers`; installed apps' grant ids and recorded declarations repointed; dependency constraints; `fc_has_read` that reads only whole Tables.
- [x] 2.2 Prove the conversion on a database migrated to 0138 with creator, restricted and line-item grants, through HTTP (`migrate.test.ts`).

## 3. Enforcement

- [x] 3.1 Grants resolve per operation with prerequisites; Column reach from the rule; level grants reach line items of their level; creator-scoped Columns count per row.
- [x] 3.2 Every read path (lists, reports, search, sources, titles, history, imports) and write path (save, children, import, bulk) uses Column reach; ungranted changes are refused atomically.
- [x] 3.3 Token reach, the grant matrix endpoint and the Apps page grant summary read the new rows.

## 4. Apps

- [x] 4.1 Manifests declare `operations` with `*`, `@basic` or Column lists; released flag declarations read as `@basic` operations; restricted-level flag declarations refused.
- [x] 4.2 Tasker, Tickets and Feather Dash ship unchanged; a legacy fixture still installs and upgrades.

## 5. Verification and delivery

- [x] 5.1 Server and web typecheck, server suite, web suite, spec/sensitive/vocabulary/import guards.
- [x] 5.2 Standard and adversarial Codex reviews until no blocker; record dispositions in the PR.
- [x] 5.3 Sync this change into the main spec and archive it in the PR, before merge.
