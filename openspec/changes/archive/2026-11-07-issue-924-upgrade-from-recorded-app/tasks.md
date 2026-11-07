## 1. Tests

- [x] 1.1 Deploy tests: upgrade from the record with only the new version shipped; rollback refused; app removed still refused with the disable hint; no migration from the installed version; an unreadable record names its step, and the old files then stand in

## 2. Platform

- [x] 2.1 The upgrade plan reads the installed version from the instance's record, falling back to its files only when the record can't be read
- [x] 2.2 The release preflight passes a shipped newer version on an instance deploy and names each refusal

## 3. Instances and docs

- [x] 3.1 Drop the dash instance's previousVersions; docs/DEPLOY.md and the instance build say when an old version is still needed
