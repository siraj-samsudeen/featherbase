// The roster's status follows the HR record (#1286). A roster is loaded once
// and nothing else writes its status, so someone who left long ago still shows
// as current. When the method's roster names a `left_status`, each roster run
// first moves rows between the current and left statuses by the leaver check's
// own rule (leaver-check.ts `recordVerdict`), read from the same warehouse feed:
//
// - Current → left only when the rule says the record has left: an exit date
//   that has passed, or marked inactive. Being off the payroll alone never is.
// - Left → current when the record is plainly current: no exit date passed,
//   active, and on the payroll. A left this job set itself (its own save is
//   the row's latest status change) goes back as soon as the rule no longer
//   says left, on the payroll or not, so a wrong feed it acted on is undone.
// - A row whose record is not in the feed, or in any other status, is never
//   touched. A stale or empty feed changes nothing.
// - Someone attendance shows at work after their exit date, or in the week
//   before the feed's latest day when only marked inactive, is held, not
//   marked left: the shared rule says they have not left (`atWork`).
// - A run that would change more than the limit changes none and says so.
// - Each change is a normal save by the roster link, so it shows in the row's
//   Activity and can be undone there.
import { sql, withTransaction } from './db'
import { logActivity } from './audit'
import { saveDoc } from './document'
import { runAsSystemActor } from './system-actor'
import { ROSTER_LINK_ACTOR } from './roster-link-actor'
import { FEED_RECORD_SYSTEM, feedRefusal, istToday, readWarehouse, recordVerdict, type EmployeeRecord } from './leaver-check'
import type { Roster } from './roster-first-sign-in'
import { errorMessage } from './errors'

const ACTOR = ROSTER_LINK_ACTOR
/** A run may move at most this share of the covered rows in a status out of
 *  it (each direction on its own, so many old leavers never widen the allowance
 *  for marking current staff as left)... */
const MAX_CHANGE_SHARE = 0.05
/** ...or this many, whichever is more. */
const MIN_CHANGE_LIMIT = 10

export interface StatusChange {
  row_id: string
  /** The HR record the decision was made on: rechecked under the row's lock. */
  record: string
  from: string
  to: string
  /** Why, in words safe for a log: no name, code or value. */
  basis: 'exit date' | 'inactive' | 'current again' | 'set left by this job'
}

export interface RosterStatusPlan {
  table: string
  today: string
  latest_feed_day: string | null
  /** Rows in the current or left status whose record the feed has. */
  covered: number
  /** Of those, in the current status; their changes are held to `limit`. */
  covered_current: number
  /** Of those, in the left status; their changes are held to `back_limit`. */
  covered_left: number
  /** Rows in those statuses whose record the feed does not have: left alone. */
  not_in_feed: number
  /** Current rows the rule says have left, held because attendance shows them at work since. */
  held_at_work: string[]
  changes: StatusChange[]
  limit: number
  back_limit: number
  refused: string | null
}

export interface RosterStatusRun {
  plan: RosterStatusPlan | null
  changed: number
  failed: string[]
}

/** One roster row, as far as its status goes. */
export interface StatusRow {
  row_id: string
  record: string
  status: string
  /** In the left status, and the row's latest status change was this job's
   *  own save to it (from the row's history; false where none is kept). */
  own_left?: boolean
}

interface Statuses {
  current: string
  left: string
}

/** What the rule says this record's row should be: a change, 'held', or null to leave it. */
function wanted(r: EmployeeRecord, row: StatusRow, s: Statuses, today: string, feedDay: string): StatusChange | 'held' | null {
  const v = recordVerdict(r, today, feedDay)
  if (row.status === s.current && v.leaver) return { row_id: row.row_id, record: row.record, from: s.current, to: s.left, basis: v.basis }
  if (row.status === s.current && !v.leaver && v.atWork) return 'held'
  if (row.status !== s.left || v.leaver || v.atWork) return null
  // Back on plain evidence: a rejoiner is active and paid again. Off the payroll
  // (an owner-director, a joiner not yet paid) is no evidence either way, except
  // to undo a left this job set itself on evidence that has since gone.
  if ((r.movement_active === true && r.payroll_active === true) || row.own_left)
    return { row_id: row.row_id, record: row.record, from: s.left, to: s.current, basis: row.own_left ? 'set left by this job' : 'current again' }
  return null
}

