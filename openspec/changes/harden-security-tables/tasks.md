# Tasks

- [x] 1.1 Failing tests, then the guard: non-managers refused on every access-control and Sales Target scope Table through save, import, delete, rename and server-side calls; System Managers still write them (`apps/server/test/security-tables.test.ts`).
- [x] 1.2 Failing tests, then the Person rule: roles and enabled refused for an ordinary Person writer over PATCH, save_row, POST, import upsert and a write-share; unchanged values ride along (same file).
- [x] 1.3 Failing tests, then the three preflight refusals and their passing counterparts (`apps/server/test/release-preflight.test.ts`).
- [x] 1.4 Tasker 2.3.0 drops the everyone-reads-Person grant; the upgrade planner withdraws it (`apps/server/test/runtime-packages.test.ts`).
