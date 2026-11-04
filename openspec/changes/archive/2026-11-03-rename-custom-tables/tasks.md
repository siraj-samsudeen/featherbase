## 1. Acceptance examples first

- [x] 1.1 Server and web tests for the rename and the old address; demonstrated red before source changes.

## 2. Server

- [x] 2.1 `renameCustomTable` and `POST /api/table_def/:name/rename`, System Managers only, custom Tables only.
- [x] 2.2 The sweep also moves import memory and recently opened entries.
- [x] 2.3 The old name and its slug answer "renamed to … by … on …".

## 3. Web

- [x] 3.1 Rename Table on a custom Table's list, with a dialog that shows refusals.
- [x] 3.2 The old address says where the Table went and links to it.

## 4. Verification

- [x] 4.1 Server and web suites; acceptance steps; strict OpenSpec validation; headless desktop check.
- [x] 4.2 Sync and archive the change once verified.
