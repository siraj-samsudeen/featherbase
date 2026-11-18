// #1282 Why mode: an installed app explains a record of a Table it declares in
// its manifest's `why`, by two of its reads, `may` (whether this viewer may have
// this record explained) and `explain` (the chain). The platform runs both as
// the viewer, offers Why only on `may` answering exactly true, checks the answer
// against the one versioned shape, and never names a record the viewer may not
// read. Fixture: a copy of test-apps/fixtures/bar-proof with a `why` block.
import { afterEach, describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { expectStatus } from './fixtures'

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const NOTE = 'barproof.note'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

const tableRead = { policy: { kind: 'table' }, authorization: { kind: 'generic' } }

/** bar-proof with `why` and the reads behind it. `explain` answers `hooks.answer`, which a test sets. */
async function explaining(why: unknown, { action = false }: { action?: boolean } = {}) {
  const directory = await mkdtemp(resolve('test/.why-1282-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.roles = ['Bar Reader', 'Bar Explainer']
  manifest.reads.operations = { ...manifest.reads.operations, may_explain: tableRead, explain: tableRead }
  if (action) manifest.actions = { version: 2, tables: [NOTE], operations: { change_note: tableRead } }
  manifest.why = why
  await writeFile(file, JSON.stringify(manifest))
  await appendFile(resolve(directory, 'server.mjs'), `
const why = (globalThis.__why1282 ??= { answer: null, asked: [] })
reads.may_explain = ({ roles, payload }) => { why.asked.push(payload); return roles.includes('Bar Explainer') }
reads.explain = ({ payload }) => { why.asked.push(payload); return why.answer ?? answerFor(payload) }
${action ? 'export const actions = { change_note: () => true }' : ''}
function answerFor({ table, row }) {
  return {
    version: 1,
    columns: [
      { heading: 'Note', boxes: [{ id: 'n', name: 'The note', record: { table, row } }] },
      { heading: 'Reader', boxes: [{ id: 'r', name: 'Bar Reader', detail: 'by hand', source: 'hand', reach: 'All' }] },
    ],
    edges: [['n', 'r']],
  }
}
`)
  return directory
}

const declared = { [NOTE]: { explain: 'explain', may: 'may_explain', label: 'Why: Who Reads It' } }

async function install(admin: TestClient, why: unknown = declared) {
  expect(await discoverPackages([await explaining(why)])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'n1', body: 'kept' } })
}

const people = (createUser: CreateUserFn) => Promise.all([
  createUser({ email: 'why-reader@example.test', roles: ['Bar Reader'] }),
  createUser({ email: 'why-explainer@example.test', roles: ['Bar Reader', 'Bar Explainer'] }),
])

const offer = (client: TestClient, table = NOTE, row = 'n1') => client.fetch(`/api/why/${encodeURIComponent(table)}/${encodeURIComponent(row)}`)
const explain = (client: TestClient, table = NOTE, row = 'n1') => client.fetch(`/api/why/${encodeURIComponent(table)}/${encodeURIComponent(row)}/explain`)

/** What the app's server module answers and was asked (the platform loads its own copy of the module). */
const hook = () => ((globalThis as unknown as { __why1282?: { answer: unknown; asked: unknown[] } }).__why1282 ??= { answer: null, asked: [] })
afterEach(() => { hook().answer = null; hook().asked.length = 0 })
const answerNext = (answer: unknown) => { hook().answer = answer }

describe('Why: what an app may declare', () => {
  test("a Why naming something that is not one of the app's reads is refused", async () => {
    expect(await discoverPackages([await explaining({ [NOTE]: { explain: 'nothing', may: 'may_explain' } })])).toEqual([
      expect.objectContaining({ error: `The app's Why for ${NOTE} is explained by nothing, which is not one of the app's reads` }),
    ])
    expect(await discoverPackages([await explaining({ [NOTE]: { explain: 'explain', may: 'nothing' } })])).toEqual([
      expect.objectContaining({ error: `The app's Why for ${NOTE} is offered by nothing, which is not one of the app's reads` }),
    ])
  })

  test("a Why naming one of the app's actions is refused: a Why only reads", async () => {
    expect(await discoverPackages([await explaining({ [NOTE]: { explain: 'change_note', may: 'may_explain' } }, { action: true })])).toEqual([
      expect.objectContaining({ error: `The app's Why for ${NOTE} is explained by change_note, which is not one of the app's reads` }),
    ])
  })

  test.for(['why: who reads it', 'Why who', 'Why: who Reads'])('a label not in Title Case after "Why: " (%j) is refused', async (label) => {
    expect(await discoverPackages([await explaining({ [NOTE]: { explain: 'explain', may: 'may_explain', label } })])).toEqual([
      expect.objectContaining({ error: expect.stringContaining('Title Case') }),
    ])
  })
})

describe('Why: who is offered it', () => {
  test('the server offers Why, with its label, only to someone the app says may have this record explained', async ({ admin, createUser }) => {
    await install(admin)
    const [reader, explainer] = await people(createUser)
    await expectStatus(await offer(explainer), 200)
    expect(await (await offer(explainer)).json()).toEqual({ offer: { label: 'Why: Who Reads It' } })
    expect(await (await offer(reader)).json()).toEqual({ offer: null })
  })

  test('the app is asked about this very record', async ({ admin, createUser }) => {
    await install(admin)
    const [, explainer] = await people(createUser)
    hook().asked.length = 0
    await offer(explainer)
    expect(hook().asked).toEqual([{ table: NOTE, row: 'n1' }])
  })

  test('the label is "Why: Access" when the app gives none', async ({ admin, createUser }) => {
    await install(admin, { [NOTE]: { explain: 'explain', may: 'may_explain' } })
    const [, explainer] = await people(createUser)
    expect(await (await offer(explainer)).json()).toEqual({ offer: { label: 'Why: Access' } })
  })

  test('a Table no app explains offers nothing', async ({ admin }) => {
    await install(admin)
    await admin.post('/api/table_def', { name: 'Why Other', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] })
    await admin.post('/api/save_row', { table: 'Why Other', row: { row_id: 'o1', title: 'Other' } })
    expect(await (await offer(admin, 'Why Other', 'o1')).json()).toEqual({ offer: null })
  })

  test('a record the viewer may not read is refused, before the app is asked', async ({ admin, createUser }) => {
    await install(admin)
    const stranger = await createUser({ email: 'why-stranger@example.test', roles: [] })
    expect((await offer(stranger)).status).toBeGreaterThanOrEqual(403)
    expect((await explain(stranger)).status).toBeGreaterThanOrEqual(403)
  })
})

