## 1. Tests

- [x] 1.1 Server tests for an expired lease, a fresh lease, the last attempt, a scheduled job, a row from before leases, and the heartbeat, red first

## 2. Server

- [x] 2.1 Migration 0153: `background_job.lease_expires_at`
- [x] 2.2 The claim takes a lease, the worker renews it while the handler runs, and every worker recovers expired leases before claiming
