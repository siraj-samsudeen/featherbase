// Run from apps/web; reuse its real SQL Sandbox bridge and React/query dedupe.
import web from '../apps/web/vitest.config'

export default {
  ...web,
  test: {
    ...web.test,
    include: ['test/task-management.test.tsx'],
    coverage: {
      enabled: true,
      provider: 'istanbul',
      allowExternal: true,
      include: ['**/example-apps/tasker/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.ts'],
      reportsDirectory: '../../coverage/tasker/components',
      reporter: ['text', 'json', 'json-summary'],
      reportOnFailure: true,
    },
  },
}