/** Pure: which rows change, and whether the run must refuse. */
export function planStatusChanges(
  table: string,
  rows: StatusRow[],
  records: EmployeeRecord[],
  latestFeedDay: string | null,
  s: Statuses,
  today: string,
): RosterStatusPlan {
  const byKey = new Map(records.map((r) => [String(r.employee_key).trim(), r]))
  const plan: RosterStatusPlan = { ...emptyPlan(table, today, null), latest_feed_day: latestFeedDay }
  plan.refused = feedRefusal(records, latestFeedDay, today)
  if (plan.refused) return plan
  for (const row of rows) {
    if (row.status !== s.current && row.status !== s.left) continue
    const r = row.record ? byKey.get(row.record) : undefined
    if (!r) {
      plan.not_in_feed++
      continue
    }
    plan.covered++
    if (row.status === s.current) plan.covered_current++
    else plan.covered_left++
    const change = wanted(r, row, s, today, latestFeedDay!)
    if (change === 'held') plan.held_at_work.push(row.row_id)
    else if (change) plan.changes.push(change)
  }
  const limitOf = (n: number) => Math.max(MIN_CHANGE_LIMIT, Math.ceil(n * MAX_CHANGE_SHARE))
  plan.limit = limitOf(plan.covered_current)
  plan.back_limit = limitOf(plan.covered_left)
  const leaving = plan.changes.filter((c) => c.to === s.left).length
  const back = plan.changes.length - leaving
  if (leaving > plan.limit)
    plan.refused = `it would change the status of ${leaving} of ${plan.covered_current} ${s.current} rows to ${s.left}, more than the limit of ${plan.limit}`
  else if (back > plan.back_limit)
    plan.refused = `it would change the status of ${back} of ${plan.covered_left} ${s.left} rows to ${s.current}, more than the limit of ${plan.back_limit}`
  return plan
}

function emptyPlan(table: string, today: string, refused: string | null): RosterStatusPlan {
  return { table, today, latest_feed_day: null, covered: 0, covered_current: 0, covered_left: 0, not_in_feed: 0, held_at_work: [], changes: [], limit: MIN_CHANGE_LIMIT, back_limit: MIN_CHANGE_LIMIT, refused }
}

const statusesOf = (roster: Roster): Statuses | null =>
  roster.link.left_status ? { current: roster.link.current_status, left: roster.link.left_status } : null

async function statusRows(roster: Roster, s: Statuses, rowId?: string): Promise<(StatusRow & { updated_at: unknown })[]> {
  const { link, relation } = roster
  const status = sql`trim(r.${sql(link.status_column)}::text)`
  const rows = await sql`
    select r.row_id, r.updated_at, trim(r.${sql(link.record_number_column)}::text) as record, ${status} as status,
      ${status} = ${s.left} and coalesce((
        select v.created_by = ${ACTOR} and c->>2 = ${s.left}
        from version v, jsonb_array_elements(coalesce(v.data->'changed', '[]'::jsonb)) c
        where v.ref_table = ${link.table} and v.ref_name = r.row_id and c->>0 = ${link.status_column}
        order by v.created_at desc, v.row_id desc limit 1), false) as own_left
    from ${sql(relation)} r
    where r.retired_at is null and ${status} in (${s.current}, ${s.left})
      ${rowId ? sql`and r.row_id = ${rowId}` : sql``}
    order by r.row_id
    ${rowId ? sql`for update of r` : sql``}`
  return rows.map((r) => ({ row_id: String(r.row_id), updated_at: r.updated_at, record: String(r.record ?? ''), status: String(r.status), own_left: r.own_left === true }))
}

/** What the sync would change, changing nothing. Null when the roster names no
 *  left status: then its status is only ever read. */
