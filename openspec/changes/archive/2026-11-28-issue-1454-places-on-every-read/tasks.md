## 1. Platform

- [x] 1.1 Places on lists, counts and charts (scopedWhere) and on a Sub-table's rows through their parent
- [x] 1.2 Places on a single row and every write (assertUserPermissions); a row the person wrote is theirs
- [x] 1.3 Places on live updates; a deleted row of such a Table reaches no narrowed reader
- [x] 1.4 The places rule in shared (placeGroups, rowWithinPlaces)

## 2. Forecasting

- [x] 2.1 Plain Table reads; `my_places` for start-up
- [x] 2.2 Members read every copy and review Table, narrowed by the platform

## 3. Proof

- [x] 3.1 scoped-tables.test.ts and read-only-copy.test.ts; the wide platform suites
- [x] 3.2 Upgrade 0.13.1 → 0.14.0; a local instance viewed as each kind of person
