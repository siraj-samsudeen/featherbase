// #1271: Leavers Who Can Still Sign In. A report the server rebuilds; it
// changes nobody (disabling is the leaver job's alone: leaver-check.ts).
// Each row is someone who can still sign in some way and is one of:
// - in the leaver job's own plan (StyleHR-linked people the warehouse shows
//   have left), the same plan its next run would act on;
// - someone the people app says has left who holds no StyleHR link, whom the
//   leaver job never sees;
// - someone the people app says is not an employee who holds a link on an
//   employees-only method (#1267).
import { createHash } from 'node:crypto'
import { sql, withTransaction } from './db'
import { LEAVER_CHECK_JOB, planLeaverCheck, type Leaver } from './leaver-check'
import { describePeople } from './person-standing'

export const LEAVER_SIGN_IN_JOB = 'refresh_leaver_sign_in'
/** The people app is asked about this many people at a time. */
const BATCH = 200

type Source = 'leaver job' | 'people app' | 'not an employee'
export interface LeaverSignInRow { person: string; why: string; ways_in: string; left_on: string | null; source: Source }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayOf = (iso: string) => `${iso.slice(8, 10)}-${MONTHS[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}`
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

interface WaysIn { ways: string[]; delegated: boolean; employeesOnly: string[] }

/** Every enabled person who can still sign in, with how: a password, and each
 *  live link or pending invite on a switched-on method. */
async function waysIn(): Promise<Map<string, WaysIn>> {
  const out = new Map<string, WaysIn>()
  const of = (person: string) => out.get(person) ?? out.set(person, { ways: [], delegated: false, employeesOnly: [] }).get(person)!
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
    if (l.kind === 'delegated_password' && !l.invited) w.delegated = true
    if (l.employees_only === true && !l.invited && !w.employeesOnly.includes(label)) w.employeesOnly.push(label)
  }
  return out
}

/** What the report holds now, worked out afresh. Pure of side effects. */
export async function leaverSignInRows(): Promise<LeaverSignInRow[]> {
  const ways = await waysIn()
  const rows = new Map<string, LeaverSignInRow>()
  const listed = (person: string) => ways.get(person)?.ways.join(', ')
  // The leaver job's own plan: whom it would disable, and the System Managers it only reports.
  const plan = await planLeaverCheck().catch(() => null)
  for (const l of [...(plan?.to_disable ?? []), ...(plan?.privileged_leavers ?? [])] as Leaver[]) {
    const how = listed(l.person)
    if (!how) continue
    rows.set(l.person, { person: l.person, why: l.left_on ? `Left on ${dayOf(l.left_on)}` : sentence(l.reason), ways_in: how, left_on: l.left_on, source: 'leaver job' })
  }
  // Everyone else who can sign in, as the people app sees them.
  const rest = [...ways.keys()].filter((p) => !rows.has(p) && p !== 'Administrator')
  for (let i = 0; i < rest.length; i += BATCH) {
    const said = await describePeople(rest.slice(i, i + BATCH))
    for (const [person, standing] of said) {
      const w = ways.get(person)!
      if (standing.status === 'left' && !w.delegated)
        rows.set(person, { person, why: standing.left_on ? `Left on ${dayOf(standing.left_on)}` : 'Left, as the people app says', ways_in: w.ways.join(', '), left_on: standing.left_on ?? null, source: 'people app' })
      else if (standing.status === 'none' && w.employeesOnly.length)
        rows.set(person, { person, why: `Not an employee, holds a ${w.employeesOnly.join(' and ')} link`, ways_in: w.ways.join(', '), left_on: null, source: 'not an employee' })
    }
  }
  return [...rows.values()]
}

/** Rebuild the report in one go: readers see the old rows or the new, never half. */
export async function refreshLeaverSignIn(): Promise<number> {
  const rows = await leaverSignInRows()
  await withTransaction(async () => {
    await sql`delete from leaver_sign_in`
    for (const r of rows)
      await sql`insert into leaver_sign_in ${sql({
        row_id: createHash('sha256').update(r.person).digest('hex').slice(0, 20),
        person: r.person, why: r.why, ways_in: r.ways_in, left_on: r.left_on, source: r.source,
      })}`
  })
  return rows.length
}

/** The list header's line: the leaver job on or off, its last run, and when this report was checked. */
export async function leaverSignInStatus() {
  const jobs = await sql`select row_id, enabled, last_run_at, last_outcome, last_result from scheduled_job where row_id in (${LEAVER_CHECK_JOB}, ${LEAVER_SIGN_IN_JOB})`
  const job = jobs.find((j) => j.row_id === LEAVER_CHECK_JOB)
  const report = jobs.find((j) => j.row_id === LEAVER_SIGN_IN_JOB)
  return {
    leaver_job: job ? { on: job.enabled === true, last_run_at: job.last_run_at ?? null, last_outcome: job.last_outcome ?? null, last_result: job.last_result ?? null } : null,
    checked_at: report?.last_run_at ?? null,
  }
}
