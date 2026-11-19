// #1340: an installed app describes rows of a Table it declares in its manifest's `records`, by one of its reads,
// run as the viewer; the generic list and record page draw the answer. The platform describes only rows the viewer
// may read, checks the answer against the one versioned shape, gives none when the app's read fails or answers
// another shape, and never names a record the viewer may not read. A preview read says what an action would do.
// Fixture: a copy of test-apps/fixtures/bar-proof with a `records` block.
import { afterEach, describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { expectStatus } from './fixtures'

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const NOTE = 'barproof.note'
const SECRET = 'barproof.secret'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

const tableRead = { policy: { kind: 'table' }, authorization: { kind: 'generic' } }

async function describing(records: unknown) {
  const directory = await mkdtemp(resolve('test/.records-1340-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.roles = ['Bar Reader', 'Bar Describer']
  // A second Table only a Bar Describer reads, so a record a Bar Reader may not read can be named.
  manifest.tables.push({ name: SECRET, label: 'secret', id_pattern: 'prompt', columns: [{ column_name: 'body', column_type: 'Data' }] })
  manifest.permissions.push({ table: SECRET, role: 'Bar Describer', can_read: true }, { table: NOTE, role: 'Bar Describer', can_read: true })
  manifest.reads.tables = [NOTE, SECRET]
  manifest.reads.operations = { ...manifest.reads.operations, describe_notes: tableRead, preview_tidy: tableRead }
  manifest.actions = { version: 2, tables: [NOTE], operations: { tidy: tableRead } }
  manifest.records = records
  await writeFile(file, JSON.stringify(manifest))
  await appendFile(resolve(directory, 'server.mjs'), `
const facts = (globalThis.__records1340 ??= { answer: null, asked: [] })
reads.describe_notes = ({ payload }) => { facts.asked.push(payload); if (facts.fails) throw new Error('down'); return facts.answer ?? answerFor(payload) }
reads.preview_tidy = () => facts.preview ?? previewFor()
export const actions = { tidy: () => ({ tidied: true }) }
function answerFor({ rows, page }) {
  return {
    version: 1,
    columns: [{ key: 'people', label: 'People' }],
    rows: Object.fromEntries(rows.map(row => [row, {
      facts: { people: { text: '2', tone: 'quiet' } },
      header: 'Note · 2 people',
      groups: [{ key: 'people', heading: 'People', count: 2, lines: [
        { parts: [{ record: { table: '${NOTE}', row, name: 'This note' } }, ' and ', { record: { table: '${SECRET}', row: 's1', name: 'The secret' } }], chip: { label: 'by hand', tone: 'caution' } },
      ] }],
    }])),
    actions: [{ key: 'tidy', label: 'Tidy The Notes', explain: 'Tidies every note. Running it again changes nothing.', href: '/featherbase/admin/table/${NOTE}/run/tidy' }],
  }
}
function previewFor() {
  return { version: 1, title: 'Tidy The Notes', status: 'Preview · nothing is saved until Run', sentence: ['Tidies ', { record: { table: '${SECRET}', row: 's1', name: 'The secret' } }, '.'],
    runLabel: 'Run', filters: [{ key: 'add', label: 'Will be added' }], columns: [{ key: 'what', label: 'What' }],
    rows: [{ filter: 'add', cells: { what: { parts: [{ record: { table: '${NOTE}', row: 'n1', name: 'Kept' } }] } } }] }
}
`)
  return directory
}

const declared = { [NOTE]: { describe: 'describe_notes', previews: { tidy: 'preview_tidy' } } }

async function install(admin: TestClient, records: unknown = declared) {
  expect(await discoverPackages([await describing(records)])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'n1', body: 'kept' } })
  await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'n2', body: 'second' } })
  await admin.post('/api/save_row', { table: SECRET, row: { row_id: 's1', body: 'hidden' } })
}

const people = (createUser: CreateUserFn) => Promise.all([
  createUser({ email: 'facts-reader@example.test', roles: ['Bar Reader'] }),
  createUser({ email: 'facts-describer@example.test', roles: ['Bar Reader', 'Bar Describer'] }),
])

