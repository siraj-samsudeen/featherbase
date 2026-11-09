// #1041: an installed app's unused Table can be archived, so it stops crowding
// search and the menus beside a real table of the same name. Archiving must not
// break the app: its reads and people's scope stay as they were, its writes get a
// plain refusal, and archiving lasts through a redeploy and an upgrade.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { discoverPackages, repinToFolder } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { expectApiError, expectRefused, makeTable } from './fixtures'

// Every request names the app versions its client loaded, as the web client does.
const atVersions = (client: TestClient, versions: string) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': versions, ...init?.headers },
}) }, client.token, client.user)
const pinned = (client: TestClient) => atVersions(client, 'scopeproof@1.0.0,actionproof@1.1.0,evolve@0.1.0')
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

const actionProof = resolve('../..', 'test-apps/action-proof')
const evolve = (v: number) => resolve('../..', `test-apps/fixtures/evolve-v${v}`)
const WORK = 'actionproof.work'
const DESTINATION = 'actionproof.destination'
const tableUrl = (table: string) => `/api/table/${encodeURIComponent(table)}`
const archive = (client: TestClient, table: string, note?: string) =>
  client.post<{ archived_at: string | null; archived_note: string | null }>(`/api/table_def/${encodeURIComponent(table)}/archive`, note === undefined ? {} : { note })
const unarchive = (client: TestClient, table: string) =>
  client.post<{ archived_at: string | null }>(`/api/table_def/${encodeURIComponent(table)}/unarchive`, {})
const search = async (client: TestClient, query: string) =>
  (await client.get<{ results: { table: string; row_id: string }[] }>(`/api/search?q=${encodeURIComponent(query)}`)).results
const saveRow = (client: TestClient, table: string, row: Record<string, unknown>) =>
  client.post<{ row_id: string; updated_at: string }>('/api/save_row', { table, row })
const archivedRow = async (table: string) =>
  (await sql`select archived_at, archived_note from table_def where name = ${table}`)[0]
const archivedRefusal = (table: string) => ({ status: 403, message: expect.stringContaining(`${table} is archived`) })

async function installActionProof(admin: TestClient) {
  expect(await discoverPackages([actionProof])).toEqual([])
  await admin.post('/api/install_app', { name: 'actionproof' })
}

/** The place-roster fixture, whose entry is a separate Table, as Dash's is: its
 *  scope Table can then be archived, which its own entry Table never could. */
async function rosterWithSeparateEntry(run: (consumer: string, provider: string) => Promise<void>) {
  const copy = await mkdtemp(resolve('test/.archive-roster-'))
  try {
    await cp(resolve('../..', 'test-apps/fixtures/place-roster'), copy, { recursive: true })
    const manifest = JSON.parse(await readFile(resolve(copy, 'featherbase.json'), 'utf8'))
    await writeFile(resolve(copy, 'featherbase.json'), JSON.stringify({
      ...manifest,
      entryTable: 'placeroster.home',
      tables: [...manifest.tables, { name: 'placeroster.home', label: 'home', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] }],
    }))
    await run(resolve('../..', 'test-apps/scope-proof'), copy)
  } finally { await rm(copy, { recursive: true, force: true }) }
}

const POSITION = 'placeroster.position'
const places = '/api/app_reads/scopeproof/places'

