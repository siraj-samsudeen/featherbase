// #1286: the roster run keeps each row's status in step with the HR record,
// by the leaver check's own rule. Everyone here is made up; the warehouse is a
// stand-in, and the roster has its own Table, columns and status words, so the
// platform cannot lean on one client's.
import { afterEach, describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { rosterFrom } from '../src/delegated-login'
import { _setWarehouseReader, istToday } from '../src/leaver-check'
import { planRosterLink, runRosterLink, formatRosterLink, ROSTER_LINK_JOB } from '../src/roster-link'
import { applyRosterStatus, planRosterStatus, planStatusChanges } from '../src/roster-status'
import { getSignInMethod } from '../src/identities'
import { usableRoster } from '../src/roster-first-sign-in'
import { enqueue, loadJobs, runOneJob } from '../src/jobs'
import { main } from '../src/cli'
import { runMain } from './command-io'
import { makeTable } from './fixtures'
import { configureDelegated } from './identity-fixtures'

const TABLE = 'Crew List'
const ROSTER = {
  table: TABLE,
  sign_in_id_column: 'crew_no',
  record_number_column: 'hr_record',
  person_column: 'login',
  name_column: 'crew_name',
  status_column: 'crew_state',
  current_status: 'Working',
  left_status: 'Gone',
  provider_record_key: 'employee_id',
  identifiers: { 'stylehr-employee-code': 'crew_no' },
}
const PAST = '2020-03-01'
const FUTURE = '2999-01-01'

const crewRow = (n: number, over: Record<string, unknown> = {}) => ({
  crew_name: `Made Up Crew ${n}`,
  crew_no: `TT-${1000 + n}`,
  hr_record: String(7000 + n),
  crew_state: 'Working',
  ...over,
})

/** One warehouse record, in the column order the leaver check reads. */
type Feed = { key: string; payroll?: boolean | null; active?: boolean | null; joined?: string; exit?: string | null; present?: string | null }
const feedRow = (f: Feed) => [f.key, `C-${f.key}`, 'payroll' in f ? f.payroll : true, 'active' in f ? f.active : true, f.joined ?? '2015-01-01', f.exit ?? null]

function warehouse(records: Feed[], latestDay: string | null = istToday()) {
  const reads: string[] = []
  _setWarehouseReader(async (q) => {
    reads.push(q)
    return records.map((f) => [...feedRow(f), f.present ?? null, latestDay])
  })
  return reads
}

async function setUp(admin: TestClient, rows: Record<string, unknown>[], roster: Record<string, unknown> = ROSTER, stateChoices?: string) {
  await configureDelegated()
  await makeTable(admin, {
    name: TABLE,
    columns: [
      { column_name: 'crew_name', column_type: 'Data', reqd: true },
      { column_name: 'crew_no', column_type: 'Data' },
      { column_name: 'hr_record', column_type: 'Data' },
      stateChoices ? { column_name: 'crew_state', column_type: 'Choice', choices: stateChoices } : { column_name: 'crew_state', column_type: 'Data' },
      { column_name: 'login', column_type: 'Reference', reference_table: 'Person' },
    ],
  })
  await sql`update sign_in_method set new_person = 'create_if_on_roster', settings = ${sql.json({ provider_record_key: 'employee_id', roster })} where row_id = 'stylehr'`
  for (const row of rows) await saveDoc(TABLE, row, 'Administrator', 'insert')
}

const crew = async (no: string) => (await sql`select * from featherbase.crew_list where crew_no = ${no}`)[0]
const state = async (no: string) => String((await crew(no)).crew_state)
const states = async () =>
  Object.fromEntries((await sql`select crew_no, crew_state from featherbase.crew_list order by crew_no`).map((r) => [r.crew_no, r.crew_state]))
const liveLinks = async () =>
  (await sql`select subject from sign_in_identity where method = 'stylehr' and ended_at is null order by subject`).map((r) => String(r.subject))

/** Enough people at work, on the record, that a handful of changes stays under the limit. */
const steady = (n: number) => Array.from({ length: n }, (_, i) => crewRow(100 + i))
const steadyFeed = (n: number): Feed[] => Array.from({ length: n }, (_, i) => ({ key: String(7100 + i) }))

afterEach(() => {
  _setWarehouseReader(null)
  vi.restoreAllMocks()
})

describe('the roster’s status follows the HR record', () => {
  test('left by an exit date that has passed, or by being marked inactive; nothing else moves', async ({ admin }) => {
    await setUp(admin, [
      crewRow(1), // exit date passed
      crewRow(2), // marked inactive
      crewRow(3), // off the payroll only, long ago: an owner-director
      crewRow(4), // exit date still to come
      crewRow(5), // not in the feed at all
      crewRow(6, { crew_state: 'Test record' }), // another status, exit date passed
      crewRow(7, { hr_record: '' }), // no record number
    ])
    warehouse([
      { key: '7001', exit: PAST, active: false },
      { key: '7002', active: false },
      { key: '7003', payroll: false, joined: '2005-01-01' },
      { key: '7004', exit: FUTURE },
      { key: '7006', exit: PAST },
    ])

    const run = await runRosterLink('stylehr')

    expect(run.status).toMatchObject({ changed: 2, failed: [] })
    expect(await states()).toEqual({
      'TT-1001': 'Gone',
      'TT-1002': 'Gone',
      'TT-1003': 'Working',
      'TT-1004': 'Working',
      'TT-1005': 'Working',
      'TT-1006': 'Test record',
      'TT-1007': 'Working',
    })
    expect(run.status!.plan).toMatchObject({ covered: 4, not_in_feed: 2, refused: null })
  })

  test('a leaver who is active and paid again is current again; one still off the payroll stays left', async ({ admin }) => {
    await setUp(admin, [crewRow(1, { crew_state: 'Gone' }), crewRow(2, { crew_state: 'Gone' }), crewRow(3, { crew_state: 'Gone' }), crewRow(4, { crew_state: 'Gone' })])
    warehouse([
      { key: '7001' },
      { key: '7002', payroll: false, joined: '2005-01-01' },
      { key: '7003', payroll: false, joined: istToday() },
      { key: '7004', active: null },
    ])

    await runRosterLink('stylehr')

    expect(await states()).toEqual({ 'TT-1001': 'Working', 'TT-1002': 'Gone', 'TT-1003': 'Gone', 'TT-1004': 'Gone' })
  })

  test('a leaver’s link ends in the same run, and a rejoiner is linked in it', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2, { crew_state: 'Gone' })])
    warehouse([{ key: '7001' }, { key: '7002', payroll: false, joined: '2005-01-01' }])
    await runRosterLink('stylehr')
    expect(await liveLinks()).toEqual(['7001'])
    warehouse([{ key: '7001', exit: PAST }, { key: '7002' }])

    const run = await runRosterLink('stylehr')

    expect(run).toMatchObject({ ended: 1, created: 1 })
    expect(await liveLinks()).toEqual(['7002'])
    expect(await states()).toEqual({ 'TT-1001': 'Gone', 'TT-1002': 'Working' })
  })

  test('each change is the roster link’s own save, in the row’s Activity and the activity log', async ({ admin }) => {
    await setUp(admin, [crewRow(1)])
    warehouse([{ key: '7001', exit: PAST }])

    await runRosterLink('stylehr')

    const row = await crew('TT-1001')
    const activity = await admin.get<{ versions: { created_by: string; data: { changed: [string, unknown, unknown][] } }[] }>(
      `/api/activity/${encodeURIComponent(TABLE)}/${row.row_id}`,
    )
    const change = activity.versions.find((v) => v.data.changed.some(([field]) => field === 'crew_state'))!
    expect(change.created_by).toBe('roster-link')
    expect(change.data.changed).toContainEqual(['crew_state', 'Working', 'Gone'])
    expect(row.updated_by).toBe('roster-link')
    const [log] = await sql`select "user", operation from activity_log where operation like 'roster_status %'`
    expect(log).toEqual({ user: 'roster-link', operation: `roster_status ${TABLE} ${row.row_id} Working to Gone: exit date` })
  })

  test('someone attendance shows at work after their exit date, or this week when only marked inactive, is held', async ({ admin }) => {
    const today = istToday()
    const daysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)
    await setUp(admin, [crewRow(1), crewRow(2), crewRow(3), crewRow(4)])
    warehouse([
      { key: '7001', exit: PAST, present: daysAgo(1) }, // at work after the exit date: held
      { key: '7002', exit: PAST, present: PAST }, // last at work on the exit day: left
      { key: '7003', active: false, present: daysAgo(2) }, // inactive, at work this week: held
      { key: '7004', active: false, present: daysAgo(30) }, // inactive, not at work for a month: left
    ])

    const run = await runRosterLink('stylehr')

    expect(await states()).toEqual({ 'TT-1001': 'Working', 'TT-1002': 'Gone', 'TT-1003': 'Working', 'TT-1004': 'Gone' })
    expect(run.status!.plan!.held_at_work).toEqual([(await crew('TT-1001')).row_id, (await crew('TT-1003')).row_id].sort())
    expect(formatRosterLink(run.plan, run)).toContain('held 2 the rule calls left whom attendance shows at work since')
  })

  test('a second run changes nothing', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2, { crew_state: 'Gone' })])
    warehouse([{ key: '7001', exit: PAST }, { key: '7002' }])
    await runRosterLink('stylehr')
    const again = await runRosterLink('stylehr')
    expect(again.status).toMatchObject({ changed: 0 })
    expect(again.status!.plan!.changes).toEqual([])
  })

  test('a roster that names no left status is only read: the warehouse is not even asked', async ({ admin }) => {
    const { left_status: _, ...readOnly } = ROSTER
    await setUp(admin, [crewRow(1)], readOnly)
    const reads = warehouse([{ key: '7001', exit: PAST }])

    const run = await runRosterLink('stylehr')

    expect(run.status).toEqual({ plan: null, changed: 0, failed: [] })
    expect(reads).toEqual([])
    expect(await state('TT-1001')).toBe('Working')
    expect(formatRosterLink(run.plan, run)).not.toContain('roster status')
  })

  test('a left status the same as the current one is refused as a malformed roster', () => {
    expect(() => rosterFrom({ roster: { ...ROSTER, left_status: 'Working' } })).toThrow('left_status must differ from current_status')
    expect(rosterFrom({ roster: { ...ROSTER, left_status: null } })).not.toHaveProperty('left_status')
  })
})

