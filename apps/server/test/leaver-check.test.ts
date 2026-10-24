// data-warehouse #4336: the daily warehouse exit-date check disables people
// whose StyleHR record shows they have left. It only ever disables, skips
// System Managers, and refuses on a stale or implausible feed.
import { afterEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makePerson } from './fixtures'
import { applySeedPack } from '../src/seed-packs'
import { issueSession } from '../src/auth'
import { newIdentifierId } from '../src/person-identifiers'
import { syncScheduledJobs } from '../src/jobs'
import type { MailMessage } from '../src/email'
import {
  LEAVER_CHECK_JOB,
  LEAVER_CHECK_SUBJECT,
  _setLeaverSummarySender,
  _setWarehouseReader,
  planLeavers,
  runLeaverCheck,
  type EmployeeRecord,
  type LinkedPerson,
} from '../src/leaver-check'

const TODAY = '2026-10-24'

afterEach(() => {
  _setWarehouseReader(null)
  _setLeaverSummarySender(null)
})

const rec = (key: string, code: string, over: Partial<EmployeeRecord> = {}): EmployeeRecord => ({
  employee_key: key,
  employee_code: code,
  payroll_active: true,
  movement_active: true,
  date_of_joining: '2024-01-01',
  exit_date: null,
  ...over,
})
const who = (person: string, over: Partial<LinkedPerson> = {}): LinkedPerson => ({
  person,
  full_name: null,
  privileged: false,
  updated_at: null,
  record_ids: [],
  codes: [],
  ...over,
})
/** Enough active staff that one or two leavers stay under the limit. */
const crowd = (n: number) => Array.from({ length: n }, (_, i) => who(`p${i}`, { record_ids: [`9${i}`] }))
const crowdRecords = (n: number) => Array.from({ length: n }, (_, i) => rec(`9${i}`, `C-9${i}`))

describe('who counts as a leaver', () => {
  test('an exit date that has passed disables, with the date as the reason', async () => {
    const plan = planLeavers([who('a', { record_ids: ['1'] })], [rec('1', 'C-1', { exit_date: '2026-10-09', movement_active: false })], TODAY, TODAY)
    expect(plan.refused).toBeNull()
    expect(plan.to_disable).toEqual([{ person: 'a', full_name: null, reason: 'exit date 09-Oct-2026 has passed', basis: 'exit date' }])
  })

  test('an exit date still in the future does not', async () => {
    const plan = planLeavers([who('a', { record_ids: ['1'] })], [rec('1', 'C-1', { exit_date: '2026-10-30' })], TODAY, TODAY)
    expect(plan.to_disable).toEqual([])
  })

  test('not being on payroll disables, unless the person joined too recently to have been paid', async () => {
    const people = [who('old', { record_ids: ['1'] }), who('new', { record_ids: ['2'] })]
    const records = [
      rec('1', 'C-1', { payroll_active: false, date_of_joining: '2025-01-01' }),
      rec('2', 'C-2', { payroll_active: false, date_of_joining: '2026-10-01' }),
    ]
    const plan = planLeavers(people, records, TODAY, TODAY)
    expect(plan.to_disable.map((l) => [l.person, l.basis])).toEqual([['old', 'not on payroll']])
    expect(plan.recent_joiners).toEqual(['new'])
  })

  test('a code shared by several records is a leaver only when every record has left', async () => {
    const records = [
      rec('1', 'C-7', { payroll_active: false }),
      rec('2', 'C-7'),
      rec('3', 'C-8', { movement_active: false }),
      rec('4', 'C-8', { payroll_active: false }),
    ]
    const plan = planLeavers([who('shared-active', { codes: ['C-7'] }), who('shared-gone', { codes: ['c-8 '] })], records, TODAY, TODAY)
    expect(plan.to_disable.map((l) => [l.person, l.reason])).toEqual([['shared-gone', 'marked inactive in StyleHR']])
  })

  test('a record number decides over the code', async () => {
    const records = [rec('1', 'C-7', { movement_active: false }), rec('2', 'C-7')]
    const plan = planLeavers([who('a', { record_ids: ['1'], codes: ['C-7'] })], records, TODAY, TODAY)
    expect(plan.to_disable.map((l) => l.person)).toEqual(['a'])
  })

  test('a System Manager who has left is reported, not disabled; a link with no record is left alone', async () => {
    const plan = planLeavers(
      [who('boss', { privileged: true, record_ids: ['1'] }), who('ghost', { record_ids: ['404'] })],
      [rec('1', 'C-1', { movement_active: false })],
      TODAY,
      TODAY,
    )
    expect(plan.to_disable).toEqual([])
    expect(plan.privileged_leavers.map((l) => l.person)).toEqual(['boss'])
    expect(plan.not_found).toEqual(['ghost'])
  })
})

