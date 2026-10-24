// The warehouse exit-date check (data-warehouse #4336, first slice). StyleHR's
// sign-in answer carries no exit date, so a person who has left keeps signing
// in until HR blocks them in StyleHR. Once a day this reads the StyleHR
// employee record in the warehouse and disables everyone linked to a record
// that shows they have left.
//
// Constraints the code below holds to:
// - It only ever DISABLES. Re-enabling is a person's decision.
// - Administrator and System Managers are never disabled; they are reported.
// - A stale feed, an empty feed, or a run that would disable more than the
//   limit refuses and disables nobody: a bad feed must never mass-disable staff.
// - A person whose StyleHR employee code is shared by several records (the
//   warehouse has such collisions) is a leaver only when EVERY record says so.
import { sql, withTransaction } from './db'
import { saveDoc } from './document'
import { logActivity } from './audit'
import { queueEmail, type MailMessage } from './email'
import { readMotherDuck, type WarehouseReader } from './motherduck-reader'

export const LEAVER_CHECK_JOB = 'disable_leavers'
export const LEAVER_CHECK_SUBJECT = 'Leaver check: people disabled from the StyleHR record'
/** The activity row's actor: the system, not a person (the person is the target). */
const ACTOR = 'system'

/** A run that would disable more than this share of linked people refuses. */
export const MAX_SHARE = 0.05
/** ...but a small instance may still lose this many in one run. */
export const MIN_LIMIT = 2
/** The warehouse's latest StyleHR day may be at most this many days behind today. */
export const MAX_FEED_AGE_DAYS = 1
/** Someone who joined this recently may not be on a payroll run yet. */
export const JOINER_GRACE_DAYS = 62

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
  updated_at: unknown
  record_ids: string[]
  codes: string[]
}