export async function planRosterStatus(roster: Roster, today = istToday()): Promise<RosterStatusPlan | null> {
  const s = statusesOf(roster)
  if (!s) return null
  const empty = (refused: string) => emptyPlan(roster.link.table, today, refused)
  // The feed is keyed by this system's values; any other record number would match the wrong people.
  if (roster.recordSystem !== FEED_RECORD_SYSTEM) return empty(`its record numbers are ${roster.recordSystem}, not the feed's ${FEED_RECORD_SYSTEM}`)
  let feed
  try {
    feed = await readWarehouse()
  } catch (err) {
    return empty(`the warehouse could not be read: ${errorMessage(err)}`)
  }
  return planStatusChanges(roster.link.table, await statusRows(roster, s), feed.records, feed.latestFeedDay, s, today)
}

/** One row, under its lock: changed only if it still holds the status and
 *  the HR record the decision was made on. */
async function changeOne(roster: Roster, s: Statuses, c: StatusChange): Promise<boolean> {
  return withTransaction(async () => {
    const [row] = await statusRows(roster, s, c.row_id)
    if (!row || row.status !== c.from || row.record !== c.record) return false
    // Someone changed its status since this job set it: theirs now, not this job's to undo.
    if (c.basis === 'set left by this job' && !row.own_left) return false
    await runAsSystemActor(ACTOR, () => saveDoc(roster.link.table, { row_id: row.row_id, updated_at: row.updated_at, [roster.link.status_column]: c.to }, ACTOR))
    return true
  })
}

/** Act on a plan unless it refuses. `acceptCount` is a person's override of the
 *  limit for exactly the count a dry run showed; it never lifts a bad feed. */
export async function applyRosterStatus(roster: Roster, plan: RosterStatusPlan | null, opts: { acceptCount?: number } = {}): Promise<RosterStatusRun> {
  const run: RosterStatusRun = { plan, changed: 0, failed: [] }
  const s = statusesOf(roster)
  if (!plan || !s) return run
  if (opts.acceptCount !== undefined) {
    if (plan.changes.length !== opts.acceptCount) plan.refused ??= `it would change ${plan.changes.length} statuses, not the ${opts.acceptCount} accepted`
    else if (plan.refused?.startsWith('it would change the status')) plan.refused = null
  }
  if (plan.refused) {
    await logActivity('system', `roster_status_refused ${plan.table}: ${plan.refused}`.slice(0, 140))
    return run
  }
  for (const c of plan.changes)
    try {
      if (await changeOne(roster, s, c)) {
        run.changed++
        await logActivity(ACTOR, `roster_status ${plan.table} ${c.row_id} ${c.from} to ${c.to}: ${c.basis}`.slice(0, 140))
      }
    } catch (err) {
      run.failed.push(`${c.row_id}: ${errorMessage(err)}`)
    }
  return run
}

/** Counts and reasons only: safe for logs. */
export function formatRosterStatus(plan: RosterStatusPlan | null, run?: RosterStatusRun): string[] {
  if (!plan) return []
  const back = (c: StatusChange) => c.basis === 'current again' || c.basis === 'set left by this job'
  const n = (to: 'left' | 'back') => plan.changes.filter((c) => (to === 'back') === back(c)).length
  const by = (basis: StatusChange['basis']) => plan.changes.filter((c) => c.basis === basis).length
  const lines = [
    `roster status ${plan.table}: ${plan.covered} rows on the StyleHR record (${plan.covered_current} current, ${plan.covered_left} left), ${plan.not_in_feed} not on it (left alone); limits ${plan.limit} to left, ${plan.back_limit} back`,
    run
      ? `roster status ${plan.table}: changed ${run.changed}${run.failed.length ? `; FAILED ${run.failed.length}` : ''}`
      : `roster status ${plan.table}: would mark ${n('left')} as left (exit date ${by('exit date')}, inactive ${by('inactive')}) and ${n('back')} as current again`,
  ]
  if (plan.held_at_work.length) lines.push(`roster status ${plan.table}: held ${plan.held_at_work.length} the rule calls left whom attendance shows at work since; not changed`)
  if (plan.refused) lines.push(`roster status ${plan.table}: CHANGED NONE — ${plan.refused}`)
  return lines
}
