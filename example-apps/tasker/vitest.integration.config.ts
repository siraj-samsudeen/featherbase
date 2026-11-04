// Run from apps/server: reuse its real SQL Sandbox and its owning HTTP tests.
import { rmSync } from 'node:fs'
import server from '../../apps/server/vitest.config'

// Config loads once in the coordinator, never in per-file setup workers.
rmSync(new URL('../../coverage/tasker/integration/', import.meta.url), { recursive: true, force: true })

export default {
  ...server,
  test: {
    ...server.test,
    include: ['test/task-management-app.test.ts', 'test/tasker-*.test.ts'],
    // This opt-in committed proof has its own database/process contract and
    // skips without TASKER_UPGRADE_ACTION_PROOF; it cannot supply counters here.
    exclude: ['test/tasker-upgrade-action-commit.test.ts'],
    setupFiles: ['../../example-apps/tasker/scripts/collect-integration-coverage.ts'],
    coverage: { enabled: false },
  },
}
