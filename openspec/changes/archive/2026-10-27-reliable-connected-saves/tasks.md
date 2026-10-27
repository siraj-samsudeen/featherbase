## 1. A save hands back what it saved (#155)

- [x] 1.1 Run each MySQL insert, update and delete with its re-read on one connection in one transaction, locking only the row being written; refuse a new row without an id unless its key is auto-numbered, and roll back a write whose row can't be read back.
- [x] 1.2 Compare the last-changed time to the whole millisecond on both sides, as the Postgres driver does.
- [x] 1.3 Tests against a real MySQL for each, failing before the fix.

## 2. A refused save says why in plain words (#154)

- [x] 2.1 Name the shared shape of a refused write, and translate the MySQL errnos for a missing value, a broken link (on save and on delete), a broken rule, and a value too long or of the wrong kind into it.
- [x] 2.2 Turn every refusal on a connected table into a plain error on the field it concerns, with the source column translated to the field, and the raw text only in the server log.
- [x] 2.3 Tests against a real MySQL and Postgres source, failing before the fix.

## 3. Close out

- [x] 3.1 Verify the change against the code and tests, sync the delta into the specs and archive this change.
