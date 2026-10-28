// #629: the glossary. An app ships its terms in its manifest; installing it
// adds them under the app, an instance may add its own and reword an app's,
// and an upgrade never overwrites a local wording. Everyone signed in reads
// it; editing is a write grant on Glossary Term. Fixtures:
// runtime-apps/fixtures/shelves-v1, -v2 (new wording) and -elsewhere (a term
// describing another app's Table).
import { resolve } from 'node:path'
import type { TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { discoverPackages, packageFailures } from '../src/runtime-packages'
import { uninstallApp } from '../src/apps'
import { expectApiError } from './fixtures'

const v1 = resolve('../..', 'runtime-apps/fixtures/shelves-v1')
const v2 = resolve('../..', 'runtime-apps/fixtures/shelves-v2')
const elsewhere = resolve('../..', 'runtime-apps/fixtures/shelves-elsewhere')

interface Term {
  id: string
  term: string
  app: string | null
  appTitle: string | null
  definition: string
  examples: string[]
  avoid: { word: string; reason: string | null }[]
  describes: { table: string; column: string | null }[]
  editedHere: boolean
  appWordingChanged: boolean
}
interface Glossary { canEdit: boolean; terms: Term[] }

const glossary = (client: TestClient) => client.get<Glossary>('/api/glossary')
const named = async (client: TestClient, term: string) => (await glossary(client)).terms.find(t => t.term === term)

async function install(admin: TestClient, paths = [v1]) {
  expect(await discoverPackages(paths)).toEqual([])
  await admin.post('/api/install_app', { name: 'shelves' })
}

async function upgrade(admin: TestClient) {
  expect(await discoverPackages([v1, v2])).toEqual([])
  const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'shelves', version: '1.1.0' })
  await admin.post('/api/upgrade_app', { name: 'shelves', version: '1.1.0', planId: plan.planId })
  await admin.post('/api/activate_app_upgrade', { name: 'shelves', version: '1.1.0' })
}

const loaded = (client: TestClient, id: string) => client.get<{ updated_at: string }>(`/api/table/${encodeURIComponent('Glossary Term')}/${id}`)
async function reword(client: TestClient, term: string, definition: string) {
  const id = (await named(client, term))!.id
  return client.post('/api/save_row', { table: 'Glossary Term', row: { row_id: id, updated_at: (await loaded(client, id)).updated_at, definition } })
}

describe('apps ship their terms', () => {
  test('installing an app adds its terms under the app, with definitions, examples and words to avoid', async ({ admin }) => {
    await install(admin)
    const { terms } = await glossary(admin)
    expect(terms.map(t => [t.app, t.appTitle, t.term])).toEqual([['shelves', 'Shelves', 'Coverage'], ['shelves', 'Shelves', 'Shelf Lead']])
    expect(terms[0]).toMatchObject({
      definition: 'The aisles a person looks after.',
      examples: [],
      avoid: [{ word: 'scope', reason: 'reads as access rights' }],
      describes: [{ table: 'shelves.aisle', column: null }],
      editedHere: false,
      appWordingChanged: false,
    })
    expect(terms[1]).toMatchObject({
      examples: ['Asha is Shelf Lead for aisle 4 on the morning shift.'],
      avoid: [],
      describes: [{ table: 'shelves.assignment', column: 'job' }],
    })
  })

  test('a term describing a Table the app does not own refuses the app and names the term', async () => {
    await discoverPackages([elsewhere])
    expect(packageFailures).toEqual([{ path: expect.stringContaining('shelves-elsewhere'),
      error: 'The glossary term Coverage describes tasker.task, which the app does not own or declare' }])
  })
})

describe('reading the glossary', () => {
  test('everyone signed in reads it; only an editor is told they can edit', async ({ admin, createUser }) => {
    await install(admin)
    const staff = await createUser({ email: 'staff@example.test' })
    expect((await glossary(staff)).terms.map(t => t.term)).toEqual(['Coverage', 'Shelf Lead'])
    expect((await glossary(staff)).canEdit).toBe(false)
    expect((await glossary(admin)).canEdit).toBe(true)
  })

  test('a person without a write grant cannot change a term', async ({ admin, createUser }) => {
    await install(admin)
    const staff = await createUser({ email: 'staff@example.test' })
    const id = (await named(staff, 'Coverage'))!.id
    const { updated_at } = await loaded(staff, id)
    await expectApiError(staff.post('/api/save_row', { table: 'Glossary Term', row: { row_id: id, updated_at, definition: 'Mine now' } }), { status: 403 })
    await expectApiError(staff.post('/api/glossary/take_app_wording', { id }), { status: 403 })
  })

  test('a role granted write on Glossary Term may edit it', async ({ admin, createUser }) => {
    await install(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Glossary Editor' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Glossary Term', role: 'Glossary Editor', can_read: true, can_write: true, can_create: true } })
    const editor = await createUser({ email: 'editor@example.test', roles: ['Glossary Editor'] })
    expect((await glossary(editor)).canEdit).toBe(true)
    await reword(editor, 'Coverage', 'The aisles you answer for.')
    expect(await named(editor, 'Coverage')).toMatchObject({ definition: 'The aisles you answer for.', editedHere: true })
  })
})

