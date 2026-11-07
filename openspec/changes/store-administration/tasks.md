## 1. Owner decisions

- [ ] 1.1 Director and COO reach: every store (built), or the stores of the legal companies they hold a stint with (design.md, open question 1).
- [ ] 1.2 Rolling Dash 0.12.0 out to staging: reinstall fresh, or let an upgrade add grants for roles the new version introduces (design.md, open question 2).

## 2. Platform

- [x] 2.1 Permission `scope_mode` `reach`, the `Role Assignment` Table (migration 0153).
- [x] 2.2 The manifest's `administration` declaration, validated on load; the app's reach provider called the way a scope provider is.
- [x] 2.3 Reach grants enforced on list, count, search, open, create, update (before and after), delete and retirement; protected rows; Column reach only on rows in reach; every other path refuses.
- [x] 2.4 Giving, listing and taking back roles (`/api/apps/:app/given_roles`).
- [x] 2.5 Tests over a fixture app (`test/store-administration.test.ts`, `test-apps/fixtures/store-admin`).

## 3. Dash

- [x] 3.1 The store reach provider (`src/reach.ts`) and its unit tests.
- [x] 3.2 Roles Dash Store Administrator, Dash Store Editor and Dash HR, with their grants; version 0.12.0.
- [x] 3.3 Instance setup marks Plant and Site Master as deciding scope (`instances/dash/instance-setup/mark-reach-tables.mjs`).
- [x] 3.4 Platform tests (`platform-test/reach.test.ts`).