describe('Why: the explanation', () => {
  test('someone the app lets explain gets the checked answer', async ({ admin, createUser }) => {
    await install(admin)
    const [, explainer] = await people(createUser)
    const response = await explain(explainer)
    await expectStatus(response, 200)
    expect(await response.json()).toEqual({
      label: 'Why: Who Reads It',
      answer: {
        version: 1,
        // Every box by the platform's own opaque id, never the app's.
        columns: [
          { heading: 'Note', boxes: [{ id: 'b1', name: 'The note', record: { table: NOTE, row: 'n1' } }] },
          { heading: 'Reader', boxes: [{ id: 'b2', name: 'Bar Reader', detail: 'by hand', source: 'hand', reach: 'All' }] },
        ],
        edges: [['b1', 'b2']],
      },
    })
  })

  test('someone the app does not let explain is refused, even asking the server directly', async ({ admin, createUser }) => {
    await install(admin)
    const [reader] = await people(createUser)
    await expectStatus(await explain(reader), 403)
  })

  test.for([
    ['no version', { columns: [{ heading: 'A', boxes: [{ id: 'a', name: 'A' }] }], edges: [] }],
    ['an edge to a box that is not there', { version: 1, columns: [{ heading: 'A', boxes: [{ id: 'a', name: 'A' }] }], edges: [['a', 'z']] }],
    ['an edge leading left', { version: 1, columns: [{ heading: 'A', boxes: [{ id: 'a', name: 'A' }] }, { heading: 'B', boxes: [{ id: 'b', name: 'B' }] }], edges: [['b', 'a']] }],
    ['two boxes with one id', { version: 1, columns: [{ heading: 'A', boxes: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }], edges: [] }],
    ['a field the shape does not have', { version: 1, columns: [{ heading: 'A', boxes: [{ id: 'a', name: 'A', html: '<b>' }] }], edges: [] }],
    ['a list, not an answer', [1, 2, 3]],
  ] as const)('an answer with %s is refused whole', async ([, answer], { admin, createUser }) => {
    await install(admin)
    const [, explainer] = await people(createUser)
    answerNext(answer)
    const response = await explain(explainer)
    await expectStatus(response, 502)
    expect(JSON.stringify(await response.json())).not.toContain('<b>')
  })

  test('a box naming a record the viewer may not read says "A row you cannot see": no name, no record, and not its id in any box id or edge', async ({ admin, createUser }) => {
    await install(admin)
    const [, explainer] = await people(createUser)
    const hidden = admin.user!
    answerNext({
      version: 1,
      columns: [
        { heading: 'Note', boxes: [{ id: 'note:n1', name: 'The note', record: { table: NOTE, row: 'n1' } }] },
        { heading: 'Person', boxes: [{ id: `person:${hidden}`, name: 'A secret name', detail: 'A secret place', record: { table: 'Person', row: hidden } }] },
      ],
      edges: [['note:n1', `person:${hidden}`]],
    })
    const body = await (await explain(explainer)).json() as { answer: { columns: { boxes: Record<string, unknown>[] }[]; edges: string[][] } }
    expect(body.answer.columns[1]!.boxes[0]).toEqual({ id: 'b2', name: 'A row you cannot see' })
    expect(body.answer.edges).toEqual([['b1', 'b2']])
    const sent = JSON.stringify(body)
    expect(sent).not.toContain('secret')
    expect(sent).not.toContain(hidden)
    // The record the viewer may read keeps its link.
    expect(body.answer.columns[0]!.boxes[0]).toEqual({ id: 'b1', name: 'The note', record: { table: NOTE, row: 'n1' } })
  })

  test('an area naming a record the viewer may not read is left out whole; one naming only readable records keeps its parts as links', async ({ admin, createUser }) => {
    await install(admin)
    const [, explainer] = await people(createUser)
    answerNext({
      version: 1,
      columns: [
        { heading: 'Note', boxes: [{ id: 'n', name: 'The note', detailParts: [{ name: 'Its note', record: { table: NOTE, row: 'n1' } }, { name: 'Whole company' }] }] },
        { heading: 'Role', boxes: [{ id: 'r', name: 'Floor Manager', detailParts: [{ name: 'Its note', record: { table: NOTE, row: 'n1' } }, { name: 'A secret store', record: { table: 'Person', row: admin.user! } }] }] },
      ],
      edges: [['n', 'r']],
    })
    const body = await (await explain(explainer)).json() as { answer: { columns: { boxes: Record<string, unknown>[] }[] } }
    expect(body.answer.columns[0]!.boxes[0]).toEqual({ id: 'b1', name: 'The note', detailParts: [{ name: 'Its note', record: { table: NOTE, row: 'n1' } }, { name: 'Whole company' }] })
    expect(body.answer.columns[1]!.boxes[0]).toEqual({ id: 'b2', name: 'Floor Manager' })
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(JSON.stringify(body)).not.toContain(admin.user!)
  })
})
