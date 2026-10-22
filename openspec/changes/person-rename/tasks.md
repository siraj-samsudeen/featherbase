# Tasks

Test-first throughout. Stacked on `person-identities` (#371, head 8f3d906).
Deploys to dev **together with `person-resolution` Phase 1a-i** in one
release (DECISION A-B2); the roster sync stays frozen until
data-warehouse#4336.

## 1. Principal model and rename

- [x] 1.1 `isPrivileged(principal)` replacing `isBypassUser` and inline checks; `getRoles` for `Person` and `Service Account` parent types; **`getScopeMap(principal)`** replacing `getUserPermissionMap` as the only `data_scope` reader (list, get, query/report, search, export, realtime, sales-target, bound sources). Verify `test/scope-map.test.ts`, `test/permissions.test.ts`.
- [x] 1.2 Migration 0101 part 1: `user` → `person` (indexes incl. username, trigger renamed `person_id_is_permanent`, `table_def`/`column_def`, every `Reference → User`); `user_identity` → `sign_in_identity`; `/api/people/…` routes replace `/api/users/…` (no alias); `newPersonId()` → `psn_`. Verify `test/person-rename.test.ts`, `test/identity-linking.test.ts`.
- [x] 1.3 Migration part 2: Service Account Table with a `before_save`/`before_delete` controller refusing generic writes; `person` + `service_account` Reference columns with the exactly-one check on `access_token`, `data_scope`, `share`; on `has_role` the pair as stored generated columns from `parent`/`parenttype`, outside `column_def`; all principal FKs `on delete restrict deferrable initially immediate`; a Person save with roles through the generic path succeeds; rows moved; `user_type`, `access_token.owner`, `data_scope."user"`, `share.user` dropped; Data Scope / Share forms with two pickers, Person picker filter (`replaced_by is null and not built_in`); service-account roles only via `service-accounts.ts`; `auth.ts`/`index.ts` token routes resolve whichever column is set; `who(c)` and Activity Log / Version / Comment / notification writers take a principal id. Verify `test/person-rename.test.ts`, `test/token-hardening.test.ts`.
- [x] 1.4 Inventory sweep with a test each: `rate-limit.ts` (`api_rate_limit` by principal), comment mentions by name, `assignment-rules.ts`, `sales-target.ts` (`person` relation; seed uses `username`), `workflow.ts`, `jobs/sla-escalation.ts`, `reports/user-report.ts`, `app-access.ts`, `admin-bootstrap.ts`, `password-reset.ts`, `cli.ts`; pickers exclude service accounts. Verify `test/person-rename.test.ts`, `test/access-tokens.test.ts` (a service-account token does everything it does today).

## 2. Re-id and scan

- [x] 2.1 Handler registry (shared with `person-resolution`): history handlers, raw tables (`access_token`, `api_rate_limit`, `user_settings`, `password_reset`, `saved_view`, `home_page`, `sign_in_identity`, `data_scope`, `share`, `has_role`, `assignment_rule_user`), JSON paths; **conditional-id handlers** (`data_scope.for_value` when `allow_table = 'Person'`, `share.share_name` when `share_table = 'Person'`); **column classification** `id` / `json-with-ids` / `conditional-id` / `code` / `free-text` for every text column; completeness test. Verify `test/person-registry.test.ts`.
- [x] 2.2 Migration part 3: `allow_person_id_change` set and `set constraints all deferred` for the transaction; mint `psn_`/`svc_` (built-ins excluded, `usr_` converted); rewrite through the registry (`has_role.parent` rewritten, generated columns follow) with the FKs live; exact-match scan over registered columns and JSON paths only; `person_id_map`; namespace checks enabled last. `cli people:plan` prints the map and every text column with its classification; `--rehearse <dsn>` runs 0101 + 0102 + scan in a rolled-back transaction. Verify `test/migration-0101.test.ts` (code and free-text columns containing old ids pass; planted id fails, incl. one in each conditional-id pair; idempotent; parity).

## 3. Web, CDC, deploy, docs

- [x] 3.1 Web: "Person" wherever a person is meant; Data Scope / Share forms with kind + picker; service-account list; sign-in-again notice. Verify `apps/web/test/person-rename.test.tsx`.
- [x] 3.2 `docs/DEPLOY.md`: joint release order (fresh snapshot → rehearsal → CDC rehearsal → maintenance window → deploy → CDC change → counts); the **manual leaver procedure** until #4336; no `/api/users` alias. CDC registration PR and the repoint re-check filed in data-warehouse#4336. `PROGRESS.md`.
- [x] 3.3 Gates: typecheck, full suites, `pnpm check:specs`, `git diff --check`.
