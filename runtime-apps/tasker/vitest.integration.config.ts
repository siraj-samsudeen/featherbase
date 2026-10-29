// Run from apps/server: reuse its real SQL Sandbox and its owning HTTP tests.
import server from '../../apps/server/vitest.config'

export default {
  ...server,
  test: {
    ...server.test,
    include: ['test/task-management-app.test.ts', 'test/tasker-actions.test.ts'],
    setupFiles: ['../../runtime-apps/tasker/scripts/collect-integration-coverage.ts'],
    coverage: { enabled: false },
  },
}
