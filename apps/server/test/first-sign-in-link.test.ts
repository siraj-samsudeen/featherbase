// First sign-in links a roster row (#970). Every person here is made up and the
// outside service is a stand-in: nothing is ever sent to a real one. The roster
// Table has its own name and column names, so the platform cannot be leaning
// on one client's.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { invalidateMeta } from '../src/meta'
import { _setDelegatedFetch, delegatedLoginConfig } from '../src/delegated-login'
import { rosterFirstSignIn } from '../src/roster-first-sign-in'
import { applyInstanceSettings } from '../src/instance-settings'
import { getSignInMethod } from '../src/identities'
import { makeTable } from './fixtures'
import { configureDelegated, giveEmployeeCode, linkDelegated } from './identity-fixtures'

const TABLE = 'Crew List'
const PASSWORD = 'Made-Up-Pass-970!'
const CODE = 'TT-1001'
const RECORD = '7001'
const REFUSED = 'Invalid login credentials'

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

async function setUp(admin: TestClient, o: { rule?: string; roster?: unknown; rows?: Record<string, unknown>[] } = {}) {
  await configureDelegated()
  await makeTable(admin, {
    name: TABLE,
    columns: [
      { column_name: 'crew_name', column_type: 'Data', reqd: true },
      { column_name: 'crew_no', column_type: 'Data' },
      { column_name: 'crew_login', column_type: 'Data' },
      { column_name: 'hr_record', column_type: 'Data' },
      { column_name: 'crew_state', column_type: 'Data' },
      { column_name: 'login', column_type: 'Reference', reference_table: 'Person' },
    ],
  })
  await sql`update sign_in_method set new_person = ${o.rule ?? 'create_if_on_roster'}, settings = ${sql.json({ roster: (o.roster === undefined ? ROSTER : o.roster) as never })} where row_id = 'stylehr'`
  for (const row of o.rows ?? [crewRow()]) await saveDoc(TABLE, row, 'Administrator', 'insert')
}

const crewRow = (over: Record<string, unknown> = {}) => ({ crew_name: 'Made Up Crew', crew_no: CODE, hr_record: RECORD, crew_state: 'Working', ...over })

type Call = { body: Record<string, unknown> }
function provider(answer: () => Response | Promise<Response> = () => Response.json({ access: 'opaque', id: 99, employee_id: Number(RECORD) })) {
  const calls: Call[] = []
  _setDelegatedFetch((async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return answer()
  }) as typeof fetch)
  return calls
}

const signIn = (api: TestClient, usr = CODE, pwd = PASSWORD, method = 'stylehr') =>
  api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr, pwd, method }) })

const crew = (no = CODE) => sql`select * from featherbase.crew_list where crew_no = ${no} order by row_id`
const peopleCount = async () => Number((await sql`select count(*)::int as n from person`)[0].n)
const heldNotes = async () => (await sql`select operation from activity_log where operation like 'first_sign_in_held %'`).map((r) => String(r.operation))

async function expectRefusedWithoutAsking(api: TestClient, calls: Call[], usr = CODE) {
  const before = await peopleCount()
  const res = await signIn(api, usr)
  expect(res.status).toBe(401)
  expect(((await res.json()) as { error: { message: string } }).error.message).toBe(REFUSED)
  expect(calls).toHaveLength(0)
  expect(await peopleCount()).toBe(before)
}

