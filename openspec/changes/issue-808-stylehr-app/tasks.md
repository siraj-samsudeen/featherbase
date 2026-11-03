## 1. First-time setup

Skipped: `acceptance-tests/` exists. Uses #782's outside-database harness and #783/#796's shelves-and-bins steps (merged into this branch).

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [x] 2.1 external-data-sources: "an app that connects its shelf table as …, titled by its … and listing only its …" and "…, titled by its …, listing only its …, and leaving out its …" (a manifest over the shelves database, the reader login granted)
- [x] 2.2 external-data-sources: "the app is installed", "the user installs the app", "the app is not installed", "the user is told the shelf table has no column …"
- [x] 2.3 external-data-sources: "the user sees each shelf's aisle", "the user does not see each shelf's label", "no table called … is in Featherbase"

## 3. Implementation

- [x] 3.1 Manifest: `reflect.tables` entries accept `{ table, name, leave_out_columns, title_column, list_columns }` beside plain names (`apps.ts` type and zod schema); install passes names and settings to reflect
- [x] 3.2 Reflect: per-table settings validated against the source before any Table is created; left-out columns skipped (never key, never modified column); title and list columns override the defaults, listed columns first in the given order
- [x] 3.3 Server tests (`apps/server/test/app-sources-settings.test.ts`): name, title, list, left-out, unknown-column refusal
- [x] 3.4 StyleHR app: `client-apps/jeyarama/stylehr/app.json` and README; `client-apps/jeyarama/CLAUDE.md` notes it; `connect-an-outside-database` guide updated
- [ ] 3.5 Live proof (owner check, local only): install StyleHR on a disposable database; 13 tables with their names, left-out columns absent, an Employee list loads live, read-only

## 4. Completion

- [ ] 4.1 Acceptance suite: every scenario passes, zero pending or undefined steps
- [ ] 4.2 Server tests pass; server typechecks; `pnpm check:specs` passes
