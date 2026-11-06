## 1. Rename

- [x] 1.1 Rename the lifecycle in every read, write, DDL statement and name list
- [x] 1.2 Migration `0151`: every stored Table, checked one by one, refusing a clash

## 2. Tests

- [x] 2.1 A business `status` holding `cancelled` locks nothing, and a workflow leaves it alone
- [x] 2.2 SLA escalation reads fulfilled states from a Table's own `status`
- [x] 2.3 The migration renames rows' Tables and sub-tables, reruns cleanly and refuses clashes

## 3. Proof

- [x] 3.1 A fresh install runs every migration
- [x] 3.2 An upgrade from the release branch's commit, with rows in it, writes version, activity and access logs
- [x] 3.3 Old code against the renamed database, to say what a person sees during a deploy
