# Tasks

## 1. Remove query reports

- [x] 1.1 Remove the query report runner, its routes, its author check, its page and its tests; reports run as built or script reports only.
- [x] 1.2 Add a migration that drops the query report choice and its query text, and refuses while a query report remains.

## 2. Remove the direct-client database sign-in

- [x] 2.1 Stop creating and granting to the sign-in in the row-level security migrations and when a Table is created; policies hold every role but the owner.
- [x] 2.2 Add an idempotent migration that retargets this database's policies, revokes the sign-in's grants and drops it once no other database on the server depends on it (until then it cannot sign in).
- [x] 2.3 Point the row-level security suite at a role it creates for its own run with a random password.

## 3. Verification

- [x] 3.1 Run the server and web suites, both typechecks and `pnpm check:specs`; upgrade a database built at the previous release and show the sign-in is gone.
