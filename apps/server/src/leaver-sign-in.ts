// #1271: Leavers Who Can Still Sign In. A report the server rebuilds; it
// changes nobody (disabling is the leaver job's alone: leaver-check.ts).
// Each row is someone who can still sign in some way, in one of four sections:
//   1. whom the leaver job's own plan would disable, with the rule that hit them;
//   2. System Managers who match a leaver rule: the job never disables them;
//   3. people the people app says have left who hold no StyleHR link, whom
//      the leaver job never sees;
//   4. people the people app says are not employees who hold a StyleHR link
//      or a link on another employees-only method (#1267);
//   5. for review only: people off the latest payroll with no exit date passed
//      and not marked inactive (owner-directors are), whom the job never disables;
//   6. for review only: people StyleHR says have left whom attendance shows at
//      work since (#1286), whom the job never disables.
import { createHash } from 'node:crypto'
import { sql, withTransaction } from './db'
import { LEAVER_CHECK_JOB, planLeaverCheck, type Leaver, type LeaverPlan } from './leaver-check'
import { describePeople, peopleDescriberState } from './person-standing'
import { EXPECTS_COLUMN, REDIRECT_KINDS, domainAllowed, listSignInMethods, methodUsable, workingLinkIds } from './identities'
import { errorMessage } from './errors'

export const LEAVER_SIGN_IN_JOB = 'refresh_leaver_sign_in'
/** The people app is asked about this many people at a time. */
const BATCH = 200

export const SECTIONS = [
  '1. Leaver job would disable',
  '2. System Manager: never disabled by the job',
  "3. Left, not on the leaver job's list",
  '4. Not an employee, holds a StyleHR link',
  '5. Not on payroll, but no exit date',
  '6. At work, though StyleHR says they left',
] as const
/** The sections of people who have left, or are not employees. Sections 5 and 6 are for review only. */
const LEAVER_SECTIONS: readonly Section[] = SECTIONS.slice(0, 4)
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
 *  live link or pending invite (a password invitation too), and each expected first Google or Microsoft
 *  sign-in, on a method that can sign anyone in now (methodUsable, the rule
 *  every way-in count shares). */
