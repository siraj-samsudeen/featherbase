# Tasks

## 1. Priority evolution
- [ ] 1.1 Add nullable priority with UI/API support and a versioned migration; verify an upgraded populated list retains identities and can store both unset and explicit priorities.
- [ ] 1.2 Add backfill and NOT NULL migration; verify only nulls become normal, explicit priorities survive, and invalid/null requests fail without writes.
- [ ] 1.3 Document separate migration/start commands and recovery; verify fresh install, populated upgrades, reruns, failed/retried and concurrent migrations.

## 2. API guarantees
- [ ] 2.1 Derive browser types and served OpenAPI from authoritative contracts; verify an independent HTTP client can use all operations and an incompatible contract change fails client compilation.
- [ ] 2.2 Enforce request and response validation on actual handler paths; verify missing fields, wrong types and restricted values cannot escape as successful output, including raw/error paths.
- [ ] 2.3 Document business rules separately from structural schemas and verify all prior CRUD/persistence behavior remains correct.
