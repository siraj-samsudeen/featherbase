# Tasks: master data sync

- [x] 1.1 The three-way rule as a function, tested case by case (synthetic values).
- [x] 1.2 Migration `0016_master_sync.sql`: rule, snapshot, differences.
- [x] 1.3 `set_master_sync` / `master_sync` / `master_sync_run` actions, System Manager only; rule validated against the Tables.
- [x] 1.4 Apply source-owned changes with provenance; raise every other difference once through the ticket app's `create` action; retry a ticket that could not be raised.
- [x] 1.5 New rows raise a ticket; gone rows mark inactive or raise a ticket; nothing deleted.
- [x] 1.6 Copy again and the scheduled refresh run the rule after the copy.
- [x] 2.1 Acceptance steps for the change's scenarios.
- [ ] 3.1 Codex standard and adversarial review; fix blockers, file the rest.
- [ ] 3.2 Sync specs and archive the change as the branch's last commit.
