## 1. Rename keeps a row's activity (#509)

- [x] 1.1 Pin the lost timeline with a failing test, then repoint every platform record that names the row by id inside the rename transaction; flip the `test.fails` pin.
- [x] 1.2 Hold the cascade's list equal to the person registry's row-id columns, so a new one cannot be missed.

## 2. Delete keeps a row's activity by refusing (#321)

- [x] 2.1 Failing tests, then refuse deleting a stored or connected row while it has comments, history, attachments or shares, naming each kind's count (owner decision on #566, 27-Oct-2026).

## 3. History index (#446)

- [x] 3.1 Migration 0126 adds the index on a row's history; check the timeline query plan uses it on a fresh and a migrated database.

## 4. Verification

- [x] 4.1 Full suites and checks on a fresh database; independent review; archive this change.
