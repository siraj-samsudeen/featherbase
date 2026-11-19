// #1282 C10–C11: an installed app works out sections about a record of a Table it declares in its
// manifest's `workedOut` ("Apps They Can Open · worked out from their roles"), by one of its reads
// run as the viewer. The platform shows them only to someone who reads the record and passes the
// app's gate, checks the answer against the one versioned shape, and never names a record the viewer
// may not read. Fixture: a copy of test-apps/fixtures/bar-proof with a `workedOut` block. Made-up names.
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

/** bar-proof with `workedOut` and its read. The read answers `hooks.answer` where a test sets one; otherwise,
 *  by the viewer's roles: with the why for an explainer, without it for a reader, nothing for anyone else. */
async function working(workedOut: unknown, { gate }: { gate?: string } = {}) {
  const directory = await mkdtemp(resolve('test/.worked-out-1282-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.roles = ['Bar Reader', 'Bar Explainer', 'Bar Guest']
  manifest.reads.operations = { ...manifest.reads.operations, worked_out: tableRead, closed: tableRead }
  if (gate) manifest.access = { gate }
  manifest.workedOut = workedOut
  await writeFile(file, JSON.stringify(manifest))
  await appendFile(resolve(directory, 'server.mjs'), `
const worked = (globalThis.__workedOut1282 ??= { answer: undefined, asked: [] })
reads.worked_out = ({ roles, payload }) => {
  worked.asked.push(payload)
  if (worked.answer !== undefined) return worked.answer
  if (!roles.includes('Bar Reader')) return null
  const why = roles.includes('Bar Explainer')
  return {
    version: 1,
    sections: [
      { heading: 'Notes They Can Read', note: 'worked out from their roles', empty: 'No notes from roles yet', rows: [
        { name: 'The note', record: { table: payload.table, row: payload.row }, detail: 'at level Reader', via: [{ name: 'Bar Reader' }],
          ...(why ? { why: [{ name: 'Made-up Person' }, { name: 'Bar Reader', detailParts: [{ name: 'Whole company' }] }, { name: 'The note', record: { table: payload.table, row: payload.row } }] } : {}) },
      ] },
      { heading: 'Reports They See', note: 'given to their roles', empty: 'No reports from roles yet', rows: [] },
    ],
  }
}
reads.closed = () => false
`)
  return directory
}

const declared = { [NOTE]: { read: 'worked_out' } }

async function install(admin: TestClient, workedOut: unknown = declared, options: { gate?: string } = {}) {
  expect(await discoverPackages([await working(workedOut, options)])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'n1', body: 'kept' } })
}

const people = (createUser: CreateUserFn) => Promise.all([
  createUser({ email: 'worked-reader@example.test', roles: ['Bar Reader'] }),
  createUser({ email: 'worked-explainer@example.test', roles: ['Bar Reader', 'Bar Explainer'] }),
])

const sections = (client: TestClient, table = NOTE, row = 'n1') => client.fetch(`/api/worked-out/${encodeURIComponent(table)}/${encodeURIComponent(row)}`)
const hook = () => ((globalThis as unknown as { __workedOut1282?: { answer: unknown; asked: unknown[] } }).__workedOut1282 ??= { answer: undefined, asked: [] })
afterEach(() => { hook().answer = undefined; hook().asked.length = 0 })

describe('worked-out sections: what an app may declare', () => {
  test("sections from something that is not one of the app's reads are refused", async () => {
    expect(await discoverPackages([await working({ [NOTE]: { read: 'nothing' } })])).toEqual([
      expect.objectContaining({ error: `The app's worked-out sections for ${NOTE} come from nothing, which is not one of the app's reads` }),
    ])
  })
})

