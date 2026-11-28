// #1454: an app's own Tables read within the reader's places. The app
// `scopedproof` declares one of its Tables under `scopedTables`, mapped on
// store and section as a dataset is; its person_scope read lists that Table.
// The places come from test-apps/fixtures/place-roster, which a test tells
// what to answer. Every row is made up.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { TestClient } from 'feather-testing-postgres'
import { afterEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { expectRefused } from './fixtures'

const APP = 'scopedproof'
const ANSWER = `${APP}.answer`
const provider = resolve('../..', 'test-apps/fixtures/place-roster')

const SERVER = `export const platformVersion = '2026-10'
const list = (ctx) => ctx.scopedTables.list('${ANSWER}', ctx.payload.filters, ctx.payload.fields ? { fields: ctx.payload.fields } : {})
export const reads = { answers: list, as_table_policy: list, outside: list,
  undeclared: (ctx) => ctx.scopedTables.list('${APP}.entry') }
`
const scoped = { policy: { kind: 'person_scope', readRoles: ['Answer Reader'], actionRoles: [] }, authorization: { kind: 'generic' } }
const manifest = (more: Record<string, unknown> = {}) => ({
  manifestVersion: 1, platformVersion: '2026-10', name: APP, title: 'Scoped Table proof', entryTable: `${APP}.entry`, server: 'server.mjs',
  tables: [
    { name: `${APP}.entry`, label: 'entry', id_pattern: 'prompt', columns: [{ column_name: 'body', column_type: 'Data' }] },
    { name: ANSWER, label: 'answer', id_pattern: 'prompt', columns: [{ column_name: 'store', column_type: 'Data' }, { column_name: 'section', column_type: 'Data' },
      { column_name: 'body', column_type: 'Data' }, { column_name: 'notes', column_type: 'Text' }] },
  ],
  roles: ['Answer Reader'],
  // The reader may open the app; nobody but an administrator may read the answers' Table itself.
  permissions: [{ table: `${APP}.entry`, role: 'Answer Reader', can_read: true }],
  scopedTables: [{ table: ANSWER, keys: ['body'], filters: { store: 'store', section: 'section' } }],
  reads: { version: 1, tables: [`${APP}.entry`, ANSWER], operations: {
    answers: scoped, outside: { ...scoped, outbound: true }, undeclared: scoped,
    as_table_policy: { policy: { kind: 'table' }, authorization: { kind: 'generic' } },
  } },
  ...more,
})

const folders: string[] = []
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })
async function writeApp(more: Record<string, unknown> = {}) {
  const dir = await mkdtemp(resolve('test/.scoped-proof-'))
  folders.push(dir)
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `featherbase-${APP}`, version: '1.0.0', type: 'module' }))
  await writeFile(join(dir, 'server.mjs'), SERVER)
  await writeFile(join(dir, 'featherbase.json'), JSON.stringify(manifest(more)))
  return dir
}

/** Installs the app and the place provider, and seeds four answers at two stores. */
async function installed(admin: TestClient) {
  expect(await discoverPackages([await writeApp(), provider])).toEqual([])
  await admin.post('/api/install_app', { name: APP })
  await admin.post('/api/install_app', { name: 'placeroster' })
  for (const [row_id, store, section, body] of [['a1', 'N1', 'kids', 'north kids'], ['a2', 'N1', 'mens', 'north mens'],
    ['a3', 'S1', 'kids', 'south kids'], ['a4', 'S1', 'mens', 'south mens']])
    await admin.post('/api/save_row', { table: ANSWER, row: { row_id, store, section, body, notes: 'made up' } })
}

async function roster(): Promise<{ faults: { result?: unknown } }> {
  const digest = availableRuntimeVersions().find((p) => p.name === 'placeroster')!.digest
  return import(`${pathToFileURL(resolve(provider, 'server.mjs')).href}?artifact=${digest}`)
}

