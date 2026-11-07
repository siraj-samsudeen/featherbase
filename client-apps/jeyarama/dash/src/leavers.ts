// The daily leaver check (data-warehouse #4336; an app job since featherbase
// #731). StyleHR's sign-in answer carries no exit date, so a person who has
// left keeps signing in until HR blocks them in StyleHR. Once a day this reads
// the StyleHR employee record in the warehouse and disables everyone linked to
// a record that shows they have left.
//
// Constraints the code below holds to:
// - It only ever DISABLES. Re-enabling is a person's decision.
// - Administrator and System Managers are never disabled; they are reported.
// - A stale feed, an empty feed, or a run that would disable more than the
//   limit refuses and disables nobody: a bad feed must never mass-disable staff.
// - A person whose StyleHR employee code is shared by several records (the
//   warehouse has such collisions) is a leaver only when EVERY record says so.

/** The identifier systems and the sign-in method that link a person to StyleHR (featherbase.json's job). */
export const RECORD_SYSTEM = 'stylehr-employee-id'
export const CODE_SYSTEM = 'stylehr-employee-code'
export const SIGN_IN_METHOD = 'stylehr'
/** The warehouse datasets the job reads. */
export const RECORDS_DATASET = 'hr_employee_records'
export const FEED_DAY_DATASET = 'hr_feed_day'
export const LEAVER_CHECK_SUBJECT = 'Leaver check: people disabled from the StyleHR record'

/** A run that would disable more than this share of linked people refuses. */
const MAX_SHARE = 0.05
/** ...but a small instance may still lose this many in one run. */
const MIN_LIMIT = 2
/** The warehouse's latest StyleHR day may be at most this many days behind today. */
const MAX_FEED_AGE_DAYS = 1
/** Someone who joined this recently may not be on a payroll run yet. */
const JOINER_GRACE_DAYS = 62

/** One StyleHR employee record, as the warehouse holds it. */
export interface EmployeeRecord {
  employee_key: string
  employee_code: string | null
  payroll_active: boolean | null
  movement_active: boolean | null
  date_of_joining: string | null
  exit_date: string | null
}

/** One enabled person with at least one StyleHR link. */
export interface LinkedPerson {
  person: string
  full_name: string | null
  privileged: boolean
  record_ids: string[]
  codes: string[]
}

export interface Leaver {
  person: string
  full_name: string | null
  reason: string
  /** For the summary: which basis decided it. */
  basis: 'exit date' | 'inactive' | 'not on payroll'
}

export interface LeaverPlan {
  today: string
  latest_feed_day: string | null
  linked: number
  limit: number
  refused: string | null
  to_disable: Leaver[]
  privileged_leavers: Leaver[]
  not_found: string[]
  recent_joiners: string[]
}

