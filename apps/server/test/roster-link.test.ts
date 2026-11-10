// The roster link (#1157): every current roster row gets its Person, link and
// identifiers before anyone signs in, and a leaver's link ends. Everyone here
// is made up, and the outside service is a stand-in. The roster Table has its
// own name and column names, so the platform cannot lean on one client's.
import { afterEach, describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { _setDelegatedFetch } from '../src/delegated-login'
import { planRosterLink, runRosterLink, formatRosterLink } from '../src/roster-link'
import { expectStatus, makeTable } from './fixtures'
import { configureDelegated, giveEmployeeCode } from './identity-fixtures'

const TABLE = 'Crew List'
const PASSWORD = 'Made-Up-Pass-1157!'
const ROSTER = {
  table: TABLE,
  sign_in_id_column: 'crew_no',
  record_number_column: 'hr_record',
  person_column: 'login',
  name_column: 'crew_name',
  status_column: 'crew_state',
  current_status: 'Working',
  provider_record_key: 'employee_id',
  identifiers: { 'stylehr-employee-code': 'crew_no' },
}

const crewRow = (n: number, over: Record<string, unknown> = {}) => ({
  crew_name: `Made Up Crew ${n}`,
  crew_no: `TT-${1000 + n}`,
  hr_record: String(7000 + n),
  crew_state: 'Working',
  ...over,
})

async function setUp(admin: TestClient, rows: Record<string, unknown>[] = [crewRow(1)]) {
  await configureDelegated()
  await makeTable(admin, {
    name: TABLE,
    columns: [
      { column_name: 'crew_name', column_type: 'Data', reqd: true },
      { column_name: 'crew_no', column_type: 'Data' },
      { column_name: 'hr_record', column_type: 'Data' },
      { column_name: 'crew_state', column_type: 'Data' },
      { column_name: 'login', column_type: 'Reference', reference_table: 'Person' },
    ],
  })
  await sql`update sign_in_method set new_person = 'create_if_on_roster', settings = ${sql.json({ provider_record_key: 'employee_id', roster: ROSTER })} where row_id = 'stylehr'`
  for (const row of rows) await saveDoc(TABLE, row, 'Administrator', 'insert')
}

const crew = async (no: string) => (await sql`select * from featherbase.crew_list where crew_no = ${no}`)[0]
const setState = async (no: string, crew_state: string) => {
  const row = await crew(no)
  await saveDoc(TABLE, { row_id: row.row_id, updated_at: row.updated_at, crew_state }, 'Administrator')
}
const count = async (table: 'person' | 'sign_in_identity' | 'person_identifier' | 'email_queue') =>
  Number((await sql`select count(*)::int as n from ${sql(`featherbase.${table}`)}`)[0].n)
const liveLinks = (person: string) =>
  sql`select subject, sign_in_name, linked_by from sign_in_identity where person_id = ${person} and ended_at is null`
const currentIds = (person: string) =>
  sql`select system, value from person_identifier where person_id = ${person} and upper_inf(valid) order by system`
const held = async () => (await sql`select operation from activity_log where operation like 'roster_link_held %' order by operation`).map((r) => String(r.operation))

function provider(record: string) {
  const calls: unknown[] = []
  _setDelegatedFetch((async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)))
    return Response.json({ access: 'opaque', employee_id: Number(record) })
  }) as typeof fetch)
  return calls
}
const signIn = (api: TestClient, usr: string, pwd = PASSWORD) =>
  api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr, pwd, method: 'stylehr' }) })

afterEach(() => {
  _setDelegatedFetch(null)
  vi.unstubAllEnvs()
})