describe('a bad feed disables nobody', () => {
  test('refuses when the warehouse has no StyleHR day from yesterday or today', async () => {
    const plan = planLeavers([who('a', { record_ids: ['1'] })], [rec('1', 'C-1', { movement_active: false })], '2026-10-22', TODAY)
    expect(plan.refused).toMatch(/stale/)
    expect(plan.to_disable).toEqual([])
    expect(planLeavers([], [], '2026-10-23', TODAY).refused).toMatch(/no StyleHR employee records/)
  })

  test('refuses when more than 5% of linked people would go at once', async () => {
    const people = [...crowd(97), who('x1', { record_ids: ['1'] }), who('x2', { record_ids: ['2'] }), who('x3', { record_ids: ['3'] })]
    const gone = ['1', '2', '3'].map((k) => rec(k, `C-${k}`, { movement_active: false }))
    expect(planLeavers(people, [...crowdRecords(97), ...gone], TODAY, TODAY).refused).toBeNull()
    const many = [...crowd(90), ...Array.from({ length: 10 }, (_, i) => who(`g${i}`, { record_ids: [`5${i}`] }))]
    const manyGone = Array.from({ length: 10 }, (_, i) => rec(`5${i}`, `G-${i}`, { movement_active: false }))
    const plan = planLeavers(many, [...crowdRecords(90), ...manyGone], TODAY, TODAY)
    expect(plan.refused).toMatch(/would disable 10 of 100 linked people, more than the limit of 5/)
  })
})

// ---------------------------------------------------------------- end to end

async function link(person: string, system: string, value: string) {
  await sql`
    insert into person_identifier (id, person_id, system, assigner, value, valid, verified, one_holder, source, recorded_by)
    values (${newIdentifierId()}, ${person}, ${system}, '', ${value}, daterange('2024-01-01'::date, null::date, '[)'), true, false, 'test', 'test')`
}

/** A stub warehouse: the feed day, then the records, in the order the check reads them. */
function warehouse(feedDay: string, records: EmployeeRecord[]) {
  _setWarehouseReader(async (q) =>
    q.includes('attendance')
      ? [[feedDay]]
      : records.map((r) => [r.employee_key, r.employee_code, r.payroll_active, r.movement_active, r.date_of_joining, r.exit_date]),
  )
}

async function enabled(person: string) {
  const [row] = await sql`select enabled from person where row_id = ${person}`
  return row.enabled as boolean
}

