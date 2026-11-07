## 1. Tests

- [x] 1.1 Server tests for every road a view can be read, written or linked by, red first (`apps/server/test/table-views.test.ts`)

## 2. Server

- [x] 2.1 One resolver turns a view into base plus filter before every read, permission and link check
- [x] 2.2 The row-write gate refuses writes to a view; grants and Data Scopes on a view are refused
- [x] 2.3 Links to a view are checked against the view and counted as links to the base everywhere links are followed
- [x] 2.4 Metadata-only branches for creating, renaming, retyping and deleting; filter columns and bases with views are protected

## 3. UI

- [x] 3.1 A view's list page with its banner; "New view…" on a filtered list for a System Manager
- [x] 3.2 Link column editors offer a base's views; a linking row shows a value outside the view
- [x] 3.3 Browser check by an independent verifier against the real UI
