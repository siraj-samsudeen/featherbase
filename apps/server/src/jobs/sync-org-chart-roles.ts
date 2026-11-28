import { registerJob } from '../jobs'
import { ORG_CHART_ROLES_JOB, syncOrgChartRoles, syncSummary } from '../org-chart-roles'

// #1453: app roles from the org chart. Daily while its Scheduled Job is on (migration 0186), and on Run Now.
registerJob(ORG_CHART_ROLES_JOB, async (_payload, ctx) => {
  ctx.setResult(syncSummary(await syncOrgChartRoles()))
})