describe('the check on a live instance', () => {
  test('disables the leaver, ends their session, logs why, mails System Managers, and does nothing the second time', async ({ api, createUser }) => {
    await applySeedPack('jeyarama')
    await createUser({ email: 'manager@example.com', roles: ['System Manager'] })
    const leaver = await makePerson({ full_name: 'Gone Person' })
    const stayer = await makePerson({ full_name: 'Still Here' })
    const bossLeaver = await makePerson({ full_name: 'Gone Boss', roles: [{ role: 'System Manager' }] })
    await link(leaver, 'stylehr-employee-id', '101')
    await link(leaver, 'stylehr-employee-code', 'C-101')
    await link(stayer, 'stylehr-employee-code', 'C-102')
    await link(bossLeaver, 'stylehr-employee-id', '103')
    warehouse(TODAY, [
      rec('101', 'C-101', { exit_date: '2026-10-20', movement_active: false }),
      rec('102', 'C-102'),
      rec('103', 'C-103', { movement_active: false }),
    ])
    const sent: MailMessage[] = []
    _setLeaverSummarySender(async (m) => sent.push(m))
    const { token } = await issueSession(leaver)
    const whoami = () => api.fetch('/api/whoami', { headers: { authorization: `Bearer ${token}` } })
    expect((await whoami()).status).toBe(200)

    const run = await runLeaverCheck({ today: TODAY })

    expect(run.disabled.map((l) => l.person)).toEqual([leaver])
    expect(await enabled(leaver)).toBe(false)
    expect(await enabled(stayer)).toBe(true)
    expect(await enabled(bossLeaver)).toBe(true)
    expect((await whoami()).status).toBe(401)
    const [logged] = await sql`select "user", operation from activity_log where operation like ${`disabled_as_leaver for ${leaver}%`}`
    expect(logged).toEqual({ user: 'system', operation: `disabled_as_leaver for ${leaver}: exit date 20-Oct-2026 has passed` })
    const mine = sent.filter((m) => m.to === 'manager@example.com')
    expect(mine).toHaveLength(1)
    expect(mine[0].subject).toBe(LEAVER_CHECK_SUBJECT)
    expect(mine[0].body).toContain('Gone Person: exit date 20-Oct-2026 has passed')
    expect(mine[0].body).toContain('Gone Boss')

    sent.length = 0
    const again = await runLeaverCheck({ today: TODAY })
    expect(again.disabled).toEqual([])
    expect(sent.filter((m) => m.body.includes('Disabled'))).toEqual([])
  })

  test('never re-enables: a disabled person whose record is active stays disabled', async () => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'Paused', enabled: false })
    await link(p, 'stylehr-employee-code', 'C-201')
    warehouse(TODAY, [rec('201', 'C-201')])
    await runLeaverCheck({ today: TODAY })
    expect(await enabled(p)).toBe(false)
  })

  test('a stale feed disables nobody and says so in the activity log', async () => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'Gone Person' })
    await link(p, 'stylehr-employee-id', '301')
    warehouse('2026-10-20', [rec('301', 'C-301', { movement_active: false })])
    const run = await runLeaverCheck({ today: TODAY })
    expect(run.disabled).toEqual([])
    expect(await enabled(p)).toBe(true)
    const [row] = await sql`select operation from activity_log where operation like 'leaver_check_refused:%' order by created_at desc limit 1`
    expect(String(row.operation)).toMatch(/stale/)
  })

  test('the operator can accept a large batch by its exact count, and only that count', async () => {
    await applySeedPack('jeyarama')
    const gone: string[] = []
    for (let i = 0; i < 3; i++) {
      const p = await makePerson({ full_name: `Gone ${i}` })
      await link(p, 'stylehr-employee-id', `40${i}`)
      gone.push(p)
    }
    warehouse(TODAY, ['400', '401', '402'].map((k) => rec(k, `C-${k}`, { movement_active: false })))
    expect((await runLeaverCheck({ today: TODAY, acceptCount: 4 })).disabled).toEqual([])
    expect((await runLeaverCheck({ today: TODAY, acceptCount: 3 })).disabled.map((l) => l.person).sort()).toEqual([...gone].sort())
  })

  test('the schedule ships switched off', async () => {
    const [row] = await sql`select cadence, enabled from scheduled_job where method = ${LEAVER_CHECK_JOB}`
    expect(row).toEqual({ cadence: 'daily', enabled: false })
    await syncScheduledJobs(LEAVER_CHECK_JOB)
    const queued = await sql`select 1 from background_job where method = ${LEAVER_CHECK_JOB} and job_status = 'queued'`
    expect(queued).toHaveLength(0)
  })

  test('an instance without StyleHR has nothing to check', async () => {
    const [seeded] = await sql`select 1 from identifier_system where row_id like 'stylehr-%' limit 1`
    expect(seeded).toBeUndefined()
    expect((await runLeaverCheck({ today: TODAY })).plan).toBeNull()
  })
})
