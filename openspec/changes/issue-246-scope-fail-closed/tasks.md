## 1. Settings

- [x] 1.1 Migration `0153`: a Table's scope columns and its scope-required flag
- [x] 1.2 Table definitions accept, validate, keep and rename them

## 2. Enforcement

- [x] 2.1 One reading of a Table's scope, used by lists, counts, search, row reads and writes
- [x] 2.2 Realtime and source-bound Tables use the same reading

## 3. Tests

- [x] 3.1 Only the named reference columns narrow rows
- [x] 3.2 With no Data Scope a required Table lists nothing and refuses reads and writes; administrators still see every row