describe('worked-out sections: who sees what', () => {
  test('a viewer who may see why gets each row with its chain; one who may not gets the rows without it', async ({ admin, createUser }) => {
    await install(admin)
    const [reader, explainer] = await people(createUser)
    const forExplainer = await (await sections(explainer)).json() as { sections: { heading: string; rows: { name: string; why?: unknown[] }[] }[] }
    expect(forExplainer.sections.map((s) => [s.heading, s.rows.length])).toEqual([['Notes They Can Read', 1], ['Reports They See', 0]])
    expect(forExplainer.sections[0]!.rows[0]!.why).toHaveLength(3)
    const forReader = await (await sections(reader)).json() as typeof forExplainer
    expect([forReader.sections[0]!.rows[0]!.name, forReader.sections[0]!.rows[0]!.why]).toEqual(['The note', undefined])
    // The app is asked about this very record.
    expect(hook().asked).toContainEqual({ table: NOTE, row: 'n1' })
  })

  test('nothing where the app shows this viewer nothing, where its gate keeps them out, or where no app works any out', async ({ admin, createUser }) => {
    await install(admin, declared, { gate: 'closed' })
    const [, explainer] = await people(createUser)
    expect(await (await sections(explainer)).json()).toEqual({ sections: [] })
    // Someone who may not read the record is refused before the app is asked.
    const guest = await createUser({ email: 'worked-guest@example.test', roles: ['Bar Guest'] })
    await expectStatus(await sections(guest), 403)
    expect(await (await sections(admin, 'Person', admin.user!)).json()).toEqual({ sections: [] })
  })

  // Codex adversarial round 2: the generic app-read route would run the read without the record check or the scrub.
  test("the app's worked-out read answers only through the record panel's checked route", async ({ admin, createUser }) => {
    await install(admin)
    const [, explainer] = await people(createUser)
    // Called as the app's own page calls its reads.
    const direct = await explainer.fetch('/api/app_reads/barproof/worked_out', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': 'barproof@1.0.0' }, body: JSON.stringify({ payload: { table: NOTE, row: 'n1' } }) })
    await expectStatus(direct, 403)
    expect(await direct.text()).toContain('answers only through the record panel')
    expect(hook().asked).toEqual([])
  })

  test('the app saying nothing is nothing; the viewer must read the record itself', async ({ admin, createUser }) => {
    await install(admin)
    const [, explainer] = await people(createUser)
    hook().answer = null
    expect(await (await sections(explainer)).json()).toEqual({ sections: [] })
    hook().answer = undefined
    await expectStatus(await sections(explainer, NOTE, 'no-such-note'), 404)
  })
})

describe('worked-out sections: what the viewer is told', () => {
  test('a record the viewer may not read is named neutrally, and a chain naming one is left out whole', async ({ admin, createUser }) => {
    await install(admin)
    const [, explainer] = await people(createUser)
    const hidden = { table: NOTE, row: 'hidden' }
    hook().answer = { version: 1, sections: [{ heading: 'Notes They Can Read', empty: 'None', rows: [
      { name: 'A hidden note', record: hidden, via: [{ name: 'Bar Reader' }] },
      { name: 'The note', record: { table: NOTE, row: 'n1' }, via: [{ name: 'Secret role', record: hidden }],
        why: [{ name: 'Made-up Person' }, { name: 'Secret', record: hidden }] },
      // Codex adversarial round 1: an area the viewer may not read hides the whole chain, though every step is readable.
      { name: 'Another note', record: { table: NOTE, row: 'n1' }, via: [],
        why: [{ name: 'Made-up Person' }, { name: 'Bar Reader', detailParts: [{ name: 'Hidden store', record: hidden }] }, { name: 'The note', record: { table: NOTE, row: 'n1' } }] },
    ] }] }
    const answer = await (await sections(explainer)).json() as { sections: { rows: { name: string; record?: unknown; via: { name: string; record?: unknown }[]; why?: unknown }[] }[] }
    expect(answer.sections[0]!.rows).toEqual([
      { name: 'A row you cannot see', via: [] },
      { name: 'The note', record: { table: NOTE, row: 'n1' }, via: [{ name: 'A row you cannot see' }] },
      { name: 'Another note', record: { table: NOTE, row: 'n1' }, via: [] },
    ])
    expect(JSON.stringify(answer)).not.toContain('Hidden store')
  })

  // UI owner: an app's name links to the app; kept only for an app the viewer may open, as the app switcher lists it.
  test("a row naming an app keeps it only where the viewer may open that app", async ({ admin, createUser }) => {
    await install(admin)
    const [, explainer] = await people(createUser)
    hook().answer = { version: 1, sections: [{ heading: 'Apps They Can Open', empty: 'None', rows: [
      { name: 'Bar Proof', app: 'barproof', via: [] }, { name: 'Elsewhere', app: 'no-such-app', via: [] }] }] }
    const answer = await (await sections(explainer)).json() as { sections: { rows: { name: string; app?: string }[] }[] }
    expect(answer.sections[0]!.rows).toEqual([{ name: 'Bar Proof', app: 'barproof', via: [] }, { name: 'Elsewhere', via: [] }])
  })

  test('an answer that is not the one shape is refused whole, saying nothing of it', async ({ admin, createUser }) => {
    await install(admin)
    const [, explainer] = await people(createUser)
    hook().answer = { version: 2, sections: [] }
    const refused = await sections(explainer)
    await expectStatus(refused, 502)
    expect(await refused.text()).not.toContain('version')
  })
})
