# Tasks

## 1. Server

- [x] 1.1 Add failing tests: Administrator, System Manager and a System Manager access token are refused on insert, update, delete (one and bulk), rename, import (dry run included), import revert, and every column change on Activity Log; every marked table refuses create, update and delete before any existence check.
- [x] 1.2 Migration 0108: add the marker to Table metadata (selectable, read-only, never settable through the table definition API) and set it on the twelve platform-written tables.
- [x] 1.3 Refuse a marked table at the head of every public write path (save, delete, rename, submit, cancel, amend, settings save, workflow step, every write-effect row and collection action, schema update, naming, column rename, table delete, custom field), ahead of the privileged bypass.
- [x] 1.4 Move the import logger to an internal trusted save that no route reaches; keep sign-in logging, the job runner, email queue and version history on their direct writers.
- [x] 1.5 A grant on a marked table never lists it as creatable.
- [x] 1.6 Completeness tests enumerate the write-effect actions, the document engine's exported writers and every state-changing HTTP route, so a new entry point fails until it is classified.

## 2. Web

- [x] 2.1 Add a failing component test: the Activity Log list shows no New, Import, Columns, Merge, Naming, Delete Table or row selection to the Administrator; its form opens read-only without Save, Delete or Rename; an ordinary platform list keeps New.
- [x] 2.2 Drive every row-write control from the table's metadata (read-only source or platform-written), including the connections panel and the command bar's "new row" suggestions.

## 3. Verify

- [x] 3.1 Run the new server and web tests, the full server suite, server and web typecheck, `pnpm check:specs` and `pnpm check:sensitive`.
