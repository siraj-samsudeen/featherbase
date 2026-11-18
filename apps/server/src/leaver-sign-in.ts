// #1271: Leavers Who Can Still Sign In. A report the server rebuilds; it
// changes nobody (disabling is the leaver job's alone: leaver-check.ts).
// Each row is someone who can still sign in some way, in one of four sections:
//   1. whom the leaver job's own plan would disable, with the rule that hit them;
//   2. System Managers who match a leaver rule: the job never disables them;
//   3. people the people app says have left who hold no StyleHR link, whom
//      the leaver job never sees;
//   4. people the people app says are not employees who hold a StyleHR link
//      or a link on another employees-only method (#1267).
import { createHash } from 'node:crypto'
import { sql, withTransaction } from './db'
import { LEAVER_CHECK_JOB, planLeaverCheck, type Leaver, type LeaverPlan } from './leaver-check'
import { describePeople } from './person-standing'
import { errorMessage } from './errors'

export const LEAVER_SIGN_IN_JOB = 'refresh_leaver_sign_in'
/** The people app is asked about this many people at a time. */
const BATCH = 200

export const SECTIONS = [
  '1. Leaver job would disable',
  '2. System Manager: never disabled by the job',
  '3. Left, no StyleHR link',
  '4. Not an employee, holds a StyleHR link',
] as const
export type Section = (typeof SECTIONS)[number]
export interface LeaverSignInRow { section: Section; person: string; why: string; ways_in: string; left_on: string | null }
export interface LeaverSignInReport {
  rows: LeaverSignInRow[]
  /** Set when the leaver job's plan could not be read, or its next run would refuse. */
  plan_note: string | null
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

interface WaysIn { ways: string[]; styleHr: string[] }

/** Every enabled person who can still sign in, with how: a password, and each
 *  live link or pending invite on a switched-on method. `styleHr` names the
 *  live links that only employees should hold: a delegated (StyleHR) method or
 *  one marked employees-only. */
async function waysIn(): Promise<Map<string, WaysIn>> {
  const out = new Map<string, WaysIn>()
  const of = (person: string) => out.get(person) ?? out.set(person, { ways: [], styleHr: [] }).get(person)!
  for (const r of await sql`select row_id from person where enabled and password_hash is not null`) of(String(r.row_id)).ways.push('Password')
  const links = await sql`
    select i.person_id, m.label, m.kind, m.employees_only, (i.subject is null) as invited
    from sign_in_identity i join sign_in_method m on m.row_id = i.method
    join person p on p.row_id = i.person_id
    where i.ended_at is null and m.enabled and p.enabled
    order by m.label`
  for (const l of links) {
    const w = of(String(l.person_id))
    const label = String(l.label || l.kind)
    const way = l.invited ? `${label} (invited)` : label
    if (!w.ways.includes(way)) w.ways.push(way)
    if (!l.invited && (l.kind === 'delegated_password' || l.employees_only === true) && !w.styleHr.includes(label)) w.styleHr.push(label)
  }
  return out
}

/** Sections in order; within one, the latest leaving date first, then by person. */
function ordered(rows: LeaverSignInRow[]): LeaverSignInRow[] {
  return rows.sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section)
    || (b.left_on ?? '').localeCompare(a.left_on ?? '')
    || a.person.localeCompare(b.person))
}

/** What the report holds now, worked out afresh. Pure of side effects. */
export async function leaverSignInRows(): Promise<LeaverSignInReport> {
  const ways = await waysIn()
  const rows = new Map<string, LeaverSignInRow>()
  const listed = (person: string) => ways.get(person)?.ways.join(', ')
  // The leaver job's own plan, the same one its next run would act on.
  let plan: LeaverPlan | null = null
  let plan_note: string | null = null
  try {
    const read = await planLeaverCheck()
    plan = read
    if (read?.refused) plan_note = `The leaver job's next run would refuse: ${read.refused}`
  } catch (e) {
    plan_note = `The leaver job's plan could not be read: ${errorMessage(e)}`
  }
  const fromPlan = (section: Section, leavers: Leaver[]) => {
    for (const l of leavers) {
      const how = listed(l.person)
      if (how) rows.set(l.person, { section, person: l.person, why: sentence(l.reason), ways_in: how, left_on: l.left_on })
    }
  }
  fromPlan(SECTIONS[0], plan?.to_disable ?? [])
  fromPlan(SECTIONS[1], plan?.privileged_leavers ?? [])
  // Everyone else who can sign in, as the people app sees them.
  const rest = [...ways.keys()].filter((p) => !rows.has(p) && p !== 'Administrator')
  for (let i = 0; i < rest.length; i += BATCH) {
    const said = await describePeople(rest.slice(i, i + BATCH))
    for (const [person, standing] of said) {
      const w = ways.get(person)!
      if (standing.status === 'left' && !w.styleHr.length)
        rows.set(person, { section: SECTIONS[2], person, why: 'The people app says they have left', ways_in: w.ways.join(', '), left_on: standing.left_on ?? null })
      else if (standing.status === 'none' && w.styleHr.length)
        rows.set(person, { section: SECTIONS[3], person, why: `Not an employee, holds a ${w.styleHr.join(' and ')} link`, ways_in: w.ways.join(', '), left_on: null })
    }
  }
  return { rows: ordered([...rows.values()]), plan_note }
}

/** Rebuild the report in one go: readers see the old rows or the new, never half. */
export async function refreshLeaverSignIn(): Promise<LeaverSignInReport> {
  const report = await leaverSignInRows()
  await withTransaction(async () => {
    await sql`delete from leaver_sign_in`
    for (const [position, r] of report.rows.entries())
      await sql`insert into leaver_sign_in ${sql({
        row_id: createHash('sha256').update(r.person).digest('hex').slice(0, 20),
        position, section: r.section, person: r.person, why: r.why, ways_in: r.ways_in, left_on: r.left_on,
      })}`
  })
  return report
}

/** The list header's line: the leaver job on or off, its last run, and when this report was checked. */
export async function leaverSignInStatus() {
  const jobs = await sql`select row_id, enabled, last_run_at, last_outcome, last_result from scheduled_job where row_id in (${LEAVER_CHECK_JOB}, ${LEAVER_SIGN_IN_JOB})`
  const job = jobs.find((j) => j.row_id === LEAVER_CHECK_JOB)
  const report = jobs.find((j) => j.row_id === LEAVER_SIGN_IN_JOB)
  return {
    leaver_job: job ? { on: job.enabled === true, last_run_at: job.last_run_at ?? null, last_outcome: job.last_outcome ?? null, last_result: job.last_result ?? null } : null,
    checked_at: report?.last_run_at ?? null,
    /** The last rebuild's own summary, which names a plan that could not be read or would refuse. */
    checked_result: report?.last_result ?? null,
  }
}
