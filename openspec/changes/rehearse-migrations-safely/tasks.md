# Tasks

## 1. The rehearsal applies changes as the release does (#557)

- [x] 1.1 The migrator and the rehearsal share one way to plan and apply a batch, including the legacy pre-0094 path and the refusal of a legacy database short of 0087.
- [x] 1.2 Tests: a legacy copy rehearses a pre-0094 change and keeps nothing; a legacy copy short of 0087 is refused.

## 2. The rehearsal cannot hold up a live instance (#558)

- [ ] 2.1 Refuse a database other sessions are connected to, unless `--allow-live` is passed.
- [ ] 2.2 A 2-second lock timeout and a 5-minute statement timeout inside the rehearsal.
- [ ] 2.3 Tests for the refusal, the override and the lock timeout.