async function waysIn(): Promise<Map<string, WaysIn>> {
  const methods = (await listSignInMethods()).filter(methodUsable)
  const out = new Map<string, WaysIn>()
  const of = (person: string) => out.get(person) ?? out.set(person, { ways: [], styleHr: [], employeesOnly: [] }).get(person)!
  const add = (w: WaysIn, way: string) => { if (!w.ways.includes(way)) w.ways.push(way) }
  const passwordOn = methods.some((m) => m.kind === 'password')
  // A live password invitation lets them set a password and sign in: as checkPasswordInvite reads it.
  const people = await sql`select row_id, email, replaced_by, (password_hash is not null) as has_password, expects_google_sign_in, expects_microsoft_sign_in,
      exists (select 1 from password_invite i where i.person = person.row_id and i.used_at is null and i.voided_at is null
        and i.sent_at is not null and i.expires_at > now()) as invited
    from person where enabled order by row_id`
  const held = new Set((await sql`select person_id || ' ' || method as k from sign_in_identity where ended_at is null`).map((r) => String(r.k)))
  for (const p of people) {
    const person = String(p.row_id)
    if (p.has_password && passwordOn) add(of(person), 'Password')
    else if (p.invited && passwordOn) add(of(person), 'Password (invited)')
    for (const kind of REDIRECT_KINDS) {
      const m = methods.find((x) => x.kind === kind)
      const email = typeof p.email === 'string' ? p.email : ''
      // As claimExpectedSignIn would admit it: the address's domain allowed, not replaced,
      // no live link on the method yet. A hosted-domain claim is assumed possible.
      if (m && p[EXPECTS_COLUMN[kind]] === true && p.replaced_by == null && domainAllowed(m, email)
        && !held.has(`${person} ${m.key}`))
        add(of(person), `${m.label || kind} (first sign-in expected)`)
    }
  }
  const usable = new Map(methods.map((m) => [m.key, m]))
  // A live link counts only where sign-in would accept it (its domain, tenant, and no StyleHR for a System Manager).
  const working = await workingLinkIds()
  const links = await sql`
    select i.id, i.person_id, i.method, (i.subject is null) as invited
    from sign_in_identity i join person p on p.row_id = i.person_id
    where i.ended_at is null and p.enabled
    order by i.person_id, i.method`
  for (const l of links) {
    const m = usable.get(String(l.method))
    if (!m || (!l.invited && !working.has(String(l.id)))) continue
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
  // #1286: StyleHR says they left, attendance says they are at work. For review
  // only, and placed before the people app, which may still read them as left.
  for (const h of plan?.held_at_work ?? []) {
    const how = listed(h.person)
    if (how) rows.set(h.person, { section: SECTIONS[5], person: h.person, why: sentence(h.reason), ways_in: how, left_on: null })
  }
  // Everyone else who can sign in, as the people app sees them.
  const describer = await peopleDescriberState()
  if (describer === 'none') notes.push('No app says who people are, so sections 3 and 4 are not checked')
  const rest = describer === 'none' ? [] : [...ways.keys()].filter((p) => !rows.has(p) && p !== 'Administrator')
  const unknown = await fromPeopleApp(rest, ways, rows)
  if (unknown) notes.push(`The people app could not say who ${count(unknown, 'person is', 'people are')}, so they are not checked`)
  // For review only, after the people app: someone it says has left stays in section 3.
  for (const o of plan?.not_on_payroll ?? []) {
    const how = listed(o.person)
    if (how && !rows.has(o.person))
      rows.set(o.person, { section: SECTIONS[4], person: o.person, why: 'Off the latest payroll, but no exit date has passed and StyleHR does not mark them inactive', ways_in: how, left_on: null })
  }

  return { rows: ordered([...rows.values()]), notes }
}

/** Sections 3 and 4, from the people app. Returns how many it could not describe. */
async function fromPeopleApp(rest: string[], ways: Map<string, WaysIn>, rows: Map<string, LeaverSignInRow>): Promise<number> {
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
  return unknown
}

/** The rebuild's one-line summary: how many can still sign in, and whatever it could not check. */
export function rebuildSummary(report: LeaverSignInReport): string {
  // Sections 5 and 6 are for review only: never in the leaver count.
  const n = report.rows.filter((r) => LEAVER_SECTIONS.includes(r.section)).length
  const offPayroll = report.rows.filter((r) => r.section === SECTIONS[4]).length
  const atWork = report.rows.filter((r) => r.section === SECTIONS[5]).length
  return [
    `${n} ${n === 1 ? 'person' : 'people'} can still sign in`,
    ...(offPayroll ? [`${count(offPayroll, 'person', 'people')} off the payroll with no exit date, for review`] : []),
    ...(atWork ? [`${count(atWork, 'person', 'people')} at work though StyleHR says they left, for review`] : []),
    ...report.notes,
  ].join('. ')
}

/** Rebuild the report in one go: readers see the old rows or the new, never
 *  half. Rebuilds replace in turn, and one that started before the rebuild
 *  already published writes nothing, so an older result never replaces a
 *  newer one. Returns whether this rebuild was published. */
export async function refreshLeaverSignIn(): Promise<LeaverSignInReport & { published: boolean }> {
  const [{ started }] = await sql`select clock_timestamp() as started`
  const report = await leaverSignInRows()
  const published = await withTransaction(async () => {
    await sql`select pg_advisory_xact_lock(hashtext('refresh_leaver_sign_in'))`
    const [shown] = await sql`select started_at from leaver_sign_in_rebuild where id = 1`
    if (shown && new Date(shown.started_at as string) > new Date(started as string)) return false
    await sql`insert into leaver_sign_in_rebuild (id, started_at, summary) values (1, ${started}, ${rebuildSummary(report)})
      on conflict (id) do update set started_at = excluded.started_at, summary = excluded.summary`
    await sql`delete from leaver_sign_in`
    for (const [position, r] of report.rows.entries())
      await sql`insert into leaver_sign_in ${sql({
        row_id: createHash('sha256').update(r.person).digest('hex').slice(0, 20),
        position, section: r.section, person: r.person, why: r.why, ways_in: r.ways_in, left_on: r.left_on,
      })}`
    return true
  })
  return { ...report, published }
}

/** The list header's line: the leaver job on or off and its last run; when
 *  the rows on show were rebuilt, and a later attempt that failed. */
export async function leaverSignInStatus() {
  const jobs = await sql`select row_id, enabled, last_run_at, last_outcome, last_result from scheduled_job where row_id in (${LEAVER_CHECK_JOB}, ${LEAVER_SIGN_IN_JOB})`
  const job = jobs.find((j) => j.row_id === LEAVER_CHECK_JOB)
  const report = jobs.find((j) => j.row_id === LEAVER_SIGN_IN_JOB)
  // The rows on show are the published rebuild's: a failed or superseded one leaves them as they were.
  const [shown] = await sql`select started_at, summary from leaver_sign_in_rebuild where id = 1`
  // What the list holds now, counted the way the rebuild's summary counts it: sections 5 and 6 are for review only.
  const [held] = await sql`select count(*) filter (where section in ${sql([...LEAVER_SECTIONS])})::int as can_sign_in,
    count(*) filter (where section not in ${sql([...LEAVER_SECTIONS])})::int as review from leaver_sign_in`
  const failed = report?.last_run_at && report.last_outcome !== 'success'
    && (!shown || new Date(report.last_run_at as string) > new Date(shown.started_at as string))
  return {
    leaver_job: job ? { on: job.enabled === true, last_run_at: job.last_run_at ?? null, last_outcome: job.last_outcome ?? null, last_result: job.last_result ?? null } : null,
    checked_at: shown?.started_at ?? null,
    /** The published rebuild's own summary, which names whatever it could not check. */
    checked_result: shown?.summary ?? null,
    /** The latest rebuild attempt, when it failed after the last success. */
    last_failed: failed ? { at: report.last_run_at, error: report.last_result ?? null } : null,
    counts: { can_sign_in: held.can_sign_in as number, review: held.review as number },
  }
}
