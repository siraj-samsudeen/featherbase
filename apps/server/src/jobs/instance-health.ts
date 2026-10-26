import { registerJob } from '../jobs'
import { HEALTH_CHECK_JOB, observeHealth } from '../instance-health'

// Instance health (#465 D8): the checks run every 15 minutes (the
// `check_instance_health` Scheduled Job, seeded on by migration 0123), so the
// history is right even when nobody opens the page. Only changes of state are
// written. A failing check is the check working, not a failed job.
registerJob(HEALTH_CHECK_JOB, async (_payload, ctx) => {
  const { checks, recorded } = await observeHealth()
  const failing = checks.filter((c) => !c.ok).length
  ctx.setResult(
    `${failing ? `${failing} of ${checks.length} checks fail` : `all ${checks.length} checks pass`}; ${recorded} ${recorded === 1 ? 'change' : 'changes'} recorded`,
  )
})
