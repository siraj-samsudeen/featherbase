// #1345: the Person Label. Search lists each human once (a person-record row folds into its
// Person) and tells people who share a name apart: `code · role · place`. The code is the
// platform's own; an app that describes people adds the rest, and each part shows only where
// the viewer may read the record it names. Made-up people throughout.
import { afterEach, describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { grantRole, makePerson, makeTable, searchLines } from './fixtures'
import { getMeta } from '../src/meta'
import { updateTable } from '../src/table-engine'
import { renameColumn } from '../src/table-rename'
import { discoverPackages } from '../src/runtime-packages'
import { personLabels } from '../src/person-labels'
import { sql } from '../src/db'

type Hit = { table: string; row_id: string; title: string; person?: Record<string, unknown> }
const group = async (client: TestClient, query: string, table: string) =>
  ((await searchLines(client, query)).find((l) => (l as { table?: string; hits?: unknown }).table === table && 'hits' in l) as { hits: Hit[] } | undefined)?.hits ?? []

const SYSTEM = 'pl-staff-code'
let identifier = 0
/** A current employee code for `person`, from `since` (the latest-joined comes first). */
async function code(person: string, value: string, since = '2026-01-01') {
  await sql`insert into identifier_system (row_id, label, kind, sensitivity, match, enabled)
    values (${SYSTEM}, 'Made-up staff code', 'employee-record', 'Normal', 'Off', true) on conflict (row_id) do nothing`
  await sql`insert into person_identifier (id, person_id, system, value, one_holder, source, recorded_by, valid)
    values (${`pid_pl${String(++identifier).padStart(18, 'a')}`}, ${person}, ${SYSTEM}, ${value}, true, 'test', 'test', daterange(${since}::date, null))`
}

/** The made-up staff list: a Table whose rows are a person's record, found by its code. */
async function staffTable(admin: TestClient) {
  return makeTable(admin, {
    name: 'Pl Staff', id_pattern: 'field:staff_code', title_column: 'full_name', person_column: 'person', search_columns: ['staff_code'],
    columns: ['staff_code', 'full_name', { column_name: 'person', column_type: 'Reference', reference_table: 'Person' }],
  })
}

/** Three made-up people who share one name, each on the staff list under their own code. */
async function threeMeenas(admin: TestClient) {
  const staff = await staffTable(admin)
  const ids: string[] = []
  for (const [i, value] of ['PL-77001', 'PL-77002', 'PL-77003'].entries()) {
    const person = await makePerson({ full_name: 'Meena Ravikumar', email: `meena.${i + 1}@example.test` })
    await code(person, value)
    await admin.post(staff.url, { staff_code: value, full_name: 'Meena Ravikumar', person })
    ids.push(person)
  }
  return { staff, ids }
}

describe('#1345: a Table names the column through which its rows are a person\'s record', () => {
  test('it must be a Reference to Person; an update that leaves it out keeps it; a rename carries it', async ({ admin }) => {
    const bad = await admin.fetch('/api/table_def', { method: 'POST', body: JSON.stringify({
      name: 'Pl Bad', person_column: 'note', columns: [{ column_name: 'note', column_type: 'Data' }] }) })
    expect(bad.status).toBe(417)
    expect(await bad.json()).toMatchObject({ error: { fields: { person_column: 'note is not a Reference to Person on this Table' } } })
    const table = await staffTable(admin)
    const columns = (await getMeta(table.name)).columns.map(({ column_name, column_type, reference_table }) => ({ column_name, column_type, reference_table }))
    await updateTable(table.name, { name: table.name, description: 'changed', columns })
    expect((await getMeta(table.name)).person_column).toBe('person')
    await renameColumn(table.name, 'person', 'staff_member')
    expect((await getMeta(table.name)).person_column).toBe('staff_member')
  })
})

describe('#1345: search lists each human once, told apart', () => {
  test('three people who share a name are three People, each with their own code, and no staff row twice', async ({ admin }) => {
    const { ids } = await threeMeenas(admin)
    const people = await group(admin, 'Meena Ravikumar', 'Person')
    expect(people.map((h) => h.row_id).sort()).toEqual([...ids].sort())
    expect(new Set(people.map((h) => h.person?.code))).toEqual(new Set(['PL-77001', 'PL-77002', 'PL-77003']))
    expect(await group(admin, 'Meena Ravikumar', 'Pl Staff')).toEqual([])
  })

  test('typing a staff code finds the person, not their staff row', async ({ admin }) => {
    const { ids } = await threeMeenas(admin)
    const people = await group(admin, 'pl-77002', 'Person')
    expect(people.map((h) => [h.row_id, h.title, h.person?.code])).toEqual([[ids[1], 'Meena Ravikumar', 'PL-77002']])
    expect(await group(admin, 'pl-77002', 'Pl Staff')).toEqual([])
  })

  test('a staff row whose person the viewer may not read stays a staff row', async ({ admin, createUser }) => {
    await threeMeenas(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Pl Staff Reader' } })
    await grantRole(admin, { role: 'Pl Staff Reader', table: 'Pl Staff', can_read: true })
    const reader = await createUser({ email: 'pl-staff-reader@example.test', roles: ['Pl Staff Reader'] })
    expect((await group(reader, 'pl-77002', 'Pl Staff')).map((h) => h.row_id)).toEqual(['PL-77002'])
    expect(await group(reader, 'pl-77002', 'Person')).toEqual([])
  })

  test('someone with no code reads by their email; their latest-joined code comes first, the rest after it', async ({ admin }) => {
    const plain = await makePerson({ full_name: 'Plain Visitor', email: 'plain.visitor@example.test' })
    const moved = await makePerson({ full_name: 'Moved Twice', email: 'moved.twice@example.test' })
    await code(moved, 'PL-10001', '2025-01-01')
    await code(moved, 'PL-20001', '2026-06-01')
    const labels = await personLabels([plain, moved], 'Administrator')
    expect(labels.get(plain)).toEqual({ email: 'plain.visitor@example.test' })
    expect(labels.get(moved)).toEqual({ code: 'PL-20001', more_codes: [{ code: 'PL-10001' }], email: 'moved.twice@example.test' })
  })

  test('a person the viewer may not read gets no label at all', async ({ admin, createUser }) => {
    const hidden = await makePerson({ full_name: 'Hidden Person' })
    await code(hidden, 'PL-90001')
    const outsider = await createUser({ email: 'pl-outsider@example.test' })
    expect((await personLabels([hidden], outsider.user!)).size).toBe(0)
  })
})

// ------------------------------------------------------------ the app layer

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const directories: string[] = []
const said = () => ((globalThis as unknown as { __people1345?: { answer?: (persons: string[]) => unknown; delay?: number } }).__people1345 ??= {})
afterEach(async () => {
  said().answer = undefined
  said().delay = undefined
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** bar-proof that says who people are (`people.describe`, #1267): its read answers what the test sets, after its delay. */
async function describing(admin: TestClient) {
  const directory = await mkdtemp(resolve('test/.person-label-1345-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.reads.operations = { ...manifest.reads.operations, describe: { policy: { kind: 'table' }, authorization: { kind: 'generic' } } }
  manifest.people = { describe: 'describe' }
  await writeFile(file, JSON.stringify(manifest))
  await appendFile(resolve(directory, 'server.mjs'), `
const told = (globalThis.__people1345 ??= {})
reads.describe = async ({ payload }) => {
  if (told.delay) await new Promise((done) => setTimeout(done, told.delay))
  return told.answer ? told.answer(payload.persons) : payload.persons.map((person) => ({ person, status: 'none' }))
}
`)
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
}

/** A made-up business role and store the app names, and a viewer who may read the role but not the store. */
async function roleAndStore(admin: TestClient, createUser: CreateUserFn) {
  const role = await makeTable(admin, { name: 'Pl Role', id_pattern: 'prompt', title_column: 'title', columns: ['title'] })
  const store = await makeTable(admin, { name: 'Pl Store', id_pattern: 'prompt', title_column: 'title', columns: ['title'] })
  await admin.post(role.url, { row_id: 'role-sm', title: 'Store Manager' })
  await admin.post(store.url, { row_id: 'store-lk', title: 'Lakeside' })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Pl Viewer' } })
  for (const table of ['Person', 'Pl Role']) await grantRole(admin, { role: 'Pl Viewer', table, can_read: true })
  const viewer = await createUser({ email: 'pl-viewer@example.test', roles: ['Pl Viewer'] })
  return { viewer }
}

const working = (persons: string[], extra: Record<string, unknown> = {}) => persons.map((person) => ({
  person, status: 'current', code: 'APP-CODE',
  jobs: [{ job: 'Store Manager (job words)', site: { table: 'Pl Store', id: 'store-lk', name: 'App words' }, business_role: { table: 'Pl Role', id: 'role-sm', name: 'App words' } }],
  ...extra,
}))

describe('#1345: the app that says who people are adds role and place; the platform shows only what the viewer may read', () => {
  test("a business role and store the viewer may read read as their records' own titles; one they may not is left out", async ({ admin, createUser }) => {
    const { ids } = await threeMeenas(admin)
    await describing(admin)
    const { viewer } = await roleAndStore(admin, createUser)
    said().answer = (persons) => working(persons)
    expect((await personLabels([ids[0]!], 'Administrator')).get(ids[0]!))
      .toEqual({ code: 'PL-77001', email: 'meena.1@example.test', standing: 'current', role: 'Store Manager', place: 'Lakeside' })
    expect((await personLabels([ids[0]!], viewer.user!)).get(ids[0]!))
      .toEqual({ code: 'PL-77001', email: 'meena.1@example.test', standing: 'current', role: 'Store Manager' })
    // And in search, as the viewer: each of the three reads the role, none the store.
    const people = await group(viewer, 'Meena Ravikumar', 'Person')
    expect(people.map((h) => [h.person?.role, 'place' in (h.person ?? {})])).toEqual([['Store Manager', false], ['Store Manager', false], ['Store Manager', false]])
  })

  test("a job with no business role reads by its words, as the Person page shows it; the platform's code wins over the app's", async ({ admin, createUser }) => {
    const { ids } = await threeMeenas(admin)
    await describing(admin)
    await roleAndStore(admin, createUser)
    said().answer = (persons) => persons.map((person) => ({ person, status: 'current', code: 'APP-CODE', jobs: [{ job: 'Cashier' }] }))
    expect((await personLabels([ids[0]!], 'Administrator')).get(ids[0]!)).toMatchObject({ code: 'PL-77001', role: 'Cashier' })
  })

  test("a leaver reads Former Staff with the day they left and the app's code, the platform holding none current", async ({ admin }) => {
    const leaver = await makePerson({ full_name: 'Left Lately', email: 'left.lately@example.test' })
    await describing(admin)
    said().answer = (persons) => persons.map((person) => ({ person, status: 'left', code: 'PL-55001', left_on: '2026-08-31', jobs: [] }))
    expect((await personLabels([leaver], 'Administrator')).get(leaver))
      .toEqual({ email: 'left.lately@example.test', standing: 'left', left_on: '2026-08-31', code: 'PL-55001' })
  })

  test('an app that is late, failing or answering nonsense adds nothing, and the label still reads code and email', async ({ admin }) => {
    const { ids } = await threeMeenas(admin)
    await describing(admin)
    said().answer = (persons) => working(persons)
    said().delay = 1000
    const started = Date.now()
    expect((await personLabels([ids[0]!], 'Administrator', 100)).get(ids[0]!)).toEqual({ code: 'PL-77001', email: 'meena.1@example.test' })
    expect(Date.now() - started).toBeLessThan(900)
    said().delay = undefined
    said().answer = () => ({ not: 'a list' })
    expect((await personLabels([ids[0]!], 'Administrator')).get(ids[0]!)).toEqual({ code: 'PL-77001', email: 'meena.1@example.test' })
    said().answer = () => { throw new Error('down') }
    expect((await personLabels([ids[0]!], 'Administrator')).get(ids[0]!)).toEqual({ code: 'PL-77001', email: 'meena.1@example.test' })
  })
})
