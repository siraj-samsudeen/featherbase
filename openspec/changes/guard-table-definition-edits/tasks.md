## 1. Definition validation

- [x] 1.1 Reproduce #510 over HTTP, refuse repeated values by name, and verify rollback and successful unique changes.
- [ ] 1.2 Reproduce #511 over HTTP, refuse missing link targets on create/update, allow self/existing targets.

## 2. Data-preserving edits

- [ ] 2.1 Obtain owner ruling for #250 and implement its approved regression.
- [ ] 2.2 Implement #251 explicit acknowledgement for omitted columns as approved.

## 3. Verification

- [ ] 3.1 Run fresh database suites, typechecks, repository checks and real HTTP/browser smoke; archive in this PR.
