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
/** An employee code for `person`, from `since` (the latest-joined comes first), in a system of the given
 *  sensitivity; `until` ends it. */
async function code(person: string, value: string, since = '2026-01-01', { sensitivity = 'Normal', until = null as string | null } = {}) {
  const system = sensitivity === 'Normal' ? SYSTEM : `${SYSTEM}-${sensitivity.replace(/\W+/g, '-').toLowerCase()}`
  await sql`insert into identifier_system (row_id, label, kind, sensitivity, match, enabled)
    values (${system}, ${`Made-up staff code (${sensitivity})`}, 'employee-record', ${sensitivity}, 'Off', true) on conflict (row_id) do nothing`
  await sql`insert into person_identifier (id, person_id, system, value, one_holder, source, recorded_by, valid)
    values (${`pid_pl${String(++identifier).padStart(18, 'a')}`}, ${person}, ${system}, ${value}, true, 'test', 'test', daterange(${since}::date, ${until}::date))`
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

  // Codex standard round 1: an instance's own Employee Table joins by a Metadata Override, as #1346's searched columns do.
  test('a Metadata Override makes a Table a person\'s record; an unrelated update never writes it in; a rename carries it', async ({ admin }) => {
    const staff = await makeTable(admin, { name: 'Pl Roster', id_pattern: 'field:roster_code', title_column: 'full_name',
      columns: ['roster_code', 'full_name', { column_name: 'person', column_type: 'Reference', reference_table: 'Person' }] })
    const person = await makePerson({ full_name: 'Overridden Person', email: 'overridden@example.test' })
    await admin.post(staff.url, { roster_code: 'PL-OV1', full_name: 'Overridden Person', person })
    expect((await group(admin, 'Overridden Person', 'Pl Roster')).map((h) => h.row_id)).toEqual(['PL-OV1'])
    await admin.post('/api/save_row', { table: 'Metadata Override', row: { table_name: staff.name, property: 'person_column', value: 'person' } })
    expect(await group(admin, 'Overridden Person', 'Pl Roster')).toEqual([])
    expect((await group(admin, 'Overridden Person', 'Person')).map((h) => h.row_id)).toEqual([person])
    const columns = (await getMeta(staff.name)).columns.map(({ column_name, column_type, reference_table }) => ({ column_name, column_type, reference_table }))
    await updateTable(staff.name, { name: staff.name, description: 'changed', columns })
    expect(await sql`select person_column from table_def where name = ${staff.name}`).toEqual([{ person_column: null }])
    await renameColumn(staff.name, 'person', 'staff_member')
    expect((await getMeta(staff.name)).person_column).toBe('staff_member')
    // An override naming anything but a Reference to Person names none.
    const [o] = await sql`select row_id, updated_at from metadata_override where table_name = ${staff.name} and property = 'person_column'`
    await admin.post('/api/save_row', { table: 'Metadata Override', row: { row_id: o!.row_id, value: 'full_name', updated_at: o!.updated_at } })
    expect((await getMeta(staff.name)).person_column).toBeNull()
  })

  test('a staff row whose person\'s name the viewer may not read stays a staff row, never named by an id', async ({ admin, createUser }) => {
    await threeMeenas(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Pl Nameless' } })
    await grantRole(admin, { role: 'Pl Nameless', table: 'Pl Staff', can_read: true })
    await grantRole(admin, { role: 'Pl Nameless', table: 'Person', can_read: true })
    await admin.post('/api/save_row', { table: 'Metadata Override', row: { table_name: 'Person', column_name: 'full_name', property: 'hidden', value: '1' } })
    const viewer = await createUser({ email: 'pl-nameless@example.test', roles: ['Pl Nameless'] })
    const people = await group(viewer, 'pl-77002', 'Person')
    expect(people.every((h) => !h.title.startsWith('psn_'))).toBe(true)
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

  // Codex adversarial round 1: a code reaches a viewer only as the person's identifiers panel would show it.
  test('a restricted code shows only to a viewer who may read restricted identifiers; a hidden one to nobody', async ({ admin, createUser }) => {
    const person = await makePerson({ full_name: 'Restricted Coded', email: 'restricted.coded@example.test' })
    await code(person, 'PL-R1', '2026-02-01', { sensitivity: 'Restricted' })
    await code(person, 'PL-H1', '2026-03-01', { sensitivity: 'Restricted, hidden' })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Pl Person Reader' } })
    await grantRole(admin, { role: 'Pl Person Reader', table: 'Person', can_read: true })
    const reader = await createUser({ email: 'pl-person-reader@example.test', roles: ['Pl Person Reader'] })
    expect((await personLabels([person], reader.user!)).get(person)).toEqual({ email: 'restricted.coded@example.test' })
    expect((await personLabels([person], 'Administrator')).get(person)).toEqual({ code: 'PL-R1', email: 'restricted.coded@example.test' })
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

/** A made-up assignment whose ends_on a leaving day comes from; only the administrator reads it. */
async function assignment(admin: TestClient) {
  const table = await makeTable(admin, { name: 'Pl Assignment', id_pattern: 'prompt', columns: [{ column_name: 'ends_on', column_type: 'Date' }] })
  await admin.post(table.url, { row_id: 'pl-asg-1', ends_on: '2026-03-12' })
  return { table: 'Pl Assignment', id: 'pl-asg-1', column: 'ends_on' }
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
    await code(leaver, 'PL-55001', '2024-01-01', { until: '2026-08-31' })
    await describing(admin)
    const from = await assignment(admin)
    said().answer = (persons) => persons.map((person) => ({ person, status: 'left', code: 'PL-55001', left_on: '2026-08-31', left_on_from: from, jobs: [] }))
    expect((await personLabels([leaver], 'Administrator')).get(leaver))
      .toEqual({ email: 'left.lately@example.test', standing: 'left', left_on: '2026-08-31', code: 'PL-55001' })
  })

  // UI owner (19-Nov): the code never drops, a leaver's included.
  test("a leaver whose app answer names no code reads their latest ended code", async ({ admin }) => {
    const leaver = await makePerson({ full_name: 'Left Uncoded', email: 'left.uncoded@example.test' })
    await code(leaver, 'PL-55003', '2023-01-01', { until: '2026-03-12' })
    await describing(admin)
    const from = await assignment(admin)
    said().answer = (persons) => persons.map((person) => ({ person, status: 'left', code: null, left_on: '2026-03-12', left_on_from: from, jobs: [] }))
    expect((await personLabels([leaver], 'Administrator')).get(leaver)).toMatchObject({ standing: 'left', left_on: '2026-03-12', code: 'PL-55003' })
  })

  // Codex (focused round): the app reads the day as its own actor; a viewer is told it only where they may read its field.
  test('a leaving day reaches only a viewer who may read the field it comes from, in the label and on the Person page', async ({ admin, createUser }) => {
    const leaver = await makePerson({ full_name: 'Left Quietly', email: 'left.quietly@example.test' })
    await code(leaver, 'PL-55004', '2023-01-01', { until: '2026-03-12' })
    await describing(admin)
    const from = await assignment(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Pl Person Only' } })
    await grantRole(admin, { role: 'Pl Person Only', table: 'Person', can_read: true })
    const reader = await createUser({ email: 'pl-person-only@example.test', roles: ['Pl Person Only'] })
    said().answer = (persons) => persons.map((person) => ({ person, status: 'left', code: 'PL-55004', left_on: '2026-03-12', left_on_from: from, jobs: [] }))
    expect((await personLabels([leaver], reader.user!)).get(leaver)).toEqual({ standing: 'left', code: 'PL-55004', email: 'left.quietly@example.test' })
    expect(await reader.get(`/api/people/${leaver}/standing`)).not.toHaveProperty('left_on')
    expect(await admin.get(`/api/people/${leaver}/standing`)).toMatchObject({ left_on: '2026-03-12' })
    // A day the app gives with no field it comes from is told to no one.
    said().answer = (persons) => persons.map((person) => ({ person, status: 'left', code: 'PL-55004', left_on: '2026-03-12', jobs: [] }))
    expect((await personLabels([leaver], 'Administrator')).get(leaver)).not.toHaveProperty('left_on')
  })

  test("the app's code never restores one the viewer may not see", async ({ admin, createUser }) => {
    const leaver = await makePerson({ full_name: 'Left Restricted', email: 'left.restricted@example.test' })
    await code(leaver, 'PL-55002', '2024-01-01', { sensitivity: 'Restricted', until: '2026-08-31' })
    await describing(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Pl Person Reader' } })
    await grantRole(admin, { role: 'Pl Person Reader', table: 'Person', can_read: true })
    const reader = await createUser({ email: 'pl-reader-2@example.test', roles: ['Pl Person Reader'] })
    said().answer = (persons) => persons.map((person) => ({ person, status: 'left', code: 'PL-55002', left_on: '2026-08-31', jobs: [] }))
    expect((await personLabels([leaver], reader.user!)).get(leaver)).not.toHaveProperty('code')
    expect((await personLabels([leaver], 'Administrator')).get(leaver)).toMatchObject({ code: 'PL-55002', standing: 'left' })
  })

  // Codex adversarial round 1: the Person page names a store or role by its own title as the viewer reads it.
  test("the Person page names a store and business role by the viewer's own read of their titles, never the app's words", async ({ admin, createUser }) => {
    const { ids } = await threeMeenas(admin)
    await describing(admin)
    await makeTable(admin, { name: 'Pl Guarded Role', id_pattern: 'prompt', title_column: 'title',
      columns: [{ column_name: 'title', column_type: 'Data', tier: 'restricted' }, 'note'] })
    await admin.post('/api/save_row', { table: 'Pl Guarded Role', row: { row_id: 'role-g', title: 'Guarded Title' } })
    const { viewer } = await roleAndStore(admin, createUser)
    await grantRole(admin, { role: 'Pl Viewer', table: 'Pl Guarded Role', can_read: true })
    said().answer = (persons) => persons.map((person) => ({ person, status: 'current', code: null,
      jobs: [{ job: 'Store Manager', site: { table: 'Pl Role', id: 'role-sm', name: 'App words' }, business_role: { table: 'Pl Guarded Role', id: 'role-g', name: 'App words' } }] }))
    const standing = await viewer.get<{ jobs: { site?: { name: string }; business_role?: unknown }[] }>(`/api/people/${ids[0]}/standing`)
    // The site reads its own title; the role's row is readable but its title is not, so it is left out.
    expect(standing.jobs).toEqual([{ job: 'Store Manager', site: { table: 'Pl Role', id: 'role-sm', name: 'Store Manager' } }])
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
