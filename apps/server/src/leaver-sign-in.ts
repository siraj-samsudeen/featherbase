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
import { describePeople, peopleDescriberState } from './person-standing'
import { EXPECTS_COLUMN, REDIRECT_KINDS, methodUsable } from './identities'
import { errorMessage } from './errors'

export const LEAVER_SIGN_IN_JOB = 'refresh_leaver_sign_in'
/** The people app is asked about this many people at a time. */
const BATCH = 200

export const SECTIONS = [
  '1. Leaver job would disable',
  '2. System Manager: never disabled by the job',
  "3. Left, not on the leaver job's list",
  '4. Not an employee, holds a StyleHR link',
] as const
export type Section = (typeof SECTIONS)[number]
export interface LeaverSignInRow { section: Section; person: string; why: string; ways_in: string; left_on: string | null }
export interface LeaverSignInReport {
  rows: LeaverSignInRow[]
  /** What this rebuild could not check: a leaver-job plan that could not be read
   *  or would refuse, or people the people app could not describe. Empty when complete. */
  notes: string[]
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

interface WaysIn {
  ways: string[]
  /** Live links on a StyleHR (delegated) method. */
  styleHr: string[]
  /** Live links on any method only employees should hold: StyleHR, or one marked employees-only. */
  employeesOnly: string[]
}

/** Every enabled person who can still sign in, with how: a password, each
 *  live link or pending invite, and each expected first Google or Microsoft
 *  sign-in, on a method that can sign anyone in now (methodUsable, the rule
 *  every way-in count shares). */
async function waysIn(): Promise<Map<string, WaysIn>> {
  const methods = (await sql`select row_id, label, kind, enabled, client_id, employees_only from sign_in_method order by label`)
    .filter((m) => methodUsable({ kind: String(m.kind), enabled: m.enabled === true, client_id: m.client_id as string | null }))
  const out = new Map<string, WaysIn>()
  const of = (person: string) => out.get(person) ?? out.set(person, { ways: [], styleHr: [], employeesOnly: [] }).get(person)!
  const add = (w: WaysIn, way: string) => { if (!w.ways.includes(way)) w.ways.push(way) }
  const people = await sql`select row_id, (password_hash is not null) as has_password, expects_google_sign_in, expects_microsoft_sign_in
    from person where enabled order by row_id`
  for (const p of people) {
    const person = String(p.row_id)
    if (p.has_password && methods.some((m) => m.kind === 'password')) add(of(person), 'Password')
    for (const kind of REDIRECT_KINDS) {
      const m = methods.find((x) => x.kind === kind)
      if (m && p[EXPECTS_COLUMN[kind]] === true) add(of(person), `${String(m.label || kind)} (first sign-in expected)`)
    }
  }
  const usable = new Map(methods.map((m) => [String(m.row_id), m]))
  const links = await sql`
    select i.person_id, i.method, (i.subject is null) as invited
    from sign_in_identity i join person p on p.row_id = i.person_id
    where i.ended_at is null and p.enabled
    order by i.person_id, i.method`
  for (const l of links) {
    const m = usable.get(String(l.method))
    if (!m) continue
    const w = of(String(l.person_id))
    const label = String(m.label || m.kind)
    add(w, l.invited ? `${label} (invited)` : label)
    if (l.invited) continue
    if (m.kind === 'delegated_password' && !w.styleHr.includes(label)) w.styleHr.push(label)
    if ((m.kind === 'delegated_password' || m.employees_only === true) && !w.employeesOnly.includes(label)) w.employeesOnly.push(label)
  }
  return out
}

/** Sections in order; within one, the latest leaving date first, then by person. */
function ordered(rows: LeaverSignInRow[]): LeaverSignInRow[] {
  return rows.sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section)
    || (b.left_on ?? '').localeCompare(a.left_on ?? '')
    || a.person.localeCompare(b.person))
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What the report holds now, worked out afresh. Pure of side effects. */
export async function leaverSignInRows(): Promise<LeaverSignInReport> {
  const ways = await waysIn()
  const rows = new Map<string, LeaverSignInRow>()
  const notes: string[] = []
  const listed = (person: string) => ways.get(person)?.ways.join(', ')
  // The leaver job's own plan, the same one its next run would act on.
  let plan: LeaverPlan | null = null
  try {
    const read = await planLeaverCheck()
    plan = read
    if (read?.refused) notes.push(`The leaver job's next run would refuse: ${read.refused}`)
  } catch (e) {
    notes.push(`The leaver job's plan could not be read: ${errorMessage(e)}`)
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
  const describer = await peopleDescriberState()
  if (describer === 'none') {
    notes.push('No app says who people are, so sections 3 and 4 are not checked')
    return { rows: ordered([...rows.values()]), notes }
  }
  const rest = [...ways.keys()].filter((p) => !rows.has(p) && p !== 'Administrator')
  let unknown = 0
  for (let i = 0; i < rest.length; i += BATCH) {
    const said = await describePeople(rest.slice(i, i + BATCH))
    for (const [person, standing] of said) {
      const w = ways.get(person)!
      if (standing.status === 'unknown') unknown++
      else if (standing.status === 'left')
        rows.set(person, {
          section: SECTIONS[2], person, ways_in: w.ways.join(', '), left_on: standing.left_on ?? null,
          why: w.styleHr.length
            ? `The people app says they have left; the leaver job did not match their ${w.styleHr.join(' and ')} link`
            : 'The people app says they have left; with no StyleHR link the leaver job never sees them',
        })
      else if (standing.status === 'none' && w.employeesOnly.length)
        rows.set(person, { section: SECTIONS[3], person, why: `Not an employee, holds a ${w.employeesOnly.join(' and ')} link`, ways_in: w.ways.join(', '), left_on: null })
    }
  }
  if (unknown) notes.push(`The people app could not say who ${count(unknown, 'person is', 'people are')}, so they are not checked`)
  return { rows: ordered([...rows.values()]), notes }
}

/** Rebuild the report in one go: readers see the old rows or the new, never half. */
export async function refreshLeaverSignIn(): Promise<LeaverSignInReport> {
  const report = await leaverSignInRows()
  await withTransaction(async () => {
    // One rebuild replaces the rows at a time, so two at once never mix their reports.
    await sql`select pg_advisory_xact_lock(hashtext('refresh_leaver_sign_in'))`
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
    /** The last rebuild's own summary, which names whatever it could not check. */
    checked_result: report?.last_result ?? null,
  }
}
