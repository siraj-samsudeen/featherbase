import { enqueue, registerJob } from '../jobs'
import { LEAVER_SIGN_IN_JOB } from '../leaver-sign-in'
import { ROSTER_LINK_JOB, formatRosterLink, runAllRosterLinks } from '../roster-link'

// #1157: link every current roster row before anyone signs in, and end a
// leaver's link (roster-link.ts). Its cadence and on/off switch are the
// `link_roster` Scheduled Job row, seeded OFF by migration 0157; an instance
// with a roster switches it on in its settings. A run that would end too many
// links ends none: refused, alerted, and the schedule carries on. #1286: it
// first moves roster rows between current and left by the HR record, under
// the same kind of limit.
registerJob(ROSTER_LINK_JOB, async (_payload, ctx) => {
  const runs = await runAllRosterLinks()
  // #1271: who can still sign in may have changed; the report is rebuilt after every run.
  await enqueue(LEAVER_SIGN_IN_JOB, {}, { maxAttempts: 1 })
  const summary = runs.map((r) => formatRosterLink(r.plan, r)).join('\n')
  console.log(summary)
  const failed = runs.flatMap((r) => r.failed)
  // Row ids only: never a name or a value.
  if (failed.length) throw new Error(`roster link could not finish ${failed.length} rows: ${failed.slice(0, 10).join('; ')}`)
  const refused = [
    ...runs.map((r) => r.status?.plan?.refused).filter(Boolean).map((why) => `changed no statuses: ${why}`),
    ...runs.map((r) => r.refused).filter(Boolean).map((why) => `ended no links: ${why}`),
  ]
  if (refused.length) ctx.refuse(refused.join('; '))
  else ctx.setResult(summary.slice(0, 500))
})
