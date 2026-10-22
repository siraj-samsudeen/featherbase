# Tasks

Test-first throughout. Stacked on `person-identities` (#371); `person-resolution`
stacks on this. Prod is empty; dev is migrated once as data.

## 1. Principal model and rename

- [ ] 1.1 `isPrivileged(principal)` helper replacing `isBypassUser` and the inline Administrator/System Manager checks; `getRoles` reads `has_role` for `Person` and `Service Account` parent types. Verify `test/person-rename.test.ts`, `test/permissions.test.ts`.
- [ ] 1.2 Migration `0101_person_rename.ts` part 1: `user` → `person` (table, indexes, trigger, `table_def`/`column_def`, every `Reference → User`, `data_scope`, `share`, `has_role.parenttype`); `user_identity` → `sign_in_identity` (`person_id`); `/api/people/…` routes replace `/api/users/…`. Verify `test/person-rename.test.ts`, `test/identity-linking.test.ts`.
- [ ] 1.3 Migration part 2: `service_account` table; `principal_kind`/`principal_id` with check + existence trigger on `access_token`, `data_scope`, `share`; rows moved, `user_type` and `access_token.owner` dropped; `auth.ts`/`index.ts` token routes resolve either kind; `service-accounts.ts` reworked; pickers exclude service accounts; `who(c)` and the Activity Log / Version / Comment / notification writers take a principal id. Verify `test/person-rename.test.ts`, `test/token-hardening.test.ts`, `test/access-tokens.test.ts` (a service-account token does everything it does today).

## 2. Re-id

- [ ] 2.1 Handler registry (shared with `person-resolution`) with history handlers (`created_by`, `owner`, `modified_by`, Activity Log, Version, Comment, notifications), raw tables (`access_token`, `user_settings`, `password_reset`, `saved_view`, `home_page`, `sign_in_identity`, `data_scope`, `share`, `has_role`) and JSON ids; completeness test over `pg_constraint` + metadata. Verify `test/person-registry.test.ts`.
- [ ] 2.2 Migration part 3: mint `psn_` ids, re-id through the registry in one transaction, post-check scan (one hit aborts), `person_id_map` written; `cli people:plan` prints the map and the columns the scan visits. Verify `test/migration-0101.test.ts` (planted old id caught; idempotent re-run; plan parity).

## 3. Web, CDC, docs

- [ ] 3.1 Web: "Person" wherever a person is meant; service-account list; sign-in-again notice. Verify `apps/web/test/person-rename.test.tsx`.
- [ ] 3.2 `docs/DEPLOY.md`: the order (0100 live → plan → snapshot → deploy, everyone signs in again → CDC change → warehouse models repointed → post-deploy counts); CDC registration PR and the repoint list filed in data-warehouse#4336. `PROGRESS.md`.
- [ ] 3.3 Gates: typecheck, full suites, `pnpm check:specs`, `git diff --check`.