const describeRows = (client: TestClient, body: unknown, table = NOTE) => client.fetch(`/api/records/${encodeURIComponent(table)}/describe`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const preview = (client: TestClient, action = 'tidy') => client.fetch(`/api/records/${encodeURIComponent(NOTE)}/preview/${action}`)

const hook = () => ((globalThis as unknown as { __records1340?: { answer: unknown; asked: unknown[]; fails?: boolean; preview?: unknown } }).__records1340 ??= { answer: null, asked: [] })
afterEach(() => { hook().answer = null; hook().asked.length = 0; delete hook().fails; delete hook().preview })

describe('Record facts: what an app may declare', () => {
  test("a describer that is not one of the app's reads is refused", async () => {
    expect(await discoverPackages([await describing({ [NOTE]: { describe: 'tidy' } })])).toEqual([
      expect.objectContaining({ error: `The app's ${NOTE} rows are described by tidy, which is not one of the app's reads` }),
    ])
  })

  test("a Table that is not the app's own is refused", async () => {
    expect(await discoverPackages([await describing({ Person: { describe: 'describe_notes' } })])).toEqual([
      expect.objectContaining({ error: 'The app describes Person, which is not one of its Tables' }),
    ])
  })

  test('a preview of something that is not an action, or by something that is not a read, is refused', async () => {
    expect(await discoverPackages([await describing({ [NOTE]: { describe: 'describe_notes', previews: { nothing: 'preview_tidy' } } })])).toEqual([
      expect.objectContaining({ error: "The app previews nothing, which is not one of the app's actions" }),
    ])
    expect(await discoverPackages([await describing({ [NOTE]: { describe: 'describe_notes', previews: { tidy: 'tidy' } } })])).toEqual([
      expect.objectContaining({ error: "The app's preview of tidy is tidy, which is not one of the app's reads" }),
    ])
  })
})

describe('Record facts: the answer', () => {
  test('a list asks about its rows and gets columns, facts and actions, but no groups', async ({ admin, createUser }) => {
    await install(admin)
    const [, describer] = await people(createUser)
    const response = await describeRows(describer, { rows: ['n1', 'n2'] })
    await expectStatus(response, 200)
    const body = await response.json()
    expect(hook().asked).toEqual([{ table: NOTE, rows: ['n1', 'n2'], page: false }])
    expect(body.app).toBe('barproof')
    expect(body.facts.columns).toEqual([{ key: 'people', label: 'People' }])
    expect(body.facts.rows.n1).toEqual({ facts: { people: { text: '2', tone: 'quiet' } }, header: 'Note · 2 people' })
    expect(body.facts.actions[0].label).toBe('Tidy The Notes')
  })

  test('a record page asks about its one row and gets its groups', async ({ admin, createUser }) => {
    await install(admin)
    const [, describer] = await people(createUser)
    const body = await (await describeRows(describer, { rows: ['n1'], page: true })).json()
    expect(body.facts.rows.n1.groups[0].lines[0].parts[2]).toEqual({ record: { table: SECRET, row: 's1', name: 'The secret' } })
    await expectStatus(await describeRows(describer, { rows: ['n1', 'n2'], page: true }), 417)
  })

  test('a record the viewer may not read is named "A row you cannot see", never by its name', async ({ admin, createUser }) => {
    await install(admin)
    const [reader] = await people(createUser)
    const body = await (await describeRows(reader, { rows: ['n1'], page: true })).json()
    expect(body.facts.rows.n1.groups[0].lines[0].parts).toEqual([{ record: { table: NOTE, row: 'n1', name: 'This note' } }, ' and ', 'A row you cannot see'])
    expect(JSON.stringify(body)).not.toContain('The secret')
  })

  test("a group standing for a link group says each of its rows as the app words it, unreadable records named neutrally", async ({ admin, createUser }) => {
    await install(admin)
    const [reader] = await people(createUser)
    hook().answer = { version: 1, rows: { n1: { groups: [{ key: 'can', heading: 'What They Can Do', table: SECRET,
      rows: { s1: { parts: ['Readers can see ', { record: { table: SECRET, row: 's1', name: 'The secret' } }], note: [{ chip: 'Area' }] } } }] } } }
    const body = await (await describeRows(reader, { rows: ['n1'], page: true })).json()
    expect(body.facts.rows.n1.groups[0]).toEqual({ key: 'can', heading: 'What They Can Do', table: SECRET,
      rows: { s1: { parts: ['Readers can see ', 'A row you cannot see'], note: [{ chip: 'Area' }] } } })
  })

  test('an answer naming no record is passed as it is', async ({ admin, createUser }) => {
    await install(admin)
    const [reader] = await people(createUser)
    hook().answer = { version: 1, rows: { n1: { header: 'Note · nobody yet' } } }
    expect((await (await describeRows(reader, { rows: ['n1'] })).json()).facts.rows).toEqual({ n1: { header: 'Note · nobody yet' } })
  })

  test('more than 500 rows at once is refused', async ({ admin }) => {
    await install(admin)
    await expectStatus(await describeRows(admin, { rows: Array.from({ length: 501 }, (_, i) => `r${i}`) }), 417)
  })

  test('a row the viewer may not read is never sent to the app nor described', async ({ admin, createUser }) => {
    await install(admin)
    const [reader] = await people(createUser)
    await describeRows(reader, { rows: ['n1', 'nobody'] })
    expect(hook().asked).toEqual([{ table: NOTE, rows: ['n1'], page: false }])
  })

  test('someone who may not read the Table is refused before the app is asked', async ({ admin, createUser }) => {
    await install(admin)
    const stranger = await createUser({ email: 'facts-stranger@example.test', roles: [] })
    expect((await describeRows(stranger, { rows: ['n1'] })).status).toBeGreaterThanOrEqual(403)
    expect(hook().asked).toEqual([])
  })

  test("an app whose read fails gives no facts: the page draws as it does without the app", async ({ admin, createUser }) => {
    await install(admin)
    const [, describer] = await people(createUser)
    hook().fails = true
    expect(await (await describeRows(describer, { rows: ['n1'] })).json()).toEqual({ facts: null })
  })

  test.for([
    ['no version', { rows: {} }],
    ['an action that both runs and opens a page', { version: 1, rows: {}, actions: [{ key: 'a', label: 'A', explain: 'A.', run: 'tidy', href: '/x' }] }],
    ['a group with lines standing for a link group', { version: 1, rows: { n1: { groups: [{ key: 'g', heading: 'G', table: NOTE, lines: [{ parts: ['a'] }] }] } } }],
    ['a field the shape does not have', { version: 1, rows: { n1: { header: 'x', html: '<b>' } } }],
  ] as const)('an answer with %s gives no facts', async ([, answer], { admin, createUser }) => {
    await install(admin)
    const [, describer] = await people(createUser)
    hook().answer = answer
    const body = await (await describeRows(describer, { rows: ['n1'] })).json()
    expect(body).toEqual({ facts: null })
  })

  test('a Table no app describes gives no facts', async ({ admin }) => {
    await install(admin, { [SECRET]: { describe: 'describe_notes' } })
    expect(await (await describeRows(admin, { rows: ['n1'] })).json()).toEqual({ facts: null })
  })
})

describe('Record facts: the preview of an action', () => {
  test("the preview is the app's, checked, its unreadable records named neutrally", async ({ admin, createUser }) => {
    await install(admin)
    const [reader] = await people(createUser)
    const response = await preview(reader)
    await expectStatus(response, 200)
    const body = await response.json()
    expect(body.label).toBe('Tidy The Notes')
    expect(body.preview.sentence).toEqual(['Tidies ', 'A row you cannot see', '.'])
    expect(body.preview.rows[0].cells.what).toEqual({ parts: [{ record: { table: NOTE, row: 'n1', name: 'Kept' } }] })
  })

  test('someone who may not read the Table gets no preview', async ({ admin, createUser }) => {
    await install(admin)
    const stranger = await createUser({ email: 'preview-stranger@example.test', roles: [] })
    expect((await preview(stranger)).status).toBeGreaterThanOrEqual(403)
  })

  test('an action with no declared preview has none', async ({ admin }) => {
    await install(admin)
    await expectStatus(await preview(admin, 'other'), 404)
  })

  test('a preview the page cannot draw is refused whole', async ({ admin }) => {
    await install(admin)
    hook().preview = { version: 1, title: 'x' }
    await expectStatus(await preview(admin), 502)
  })
})