afterEach(() => {
  _setDelegatedFetch(null)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('a first sign-in links the roster row', () => {
  test('one current row with no person: the service is asked once, then everything is recorded together', async ({ api, admin }) => {
    await setUp(admin)
    const calls = provider()
    const before = await peopleCount()

    const res = await signIn(api)

    expect(res.status).toBe(200)
    const { user } = (await res.json()) as { user: { row_id: string } }
    expect(calls).toEqual([{ body: { email: CODE, password: PASSWORD } }])
    expect(await peopleCount()).toBe(before + 1)
    const [person] = await sql`select row_id, full_name, email, enabled, password_hash from person where row_id = ${user.row_id}`
    expect(person).toMatchObject({ full_name: 'Made Up Crew', email: null, enabled: true, password_hash: null })
    const [row] = await crew()
    expect(row.login).toBe(user.row_id)
    const [identity] = await sql`select subject, sign_in_name, linked_by, ended_at from sign_in_identity where person_id = ${user.row_id}`
    expect(identity).toMatchObject({ subject: RECORD, sign_in_name: CODE, linked_by: 'roster-first-sign-in', ended_at: null })
    const held = await sql`select system, value, verified, upper_inf(valid) as current from person_identifier where person_id = ${user.row_id} order by system`
    expect(held).toEqual([
      { system: 'stylehr-employee-code', value: CODE, verified: true, current: true },
      { system: 'stylehr-employee-id', value: RECORD, verified: true, current: true },
    ])
  })

  // #1104: the roster's code carries a region prefix the service has never heard of.
  describe('the ID staff type sits in its own column, beside a prefixed code', () => {
    const PREFIXED = `KL-${CODE}`
    const ownColumn = { ...ROSTER, sign_in_id_column: 'crew_login', identifiers: { 'stylehr-employee-code': 'crew_login' } }

    test('the ID staff type signs in, and is what the service is asked about', async ({ api, admin }) => {
      await setUp(admin, { roster: ownColumn, rows: [crewRow({ crew_no: PREFIXED, crew_login: CODE })] })
      const calls = provider()

      const res = await signIn(api, CODE)

      expect(res.status).toBe(200)
      expect(calls).toEqual([{ body: { email: CODE, password: PASSWORD } }])
      const [row] = await crew(PREFIXED)
      expect(row.login).toBeTruthy()
    })

    test('the prefixed code is not a sign-in ID', async ({ api, admin }) => {
      await setUp(admin, { roster: ownColumn, rows: [crewRow({ crew_no: PREFIXED, crew_login: CODE })] })
      await expectRefusedWithoutAsking(api, provider(), PREFIXED)
    })

    test('two people sharing the typed ID are both refused, and it is noted', async ({ api, admin }) => {
      await setUp(admin, {
        roster: ownColumn,
        rows: [crewRow({ crew_no: PREFIXED, crew_login: CODE }), crewRow({ crew_no: `TN-${CODE}`, crew_login: CODE, hr_record: '7002' })],
      })
      await expectRefusedWithoutAsking(api, provider(), CODE)
      expect((await heldNotes())[0]).toMatch(/ duplicate_id$/)
    })
  })

  test('a new person holds no role', async ({ api, admin }) => {
    await setUp(admin)
    provider()
    const res = await signIn(api)
    const { user } = (await res.json()) as { user: { row_id: string } }
    expect(await sql`select role from has_role where parent = ${user.row_id}`).toEqual([])
  })

  test('the ID may differ in case and surrounding spaces', async ({ api, admin }) => {
    await setUp(admin)
    const calls = provider()
    expect((await signIn(api, `  ${CODE.toLowerCase()} `)).status).toBe(200)
    expect(calls).toHaveLength(1)
    expect((await crew())[0].login).toBeTruthy()
  })

  test('a later sign-in takes the linked path, onto the same person', async ({ api, admin }) => {
    await setUp(admin)
    const calls = provider()
    const first = (await (await signIn(api)).json()) as { user: { row_id: string } }
    const people = await peopleCount()
    const again = await signIn(api)
    expect(again.status).toBe(200)
    expect(((await again.json()) as { user: { row_id: string } }).user.row_id).toBe(first.user.row_id)
    expect(calls).toHaveLength(2)
    expect(await peopleCount()).toBe(people)
  })

  test('a later sign-in after the row moved on is still the linked person, and a leaver is disabled', async ({ api, admin }) => {
    await setUp(admin)
    provider()
    const first = (await (await signIn(api)).json()) as { user: { row_id: string } }
    provider(() => Response.json({ access: 'opaque', employee_id: Number(RECORD), is_active: false }))
    expect((await signIn(api)).status).toBe(403)
    expect((await sql`select enabled from person where row_id = ${first.user.row_id}`)[0].enabled).toBe(false)
  })
})

describe('a positive answer is required, and must name the same record', () => {
  test.for([
    ['a wrong password', () => Response.json({ message: 'Invalid Credentials' }, { status: 401 }), 401],
    ['a body with no positive signal', () => Response.json({ hello: 'there' }), 503],
    ['the service being down', () => new Response('', { status: 503 }), 503],
    ['someone who has left', () => Response.json({ access: 'opaque', employee_id: Number(RECORD), is_active: false }), 401],
    ['an answer that names no record', () => Response.json({ access: 'opaque', id: 99, employee_id: '' }), 401],
    ['an answer naming another record', () => Response.json({ access: 'opaque', employee_id: 7002 }), 401],
  ] as const)('%s changes nothing', async ([, answer, status], { api, admin }) => {
    await setUp(admin)
    provider(answer)
    const before = await peopleCount()
    const res = await signIn(api)
    expect(res.status).toBe(status)
    expect(res.headers.getSetCookie().find((c) => c.startsWith('sid='))).toBeUndefined()
    expect(await peopleCount()).toBe(before)
    expect((await crew())[0].login).toBeNull()
    expect(await sql`select 1 from sign_in_identity where subject = ${RECORD}`).toEqual([])
    expect(await sql`select 1 from person_identifier where value in (${RECORD}, ${CODE})`).toEqual([])
  })

  test('another record answering is raised for an administrator, in the generic wording', async ({ api, admin }) => {
    await setUp(admin)
    provider(() => Response.json({ access: 'opaque', employee_id: 7002 }))
    const res = await signIn(api)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(REFUSED)
    const [row] = await crew()
    expect(await heldNotes()).toEqual([`first_sign_in_held stylehr ${String(row.row_id)} service_named_another_record`])
  })
})

describe('every later sign-in must name the same record too', () => {
  const firstThen = async (api: TestClient, admin: TestClient, answer: () => Response) => {
    await setUp(admin)
    provider()
    const first = (await (await signIn(api)).json()) as { user: { row_id: string } }
    provider(answer)
    const res = await signIn(api)
    const [person] = await sql`select enabled from person where row_id = ${first.user.row_id}`
    return { res, person }
  }

  test('a yes naming another record signs nobody in', async ({ api, admin }) => {
    const { res, person } = await firstThen(api, admin, () => Response.json({ access: 'opaque', employee_id: 7002 }))
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(REFUSED)
    expect(res.headers.getSetCookie().find((c) => c.startsWith('sid='))).toBeUndefined()
    expect(person.enabled).toBe(true)
  })

  test('a yes naming no record signs nobody in', async ({ api, admin }) => {
    const { res } = await firstThen(api, admin, () => Response.json({ access: 'opaque', id: 99 }))
    expect(res.status).toBe(401)
  })

  test('another record having left does not disable this person', async ({ api, admin }) => {
    const { res, person } = await firstThen(api, admin, () => Response.json({ access: 'opaque', employee_id: 7002, is_active: false }))
    expect(res.status).toBe(401)
    expect(person.enabled).toBe(true)
  })

  test('a leaver answer naming no record does not disable this person', async ({ api, admin }) => {
    const { res, person } = await firstThen(api, admin, () => Response.json({ is_active: false }))
    expect(res.status).toBe(401)
    expect(person.enabled).toBe(true)
  })

  test('an answer naming two records is not believed, for a yes or for a leaver', async ({ api, admin }) => {
    const { res, person } = await firstThen(api, admin, () => Response.json({ employee_id: Number(RECORD), employee: { employee_id: 7002, is_active: false } }))
    expect(res.status).toBe(401)
    expect(person.enabled).toBe(true)
    provider(() => Response.json({ employee_id: Number(RECORD), user: { employee_id: 7002, access: 'opaque' } }))
    expect((await signIn(api)).status).toBe(401)
  })

  test('a later answer naming another record is noted for an administrator', async ({ api, admin }) => {
    await firstThen(api, admin, () => Response.json({ access: 'opaque', employee_id: 7002 }))
    const [link] = await sql`select id from sign_in_identity where subject = ${RECORD}`
    expect(await heldNotes()).toEqual([`first_sign_in_held stylehr ${String(link.id)} service_named_another_record`])
  })

  test('with the roster taken off the method, it refuses rather than stop checking', async ({ api, admin }) => {
    await setUp(admin)
    provider()
    await signIn(api)
    await sql`update sign_in_method set new_person = 'refuse', settings = null where row_id = 'stylehr'`
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expectRefusedWithoutAsking(api, provider())
  })

  test('a person linked by an administrator is not held to it', async ({ api, admin, createUser }) => {
    const other = await createUser({ email: 'other.crew@example.test' })
    await setUp(admin)
    await linkDelegated(other.user!, 'TT-5555', { subject: '7555' })
    provider(() => Response.json({ access: 'opaque', id: 99 }))
    expect((await signIn(api, 'TT-5555')).status).toBe(200)
  })
})

describe('the service is not asked, and the refusal says nothing', () => {
  test('an ID on no roster row', async ({ api, admin }) => {
    await setUp(admin)
    await expectRefusedWithoutAsking(api, provider(), 'TT-9999')
    expect(await heldNotes()).toEqual([])
  })

  test('a blank number on the roster never matches a blank-looking ID', async ({ api, admin }) => {
    await setUp(admin, { rows: [crewRow({ crew_no: '' })] })
    await expectRefusedWithoutAsking(api, provider(), ' . ')
  })

  test.for(['Left', 'Test record', ''])('a row whose status is "%s"', async (state, { api, admin }) => {
    await setUp(admin, { rows: [crewRow({ crew_state: state })] })
    await expectRefusedWithoutAsking(api, provider())
  })

  test('two rows with one ID are raised, even when one has left', async ({ api, admin }) => {
    await setUp(admin, { rows: [crewRow(), crewRow({ hr_record: '7002', crew_state: 'Left' })] })
    await expectRefusedWithoutAsking(api, provider())
    const notes = await heldNotes()
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/ duplicate_id$/)
  })

  test('a retired row is out of use, whatever its status says', async ({ api, admin }) => {
    await setUp(admin)
    await sql`update featherbase.crew_list set retired_at = now(), retired_reason = 'Entered by mistake' where crew_no = ${CODE}`
    await expectRefusedWithoutAsking(api, provider())
  })

  test('a row that already has a person', async ({ api, admin, createUser }) => {
    const other = await createUser({ email: 'other.crew@example.test' })
    await setUp(admin, { rows: [crewRow({ login: other.user })] })
    await expectRefusedWithoutAsking(api, provider())
    expect((await heldNotes())[0]).toMatch(/ row_has_person$/)
  })

  test('a row with no record number', async ({ api, admin }) => {
    await setUp(admin, { rows: [crewRow({ hr_record: '' })] })
    await expectRefusedWithoutAsking(api, provider())
    expect((await heldNotes())[0]).toMatch(/ no_record_number$/)
  })

  test('the record number is already another live link', async ({ api, admin, createUser }) => {
    const other = await createUser({ email: 'other.crew@example.test' })
    await setUp(admin)
    await linkDelegated(other.user!, 'some-other-id', { subject: RECORD })
    await expectRefusedWithoutAsking(api, provider())
    expect((await heldNotes())[0]).toMatch(/ already_linked$/)
  })

  test('an ended link on the record never reopens', async ({ api, admin, createUser }) => {
    const other = await createUser({ email: 'other.crew@example.test' })
    await setUp(admin)
    const id = await linkDelegated(other.user!, CODE, { subject: RECORD })
    await sql`update sign_in_identity set ended_at = now(), ended_reason = 'unlinked' where id = ${id}`
    await expectRefusedWithoutAsking(api, provider())
    expect((await heldNotes())[0]).toMatch(/ already_linked$/)
  })

  test('someone already holds the employee code', async ({ api, admin, createUser }) => {
    const other = await createUser({ email: 'other.crew@example.test' })
    await setUp(admin)
    await giveEmployeeCode(other.user!, CODE)
    await expectRefusedWithoutAsking(api, provider())
    expect((await heldNotes())[0]).toMatch(/ already_linked$/)
  })

  test('the same refusal is noted once, however often it is tried', async ({ api, admin }) => {
    await setUp(admin, { rows: [crewRow(), crewRow({ hr_record: '7002' })] })
    provider()
    await signIn(api)
    await signIn(api)
    expect(await heldNotes()).toHaveLength(1)
  })

  test('test mode never makes anyone', async ({ api, admin }) => {
    await setUp(admin)
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    await expectRefusedWithoutAsking(api, provider())
  })

  test('the method rule still decides: refuse means refuse', async ({ api, admin }) => {
    await setUp(admin, { rule: 'refuse' })
    await expectRefusedWithoutAsking(api, provider())
  })

  test.for([
    ['a Table that does not exist', { ...ROSTER, table: 'No Such Table' }],
    ['a column that does not exist', { ...ROSTER, status_column: 'no_such_column' }],
    ['a person column that is not a link to Person', { ...ROSTER, person_column: 'crew_name' }],
    ['an identifier system that does not exist', { ...ROSTER, identifiers: { 'no-such-system': 'crew_no' } }],
    ['a malformed setting', { ...ROSTER, sign_in_id_column: 'crew no; drop table person' }],
    ['a blank setting', { ...ROSTER, current_status: ' ' }],
    ['identifiers that are not column names', { ...ROSTER, identifiers: { 'stylehr-employee-code': 'crew no' } }],
  ] as const)('a roster naming %s fails closed', async ([, roster], { api, admin }) => {
    await setUp(admin, { roster })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expectRefusedWithoutAsking(api, provider())
  })

  test('a roster that is not an object, or absent, fails closed', async ({ api, admin }) => {
    await setUp(admin, { roster: 'not an object' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expectRefusedWithoutAsking(api, provider())
    await sql`update sign_in_method set settings = null where row_id = 'stylehr'`
    await expectRefusedWithoutAsking(api, provider())
  })

  test('a method with no record-number system fails closed', async ({ api, admin }) => {
    await setUp(admin)
    await sql`update sign_in_method set identifier_system = null where row_id = 'stylehr'`
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expectRefusedWithoutAsking(api, provider())
  })

  test('nothing about the person or the password reaches the log', async ({ api, admin }) => {
    await setUp(admin, { rows: [crewRow(), crewRow({ hr_record: '7002' })] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    provider()
    await signIn(api)
    const said = JSON.stringify([...warn.mock.calls, ...log.mock.calls])
    for (const secret of [CODE, RECORD, PASSWORD, 'Made Up Crew']) expect(said).not.toContain(secret)
    expect((await heldNotes()).join()).not.toContain(CODE)
  })
})

describe('two first sign-ins at once', () => {
  test('the one that loses, having already been asked about, signs in as the winner', async ({ api, admin }) => {
    await setUp(admin)
    const before = await peopleCount()
    let nested = false
    let inner: { user: { row_id: string } | string } | undefined
    provider(async () => {
      if (!nested) {
        // The other sign-in, finishing while this one waits on the service. Called
        // directly: the sandbox takes HTTP requests one at a time. The real race,
        // across commits, is in first-sign-in-link-commit.test.ts.
        nested = true
        inner = await rosterFirstSignIn((await delegatedLoginConfig('stylehr'))!, CODE, PASSWORD, null)
      }
      return Response.json({ access: 'opaque', employee_id: Number(RECORD) })
    })
    const outer = await signIn(api)
    expect(outer.status).toBe(200)
    expect(((await outer.json()) as { user: { row_id: string } }).user.row_id).toBe(typeof inner!.user === 'string' ? inner!.user : inner!.user.row_id)
    expect(await peopleCount()).toBe(before + 1)
  })

  test('the one that arrives just after the winner committed is asked about, and lands on the winner', async ({ api, admin }) => {
    await setUp(admin)
    const calls = provider()
    const cfg = (await delegatedLoginConfig('stylehr'))!
    const winner = await rosterFirstSignIn(cfg, CODE, PASSWORD, null)
    const late = await rosterFirstSignIn(cfg, CODE, PASSWORD, null)
    expect((late.user as unknown as { row_id: string }).row_id).toBe((winner.user as unknown as { row_id: string }).row_id)
    expect(calls).toHaveLength(2)
    expect(await heldNotes()).toEqual([])
    provider(() => Response.json({ message: 'Invalid Credentials' }, { status: 401 }))
    await expect(rosterFirstSignIn(cfg, CODE, 'wrong', null)).rejects.toThrow(REFUSED)
  })

  test('a row taken by another person meanwhile is refused and raised', async ({ api, admin, createUser }) => {
    const other = await createUser({ email: 'other.crew@example.test' })
    await setUp(admin)
    const before = await peopleCount()
    provider(async () => {
      await sql`update featherbase.crew_list set login = ${other.user!} where crew_no = ${CODE}`
      return Response.json({ access: 'opaque', employee_id: Number(RECORD) })
    })
    const res = await signIn(api)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(REFUSED)
    expect(await peopleCount()).toBe(before)
    expect((await heldNotes())[0]).toMatch(/ row_has_person$/)
  })

  test('a row whose record changed while taken is not the winner', async ({ api, admin }) => {
    await setUp(admin)
    provider()
    const cfg = (await delegatedLoginConfig('stylehr'))!
    await rosterFirstSignIn(cfg, CODE, PASSWORD, null)
    provider(async () => {
      await sql`update featherbase.crew_list set hr_record = '7009' where crew_no = ${CODE}`
      return Response.json({ access: 'opaque', employee_id: Number(RECORD) })
    })
    await expect(rosterFirstSignIn(cfg, CODE, PASSWORD, null)).rejects.toThrow(REFUSED)
  })

  test('a failure midway leaves nothing behind', async ({ api, admin, createUser }) => {
    const other = await createUser({ email: 'other.crew@example.test' })
    await setUp(admin)
    const before = await peopleCount()
    provider(async () => {
      // The code goes to someone else after the check, so the transaction's last writes fail.
      await giveEmployeeCode(other.user!, CODE)
      return Response.json({ access: 'opaque', employee_id: Number(RECORD) })
    })
    const res = await signIn(api)
    expect(res.status).toBe(401)
    expect(await peopleCount()).toBe(before)
    expect((await crew())[0].login).toBeNull()
    expect(await sql`select 1 from sign_in_identity where subject = ${RECORD}`).toEqual([])
  })
})

describe('what cannot be read is refused', () => {
  test('a save that fails midway keeps nothing and is noted', async ({ api, admin }) => {
    await setUp(admin)
    const before = await peopleCount()
    provider(async () => {
      // Recording the employee code now fails, after the person and link were written.
      await sql`update identifier_system set enabled = false where row_id = 'stylehr-employee-code'`
      return Response.json({ access: 'opaque', employee_id: Number(RECORD) })
    })
    const res = await signIn(api)
    expect(res.status).toBe(401)
    expect(await peopleCount()).toBe(before)
    expect(await sql`select 1 from sign_in_identity where subject = ${RECORD}`).toEqual([])
    expect(await sql`select 1 from person_identifier where value in (${RECORD}, ${CODE})`).toEqual([])
    expect((await heldNotes())[0]).toMatch(/ link_failed$/)
  })

  test.for([
    ['removed', () => sql`delete from featherbase.crew_list where crew_no = ${CODE}`, 'link_failed'],
    ['no longer current', () => sql`update featherbase.crew_list set crew_state = 'Left' where crew_no = ${CODE}`, 'link_failed'],
    ['retired', () => sql`update featherbase.crew_list set retired_at = now(), retired_reason = 'Entered by mistake' where crew_no = ${CODE}`, 'link_failed'],
    ['given another record', () => sql`update featherbase.crew_list set hr_record = '7009' where crew_no = ${CODE}`, 'link_failed'],
    ['joined by a second row with its ID', () => sql`insert into featherbase.crew_list (row_id, crew_name, crew_no, hr_record, crew_state) values ('second-crew', 'Made Up Two', ${CODE}, '7003', 'Working')`, 'duplicate_id'],
  ] as const)('a row %s while the service was asked is not linked', async ([, change, reason], { api, admin }) => {
    await setUp(admin)
    const before = await peopleCount()
    provider(async () => {
      await change()
      return Response.json({ access: 'opaque', employee_id: Number(RECORD) })
    })
    expect((await signIn(api)).status).toBe(401)
    expect(await peopleCount()).toBe(before)
    expect((await heldNotes())[0]).toMatch(new RegExp(` ${reason}$`))
  })

  test('a roster may also list the record number system, recorded once', async ({ api, admin }) => {
    await setUp(admin, { roster: { ...ROSTER, identifiers: { 'stylehr-employee-id': 'hr_record', 'stylehr-employee-code': 'crew_no' } } })
    provider()
    expect((await signIn(api)).status).toBe(200)
    expect(await sql`select 1 from person_identifier where value = ${RECORD}`).toHaveLength(1)
  })

  test('a roster with no extra identifiers records the record number alone', async ({ api, admin }) => {
    const { identifiers: _none, ...roster } = ROSTER
    await setUp(admin, { roster })
    provider()
    expect((await signIn(api)).status).toBe(200)
    expect(await sql`select system from person_identifier where value in (${RECORD}, ${CODE})`).toEqual([{ system: 'stylehr-employee-id' }])
  })

  test('a Table in an outside source fails closed', async ({ api, admin }) => {
    await setUp(admin)
    await sql`update table_def set data_source = 'elsewhere' where name = ${TABLE}`
    invalidateMeta(TABLE)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expectRefusedWithoutAsking(api, provider())
  })

  test('a database failure midway stays a failure, keeps nothing, and is not called a wrong password', async ({ api, admin }) => {
    await setUp(admin)
    const before = await peopleCount()
    provider(async () => {
      await sql`alter table featherbase.crew_list drop column login`
      return Response.json({ access: 'opaque', employee_id: Number(RECORD) })
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await signIn(api)).status).toBe(500)
    expect(await peopleCount()).toBe(before)
  })

  test('losing the unique link to another row keeps nothing, is noted, and logs no value', async ({ api, admin }) => {
    await setUp(admin)
    const before = await peopleCount()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    provider(async () => {
      // What a second row's commit does to this insert, with a value no check can see in time.
      await sql.unsafe(`create function featherbase.lose_the_race() returns trigger language plpgsql as $$
        begin raise unique_violation using message = 'lost'; end $$`)
      await sql.unsafe(`create trigger lose_the_race before insert on featherbase.sign_in_identity
        for each row execute function featherbase.lose_the_race()`)
      return Response.json({ access: 'opaque', employee_id: Number(RECORD) })
    })
    const res = await signIn(api)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(REFUSED)
    expect(await peopleCount()).toBe(before)
    expect((await heldNotes())[0]).toMatch(/ link_failed$/)
    expect(JSON.stringify([...error.mock.calls, ...warn.mock.calls])).not.toContain(RECORD)
  })

  test('a value its identifier system cannot hold is noted, without asking', async ({ api, admin }) => {
    await setUp(admin, { roster: { ...ROSTER, identifiers: { 'stylehr-employee-code': 'login' } } })
    await expectRefusedWithoutAsking(api, provider())
    expect((await heldNotes())[0]).toMatch(/ link_failed$/)
  })

  test('a roster-made link is refused when the roster has become unreadable', async ({ api, admin }) => {
    await setUp(admin)
    provider()
    await signIn(api)
    await sql`update sign_in_method set settings = ${sql.json({ roster: 'not an object' })} where row_id = 'stylehr'`
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expectRefusedWithoutAsking(api, provider())
  })

  test('settings saved as text that is not JSON read as none', async ({ admin }) => {
    await setUp(admin)
    await sql`update sign_in_method set settings = to_jsonb('not json'::text) where row_id = 'stylehr'`
    expect((await getSignInMethod('stylehr'))?.settings).toBeNull()
  })
})

describe('the rule is configuration', () => {
  const method = { row_id: 'hr_two', kind: 'delegated_password', label: 'HR Two', enabled: false }
  const METHODS = `/api/table/${encodeURIComponent('Sign In Method')}`
  async function patchMethod(admin: TestClient, key: string, change: Record<string, unknown>) {
    const [r] = await sql`select updated_at from sign_in_method where row_id = ${key}`
    return admin.fetch(`${METHODS}/${key}`, { method: 'PATCH', body: JSON.stringify({ ...change, updated_at: r.updated_at }) })
  }

  test('only a delegated method may take it, and only with a whole roster', async ({ admin }) => {
    const post = (body: Record<string, unknown>) => admin.fetch(METHODS, { method: 'POST', body: JSON.stringify(body) })
    expect((await post({ ...method, new_person: 'create_if_on_roster' })).status).toBe(417)
    expect((await post({ ...method, new_person: 'create_if_on_roster', settings: JSON.stringify({ roster: { table: TABLE } }) })).status).toBe(417)
    expect((await post({ ...method, new_person: 'create_if_on_roster', settings: JSON.stringify({ roster: ROSTER }) })).status).toBe(201)
    expect((await getSignInMethod('hr_two'))?.settings).toMatchObject({ roster: { table: TABLE } })
    expect((await patchMethod(admin, 'password', { new_person: 'create_if_on_roster' })).status).toBe(417)
    expect((await patchMethod(admin, 'google', { new_person: 'create_if_on_roster' })).status).toBe(417)
  })

  test('an administrator cannot leave a roster method without its roster', async ({ admin }) => {
    await setUp(admin)
    expect((await patchMethod(admin, 'stylehr', { settings: JSON.stringify({}) })).status).toBe(417)
  })

  // #1061: the owner turned StyleHR sign-in on in the instance file.
  test('the instance file ships the method on, needing no variable', async () => {
    const file = JSON.parse(readFileSync(new URL('../../../client-apps/jeyarama/instances/dash/instance-settings.json', import.meta.url), 'utf8')) as {
      settings: { 'Sign In Method': { row_id: string }[] }
      environments: Record<string, { settings: { 'Sign In Method'?: { row_id: string }[] } }>
    }
    const stylehr = file.settings['Sign In Method'].find((m) => m.row_id === 'stylehr')
    expect(stylehr).toMatchObject({ kind: 'delegated_password', enabled: true, new_person: 'create_if_on_roster', settings: { provider_record_key: 'employee_id' } })
    // #1104: staff type StyleHR's own code; employee_code carries a region prefix.
    expect(stylehr).toMatchObject({ settings: { roster: { sign_in_id_column: 'employee_code_stylehr', identifiers: { 'stylehr-employee-code': 'employee_code_stylehr' } } } })
    for (const section of Object.values(file.environments))
      expect((section.settings['Sign In Method'] ?? []).some((m) => m.row_id === 'stylehr')).toBe(false)
    await applyInstanceSettings({ settings: { 'Sign In Method': [stylehr!] } }, { by: 'Administrator' })
    const [row] = await sql`select enabled, new_person from sign_in_method where row_id = 'stylehr'`
    expect(row).toEqual({ enabled: true, new_person: 'create_if_on_roster' })
    expect((await getSignInMethod('stylehr'))?.settings).toMatchObject({ roster: { table: 'Employee', provider_record_key: 'employee_id' } })
  })
})
