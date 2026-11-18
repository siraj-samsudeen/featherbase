import { registerJob } from '../jobs'
import { LEAVER_SIGN_IN_JOB, rebuildSummary, refreshLeaverSignIn } from '../leaver-sign-in'

// #1271: rebuild Leavers Who Can Still Sign In. Daily (the Scheduled Job row,
// migration 0170), after each leaver check and roster sync, and on Refresh Now.
// It changes nobody.
registerJob(LEAVER_SIGN_IN_JOB, async (_payload, ctx) => {
  const report = await refreshLeaverSignIn()
  ctx.setResult(report.published ? rebuildSummary(report) : 'A newer rebuild was already on show; this one changed nothing')
})
