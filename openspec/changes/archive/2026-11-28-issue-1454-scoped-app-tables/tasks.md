## 1. Platform

- [x] 1.1 `scopedTables` in the manifest, checked at load: the app's own Table, plain key and mapped columns
- [x] 1.2 `context.scopedTables.list` in reads: within the reader's places by the dataset rule, filtered on keys, fields, a named Sub-table's rows
- [x] 1.3 None in an outbound read; none in a read that is not person_scope
- [x] 1.4 A validator reads its app's read-only copies as the app

## 2. Forecasting 0.14.0

- [x] 2.1 person_scope reads `copy` and `review`, Team Leaders and above
- [x] 2.2 The copies' whole-Table grant and All's grants withdrawn; members read their own review rows
- [x] 2.3 The client reads through the scoped reads

## 3. Proof

- [x] 3.1 Platform tests (scoped-tables.test.ts, read-only-copy.test.ts)
- [x] 3.2 Role tests on Dash's own provider (forecasting scoped.test.ts)
- [x] 3.3 A local instance viewed as each kind of person