// ------------------------------------------------------------- dates

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** ISO day → DD-Mon-YYYY. */
function displayDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`
}

/** The day `now` falls on in `timeZone`, as an ISO day. */
export function dayIn(now: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

const normCode = (c: string) => c.trim().toUpperCase()

// ------------------------------------------------------------- the rule

type Verdict = { leaver: true; basis: Leaver['basis']; reason: string; rank: number } | { leaver: false; recentJoiner: boolean }

/** Has this one record left, as of `today`? An exit date that has passed comes
 *  first, then an inactive status, then not being on payroll. */
function recordVerdict(r: EmployeeRecord, today: string): Verdict {
  if (r.exit_date && r.exit_date <= today)
    return { leaver: true, basis: 'exit date', reason: `exit date ${displayDate(r.exit_date)} has passed`, rank: 0 }
  if (r.movement_active === false) return { leaver: true, basis: 'inactive', reason: 'marked inactive in StyleHR', rank: 1 }
  if (r.payroll_active === false) {
    if (r.date_of_joining && daysBetween(r.date_of_joining, today) < JOINER_GRACE_DAYS) return { leaver: false, recentJoiner: true }
    return { leaver: true, basis: 'not on payroll', reason: 'not on the latest payroll', rank: 2 }
  }
  return { leaver: false, recentJoiner: false }
}

/** Pure: who this run would disable, and whether it must refuse. */
export function planLeavers(people: LinkedPerson[], records: EmployeeRecord[], latestFeedDay: string | null, today: string): LeaverPlan {
  const byKey = new Map<string, EmployeeRecord>()
  const byCode = new Map<string, EmployeeRecord[]>()
  for (const r of records) {
    byKey.set(String(r.employee_key), r)
    if (r.employee_code) {
      const k = normCode(r.employee_code)
      byCode.set(k, [...(byCode.get(k) ?? []), r])
    }
  }
  const linked = people.length
  const limit = Math.max(MIN_LIMIT, Math.floor(linked * MAX_SHARE))
  const plan: LeaverPlan = {
    today, latest_feed_day: latestFeedDay, linked, limit, refused: null,
    to_disable: [], privileged_leavers: [], not_found: [], recent_joiners: [],
  }
  if (!latestFeedDay || daysBetween(latestFeedDay, today) > MAX_FEED_AGE_DAYS) {
    plan.refused = `the warehouse's StyleHR data is stale (latest day ${latestFeedDay ? displayDate(latestFeedDay) : 'none'}, today ${displayDate(today)})`
    return plan
  }
  if (!records.length) {
    plan.refused = 'the warehouse returned no StyleHR employee records'
    return plan
  }
  for (const p of people) {
    // A record number names exactly one record; a code may name several.
    const mine = p.record_ids.length
      ? p.record_ids.map((id) => byKey.get(id)).filter((r): r is EmployeeRecord => Boolean(r))
      : [...new Map(p.codes.flatMap((c) => byCode.get(normCode(c)) ?? []).map((r) => [r.employee_key, r])).values()]
    if (!mine.length) {
      plan.not_found.push(p.person)
      continue
    }
    const verdicts = mine.map((r) => recordVerdict(r, today))
    const left = verdicts.filter((v): v is Extract<Verdict, { leaver: true }> => v.leaver)
    if (left.length !== verdicts.length) {
      if (verdicts.some((v) => !v.leaver && v.recentJoiner) && !verdicts.some((v) => !v.leaver && !v.recentJoiner))
        plan.recent_joiners.push(p.person)
      continue
    }
    const decisive = left.sort((a, b) => a.rank - b.rank)[0]
    const leaver: Leaver = { person: p.person, full_name: p.full_name, reason: decisive.reason, basis: decisive.basis }
    if (p.privileged) plan.privileged_leavers.push(leaver)
    else plan.to_disable.push(leaver)
  }
  if (plan.to_disable.length > limit)
    plan.refused = `it would disable ${plan.to_disable.length} of ${linked} linked people, more than the limit of ${limit}`
  return plan
}

// ------------------------------------------------------------- the job

/** What the platform hands a job (the part this module uses; featherbase's RuntimeJobContext). */
export interface LeaverJobContext {
  now: string
  timeZone: string
  datasets: { live(name: string): Promise<{ rows: unknown[] }> }
  people: {
    list(): Promise<{
      person: string
      full_name: string | null
      privileged: boolean
      identifiers: Readonly<Record<string, readonly string[]>>
      sign_ins: Readonly<Record<string, readonly string[]>>
    }[]>
    disable(person: string, reason: string): Promise<boolean>
  }
  email: { systemManagers(message: { subject: string; body: string }): Promise<number> }
  setResult(text: string): void
  refuse(reason: string): void
}

/** Every enabled person with a StyleHR link: a record number or an employee
 *  code from their identifiers, or the record number their StyleHR sign-in carries. */
export function linkedPeople(people: Awaited<ReturnType<LeaverJobContext['people']['list']>>): LinkedPerson[] {
  return people.flatMap((p) => {
    const record_ids = [...new Set([...(p.identifiers[RECORD_SYSTEM] ?? []), ...(p.sign_ins[SIGN_IN_METHOD] ?? [])].map(String))]
    const codes = [...new Set((p.identifiers[CODE_SYSTEM] ?? []).map(String))]
    return record_ids.length || codes.length ? [{ person: p.person, full_name: p.full_name, privileged: p.privileged, record_ids, codes }] : []
  })
}