describe('instance terms', () => {
  test('a term added with no app belongs to the instance, and the app column cannot be claimed', async ({ admin }) => {
    await install(admin)
    await admin.post('/api/save_row', { table: 'Glossary Term', row: {
      term: 'Planogram', app: 'shelves', definition: 'The drawing of what goes on each shelf.',
      avoid: [{ word: 'layout' }], describes: [{ link_table: 'shelves.aisle' }],
    } })
    expect(await named(admin, 'Planogram')).toMatchObject({
      app: null, appTitle: null, avoid: [{ word: 'layout', reason: null }],
      describes: [{ table: 'shelves.aisle', column: null }], editedHere: false,
    })
  })

  test('a term describing a column its Table does not have is refused', async ({ admin }) => {
    await install(admin)
    await expectApiError(admin.post('/api/save_row', { table: 'Glossary Term', row: {
      term: 'Bay', definition: 'A run of shelving.', describes: [{ link_table: 'shelves.aisle', link_column: 'bay' }],
    } }), { status: 417, message: expect.stringContaining('has no column bay') })
  })
})

describe('local wording survives upgrades', () => {
  test('an upgrade refreshes an unedited term and keeps a reworded one, marking that the app\'s wording changed', async ({ admin }) => {
    await install(admin)
    await reword(admin, 'Coverage', 'The aisles you answer for.')
    expect(await named(admin, 'Coverage')).toMatchObject({ editedHere: true, appWordingChanged: false })
    await upgrade(admin)
    expect(await named(admin, 'Shelf Lead')).toMatchObject({
      definition: 'The person who keeps one aisle\'s shelves full and tidy for a whole shift.', editedHere: false })
    expect(await named(admin, 'Coverage')).toMatchObject({
      definition: 'The aisles you answer for.', editedHere: true, appWordingChanged: true })
  })

  test('taking the app\'s wording replaces the local one and clears the marks', async ({ admin }) => {
    await install(admin)
    await reword(admin, 'Coverage', 'The aisles you answer for.')
    await upgrade(admin)
    await admin.post('/api/glossary/take_app_wording', { id: (await named(admin, 'Coverage'))!.id })
    expect(await named(admin, 'Coverage')).toMatchObject({
      definition: 'The aisles a person is answerable for on a shift.', editedHere: false, appWordingChanged: false })
  })

  test('rewording a term back to the app\'s wording makes it unedited again', async ({ admin }) => {
    await install(admin)
    await reword(admin, 'Shelf Lead', 'Keeps an aisle stocked.')
    await reword(admin, 'Coverage', 'The aisles you answer for.')
    await reword(admin, 'Coverage', 'The aisles a person looks after.')
    expect(await named(admin, 'Coverage')).toMatchObject({ editedHere: false })
  })
})

describe('terms follow their app', () => {
  test('a turned-off app\'s terms leave the glossary and return when it is turned back on', async ({ admin }) => {
    await install(admin)
    await admin.post('/api/set_app_enabled', { name: 'shelves', enabled: false })
    expect((await glossary(admin)).terms).toEqual([])
    await admin.post('/api/set_app_enabled', { name: 'shelves', enabled: true })
    expect((await glossary(admin)).terms.map(t => t.term)).toEqual(['Coverage', 'Shelf Lead'])
  })

  test('a removed app\'s terms leave, and return with the local wording when it is installed again', async ({ admin }) => {
    await install(admin)
    await reword(admin, 'Coverage', 'The aisles you answer for.')
    await uninstallApp('shelves')
    expect((await glossary(admin)).terms).toEqual([])
    await install(admin)
    expect(await named(admin, 'Coverage')).toMatchObject({ definition: 'The aisles you answer for.', editedHere: true })
    expect((await glossary(admin)).terms).toHaveLength(2)
  })
})