export interface Leaver {
  person: string
  full_name: string | null
  reason: string
  /** For the activity row and the summary: which basis decided it. */
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

/** ISO day → DD-Mon-YYYY (ADR 844). */
export function displayDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`
}

/** Today in India, as an ISO day. */
export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** DuckDB hands a DATE back as a Date or its own value object; keep the ISO day. */
function isoDay(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function bool(v: unknown): boolean | null {
  return v == null ? null : v === true || v === 'true'
}

const normCode = (c: string) => c.trim().toUpperCase()

// ------------------------------------------------------------- the rule

type Verdict = { leaver: true; basis: Leaver['basis']; reason: string; rank: number } | { leaver: false; recentJoiner: boolean }

/** Has this one record left, as of `today`? An exit date that has passed comes
 *  first, then an inactive status, then not being on payroll. */
export function recordVerdict(r: EmployeeRecord, today: string): Verdict {
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
export function planLeavers(
  people: LinkedPerson[],
  records: EmployeeRecord[],
  latestFeedDay: string | null,
  today: string,
): LeaverPlan {
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
    today,
    latest_feed_day: latestFeedDay,
    linked,
    limit,
    refused: null,
    to_disable: [],
    privileged_leavers: [],
    not_found: [],
    recent_joiners: [],
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

// ------------------------------------------------------------- reading

/** Every enabled person with a current StyleHR link: a record number or an
 *  employee code, from their identifiers or their StyleHR sign-in. */
export async function linkedPeople(): Promise<LinkedPerson[]> {
  const rows = await sql`
    with links as (
      select person_id, 'record' as kind, value from person_identifier
      where system = 'stylehr-employee-id' and upper_inf(valid) and value is not null
      union
      select person_id, 'code', value from person_identifier
      where system = 'stylehr-employee-code' and upper_inf(valid) and value is not null
      union
      select person_id, case when subject_kind = 'record-id' then 'record' else 'code' end, subject from sign_in_identity
      where method = 'stylehr' and ended_at is null and subject is not null
    )
    select p.row_id, p.full_name, p.updated_at,
      (p.row_id = 'Administrator' or exists (
        select 1 from has_role r where r.parent = p.row_id and r.parenttype = 'Person'
          and r.role in ('System Manager', 'Administrator'))) as privileged,
      coalesce(array_agg(distinct l.value) filter (where l.kind = 'record'), '{}') as record_ids,
      coalesce(array_agg(distinct l.value) filter (where l.kind = 'code'), '{}') as codes
    from person p
    join links l on l.person_id = p.row_id
    where p.enabled and not coalesce(p.built_in, false) and p.replaced_by is null
    group by p.row_id, p.full_name, p.updated_at
    order by p.row_id`
  return rows.map((r) => ({
    person: String(r.row_id),
    full_name: (r.full_name as string | null) ?? null,
    privileged: r.privileged === true,
    updated_at: r.updated_at,
    record_ids: (r.record_ids as string[]).map(String),
    codes: (r.codes as string[]).map(String),
  }))
}

// The whole roster is small (tens of thousands of rows), so it is read in full:
// no person data is ever written into warehouse SQL.
export const RECORDS_SQL = `
  select e.employee_key, e.employee_code, e.payroll_active, e.movement_active, e.date_of_joining, x.exit_date
  from "gold"."hr"."employee" e
  left join "gold"."hr"."employee_exit" x on x.employee_key = e.employee_key and x.is_leaver`
// A day with people present is a day StyleHR loaded and the warehouse built.
export const FEED_DAY_SQL = `select max(date) from "gold"."hr"."attendance" where is_present`

let reader: WarehouseReader | null = null
/** Test seam: drive the check without MotherDuck. */
export function _setWarehouseReader(r: WarehouseReader | null): void {
  reader = r
}
const read: WarehouseReader = (q) => (reader ? reader(q) : readMotherDuck(q, 'run the leaver check'))

export async function readWarehouse(): Promise<{ records: EmployeeRecord[]; latestFeedDay: string | null }> {
  const [feed] = await read(FEED_DAY_SQL)
  const rows = await read(RECORDS_SQL)
  return {
    latestFeedDay: isoDay(feed?.[0]),
    records: rows.map((r) => ({
      employee_key: String(r[0]),
      employee_code: r[1] == null ? null : String(r[1]),
      payroll_active: bool(r[2]),
      movement_active: bool(r[3]),
      date_of_joining: isoDay(r[4]),
      exit_date: isoDay(r[5]),
    })),
  }
}

/** Nothing to check on an instance with no StyleHR identifier system. */
async function hasStyleHr(): Promise<boolean> {
  const [row] = await sql`select 1 from identifier_system where row_id in ('stylehr-employee-code', 'stylehr-employee-id') limit 1`
  return Boolean(row)
}

export async function planLeaverCheck(today = istToday()): Promise<LeaverPlan | null> {
  if (!(await hasStyleHr())) return null
  const people = await linkedPeople()
  const { records, latestFeedDay } = await readWarehouse()
  return planLeavers(people, records, latestFeedDay, today)
}

// ------------------------------------------------------------- acting

export interface LeaverRun {
  plan: LeaverPlan | null
  disabled: Leaver[]
  emailed: number
}

/** Disable one leaver: a normal row save as Administrator, so the change is
 *  versioned and every session the person holds ends with the flag. Re-read
 *  inside the transaction: someone may have re-enabled, disabled or promoted
 *  them since the plan was made. */
async function disableOne(l: Leaver): Promise<boolean> {
  return withTransaction(async () => {
    const [row] = await sql`
      select p.updated_at, p.enabled,
        (p.row_id = 'Administrator' or exists (
          select 1 from has_role r where r.parent = p.row_id and r.parenttype = 'Person'
            and r.role in ('System Manager', 'Administrator'))) as privileged
      from person p where p.row_id = ${l.person} for update`
    if (!row || !row.enabled || row.privileged) return false
    await saveDoc('Person', { row_id: l.person, updated_at: row.updated_at, enabled: false }, 'Administrator')
    await logActivity(ACTOR, `disabled_as_leaver for ${l.person}: ${l.reason}`.slice(0, 140))
    return true
  })
}

type Sender = (msg: MailMessage) => Promise<unknown>
let sender: Sender = queueEmail
/** Test seam: swap how the summary is handed to the transport. */
export function _setLeaverSummarySender(fn: Sender | null): void {
  sender = fn ?? queueEmail
}

const line = (l: Leaver) => `- ${l.full_name || l.person}: ${l.reason}`

export function summaryBody(plan: LeaverPlan, disabled: Leaver[]): string {
  const out = [`The daily leaver check ran on ${displayDate(plan.today)} against the StyleHR record in the warehouse (latest day ${plan.latest_feed_day ? displayDate(plan.latest_feed_day) : 'none'}).`, '']
  if (plan.refused) out.push(`It disabled nobody: ${plan.refused}.`, 'Check the warehouse feed. To act on a large but genuine batch, run the check by hand with the count it reports.', '')
  if (disabled.length) out.push(`Disabled ${disabled.length} of ${plan.linked} linked people:`, ...disabled.map(line), '')
  if (plan.privileged_leavers.length)
    out.push('Not disabled, because they are System Managers. Decide by hand:', ...plan.privileged_leavers.map(line), '')
  if (plan.not_found.length) out.push(`${plan.not_found.length} linked people have no StyleHR record in the warehouse; they were left as they are.`)
  out.push('', 'The check never re-enables anyone. To let someone back in, enable them on their Person page.')
  return out.join('\n')
}

async function sendSummary(plan: LeaverPlan, disabled: Leaver[]): Promise<number> {
  if (!plan.refused && !disabled.length && !plan.privileged_leavers.length) return 0
  const managers = await sql`
    select distinct lower(trim(p.email)) as email from person p
    join has_role r on r.parent = p.row_id and r.parenttype = 'Person' and r.role = 'System Manager'
    where p.enabled and p.replaced_by is null and coalesce(trim(p.email), '') <> ''
    order by 1`
  const body = summaryBody(plan, disabled)
  for (const m of managers) await sender({ to: String(m.email), subject: LEAVER_CHECK_SUBJECT, body })
  return managers.length
}

export interface RunOpts {
  today?: string
  /** A human's override of the limit: act only if the count is exactly this. */
  acceptCount?: number
}

/** Plan, then act on the plan unless it refuses. Idempotent: a disabled person
 *  is not linked any more, so a second run finds nothing to do. */
export async function runLeaverCheck(opts: RunOpts = {}): Promise<LeaverRun> {
  const plan = await planLeaverCheck(opts.today)
  if (!plan) return { plan: null, disabled: [], emailed: 0 }
  // The override lifts only the size limit, and only for the exact count the
  // operator saw; a stale or empty feed is never overridden.
  if (opts.acceptCount !== undefined && plan.refused && plan.refused.startsWith('it would disable') && plan.to_disable.length === opts.acceptCount)
    plan.refused = null
  const disabled: Leaver[] = []
  if (!plan.refused) for (const l of plan.to_disable) if (await disableOne(l)) disabled.push(l)
  if (plan.refused) await logActivity(ACTOR, `leaver_check_refused: ${plan.refused}`.slice(0, 140))
  const emailed = await sendSummary(plan, disabled)
  return { plan, disabled, emailed }
}

/** Counts and reasons only: no names, so it is safe for logs. */
export function formatLeaverPlan(plan: LeaverPlan | null, opts: { applied?: Leaver[] } = {}): string {
  if (!plan) return 'leaver check: this instance has no StyleHR identifier system; nothing to check'
  const verb = opts.applied ? 'disabled' : 'would disable'
  const n = opts.applied ? opts.applied.length : plan.to_disable.length
  const basis = (ls: Leaver[]) => {
    const c = new Map<string, number>()
    for (const l of ls) c.set(l.basis, (c.get(l.basis) ?? 0) + 1)
    return [...c].map(([b, k]) => `${b} ${k}`).join(', ') || 'none'
  }
  return [
    `leaver check: today ${displayDate(plan.today)}; latest StyleHR day ${plan.latest_feed_day ? displayDate(plan.latest_feed_day) : 'none'}`,
    `leaver check: ${plan.linked} linked people; limit ${plan.limit}`,
    plan.refused ? `leaver check: REFUSED — ${plan.refused}` : `leaver check: ${verb} ${n} (${basis(opts.applied ?? plan.to_disable)})`,
    `leaver check: System Managers who have left, not disabled: ${plan.privileged_leavers.length}`,
    `leaver check: no StyleHR record found: ${plan.not_found.length}; recent joiners not yet on payroll: ${plan.recent_joiners.length}`,
  ].join('\n')
}
