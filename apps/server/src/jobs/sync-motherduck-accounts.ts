import { registerJob } from '../jobs'
import { MOTHERDUCK_ACCOUNT_JOB, MotherDuckSyncStop, formatMotherDuckSync, syncMotherDuckAccounts } from '../motherduck-accounts'

// #1346: bring MotherDuck Accounts in step with MotherDuck's list of users. Its
// cadence and on/off switch are the `sync_motherduck_accounts` Scheduled Job row
// (migration 0174). A run that cannot read MotherDuck is refused, alerted, and
// says what to fix; the schedule carries on.
registerJob(MOTHERDUCK_ACCOUNT_JOB, async (_payload, ctx) => {
  try {
    const result = await syncMotherDuckAccounts()
    const summary = formatMotherDuckSync(result)
    console.log(summary)
    if (result.ticket_errors.length) ctx.refuse(`${summary}. ${result.ticket_errors.slice(0, 3).join('; ')}`.slice(0, 500))
    else ctx.setResult(summary.slice(0, 500))
  } catch (error) {
    if (error instanceof MotherDuckSyncStop) return ctx.refuse(error.message)
    throw error
  }
})
