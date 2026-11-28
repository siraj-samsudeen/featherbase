## 1. Build

- [x] 1.1 `readsAllRows` on a job: the app's own stored Tables and read-only copies only, checked when the app loads
- [x] 1.2 `ctx.documents.list` / `get` for a job: every row, read-only, filters `=` and `in`; an undeclared Table refused and recorded
- [x] 1.3 An upgrade cannot add to a kept job's `readsAllRows`; a new job's preview lists it
- [x] 1.4 Tests: private rows of two people read whole, another app's and a platform Table refused at load, an undeclared Table refused at run, the upgrade rule

## 2. Hand-off

- [ ] 2.1 Archive with #1418's change once #1424 is merged