const text = (v: unknown) => (v == null ? null : String(v))
const bool = (v: unknown) => (v == null ? null : v === true)

function records(rows: unknown[]): EmployeeRecord[] {
  return (rows as Record<string, unknown>[]).map((r) => ({
    employee_key: String(r.employee_key),
    employee_code: text(r.employee_code),
    payroll_active: bool(r.payroll_active),
    movement_active: bool(r.movement_active),
    date_of_joining: text(r.date_of_joining),
    exit_date: text(r.exit_date),
  }))
}

const line = (l: Leaver) => `- ${l.full_name || l.person}: ${l.reason}`

export function summaryBody(plan: LeaverPlan, disabled: Leaver[], failedCount = 0): string {
  const out = [`The daily leaver check ran on ${displayDate(plan.today)} against the StyleHR record in the warehouse (latest day ${plan.latest_feed_day ? displayDate(plan.latest_feed_day) : 'none'}).`, '']
  if (plan.refused) out.push(`It disabled nobody: ${plan.refused}.`, 'Check the warehouse feed. A large but genuine batch is disabled by hand, on each Person page.', '')
  if (disabled.length) out.push(`Disabled ${disabled.length} of ${plan.linked} linked people:`, ...disabled.map(line), '')
  if (failedCount) out.push(`${failedCount} could not be disabled; the job's error in Job Execution names them. The next run tries again.`, '')
  if (plan.privileged_leavers.length)
    out.push('Not disabled, because they are System Managers. Decide by hand:', ...plan.privileged_leavers.map(line), '')
  if (plan.not_found.length) out.push(`${plan.not_found.length} linked people have no StyleHR record in the warehouse; they were left as they are.`)
  out.push('', 'The check never re-enables anyone. To let someone back in, enable them on their Person page.')
  return out.join('\n')
}

/** Plan, then act on the plan unless it refuses. Idempotent: a disabled person
 *  is not listed any more, so a second run finds nothing to do. */
export async function disableLeavers(ctx: LeaverJobContext): Promise<void> {
  const people = linkedPeople(await ctx.people.list())
  if (!people.length) {
    ctx.setResult('leaver check: nobody is linked to StyleHR; nothing to check')
    return
  }
  const [feed] = (await ctx.datasets.live(FEED_DAY_DATASET)).rows as { latest_day?: unknown }[]
  const plan = planLeavers(people, records((await ctx.datasets.live(RECORDS_DATASET)).rows), text(feed?.latest_day), dayIn(ctx.now, ctx.timeZone))
  const disabled: Leaver[] = []
  const failed: string[] = []
  // One person's failed save must not stop the rest, nor the summary that
  // reports those already disabled: a retry would no longer see them.
  if (!plan.refused)
    for (const l of plan.to_disable)
      try {
        if (await ctx.people.disable(l.person, `left: ${l.reason}`)) disabled.push(l)
      } catch (err) {
        failed.push(`${l.person}: ${err instanceof Error ? err.message : String(err)}`)
      }
  let delivery = 'nothing to report; no summary sent'
  if (plan.refused || disabled.length || failed.length || plan.privileged_leavers.length) {
    const mailed = await ctx.email.systemManagers({ subject: LEAVER_CHECK_SUBJECT, body: summaryBody(plan, disabled, failed.length) })
    delivery = mailed ? `summary sent to ${mailed} System Manager(s)` : 'summary reached nobody: no System Manager has an email address'
  }
  if (failed.length) throw new Error(`leaver check could not disable ${failed.length}: ${failed.join('; ')}`)
  // A refusal is not retried, but the Jobs page treats it like a failure and alerts.
  if (plan.refused) ctx.refuse(`disabled nobody: ${plan.refused}; ${delivery}`)
  else ctx.setResult(`leaver check: disabled ${disabled.length} of ${plan.linked} linked people; ${delivery}`)
}