describe('a current roster row is linked before anyone signs in', () => {
  test('a Person, a live link, the identifiers and the row’s person, all together', async ({ admin }) => {
    await setUp(admin)
    const people = await count('person')

    const run = await runRosterLink('stylehr')

    expect(run.created).toBe(1)
    expect(await count('person')).toBe(people + 1)
    const row = await crew('TT-1001')
    const [person] = await sql`select full_name, email, enabled, password_hash, created_by from person where row_id = ${row.login}`
    expect(person).toMatchObject({ full_name: 'Made Up Crew 1', email: null, enabled: true, password_hash: null, created_by: 'roster-link' })
    expect(await liveLinks(row.login)).toEqual([{ subject: '7001', sign_in_name: 'TT-1001', linked_by: 'roster-link' }])
    expect(await currentIds(row.login)).toEqual([
      { system: 'stylehr-employee-code', value: 'TT-1001' },
      { system: 'stylehr-employee-id', value: '7001' },
    ])
  })

  test('nothing is sent to the people it makes, and they hold no role of their own', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2)])
    const mail = await count('email_queue')
    await runRosterLink('stylehr')
    expect(await count('email_queue')).toBe(mail)
    const row = await crew('TT-1001')
    expect(await sql`select role from has_role where parent = ${row.login}`).toEqual([])
  })

  test('a second run changes nothing', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2)])
    await runRosterLink('stylehr')
    const before = await Promise.all([count('person'), count('sign_in_identity'), count('person_identifier')])
    const rowBefore = await crew('TT-1001')
    const activity = Number((await sql`select count(*)::int as n from activity_log`)[0].n)

    const again = await runRosterLink('stylehr')

    expect(again).toMatchObject({ created: 0, linked: 0, completed: 0, ended: 0, unchanged: 2 })
    expect(await Promise.all([count('person'), count('sign_in_identity'), count('person_identifier')])).toEqual(before)
    expect(String((await crew('TT-1001')).updated_at)).toBe(String(rowBefore.updated_at))
    expect(Number((await sql`select count(*)::int as n from activity_log`)[0].n)).toBe(activity)
  })

  test('a dry run says what it would do and changes nothing', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2)])
    const people = await count('person')
    const plan = await planRosterLink('stylehr')
    expect(plan?.rows.filter((r) => r.action === 'create').map((r) => r.sign_in_id).sort()).toEqual(['TT-1001', 'TT-1002'])
    expect(await count('person')).toBe(people)
    expect(formatRosterLink(plan)).toContain('would create 2')
  })

  test('a dry run names the email rules and webhooks its saves would set off', async ({ admin }) => {
    await setUp(admin)
    await sql`insert into email_rule (row_id, ref_table, event, enabled, recipient, subject) values ('Made up welcome', 'Person', 'on_create', true, 'someone@example.test', 'Hello')`
    expect((await planRosterLink('stylehr'))?.side_effects).toEqual(['email rule Made up welcome (Person, on_create)'])
  })

  test('someone who signed in first is matched, never duplicated', async ({ api, admin }) => {
    await setUp(admin)
    provider('7001')
    await expectStatus(await signIn(api, 'TT-1001'), 200)
    const people = await count('person')

    const run = await runRosterLink('stylehr')

    expect(run).toMatchObject({ created: 0, linked: 0, unchanged: 1 })
    expect(await count('person')).toBe(people)
  })

  test('a Person the row already names gets the missing link and identifiers', async ({ admin }) => {
    await setUp(admin)
    const person = await saveDoc('Person', { full_name: 'Made Up Crew 1', enabled: true, roles: [] }, 'Administrator', 'insert')
    const row = await crew('TT-1001')
    await saveDoc(TABLE, { row_id: row.row_id, updated_at: row.updated_at, login: person.row_id }, 'Administrator')
    const people = await count('person')

    const run = await runRosterLink('stylehr')

    expect(run.linked).toBe(1)
    expect(await count('person')).toBe(people)
    expect(await liveLinks(String(person.row_id))).toHaveLength(1)
    expect((await currentIds(String(person.row_id))).map((r) => r.system)).toEqual(['stylehr-employee-code', 'stylehr-employee-id'])
  })

  test('first-sign-in creation still works for someone who joins between runs', async ({ api, admin }) => {
    await setUp(admin)
    await runRosterLink('stylehr')
    await saveDoc(TABLE, crewRow(2), 'Administrator', 'insert')
    provider('7002')
    await expectStatus(await signIn(api, 'TT-1002'), 200)
    expect((await crew('TT-1002')).login).toBeTruthy()
  })
})

describe('what the roster link holds back', () => {
  test('a sign-in ID on two roster rows links neither, noted once', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2, { crew_no: 'TT-1001' })])
    await runRosterLink('stylehr')
    await runRosterLink('stylehr')
    expect(await sql`select login from featherbase.crew_list where login is not null`).toEqual([])
    expect((await held()).filter((h) => h.endsWith('duplicate_id'))).toHaveLength(2)
  })

  test('an employee code current on another person is not linked', async ({ admin }) => {
    await setUp(admin)
    const other = await saveDoc('Person', { full_name: 'Someone Else', enabled: true, roles: [] }, 'Administrator', 'insert')
    await giveEmployeeCode(String(other.row_id), 'TT-1001')
    await runRosterLink('stylehr')
    expect((await crew('TT-1001')).login).toBeNull()
    expect(await held()).toEqual([expect.stringMatching(/ value_held_elsewhere$/)])
  })

  test('an employee code current on two people stays refused in test mode', async ({ api, admin }) => {
    await setUp(admin)
    await runRosterLink('stylehr')
    const twin = await saveDoc('Person', { full_name: 'Made Up Twin', enabled: true, roles: [] }, 'Administrator', 'insert')
    // Two firms' codes collide: the same code, current, under different assigners.
    await sql`update person_identifier set assigner = 'firm-7' where person_id = ${(await crew('TT-1001')).login} and system = 'stylehr-employee-code'`
    await sql`insert into person_identifier (id, person_id, system, assigner, value, verified, one_holder, source, recorded_by)
      values ('pid_twin_code', ${String(twin.row_id)}, 'stylehr-employee-code', 'firm-12', 'TT-1001', true, true, 'test', 'test')`
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    await expectStatus(await signIn(api, 'TT-1001', 'x'), 409)
  })

  test('a privileged person the row names gets no StyleHR link', async ({ admin }) => {
    await setUp(admin)
    const row = await crew('TT-1001')
    await saveDoc(TABLE, { row_id: row.row_id, updated_at: row.updated_at, login: 'Administrator' }, 'Administrator')
    await runRosterLink('stylehr')
    expect(await liveLinks('Administrator')).toEqual([])
    expect(await held()).toEqual([expect.stringMatching(/ privileged$/)])
  })

  test('a link an administrator ended is not made again', async ({ admin }) => {
    await setUp(admin)
    await runRosterLink('stylehr')
    const row = await crew('TT-1001')
    await sql`update sign_in_identity set ended_at = now(), ended_reason = 'unlinked' where person_id = ${row.login}`
    const run = await runRosterLink('stylehr')
    expect(run.linked).toBe(0)
    expect(await liveLinks(row.login)).toEqual([])
    expect(await held()).toEqual([expect.stringMatching(/ link_ended$/)])
  })
})

