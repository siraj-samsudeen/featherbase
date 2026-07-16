import { registerJob } from '../jobs'
import { runDueAutoEmailReports } from '../auto-email-report'

// EML-007: the daily scheduler pass. Delivers every enabled Auto Email Report
// whose cadence has elapsed. The job re-enqueues itself (repeatEvery), so it
// keeps ticking; delivery itself queues one email per recipient with the
// rendered report attached.
registerJob('auto_email_reports', async () => {
  await runDueAutoEmailReports()
})