describe("#1041: archiving an app's table", () => {
  test("a System Manager archives and un-archives it, and nobody else can", async ({ admin, createUser }) => {
    await installActionProof(admin)
    const clerk = await createUser({ email: 'arc.app.clerk@example.com', roles: [] })
    await expectRefused(archive(clerk, DESTINATION), 403)
    const meta = await archive(admin, DESTINATION, 'Replaced by the master table')
    expect(meta).toMatchObject({ archived_note: 'Replaced by the master table' })
    expect(meta.archived_at).toBeTruthy()
    await expectRefused(unarchive(clerk, DESTINATION), 403)
    expect(await unarchive(admin, DESTINATION)).toMatchObject({ archived_at: null })
  })

  test("the app's entry table is refused, in plain words", async ({ admin }) => {
    await installActionProof(admin)
    await expectApiError(archive(admin, WORK), {
      status: 417, message: expect.stringContaining('it is the entry table of the actionproof app'),
    })
    expect((await archivedRow(WORK)).archived_at).toBeNull()
  })

  test('platform security tables and custom tables that decide access stay refused', async ({ admin }) => {
    await installActionProof(admin)
    for (const table of ['Role', 'Permission']) await expectApiError(archive(admin, table), { status: 417 })
    await makeTable(admin, { name: 'Arc Custom Roster', columns: ['person'] })
    await sql`update table_def set decides_scope = true where name = 'Arc Custom Roster'`
    invalidateMeta('Arc Custom Roster')
    await expectApiError(archive(admin, 'Arc Custom Roster'), { status: 417, message: expect.stringContaining('who can see or do what') })
  })

  test('a sub-table and a settings table are refused, each in plain words', async ({ admin }) => {
    await makeTable(admin, { name: 'Arc Line', kind: 'sub_table', columns: ['code'] })
    await expectApiError(archive(admin, 'Arc Line'), { status: 417, message: expect.stringContaining('it is a sub-table') })
    await makeTable(admin, { name: 'Arc Preferences', kind: 'settings', columns: ['colour'] })
    await expectApiError(archive(admin, 'Arc Preferences'), { status: 417, message: expect.stringContaining('it holds settings') })
  })

  test("its rows stay readable, and its writes are refused saying it is archived, even from the app's own action", async ({ admin }) => {
    await installActionProof(admin)
    const kept = await saveRow(admin, DESTINATION, { title: 'Kept' })
    const source = await saveRow(admin, WORK, { row_id: 'w1', title: 'Source' })
    await archive(admin, DESTINATION)

    expect(await admin.get(`${tableUrl(DESTINATION)}/${kept.row_id}`)).toMatchObject({ title: 'Kept' })
    expect((await admin.get<{ data: unknown[] }>(tableUrl(DESTINATION))).data).toHaveLength(1)

    const refused = archivedRefusal(DESTINATION)
    await expectApiError(saveRow(admin, DESTINATION, { title: 'New' }), refused)
    await expectApiError(admin.delete(`${tableUrl(DESTINATION)}/${kept.row_id}`), refused)
    await expectApiError(admin.post(`${tableUrl(DESTINATION)}:import`, { key_column: 'title', rows: [{ title: 'Imported' }] }), refused)
    await expectApiError(admin.post('/api/app_actions/actionproof/transform', {
      idempotencyKey: 'arc-transform', payload: { source: source.row_id, updatedAt: source.updated_at },
    }), refused)
    // The action rolled back whole, and the app's other Table still takes rows.
    expect((await admin.get<{ data: unknown[] }>(tableUrl(DESTINATION))).data).toHaveLength(1)
    await saveRow(admin, WORK, { row_id: 'w2', title: 'Still writable' })

    await unarchive(admin, DESTINATION)
    await saveRow(admin, DESTINATION, { title: 'Back' })
  })

  test('global search leaves it out, and finds it again once un-archived', async ({ admin }) => {
    await installActionProof(admin)
    const row = await saveRow(admin, DESTINATION, { title: 'Findable' })
    const inSearch = async () => (await search(admin, row.row_id)).some((hit) => hit.table === DESTINATION)
    expect(await inSearch()).toBe(true)
    await archive(admin, DESTINATION)
    expect(await inSearch()).toBe(false)
    await unarchive(admin, DESTINATION)
    expect(await inSearch()).toBe(true)
  })

  test('global search leaves out an archived custom table too', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Arc Searched Plant', id_pattern: 'prompt', columns: ['city'] })
    await admin.post(table.url, { row_id: 'ARC-SEARCH-1', city: 'Chennai' })
    expect((await search(admin, 'ARC-SEARCH-1')).map((hit) => hit.row_id)).toEqual(['ARC-SEARCH-1'])
    await archive(admin, table.name)
    expect(await search(admin, 'ARC-SEARCH-1')).toEqual([])
  })

  test("search leaves out the table's own definition, and Explore's picker leaves it out, until un-archived", async ({ admin }) => {
    await installActionProof(admin)
    const definitionFound = async () => (await search(admin, DESTINATION)).some((hit) => hit.table === 'Table' && hit.row_id === DESTINATION)
    const inPicker = async () => (await admin.get<{ tables: string[] }>('/api/navigable_tables')).tables.includes(DESTINATION)
    expect([await definitionFound(), await inPicker()]).toEqual([true, true])
    await archive(admin, DESTINATION)
    expect([await definitionFound(), await inPicker()]).toEqual([false, false])
    await unarchive(admin, DESTINATION)
    expect([await definitionFound(), await inPicker()]).toEqual([true, true])
  })

  test('it stays archived through a redeploy', async ({ admin }) => {
    await installActionProof(admin)
    await archive(admin, DESTINATION, 'Not in use yet')
    expect(await discoverPackages([actionProof])).toEqual([])
    await loadInstalledApps()
    invalidateMeta()
    expect(await archivedRow(DESTINATION)).toMatchObject({ archived_note: 'Not in use yet', archived_at: expect.anything() })
    await expectApiError(saveRow(admin, DESTINATION, { title: 'New' }), archivedRefusal(DESTINATION))
  })

  test('it stays archived when the app is re-pinned to changed files', async ({ admin }) => {
    const copy = await mkdtemp(resolve('test/.archive-repin-'))
    try {
      await cp(actionProof, copy, { recursive: true })
      expect(await discoverPackages([copy])).toEqual([])
      await admin.post('/api/install_app', { name: 'actionproof' })
      await archive(admin, DESTINATION, 'Not in use yet')
      await writeFile(resolve(copy, 'NOTES.md'), 'a file changed\n')
      await discoverPackages([copy])
      expect(await repinToFolder('actionproof', true)).toBe('repinned')
      expect(await archivedRow(DESTINATION)).toMatchObject({ archived_note: 'Not in use yet', archived_at: expect.anything() })
    } finally { await rm(copy, { recursive: true, force: true }) }
  })

  test('an upgrade that renames it and changes its columns succeeds, and it stays archived', async ({ admin }) => {
    await discoverPackages([evolve(1)])
    await admin.post('/api/install_app', { name: 'evolve' })
    await discoverPackages([evolve(1), evolve(2)])
    await loadInstalledApps()
    await saveRow(admin, 'evolve.note', { row_id: 'n1', body: 'Count again on Monday' })
    await archive(admin, 'evolve.note', 'Plain table')
    await archive(admin, 'evolve.zone', 'Scope table')

    const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'evolve', version: '0.2.0' })
    await admin.post('/api/upgrade_app', { name: 'evolve', version: '0.2.0', planId: plan.planId })
    await admin.post('/api/activate_app_upgrade', { name: 'evolve', version: '0.2.0' })

    const upgraded = atVersions(admin, 'evolve@0.2.0')
    expect(await archivedRow('evolve.memo')).toMatchObject({ archived_note: 'Plain table', archived_at: expect.anything() })
    expect(await archivedRow('evolve.region')).toMatchObject({ archived_note: 'Scope table', archived_at: expect.anything() })
    expect(await upgraded.get(`${tableUrl('evolve.memo')}/n1`)).toMatchObject({ body: 'Count again on Monday' })
    await expectApiError(saveRow(upgraded, 'evolve.memo', { row_id: 'n2', body: 'New' }), archivedRefusal('evolve.memo'))
    await expectApiError(saveRow(upgraded, 'evolve.region', { row_id: 'z1', zone_name: 'New' }), archivedRefusal('evolve.region'))
  })

  describe('a table that decides access', () => {
    test('can be archived while it holds no rows, and not once it holds any', async ({ admin }) => {
      await rosterWithSeparateEntry(async (consumer, provider) => {
        expect(await discoverPackages([consumer, provider])).toEqual([])
        await admin.post('/api/install_app', { name: 'placeroster' })
        await saveRow(admin, POSITION, { row_id: 'p1', person: 'someone', place: 'North', store: 'N1', section: 'kids' })
        await expectApiError(archive(admin, POSITION), {
          status: 417, message: expect.stringContaining('it decides who can see or do what, and it holds rows'),
        })
        // A retired row is still a row: scope reads it.
        await admin.post(`${tableUrl(POSITION)}/p1:retire`, { reason: 'Moved' })
        await expectRefused(archive(admin, POSITION), 417)
        await admin.post(`${tableUrl(POSITION)}:purge`, { ids: ['p1'], links: 'clear', reason: 'Made by mistake', confirm: true })
        expect(await archive(admin, POSITION)).toMatchObject({ archived_at: expect.anything() })
      })
    })

    test('no rows can be added while it is archived', async ({ admin }) => {
      await rosterWithSeparateEntry(async (consumer, provider) => {
        expect(await discoverPackages([consumer, provider])).toEqual([])
        await admin.post('/api/install_app', { name: 'placeroster' })
        await archive(admin, POSITION)
        const refused = archivedRefusal(POSITION)
        await expectApiError(saveRow(admin, POSITION, { row_id: 'p1', person: 'someone', place: 'North' }), refused)
        await expectApiError(admin.post(`${tableUrl(POSITION)}:import`, { key_column: 'person', rows: [{ person: 'someone', place: 'North' }] }), refused)
        expect((await admin.get<{ data: unknown[] }>(tableUrl(POSITION))).data).toEqual([])
      })
    })

    test("people's scope is the same before and after archiving", async ({ admin, createUser }) => {
      await rosterWithSeparateEntry(async (consumer, provider) => {
        expect(await discoverPackages([consumer, provider])).toEqual([])
        await admin.post('/api/install_app', { name: 'scopeproof' })
        await admin.post('/api/install_app', { name: 'placeroster' })
        const user = await createUser({ email: 'arc.placed@example.test', roles: ['Scope Reader'] })

        // Empty, as an unused app's table is: the person covers no place,
        // which an app refuses, and archiving doesn't change that answer.
        const asked = () => user.post(places, { payload: {} }).catch((error: Error) => error.message)
        const empty = await asked()
        expect(empty).toContain('Application access refused')
        await archive(admin, POSITION)
        expect(await asked()).toEqual(empty)
        await unarchive(admin, POSITION)

        // Reads ignore the mark altogether: rows already there still decide
        // scope however a Table came to be archived.
        await saveRow(admin, POSITION, { row_id: 'p1', person: user.user, place: 'North / Kids', store: 'N1', section: 'kids' })
        const placed = await user.post(places, { payload: {} })
        expect(placed).toMatchObject({ result: { places: [{ label: 'North / Kids' }] } })
        await sql`update table_def set archived_at = now(), archived_by = 'Administrator' where name = ${POSITION}`
        invalidateMeta(POSITION)
        expect(await user.post(places, { payload: {} })).toEqual(placed)
      })
    })
  })
})
