import { registerJob } from '../jobs'
import { ROSTER_LINK_JOB, formatRosterLink, runAllRosterLinks } from '../roster-link'

// #1157: link every current roster row before anyone signs in, and end a
// leaver's link (roster-link.ts). Its cadence and on/off switch are the
// `link_roster` Scheduled Job row, seeded OFF by migration 0157; an instance
// with a roster switches it on in its settings. A run that would end too many
// links ends none: refused, alerted, and the schedule carries on.
registerJob(ROSTER_LINK_JOB, async (_payload, ctx) => {
  const runs = await runAllRosterLinks()
  const summary = runs.map((r) => formatRosterLink(r.plan, r)).join('\n') || 'roster link: no method has a usable roster'
  console.log(summary)
  const failed = runs.flatMap((r) => r.failed)
  // Row ids only: never a name or a value.
  if (failed.length) throw new Error(`roster link could not finish ${failed.length} rows: ${failed.slice(0, 10).join('; ')}`)
  const refused = runs.map((r) => r.refused).filter(Boolean)
  if (refused.length) ctx.refuse(`ended no links: ${refused.join('; ')}`)
  else ctx.setResult(summary.slice(0, 500))
})