describe('a bad feed or a big batch changes nothing', () => {
  test('a run that would change more than the limit changes none, says so, and still links', async ({ admin }) => {
    const rows = Array.from({ length: 11 }, (_, i) => crewRow(i + 1))
    await setUp(admin, rows)
    warehouse(rows.map((r) => ({ key: String(r.hr_record), exit: PAST })))

    const run = await runRosterLink('stylehr')

    expect(run.status!.plan!.refused).toBe('it would change the status of 11 of 11 Working rows to Gone, more than the limit of 10')
    expect(run.status!.changed).toBe(0)
    expect(Object.values(await states())).toEqual(Array(11).fill('Working'))
    expect(run.created).toBe(11)
    const [log] = await sql`select operation from activity_log where operation like 'roster_status_refused %'`
    expect(String(log.operation)).toContain('it would change the status of 11 of 11 Working rows to Gone')
  })

  test('the limit is one in twenty of the rows on the record, when that is more than ten', async ({ admin }) => {
    await setUp(admin, [...steady(240), crewRow(1)])
    warehouse([...steadyFeed(240), { key: '7001', exit: PAST }])
    const plan = (await planRosterLink('stylehr'))!.status!
    expect(plan).toMatchObject({ covered: 241, limit: 13, refused: null })
    expect(plan.changes).toEqual([{ row_id: expect.any(String), record: '7001', from: 'Working', to: 'Gone', basis: 'exit date' }])
  })

  test('many old leavers never widen the allowance for marking current staff as left', async ({ admin }) => {
    const gone = Array.from({ length: 400 }, (_, i) => crewRow(200 + i, { crew_state: 'Gone' }))
    const working = Array.from({ length: 11 }, (_, i) => crewRow(i + 1))
    await setUp(admin, [...gone, ...working])
    warehouse([...gone.map((r) => ({ key: String(r.hr_record), exit: PAST })), ...working.map((r) => ({ key: String(r.hr_record), active: false }))])
    const plan = (await planRosterLink('stylehr'))!.status!
    expect(plan).toMatchObject({ covered: 411, covered_current: 11, covered_left: 400, limit: 10, back_limit: 20 })
    expect(plan.refused).toBe('it would change the status of 11 of 11 Working rows to Gone, more than the limit of 10')
  })

  test('bringing back more left rows than their own limit is refused too', async ({ admin }) => {
    const gone = Array.from({ length: 11 }, (_, i) => crewRow(i + 1, { crew_state: 'Gone' }))
    await setUp(admin, [...steady(300), ...gone])
    warehouse([...steadyFeed(300), ...gone.map((r) => ({ key: String(r.hr_record) }))])
    const plan = (await planRosterLink('stylehr'))!.status!
    expect(plan.refused).toBe('it would change the status of 11 of 11 Gone rows to Working, more than the limit of 10')
  })

  test('a person may lift the limit for exactly the count the dry run showed, never another', async ({ admin }) => {
    const rows = Array.from({ length: 11 }, (_, i) => crewRow(i + 1))
    await setUp(admin, rows)
    warehouse(rows.map((r) => ({ key: String(r.hr_record), exit: PAST })))

    const wrong = await runRosterLink('stylehr', { acceptStatus: 12 })
    expect(wrong.status!.plan!.refused).toBe('it would change the status of 11 of 11 Working rows to Gone, more than the limit of 10')
    expect(wrong.status!.changed).toBe(0)

    const right = await runRosterLink('stylehr', { acceptStatus: 11 })
    expect(right.status!.changed).toBe(11)
    expect(Object.values(await states())).toEqual(Array(11).fill('Gone'))
  })

  test('an accepted count that no longer matches refuses even under the limit', async ({ admin }) => {
    await setUp(admin, [crewRow(1)])
    warehouse([{ key: '7001', exit: PAST }])
    const run = await runRosterLink('stylehr', { acceptStatus: 3 })
    expect(run.status!.plan!.refused).toBe('it would change 1 statuses, not the 3 accepted')
    expect(await state('TT-1001')).toBe('Working')
  })

  test('a stale feed, an empty feed, or no warehouse changes nobody, and the linking still runs', async ({ admin }) => {
    await setUp(admin, [crewRow(1)])
    warehouse([{ key: '7001', exit: PAST }], '2020-01-01')
    let run = await runRosterLink('stylehr')
    expect(run.status!.plan!.refused).toContain('stale')
    expect(run.created).toBe(1)

    warehouse([])
    run = await runRosterLink('stylehr')
    expect(run.status!.plan!.refused).toContain('latest day none')

    _setWarehouseReader(async () => {
      throw new Error('warehouse down')
    })
    run = await runRosterLink('stylehr')
    expect(run.status!.plan!.refused).toBe('the warehouse could not be read: warehouse down')
    expect(await state('TT-1001')).toBe('Working')
  })

  test('the records, each one’s last day at work and the feed day come from one read, so one snapshot', async ({ admin }) => {
    await setUp(admin, [crewRow(1)])
    const reads = warehouse([{ key: '7001', exit: PAST, present: istToday() }])
    const run = await runRosterLink('stylehr')
    expect(reads).toHaveLength(1)
    expect(run.status!.plan!.held_at_work).toHaveLength(1)
  })

  test('a feed day after today is a misdated row, and changes nobody', async ({ admin }) => {
    await setUp(admin, [crewRow(1)])
    const ahead = new Date(Date.parse(`${istToday()}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10)
    warehouse([{ key: '7001', active: false, present: istToday() }], ahead)
    const run = await runRosterLink('stylehr')
    expect(run.status!.plan!.refused).toMatch(/^the warehouse's latest StyleHR day .* is after today/)
    expect(await state('TT-1001')).toBe('Working')
  })

  test('a saved plan is decided again from today’s feed: an exit corrected since changes nobody, and the row is still linked', async ({ admin }) => {
    await setUp(admin, [crewRow(1)])
    warehouse([{ key: '7001', exit: PAST }])
    const plan = (await planRosterLink('stylehr'))!
    expect(plan.status!.changes).toHaveLength(1)
    expect(plan.rows).toEqual([])
    warehouse([{ key: '7001' }])

    const run = await runRosterLink('stylehr', { plan })

    expect(run.status!.changed).toBe(0)
    expect(await state('TT-1001')).toBe('Working')
    expect(run.created).toBe(1)
    expect(await liveLinks()).toEqual(['7001'])
  })

  test('a roster whose record numbers are not the feed’s keys changes nobody', async ({ admin }) => {
    await setUp(admin, [crewRow(1)])
    await sql`update sign_in_method set identifier_system = 'stylehr-employee-code' where row_id = 'stylehr'`
    const reads = warehouse([{ key: '7001', exit: PAST }])
    const plan = (await planRosterLink('stylehr'))!.status!
    expect(plan.refused).toBe("its record numbers are stylehr-employee-code, not the feed's stylehr-employee-id")
    expect(reads).toEqual([])
  })

  test('a dry run counts the links the status changes will end and make, and applying it does both', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2, { crew_state: 'Gone' })])
    warehouse([{ key: '7001' }, { key: '7002', payroll: false, joined: '2005-01-01' }])
    await runRosterLink('stylehr')
    warehouse([{ key: '7001', exit: PAST }, { key: '7002' }])

    const plan = (await planRosterLink('stylehr'))!
    expect(plan.ends.map((e) => e.record)).toEqual(['7001'])
    expect(plan.rows.map((r) => [r.record, r.action])).toEqual([['7002', 'create']])
    expect(await states()).toEqual({ 'TT-1001': 'Working', 'TT-1002': 'Gone' })

    const run = await runRosterLink('stylehr', { plan })
    expect(run).toMatchObject({ ended: 1, created: 1 })
    expect(await liveLinks()).toEqual(['7002'])
  })

  test('a dry run whose status changes are refused plans links as the statuses stand', async ({ admin }) => {
    const rows = Array.from({ length: 11 }, (_, i) => crewRow(i + 1))
    await setUp(admin, rows)
    warehouse(rows.map((r) => ({ key: String(r.hr_record) })))
    await runRosterLink('stylehr')
    warehouse(rows.map((r) => ({ key: String(r.hr_record), exit: PAST })))
    const plan = (await planRosterLink('stylehr'))!
    expect(plan.status!.refused).toContain('more than the limit')
    expect(plan.ends).toEqual([])
  })

  test('a refused dry run applied with its accepted count links and ends on the new statuses', async ({ admin }) => {
    const rows = Array.from({ length: 11 }, (_, i) => crewRow(i + 1))
    await setUp(admin, rows)
    warehouse(rows.map((r) => ({ key: String(r.hr_record) })))
    await runRosterLink('stylehr')
    warehouse(rows.map((r) => ({ key: String(r.hr_record), exit: PAST })))
    const plan = (await planRosterLink('stylehr'))!
    expect(plan.status!.refused).toContain('more than the limit')

    const run = await runRosterLink('stylehr', { plan, acceptStatus: 11, acceptEnds: 11 })

    expect(run).toMatchObject({ refused: null, ended: 11 })
    expect(await liveLinks()).toEqual([])
  })

  test('a row changed by someone after the plan is left as they made it', async ({ admin }) => {
    await setUp(admin, [crewRow(1)])
    warehouse([{ key: '7001', exit: PAST }])
    const plan = (await planRosterLink('stylehr'))!
    const row = await crew('TT-1001')
    await saveDoc(TABLE, { row_id: row.row_id, updated_at: row.updated_at, crew_state: 'Test record' }, 'Administrator')

    const run = await runRosterLink('stylehr', { plan })

    expect(run.status!.changed).toBe(0)
    expect(await state('TT-1001')).toBe('Test record')
  })

  test('a row whose HR record number was corrected after the plan is not changed on the old record’s say', async ({ admin }) => {
    await setUp(admin, [crewRow(1)])
    warehouse([{ key: '7001', exit: PAST }, { key: '7099' }])
    const plan = (await planRosterLink('stylehr'))!
    const row = await crew('TT-1001')
    await saveDoc(TABLE, { row_id: row.row_id, updated_at: row.updated_at, hr_record: '7099' }, 'Administrator')

    const run = await runRosterLink('stylehr', { plan })

    expect(run.status!.changed).toBe(0)
    expect(await state('TT-1001')).toBe('Working')
  })

  test('a row changed between the plan and its save, under the row’s lock, is left as it was made', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2)])
    warehouse([{ key: '7001', exit: PAST }, { key: '7002', exit: PAST }])
    const roster = (await usableRoster((await getSignInMethod('stylehr'))!))!
    const plan = await planRosterStatus(roster)
    const one = await crew('TT-1001')
    await saveDoc(TABLE, { row_id: one.row_id, updated_at: one.updated_at, crew_state: 'Test record' }, 'Administrator')
    const two = await crew('TT-1002')
    await saveDoc(TABLE, { row_id: two.row_id, updated_at: two.updated_at, hr_record: '7099' }, 'Administrator')

    const run = await applyRosterStatus(roster, plan)

    expect(run).toMatchObject({ changed: 0, failed: [] })
    expect(await states()).toEqual({ 'TT-1001': 'Test record', 'TT-1002': 'Working' })
  })

  test('a status the Table will not take fails that row only, and the run names it', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2)], ROSTER, 'Working\nTest record')
    warehouse([{ key: '7001', exit: PAST }, { key: '7002' }])

    const run = await runRosterLink('stylehr')

    expect(run.status!.failed).toHaveLength(1)
    expect(run.failed[0]).toMatch(new RegExp(`^${(await crew('TT-1001')).row_id}: `))
    expect(run.created).toBe(2)
  })
})

describe('the pure plan', () => {
  const S = { current: 'Working', left: 'Gone' }
  const rec = (key: string, over: Record<string, unknown> = {}) => ({
    employee_key: key, employee_code: `C-${key}`, payroll_active: true, movement_active: true, date_of_joining: '2015-01-01', exit_date: null, ...over,
  })
  test('the same rule as the leaver check: an off-payroll director is never a leaver', () => {
    const plan = planStatusChanges('T', [{ row_id: 'r1', record: '1', status: 'Working' }, { row_id: 'r2', record: '1', status: 'Test record' }], [rec('1', { payroll_active: false, date_of_joining: '2001-01-01' })], '2026-11-18', S, '2026-11-18')
    expect(plan.changes).toEqual([])
    expect(plan.covered).toBe(1)
  })
})

describe('where a person sees it', () => {
  const runJob = async () => {
    await loadJobs()
    await sql`delete from background_job`
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const job = await enqueue(ROSTER_LINK_JOB, {})
    await sql`update background_job set run_at = now() where row_id = ${job}`
    await runOneJob()
    const [exec] = await sql`select outcome, result from job_execution where job = ${job} order by created_at desc limit 1`
    return exec as { outcome: string; result: string | null }
  }

  test('the job reports the changes, and refuses when the batch is too big', async ({ admin }) => {
    const rows = Array.from({ length: 11 }, (_, i) => crewRow(i + 1))
    await setUp(admin, rows)
    warehouse([{ key: '7001', exit: PAST }])
    let exec = await runJob()
    expect(exec.outcome).toBe('success')
    expect(exec.result).toContain('changed 1')

    warehouse(rows.map((r) => ({ key: String(r.hr_record), exit: PAST })))
    await saveDoc(TABLE, { row_id: (await crew('TT-1001')).row_id, updated_at: (await crew('TT-1001')).updated_at, crew_state: 'Working' }, 'Administrator')
    exec = await runJob()
    expect(exec.outcome).toBe('refused')
    expect(exec.result).toContain('changed no statuses: it would change the status of 11 of 11 Working rows to Gone')
  })

  test('the dry run counts by reason; the CLI lifts a limit only on --apply, with a count', async ({ admin }) => {
    const rows = Array.from({ length: 11 }, (_, i) => crewRow(i + 1))
    await setUp(admin, [...rows, crewRow(20, { crew_state: 'Gone' })])
    warehouse([...rows.map((r) => ({ key: String(r.hr_record), exit: PAST, active: r.hr_record === '7002' ? true : false })), { key: '7020' }])

    const dry = await runMain(main, ['roster:link', 'stylehr'])
    expect(dry.stdout).toContain(`roster status ${TABLE}: 12 rows on the StyleHR record (11 current, 1 left), 0 not on it (left alone); limits 10 to left, 10 back`)
    expect(dry.stdout).toContain(`roster status ${TABLE}: would mark 11 as left (exit date 11, inactive 0) and 1 as current again`)
    expect(dry.stdout).toContain('CHANGED NONE')

    expect((await runMain(main, ['roster:link', 'stylehr', '--accept-status', '12'])).code).toBe(1)
    expect((await runMain(main, ['roster:link', 'stylehr', '--apply', '--accept-status'])).code).toBe(1)
    expect((await runMain(main, ['roster:link', 'stylehr', '--apply', '--accept-ends', '0'])).code).toBe(1)
    const applied = await runMain(main, ['roster:link', 'stylehr', '--apply', '--accept-status', '12'])
    expect(applied.stdout).toContain(`roster status ${TABLE}: changed 12`)
    expect(await state('TT-1020')).toBe('Working')
  })

  test('ending more links than the limit can be accepted for exactly that count', async ({ admin }) => {
    const rows = Array.from({ length: 11 }, (_, i) => crewRow(i + 1))
    await setUp(admin, rows)
    warehouse(rows.map((r) => ({ key: String(r.hr_record) })))
    await runRosterLink('stylehr')
    expect(await liveLinks()).toHaveLength(11)
    warehouse(rows.map((r) => ({ key: String(r.hr_record), exit: PAST })))
    await runRosterLink('stylehr', { acceptStatus: 11 })
    // The statuses changed; ending eleven links is over its own limit.
    expect(await liveLinks()).toHaveLength(11)

    const wrong = await runRosterLink('stylehr', { acceptEnds: 5 })
    expect(wrong.refused).toBe('it would end 11 of 11 live links, more than the limit of 10')
    const right = await runRosterLink('stylehr', { acceptEnds: 11 })
    expect(right).toMatchObject({ refused: null, ended: 11 })
    expect(await liveLinks()).toEqual([])
  })
})
