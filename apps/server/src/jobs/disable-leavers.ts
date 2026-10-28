import { registerJob } from '../jobs'
import { LEAVER_CHECK_JOB, formatLeaverPlan, formatSummaryDelivery, runLeaverCheck } from '../leaver-check'

// The daily warehouse exit-date check (leaver-check.ts). Its cadence and its
// on/off switch are the `disable_leavers` Scheduled Job row, seeded OFF by
// migration 0119: a System Manager turns it on after reviewing a dry run.
// A refused run (a stale or empty feed, an oversized batch) ends the run as
// refused: not retried, but treated like a failure on the Jobs page and
// alerted to the System Managers (#464). Its own summary still goes out too.
registerJob(LEAVER_CHECK_JOB, async (_payload, ctx) => {
  const run = await runLeaverCheck()
  const delivery = formatSummaryDelivery(run)
  console.log(formatLeaverPlan(run.plan, { applied: run.disabled }))
  console.log(delivery)
  if (run.plan?.refused) ctx.refuse(`disabled nobody: ${run.plan.refused}; ${delivery}`)
  else ctx.setResult(delivery)
})
