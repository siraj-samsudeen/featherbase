// #970: first sign-ins taking turns across real commits. Independent commits are
// essential: sandbox savepoints share one connection, so they cannot prove that
// a row lock makes the second sign-in wait and then see the first one's person.
import { expect, test } from 'vitest'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { _setDelegatedFetch } from '../src/delegated-login'
import { _setAlertSender } from '../src/waiting-for-access'
import { app } from '../src/index'
import { applySeedPack } from '../src/seed-packs'

const prove = process.env.FIRST_SIGN_IN_COMMIT_PROOF === '1' ? test : test.skip
const TABLE = 'Commit Crew'
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

const signIn = () => app.request('/api/login/delegated', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ usr: 'TT-2001', pwd: 'Made-Up-Pass-970!', method: 'stylehr' }),
})

prove('sign-ins that were all confirmed at once make one person, and all land on it', async () => {
  const [db] = await sql`select current_database() as name, (select value from internal_metadata where key = 'environment') as environment`
  expect(db.environment).toBe('test')
  expect(String(db.name)).toMatch(/_first_sign_in_commit_e2e$/)
  await applySeedPack('jeyarama')
  await saveDoc('Table', {
    name: TABLE, module: 'Core',
    columns: [
      { column_name: 'crew_name', label: 'Name', column_type: 'Data', reqd: true },
      { column_name: 'crew_no', label: 'Number', column_type: 'Data' },
      { column_name: 'hr_record', label: 'Record', column_type: 'Data' },
      { column_name: 'crew_state', label: 'State', column_type: 'Data' },
      { column_name: 'login', label: 'Login', column_type: 'Reference', reference_table: 'Person' },
    ],
  }, 'Administrator', 'insert')
  await saveDoc('Sign In Method', {
    row_id: 'stylehr', kind: 'delegated_password', label: 'StyleHR', enabled: true, self_link: false,
    new_person: 'create_if_on_roster', service_url: 'https://hr.example.test/api/login/', settings: JSON.stringify({ roster: ROSTER }),
  }, 'Administrator', 'insert')
  await applySeedPack('jeyarama')
  await saveDoc(TABLE, { crew_name: 'Made Up Crew', crew_no: 'TT-2001', hr_record: '8001', crew_state: 'Working' }, 'Administrator', 'insert')
  _setAlertSender(async () => {})

  // The stand-in holds every sign-in until all of them have been asked, so all
  // of them passed the check before asking and race for the row together.
  const racers = 4
  let waiting = 0
  let release!: () => void
  const allAsked = new Promise<void>((resolve) => { release = resolve })
  _setDelegatedFetch((async () => {
    if (++waiting === racers) release()
    await allAsked
    return Response.json({ access: 'opaque', employee_id: 8001 })
  }) as typeof fetch)
  try {
    const before = Number((await sql`select count(*)::int as n from person`)[0].n)
    const answers = await Promise.all(Array.from({ length: racers }, signIn))
    expect(answers.map((a) => a.status)).toEqual(Array(racers).fill(200))
    const people = new Set(await Promise.all(answers.map(async (a) => ((await a.json()) as { user: { row_id: string } }).user.row_id)))
    expect(people.size).toBe(1)
    expect(Number((await sql`select count(*)::int as n from person`)[0].n)).toBe(before + 1)
    expect(await sql`select person_id from sign_in_identity where subject = '8001'`).toHaveLength(1)
    expect(await sql`select 1 from person_identifier where value in ('8001', 'TT-2001')`).toHaveLength(2)
    const [row] = await sql`select login from commit_crew where crew_no = 'TT-2001'`
    expect(people.has(String(row.login))).toBe(true)
  } finally {
    _setDelegatedFetch(null)
    _setAlertSender(null)
  }
})
