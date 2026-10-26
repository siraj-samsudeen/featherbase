import { registerJob } from '../jobs'
import { LEAVER_CHECK_JOB, formatLeaverPlan, formatSummaryDelivery, runLeaverCheck } from '../leaver-check'

// The daily warehouse exit-date check (leaver-check.ts). Its cadence and its
// on/off switch are the `disable_leavers` Scheduled Job row, seeded OFF by
// migration 0119: a System Manager turns it on after reviewing a dry run.
// A refused run is not a failed job — refusing is the check working — so it
// is logged and mailed, not retried.
registerJob(LEAVER_CHECK_JOB, async (_payload, ctx) => {
  const run = await runLeaverCheck()
  const delivery = formatSummaryDelivery(run)
  console.log(formatLeaverPlan(run.plan, { applied: run.disabled }))
  console.log(delivery)
  ctx.setResult(delivery)
})