describe('a leaver’s link ends', () => {
  test('a row no longer current ends the link and the identifiers; the Person stays', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2)])
    await runRosterLink('stylehr')
    const { login } = await crew('TT-1001')
    await setState('TT-1001', 'Left')

    const run = await runRosterLink('stylehr')

    expect(run.ended).toBe(1)
    expect(await liveLinks(login)).toEqual([])
    const [ended] = await sql`select ended_reason from sign_in_identity where person_id = ${login}`
    expect(ended.ended_reason).toBe('left')
    expect(await currentIds(login)).toEqual([])
    expect(await sql`select 1 from person where row_id = ${login}`).toHaveLength(1)
    expect((await crew('TT-1001')).login).toBe(login)
  })

  test('a retired row counts as gone, whatever its status says', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2)])
    await runRosterLink('stylehr')
    const { row_id, login } = await crew('TT-1001')
    await sql`update featherbase.crew_list set retired_at = now() where row_id = ${row_id}`
    expect((await runRosterLink('stylehr')).ended).toBe(1)
    expect(await liveLinks(login)).toEqual([])
  })

  test('a link whose record is on no roster row is left alone', async ({ admin }) => {
    await setUp(admin, [crewRow(1)])
    const p = await saveDoc('Person', { full_name: 'Not On The Roster', enabled: true, roles: [] }, 'Administrator', 'insert')
    await sql`insert into sign_in_identity ${sql({ id: 'uid_notonroster', person_id: String(p.row_id), method: 'stylehr', subject: '9999', sign_in_name: 'TT-9999', linked_by: 'test' })}`
    expect((await runRosterLink('stylehr')).ended).toBe(0)
    expect(await liveLinks(String(p.row_id))).toHaveLength(1)
  })

  test('someone who comes back gets a fresh link on the same Person', async ({ admin }) => {
    await setUp(admin, [crewRow(1), crewRow(2)])
    await runRosterLink('stylehr')
    const { login } = await crew('TT-1001')
    await setState('TT-1001', 'Left')
    await runRosterLink('stylehr')
    await setState('TT-1001', 'Working')

    const run = await runRosterLink('stylehr')

    expect(run.linked).toBe(1)
    expect(await liveLinks(login)).toHaveLength(1)
    expect((await currentIds(login)).map((r) => r.system)).toEqual(['stylehr-employee-code', 'stylehr-employee-id'])
  })

  test('a run that would end too many links ends none, and says so', async ({ admin }) => {
    await setUp(admin, Array.from({ length: 12 }, (_, i) => crewRow(i + 1)))
    await runRosterLink('stylehr')
    await sql`update featherbase.crew_list set crew_state = 'Left'`
    await saveDoc(TABLE, crewRow(50), 'Administrator', 'insert')

    const run = await runRosterLink('stylehr')

    expect(run.refused).toMatch(/would end 12/)
    expect(run.ended).toBe(0)
    expect(run.created).toBe(1)
    expect(Number((await sql`select count(*)::int as n from sign_in_identity where ended_at is null`)[0].n)).toBe(13)
  })
})

describe('a link alone signs nobody in', () => {
  test('outside test mode, the service is asked for the password and must name the record', async ({ api, admin }) => {
    await setUp(admin)
    await runRosterLink('stylehr')
    const calls = provider('7999') // the service answers for somebody else
    await expectStatus(await signIn(api, 'TT-1001'), 401)
    expect(calls).toEqual([{ email: 'TT-1001', password: PASSWORD }])
  })

  test('in test mode on staging, a pre-linked employee signs in by their code', async ({ api, admin }) => {
    await setUp(admin)
    await runRosterLink('stylehr')
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    const res = await signIn(api, 'TT-1001', 'anything')
    await expectStatus(res, 200)
    expect(((await res.json()) as { user: { row_id: string } }).user.row_id).toBe((await crew('TT-1001')).login)
  })
})
