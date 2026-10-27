# Tasks

## 1. Warehouse exit-date check

- [x] 1.1 The leaver rule, the collision rule and the refusals, as a pure plan with unit tests.
- [x] 1.2 The job disables through a normal row save, logs each person with the reason, and mails one summary to System Managers.
- [x] 1.3 Migration 0119 seeds the `disable_leavers` Scheduled Job, daily and switched off.
- [x] 1.4 `cli leavers:check` dry run (counts only) and `--apply [--accept <n>]`.
- [x] 1.5 Dry run on dev against the warehouse.
- [ ] 1.6 Siraj turns the schedule on, dev first, after reviewing the dry run.
