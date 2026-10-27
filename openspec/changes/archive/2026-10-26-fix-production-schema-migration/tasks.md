## 1. Legacy release boundary

- [x] 1.1 Add an exact-production-era regression fixture/proof from commit 3a6770ff651a308bfae0e31b5c525705c356a5a5 and verify current release fails on missing featherbase.table_def before changing runner behavior.
- [x] 1.2 Add the supported legacy ledger preflight and raw transaction path for pending 0088–0093 without changing historical migration files; verify old-shape release succeeds and missing-floor rejection performs no DDL.
- [x] 1.3 Add matching @spec markers at deciding code and checking tests, sync the delta, and verify strict OpenSpec validation plus pnpm check:specs.

## 2. Preservation and recovery proof

- [x] 2.1 Test asymmetric rows, object OIDs, ledger timestamps, public.site and grants across exact-old release upgrade; test prototype-owned storage and permission recovery where populated, asserting expected preserved values.
- [x] 2.2 Exercise rollback after writes in a legacy prerequisite and late in 0094, then retry; verify per-migration atomicity and no duplicated ledger or grants.
- [x] 2.3 Prove fresh install and completed-upgrade rerun using the production release command, and compare relevant resulting schema shape.

## 3. Acceptance

- [x] 3.1 Run targeted migration/release tests, server typecheck, SQL lint, check:specs and relevant broader server tests against disposable local PostgreSQL; report decisive results and limitations.
- [x] 3.2 Inspect the final diff, obtain scoped independent final Oracle review of the migration boundary, resolve findings, and execute applicable Prove Before Handoff checks.
- [x] 3.3 Commit and push the authorized review branch/PR, watch CI, and report root cause, evidence, verification, production maintenance/backup sequence, reset trade-offs and any blockers to the parent; do not merge or operate production.
