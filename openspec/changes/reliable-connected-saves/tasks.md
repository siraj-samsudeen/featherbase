## 1. A save hands back what it saved (#155)

- [x] 1.1 Run each MySQL insert, update and delete with its re-read on one connection in one transaction, and roll back a new row that can't be read back.
- [x] 1.2 Compare the last-changed time to the whole millisecond on both sides, as the Postgres driver does.
- [x] 1.3 Tests against a real MySQL for each, failing before the fix.

## 2. Close out

- [ ] 2.1 Verify the change against the code and tests, sync the delta into the specs and archive this change.
