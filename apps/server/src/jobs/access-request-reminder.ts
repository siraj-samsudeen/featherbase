import { registerJob } from '../jobs'
import { remindAccessRequests } from '../waiting-for-access'

// #955: the access-request SLA. Hourly (the `remind_access_requests`
// Scheduled Job row, migration 0144), it reminds System Managers once about
// each request still waiting a day after it was made.
registerJob('remind_access_requests', async (_payload, ctx) => {
  const named = await remindAccessRequests()
  ctx.setResult(named === 'no recipients' ? 'no System Manager has an email address' : `reminded about ${named} request(s)`)
})
