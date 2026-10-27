## 1. Rename keeps a row's activity (#509)

- [x] 1.1 Pin the lost timeline with a failing test, then repoint every platform record that names the row by id inside the rename transaction; flip the `test.fails` pin.
- [x] 1.2 Hold the cascade's list equal to the person registry's row-id columns, so a new one cannot be missed.

## 2. Delete leaves nothing pointing at the row (#321)

- [ ] 2.1 Failing test for a plain row with comments, history, attachments and shares; fix per the owner's answer on #566.

## 3. History index (#446)

- [x] 3.1 Migration 0126 adds the index on a row's history; check the timeline query plan uses it on a fresh and a migrated database.

## 4. Verification

- [ ] 4.1 Full suites and checks on a fresh database; independent review; archive this change.
