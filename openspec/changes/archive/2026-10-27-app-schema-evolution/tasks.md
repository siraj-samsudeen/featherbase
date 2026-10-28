# Tasks

## 1. Every operation, replayed both ways

- [x] 1.1 A version's history may add and remove tables and add, change, rename and remove columns, and rename tables; each operation replays forward and backward, pinned by server tests.
- [x] 1.2 An operation outside the app's own tables, an unsafe type change, and a data-removing operation not marked as such keep the version from loading, pinned by server tests.

## 2. One engine

- [x] 2.1 The upgrade runs every operation through the table engine an administrator's edits use; renaming an app's table and a safe change of a column's kind are new engine operations, pinned by server tests.

## 3. Upgrades

- [x] 3.1 Renames keep rows, history, links and grants; a renamed table keeps its scope mark and its security guard, pinned by server tests.
- [x] 3.2 A table the upgrade adds arrives with the grants its version declares; access to the tables the app had never widens, pinned by server tests.
- [x] 3.3 A failing step leaves the app on its old version with nothing changed, pinned by server tests.
- [x] 3.4 Installing 0.3.0 of the fixture app directly and upgrading 0.1.0 to 0.2.0 to 0.3.0 give an identical schema, pinned by a server test.

## 4. Losses counted first

- [x] 4.1 The preview, the release check and the rehearsal say how many rows or values each data-removing step would remove on this instance, never the values, pinned by server tests.
