## 1. First-time setup

Skipped: `acceptance-tests/` already exists. The promises here are about concurrency, so their tests are server tests against real Postgres; their scenarios are not fenced Gherkin, as elsewhere in `running-an-instance`.

## 2. Deploy retries

- [x] 2.1 Test: a shared holder, a waiting exclusive and a new shared request: does the new request stall?
- [x] 2.2 Test and build: short attempts with pauses, each logged, the same safe failure at the end
- [x] 2.3 `docs/DEPLOY.md`

## 3. Copy reads outside the lifecycle lock

- [x] 3.1 Test and build: a deploy completes during a manual copy's read; the same for the first copy and a scheduled refresh
- [x] 3.2 Test and build: an app upgraded during the read is refused and nothing changes
- [x] 3.3 Test: overlap: a long copy applying, a deploy starting, the deploy succeeding after it ends

## 4. Apply

- [x] 4.1 Time read, apply and master sync on 1,519 rows
- [x] 4.2 Test and build: a no-change refresh writes no row and keeps history, corrections and conflicts

## 5. Check and archive

- [ ] 5.1 Server suite and checks pass; Codex review
- [ ] 5.2 Sync the specs and archive