/** `client`'s read `name`, with the provider answering `places`. */
async function readAs(client: TestClient, name: string, places: unknown, payload: Record<string, unknown> = {}) {
  const provider = await roster()
  provider.faults.result = places
  try {
    const res = await client.fetch(`/api/app_reads/${APP}/${name}`, { method: 'POST', body: JSON.stringify({ payload }),
      headers: { 'content-type': 'application/json', 'X-Featherbase-App-Version': `${APP}@1.0.0` } })
    return { status: res.status, body: await res.json() as { result?: Record<string, unknown>[]; error?: { message: string } } }
  } finally { delete provider.faults.result }
}
const ids = (answer: { body: { result?: Record<string, unknown>[] } }) => answer.body.result?.map((row) => row.row_id)

describe('a scoped Table', () => {
  test('answers the rows the reader’s places reach, and no others', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    // A whole store, and one section of another.
    const answer = await readAs(reader, 'answers', [{ label: 'North', filters: { store: ['N1'] } },
      { label: 'South kids', filters: { store: ['S1'], section: ['kids'] } }])
    expect(answer.status).toBe(200)
    expect(ids(answer)).toEqual(['a1', 'a2', 'a3'])
    // The Table itself is not theirs to read.
    await expectRefused(reader.get(`/api/table/${encodeURIComponent(ANSWER)}`), 403)
  })

  test('a row two places reach is answered once', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    expect(ids(await readAs(reader, 'answers', [{ label: 'North', filters: { store: ['N1'] } },
      { label: 'North kids', filters: { store: ['N1'], section: ['kids'] } }]))).toEqual(['a1', 'a2'])
  })

  test('a place naming a filter the Table does not map adds no row (fail closed)', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    expect(ids(await readAs(reader, 'answers', [{ label: 'North by line', filters: { store: ['N1'], line: ['L1'] } },
      { label: 'South mens', filters: { store: ['S1'], section: ['mens'] } }]))).toEqual(['a4'])
  })

  test('a read narrows by a declared key, never by another column', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    const places = [{ label: 'Both', filters: { store: ['N1', 'S1'] } }]
    expect(ids(await readAs(reader, 'answers', places, { filters: { body: ['north kids', 'south mens'] } }))).toEqual(['a1', 'a4'])
    // A key can never reach past the places.
    expect(ids(await readAs(reader, 'answers', [{ label: 'North', filters: { store: ['N1'] } }], { filters: { body: 'south mens' } }))).toEqual([])
    const refused = await readAs(reader, 'answers', places, { filters: { notes: 'made up' } })
    expect(refused.status).toBe(417)
    expect(refused.body.error?.message).toContain('cannot be filtered on notes')
  })

  test('answers only the columns asked for, with row_id and updated_at', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    const [row] = (await readAs(reader, 'answers', [{ label: 'North kids', filters: { store: ['N1'], section: ['kids'] } }], { fields: ['body'] })).body.result!
    expect(Object.keys(row).sort()).toEqual(['body', 'row_id', 'updated_at'])
  })

  test('a read that is not person_scope has no places, so no rows', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    expect(await readAs(reader, 'as_table_policy', [{ label: 'North', filters: { store: ['N1'] } }])).toMatchObject({ status: 200, body: { result: [] } })
  })

  test('an outbound read reads no scoped Table, and an undeclared Table is refused', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    const places = [{ label: 'North', filters: { store: ['N1'] } }]
    const outside = await readAs(reader, 'outside', places)
    expect(outside.status).toBe(417)
    expect(outside.body.error?.message).toContain('This read is outbound')
    const undeclared = await readAs(reader, 'undeclared', places)
    expect(undeclared.status).toBe(417)
    expect(undeclared.body.error?.message).toContain(`has not declared the scoped Table ${APP}.entry`)
  })

  test('the declaration names the app’s own Table and its plain columns', async () => {
    const problems = async (more: Record<string, unknown>) => JSON.stringify(await discoverPackages([await writeApp(more), provider]))
    expect(await problems({ scopedTables: [{ table: 'Shop Store', keys: [], filters: { store: 'store' } }] })).toContain('not one of the app')
    expect(await problems({ scopedTables: [{ table: ANSWER, keys: ['missing'], filters: { store: 'store' } }] })).toContain('cannot be filtered on missing')
    expect(await problems({ scopedTables: [{ table: ANSWER, keys: [], filters: { store: 'notes' } }] })).toContain('cannot be filtered on notes')
    expect(await problems({ scopedTables: [{ table: ANSWER, keys: [], filters: {} }] })).toContain('maps at least one scope filter')
  })
})
