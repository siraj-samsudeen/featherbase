// #1297: the roster run adds new joiners, with their primary job, from the HR
// feed the status sync reads. Everyone here is made up; the warehouse is a
// stand-in, and every Table, column and job title is the test's own, so the
// platform cannot lean on one client's.
import { afterEach, describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { _setWarehouseReader, istToday } from '../src/leaver-check'
import { formatRosterLink, planRosterLink, runRosterLink, ROSTER_LINK_JOB } from '../src/roster-link'
import { fill, joinerSettings } from '../src/roster-joiners'
import { enqueue, loadJobs, runOneJob } from '../src/jobs'
import { main } from '../src/cli'
import { runMain } from './command-io'
import { makeTable } from './fixtures'
import { configureDelegated } from './identity-fixtures'

const TABLE = 'Crew List'
const JOB = {
  table: 'Crew Job',
  id_column: 'job_ref',
  id: '{code}-{site}-1',
  employee_column: 'crew',
  site_column: 'place',
  job_column: 'role',
  jobs: { 'shift lead': 'Lead', 'deck boss': 'Boss' },
  default_job: 'Hand',
  off_store_job: 'Office hand',
  site_of_store: { table: 'Crew Depot', site_column: 'place' },
  store_site: { table: 'Crew Place', column: 'place_kind', value: 'Shop' },
  designation_column: 'title',
  designation: { table: 'Crew Title', spellings_column: 'spellings' },
  section_column: 'corner',
  section: { table: 'Crew Corner', site_column: 'place', name_column: 'corner_name' },
  section_jobs: ['Hand', 'Lead'],
  reports_to_column: 'boss',
  manager_column: 'crew_no',
  values: { kind: 'Main', share: 100, joined: '{date_of_joining}', origin: 'joiner {employee_key}' },
}
const JOINERS = { code_column: 'crew_code', code: '{region}-{employee_code}', values: { origin: 'hr {employee_key}' }, job: JOB }
const ROSTER = {
  table: TABLE,
  sign_in_id_column: 'crew_no',
  record_number_column: 'hr_record',
  person_column: 'login',
  name_column: 'crew_name',
  status_column: 'crew_state',
  current_status: 'Working',
  left_status: 'Gone',
  joiners: JOINERS,
  provider_record_key: 'employee_id',
  identifiers: { 'stylehr-employee-code': 'crew_no' },
}
const PAST = '2020-03-01'
const today = () => istToday()
const daysAgo = (n: number) => new Date(Date.parse(`${today()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)

/** One HR record. A joiner by default: active, on the payroll, posted at depot 9001. */
type Feed = {
  key: string
  code?: string | null
  name?: string | null
  region?: string
  payroll?: boolean | null
  active?: boolean | null
  joined?: string
  exit?: string | null
  present?: string | null
  title?: string | null
  depot?: string | null
  manager?: string | null
  corner?: string | null
}
const feedRow = (f: Feed, day: string) => [
  f.key, 'code' in f ? f.code : `TT-${f.key}`, 'payroll' in f ? f.payroll : true, 'active' in f ? f.active : true, f.joined ?? daysAgo(5),
  f.exit ?? null, f.present ?? null, day, 'name' in f ? f.name : `Made Up Joiner ${f.key}`, f.region ?? 'ZZ', 'title' in f ? f.title : 'Packer',
  'depot' in f ? f.depot : '9001', f.manager ?? null, f.corner ?? null,
]
function warehouse(records: Feed[], day: string = today()) {
  const reads: string[] = []
  _setWarehouseReader(async (q) => {
    reads.push(q)
    return records.length ? records.map((f) => feedRow(f, day)) : [[null, null, null, null, null, null, null, day]]
  })
  return reads
}

async function setUp(admin: TestClient, existing: Record<string, unknown>[] = [], roster: Record<string, unknown> = ROSTER) {
  await configureDelegated()
  await makeTable(admin, { name: 'Crew Place', columns: [{ column_name: 'place_kind', column_type: 'Data' }] })
  await makeTable(admin, { name: 'Crew Depot', columns: [{ column_name: 'place', column_type: 'Reference', reference_table: 'Crew Place' }] })
  await makeTable(admin, { name: 'Crew Title', id_pattern: 'field:title_name', columns: [{ column_name: 'title_name', column_type: 'Data' }, { column_name: 'spellings', column_type: 'Text' }] })
  await makeTable(admin, {
    name: 'Crew Corner', id_pattern: 'field:corner_code',
    columns: [{ column_name: 'corner_code', column_type: 'Data' }, { column_name: 'corner_name', column_type: 'Data' }, { column_name: 'place', column_type: 'Reference', reference_table: 'Crew Place' }],
  })
  await makeTable(admin, {
    name: TABLE, id_pattern: 'field:crew_code',
    columns: [
      { column_name: 'crew_code', column_type: 'Data' },
      { column_name: 'crew_name', column_type: 'Data', reqd: true },
      { column_name: 'crew_no', column_type: 'Data' },
      { column_name: 'hr_record', column_type: 'Data' },
      { column_name: 'crew_state', column_type: 'Data' },
      { column_name: 'origin', column_type: 'Data' },
      { column_name: 'login', column_type: 'Reference', reference_table: 'Person' },
    ],
  })
  await makeTable(admin, {
    name: 'Crew Job', id_pattern: 'field:job_ref',
    columns: [
      { column_name: 'job_ref', column_type: 'Data' },
      { column_name: 'crew', column_type: 'Reference', reference_table: TABLE, reqd: true },
      { column_name: 'place', column_type: 'Reference', reference_table: 'Crew Place', reqd: true },
      { column_name: 'role', column_type: 'Data', reqd: true },
      { column_name: 'title', column_type: 'Reference', reference_table: 'Crew Title' },
      { column_name: 'corner', column_type: 'Reference', reference_table: 'Crew Corner' },
      { column_name: 'boss', column_type: 'Reference', reference_table: TABLE },
      { column_name: 'kind', column_type: 'Data' },
      { column_name: 'share', column_type: 'Float' },
      { column_name: 'joined', column_type: 'Date' },
      { column_name: 'origin', column_type: 'Data' },
    ],
  })
  await saveDoc('Crew Place', { row_id: 'SHOP1', place_kind: 'Shop' }, 'Administrator', 'insert')
  await saveDoc('Crew Place', { row_id: 'DEPOT1', place_kind: 'Depot' }, 'Administrator', 'insert')
  await saveDoc('Crew Depot', { row_id: '9001', place: 'SHOP1' }, 'Administrator', 'insert')
  await saveDoc('Crew Depot', { row_id: '9002', place: 'DEPOT1' }, 'Administrator', 'insert')
  await saveDoc('Crew Title', { title_name: 'Packer', spellings: 'PACKER; Packer' }, 'Administrator', 'insert')
  await saveDoc('Crew Title', { title_name: 'Shift lead', spellings: 'SHIFT LEAD' }, 'Administrator', 'insert')
  await saveDoc('Crew Corner', { corner_code: 'SHOP1-TOYS', corner_name: 'Toys', place: 'SHOP1' }, 'Administrator', 'insert')
  await saveDoc('Crew Corner', { corner_code: 'SHOP1-GF-SHOES', corner_name: 'Shoes', place: 'SHOP1' }, 'Administrator', 'insert')
  await saveDoc('Crew Corner', { corner_code: 'SHOP1-1F-SHOES', corner_name: 'Shoes', place: 'SHOP1' }, 'Administrator', 'insert')
  await sql`update sign_in_method set new_person = 'create_if_on_roster', settings = ${sql.json({ provider_record_key: 'employee_id', roster })} where row_id = 'stylehr'`
  for (const row of existing) await saveDoc(TABLE, row, 'Administrator', 'insert')
}

const crewRow = (n: number, over: Record<string, unknown> = {}) => ({
  crew_code: `ZZ-TT-${7000 + n}`, crew_name: `Made Up Crew ${n}`, crew_no: `TT-${7000 + n}`, hr_record: String(7000 + n), crew_state: 'Working', ...over,
})
const crew = async (code: string) => (await sql`select * from featherbase.crew_list where crew_code = ${code}`)[0]
const jobsOf = async (code: string) => sql`select job_ref, place, role, title, corner, boss, kind, share, joined::text as joined, origin, created_by from featherbase.crew_job where crew = ${code} order by job_ref`
const codes = async () => (await sql`select crew_code from featherbase.crew_list order by crew_code`).map((r) => String(r.crew_code))

afterEach(() => {
  _setWarehouseReader(null)
  vi.restoreAllMocks()
})

describe('a new joiner reaches the roster with their job', () => {
  test('a row, a primary job at the site of their store, and in the same run a person and a live link', async ({ admin }) => {
    await setUp(admin, [crewRow(1)])
    warehouse([{ key: '7001' }, { key: '8001', title: 'PACKER', manager: 'tt-7001', corner: 'Toys', joined: daysAgo(6) }])

    const run = await runRosterLink('stylehr')

    expect(run.joiners).toMatchObject({ added: 1, jobs: 1, failed: [] })
    const row = await crew('ZZ-TT-8001')
    expect(row).toMatchObject({ crew_name: 'Made Up Joiner 8001', crew_no: 'TT-8001', hr_record: '8001', crew_state: 'Working', origin: 'hr 8001', created_by: 'roster-link' })
    expect(await jobsOf('ZZ-TT-8001')).toEqual([{
      job_ref: 'ZZ-TT-8001-SHOP1-1', place: 'SHOP1', role: 'Hand', title: 'Packer', corner: 'SHOP1-TOYS', boss: 'ZZ-TT-7001',
      kind: 'Main', share: 100, joined: daysAgo(6), origin: 'joiner 8001', created_by: 'roster-link',
    }])
    expect(row.login).toBeTruthy()
    expect(await sql`select subject from sign_in_identity where person_id = ${row.login} and ended_at is null`).toEqual([{ subject: '8001' }])
    const [log] = await sql`select "user", operation from activity_log where operation like 'roster_joiner_added %'`
    expect(log).toEqual({ user: 'roster-link', operation: `roster_joiner_added ${TABLE} ZZ-TT-8001 with a job` })
  })

  test('the job: a whole designation names it; elsewhere than a shop the default is the office job; a section only for jobs that hold one', async ({ admin }) => {
    await setUp(admin)
    warehouse([
      { key: '8001', title: 'Shift Lead', corner: 'Toys' },
      { key: '8002', title: 'Deck Boss', corner: 'Toys' },
      { key: '8003', title: 'Packer', depot: '9002' },
      { key: '8004', title: 'Assistant shift lead', corner: 'Shoes' },
      { key: '8005', title: null, corner: 'Nowhere' },
    ])
    await runRosterLink('stylehr')
    const one = async (code: string) => (await jobsOf(code))[0]
    expect(await one('ZZ-TT-8001')).toMatchObject({ role: 'Lead', title: 'Shift lead', corner: 'SHOP1-TOYS' })
    expect(await one('ZZ-TT-8002')).toMatchObject({ role: 'Boss', title: null, corner: null })
    expect(await one('ZZ-TT-8003')).toMatchObject({ role: 'Office hand', place: 'DEPOT1', corner: null })
    // Two corners share the name: none is guessed between.
    expect(await one('ZZ-TT-8004')).toMatchObject({ role: 'Hand', title: null, corner: null })
    expect(await one('ZZ-TT-8005')).toMatchObject({ role: 'Hand', title: null, corner: null })
  })

  test('a store with no site still adds the row; its job is held and the run says so', async ({ admin }) => {
    await setUp(admin)
    warehouse([{ key: '8001', depot: '9999' }, { key: '8002', depot: null }])
    const dry = (await planRosterLink('stylehr'))!
    expect(formatRosterLink(dry)).toContain(`roster joiners ${TABLE}: would add 2 (with a job 0, job held 2); held 0 (none); limit 10`)
    const run = await runRosterLink('stylehr')
    expect(run.joiners).toMatchObject({ added: 2, jobs: 0 })
    expect(await jobsOf('ZZ-TT-8001')).toEqual([])
    const ops = (await sql`select operation from activity_log where operation like 'roster_joiner_added %' order by operation`).map((r) => String(r.operation))
    expect(ops).toEqual([`roster_joiner_added ${TABLE} ZZ-TT-8001; job held: no_site`, `roster_joiner_added ${TABLE} ZZ-TT-8002; job held: no_site`])
  })

  test('a manager two rows share is not guessed between', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2, { crew_no: 'TT-7001', hr_record: '7002' })])
    warehouse([{ key: '7001' }, { key: '7002' }, { key: '8001', manager: 'TT-7001' }])
    await runRosterLink('stylehr')
    expect((await jobsOf('ZZ-TT-8001'))[0]).toMatchObject({ boss: null })
  })
})

describe('who is never added', () => {
  test('a leaver, someone inactive, someone off the payroll who is no recent joiner, and anyone a row already holds', async ({ admin }) => {
    await setUp(admin, [crewRow(1, { crew_state: 'Gone' }), crewRow(2, { crew_state: 'Test record' }), crewRow(3)])
    await sql`update featherbase.crew_list set retired_at = now() where crew_code = 'ZZ-TT-7003'`
    warehouse([
      { key: '7001' }, { key: '7002' }, { key: '7003' }, // on the roster in some status, retired included
      { key: '8001', exit: PAST }, // left
      { key: '8002', active: false }, // inactive
      { key: '8003', payroll: false, joined: '2005-01-01' }, // off the payroll, long ago: an owner-director with no row
      { key: '8004', payroll: false, joined: daysAgo(3) }, // a recent joiner not yet paid: added
      { key: '8005', exit: PAST, present: today(), active: false }, // the rule holds them at work, but they are no plain joiner
    ])
    const run = await runRosterLink('stylehr')
    expect(run.joiners).toMatchObject({ added: 1 })
    expect(await codes()).toEqual(['ZZ-TT-7001', 'ZZ-TT-7002', 'ZZ-TT-7003', 'ZZ-TT-8004'])
  })

  test('a code another row has, or a record with no code or name, is held and named', async ({ admin }) => {
    await setUp(admin, [crewRow(1, { crew_code: 'ZZ-TT-8001', hr_record: '6001' })])
    warehouse([{ key: '6001' }, { key: '8001' }, { key: '8002', code: null }, { key: '8003', name: null }])
    const plan = (await planRosterLink('stylehr'))!.joiners!
    expect(plan.joiners).toEqual([])
    expect(plan.held).toEqual([{ record: '8001', reason: 'code_taken' }, { record: '8002', reason: 'no_code' }, { record: '8003', reason: 'no_name' }])
  })

  test('a second run adds nothing, and a job id already taken is held', async ({ admin }) => {
    await setUp(admin)
    warehouse([{ key: '8001' }])
    await runRosterLink('stylehr')
    const again = await runRosterLink('stylehr')
    expect(again.joiners).toMatchObject({ added: 0, jobs: 0 })
    expect(again.joiners!.plan!.joiners).toEqual([])

    await saveDoc('Crew Job', { job_ref: 'ZZ-TT-8002-SHOP1-1', crew: 'ZZ-TT-8001', place: 'SHOP1', role: 'Hand' }, 'Administrator', 'insert')
    warehouse([{ key: '8001' }, { key: '8002' }])
    const plan = (await planRosterLink('stylehr'))!.joiners!
    expect(plan.joiners).toEqual([expect.objectContaining({ code: 'ZZ-TT-8002', job: null, job_held: 'id_taken' })])
  })

  test('someone added between the plan and the save is not added twice', async ({ admin }) => {
    await setUp(admin)
    warehouse([{ key: '8001' }])
    const plan = (await planRosterLink('stylehr'))!
    await saveDoc(TABLE, crewRow(9, { crew_code: 'ZZ-TT-8001', hr_record: '8001' }), 'Administrator', 'insert')
    const { applyJoiners } = await import('../src/roster-joiners')
    const { usableRoster } = await import('../src/roster-first-sign-in')
    const { getSignInMethod } = await import('../src/identities')
    const roster = (await usableRoster((await getSignInMethod('stylehr'))!))!
    expect(await applyJoiners(roster, plan.joiners)).toMatchObject({ added: 0, failed: [] })
    expect(await codes()).toEqual(['ZZ-TT-8001'])
  })
})

describe('a bad feed or a big batch adds nobody', () => {
  test('more than the limit adds none, says so, and a person may accept exactly that count', async ({ admin }) => {
    await setUp(admin)
    const feed = Array.from({ length: 11 }, (_, i) => ({ key: String(8000 + i) }))
    warehouse(feed)
    const run = await runRosterLink('stylehr')
    expect(run.joiners!.plan!.refused).toBe('it would add 11 new joiners to 0 current rows, more than the limit of 10')
    expect(run.joiners!.added).toBe(0)
    expect(String((await sql`select operation from activity_log where operation like 'roster_joiners_refused %'`)[0].operation)).toContain('it would add 11')

    expect((await runRosterLink('stylehr', { acceptJoiners: 12 })).joiners!.added).toBe(0)
    expect((await runRosterLink('stylehr', { acceptJoiners: 11 })).joiners!.added).toBe(11)
  })

  test('an accepted count that no longer matches refuses even under the limit', async ({ admin }) => {
    await setUp(admin)
    warehouse([{ key: '8001' }])
    const run = await runRosterLink('stylehr', { acceptJoiners: 4 })
    expect(run.joiners!.plan!.refused).toBe('it would add 1 new joiners, not the 4 accepted')
  })

  test('a stale feed, an unreadable warehouse or a Table it cannot read adds nobody, and the linking still runs', async ({ admin }) => {
    await setUp(admin, [crewRow(1)])
    warehouse([{ key: '7001' }, { key: '8001' }], '2020-01-01')
    let run = await runRosterLink('stylehr')
    expect(run.joiners!.plan!.refused).toContain('stale')
    expect(run.created).toBe(1)

    _setWarehouseReader(async () => {
      throw new Error('warehouse down')
    })
    run = await runRosterLink('stylehr')
    expect(run.joiners!.plan!.refused).toBe('the warehouse could not be read: warehouse down')

    warehouse([{ key: '7001' }, { key: '8001' }])
    await sql`update sign_in_method set settings = ${sql.json({ provider_record_key: 'employee_id', roster: { ...ROSTER, joiners: { ...JOINERS, job: { ...JOB, table: 'No Such Table' } } } })} where row_id = 'stylehr'`
    run = await runRosterLink('stylehr')
    expect(run.joiners!.plan!.refused).toMatch(/^its Tables could not be read: /)
    expect(await codes()).toEqual(['ZZ-TT-7001'])
  })

  test('a roster that names no joiners adds nobody and reads no Tables for them', async ({ admin }) => {
    const { joiners: _, left_status: __, ...plain } = ROSTER
    await setUp(admin, [], plain)
    const reads = warehouse([{ key: '8001' }])
    const run = await runRosterLink('stylehr')
    expect(run.joiners).toEqual({ plan: null, added: 0, jobs: 0, failed: [] })
    expect(reads).toEqual([])
    expect(formatRosterLink(run.plan, run)).not.toContain('roster joiners')
  })

  test('joiners alone, with no left status, still read the feed once and add', async ({ admin }) => {
    const { left_status: _, ...noLeft } = ROSTER
    await setUp(admin, [], noLeft)
    const reads = warehouse([{ key: '8001' }])
    const run = await runRosterLink('stylehr')
    expect(run.status).toEqual({ plan: null, changed: 0, failed: [] })
    expect(run.joiners!.added).toBe(1)
    expect(reads).toHaveLength(1)
  })

  test('a malformed joiners block is refused, naming what is wrong', async ({ admin }) => {
    await setUp(admin, [], { ...ROSTER, joiners: { ...JOINERS, code_column: 'Not A Column' } })
    warehouse([{ key: '8001' }])
    const run = await runRosterLink('stylehr')
    expect(run.joiners!.plan!.refused).toBe('settings.roster.joiners.code_column must be a column name')
  })
})

describe('the settings and templates', () => {
  test('every part of a joiners block is checked', () => {
    expect(joinerSettings(null)).toBeNull()
    expect(() => joinerSettings('x')).toThrow('settings.roster.joiners must be an object')
    expect(() => joinerSettings({ ...JOINERS, code: '' })).toThrow('settings.roster.joiners.code must be a string')
    expect(() => joinerSettings({ ...JOINERS, values: { 'Bad Key': 'x' } })).toThrow('settings.roster.joiners.values must map column names to values')
    expect(() => joinerSettings({ ...JOINERS, job: 'x' })).toThrow('settings.roster.joiners.job must be an object')
    expect(() => joinerSettings({ ...JOINERS, job: { ...JOB, jobs: { a: '' } } })).toThrow('settings.roster.joiners.job.jobs must map designations to jobs')
    expect(() => joinerSettings({ ...JOINERS, job: { ...JOB, site_of_store: undefined } })).toThrow('settings.roster.joiners.job.site_of_store must be an object')
    expect(() => joinerSettings({ ...JOINERS, job: { ...JOB, section_jobs: 'Hand' } })).toThrow('settings.roster.joiners.job.section_jobs must be a list of jobs')
    const bare = joinerSettings({ code_column: 'crew_code', code: '{employee_code}', job: { ...JOB, jobs: undefined, store_site: null, designation: null, section: null, section_jobs: undefined, off_store_job: null, designation_column: null, section_column: null, reports_to_column: null, manager_column: null, values: undefined } })!
    expect(bare.job).toMatchObject({ jobs: {}, store_site: null, designation: null, section: null, section_jobs: [], off_store_job: null, values: {} })
  })

  test('a template with a field the record lacks gives nothing', () => {
    expect(fill('{region}-{employee_code}', { region: 'ZZ', employee_code: 'TT-1' })).toBe('ZZ-TT-1')
    expect(fill('{region}-{employee_code}', { employee_code: 'TT-1' })).toBeNull()
  })

  test('a bare job block adds the job with no designation, section or manager', async ({ admin }) => {
    const job = { ...JOB, store_site: null, designation: null, designation_column: null, section: null, section_column: null, reports_to_column: null, manager_column: null }
    await setUp(admin, [], { ...ROSTER, joiners: { ...JOINERS, job } })
    warehouse([{ key: '8001', depot: '9002', title: 'Shift Lead' }])
    await runRosterLink('stylehr')
    expect((await jobsOf('ZZ-TT-8001'))[0]).toMatchObject({ role: 'Lead', place: 'DEPOT1', title: null, corner: null, boss: null })
  })

  test('a row-only block adds the row and no job', async ({ admin }) => {
    await setUp(admin, [], { ...ROSTER, joiners: { code_column: 'crew_code', code: '{region}-{employee_code}' } })
    warehouse([{ key: '8001' }])
    const run = await runRosterLink('stylehr')
    expect(run.joiners).toMatchObject({ added: 1, jobs: 0 })
    expect(await jobsOf('ZZ-TT-8001')).toEqual([])
  })
})

describe('where a person sees it', () => {
  test('the job refuses on too many joiners, and the CLI accepts a count only on --apply', async ({ admin }) => {
    await setUp(admin)
    warehouse(Array.from({ length: 11 }, (_, i) => ({ key: String(8000 + i) })))
    await loadJobs()
    await sql`delete from background_job`
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const job = await enqueue(ROSTER_LINK_JOB, {})
    await sql`update background_job set run_at = now() where row_id = ${job}`
    await runOneJob()
    const [exec] = await sql`select outcome, result from job_execution where job = ${job} order by created_at desc limit 1`
    expect(exec).toMatchObject({ outcome: 'refused', result: expect.stringContaining('added no joiners: it would add 11 new joiners') })

    expect((await runMain(main, ['roster:link', 'stylehr', '--accept-joiners', '11'])).code).toBe(1)
    expect((await runMain(main, ['roster:link', 'stylehr', '--apply', '--accept-joiners'])).code).toBe(1)
    const applied = await runMain(main, ['roster:link', 'stylehr', '--apply', '--accept-joiners', '11'])
    expect(applied.stdout).toContain(`roster joiners ${TABLE}: added 11, with a job 11`)
  })
})
