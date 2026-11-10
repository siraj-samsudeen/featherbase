// #629: the glossary. An app ships its terms in its manifest; installing it
// adds them under the app, an instance may add its own and reword an app's,
// and an upgrade never overwrites a local wording. Everyone signed in reads
// it; editing is a write grant on Glossary Term. Fixtures:
// test-apps/fixtures/shelves-v1, -v2 (new wording) and -elsewhere (a term
// describing another app's Table).
import { resolve } from 'node:path'
import type { TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { discoverPackages, packageFailures } from '../src/runtime-packages'
import { installApp, registerApp, uninstallApp } from '../src/apps'
import { glossaryDeclaration, readGlossary, syncAppGlossary, takeAppWording, validateGlossary } from '../src/glossary'
import { expectApiError, expectRefused, expectStatus, grantRole } from './fixtures'
import { sql } from '../src/db'
import { deleteStored } from '../src/storage'

const v1 = resolve('../..', 'test-apps/fixtures/shelves-v1')
const v2 = resolve('../..', 'test-apps/fixtures/shelves-v2')
const elsewhere = resolve('../..', 'test-apps/fixtures/shelves-elsewhere')
const renamed = resolve('../..', 'test-apps/fixtures/shelves-renamed')

interface Term {
  id: string
  term: string
  app: string | null
  appTitle: string | null
  definition: string
  examples: string[]
  avoid: { word: string; reason: string | null }[]
  describes: { table: string; column: string | null; columnLabel: string | null }[]
  picture: string | null
  editedHere: boolean
  appWordingChanged: boolean
}
interface Glossary { canEdit: boolean; canAdd: boolean; terms: Term[] }

const glossary = (client: TestClient) => client.get<Glossary>('/api/glossary')
const named = async (client: TestClient, term: string) => (await glossary(client)).terms.find(t => t.term === term)

async function install(admin: TestClient, paths = [v1]) {
  expect(await discoverPackages(paths)).toEqual([])
  await admin.post('/api/install_app', { name: 'shelves' })
}

async function upgrade(admin: TestClient, to = v2) {
  expect(await discoverPackages([v1, to])).toEqual([])
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
      describes: [{ table: 'shelves.aisle', column: null, columnLabel: null }],
      editedHere: false,
      appWordingChanged: false,
    })
    expect(terms[1]).toMatchObject({
      examples: ['Asha is Shelf Lead for aisle 4 on the morning shift.'],
      avoid: [],
      describes: [{ table: 'shelves.assignment', column: 'job', columnLabel: 'Job' }],
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
    expect(await glossary(staff)).toMatchObject({ canEdit: false, canAdd: false })
    expect(await glossary(admin)).toMatchObject({ canEdit: true, canAdd: true })
  })

  test('a person without a write grant cannot change a term', async ({ admin, createUser }) => {
    await install(admin)
    const staff = await createUser({ email: 'staff@example.test' })
    const id = (await named(staff, 'Coverage'))!.id
    const { updated_at } = await loaded(staff, id)
    await expectRefused(staff.post('/api/save_row', { table: 'Glossary Term', row: { row_id: id, updated_at, definition: 'Mine now' } }), 403)
    await expectRefused(staff.post('/api/glossary/take_app_wording', { id }), 403)
  })

  test('a role granted write on Glossary Term may edit it', async ({ admin, createUser }) => {
    await install(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Glossary Editor' } })
    await grantRole(admin, { table: 'Glossary Term', role: 'Glossary Editor', can_read: true, can_write: true, can_create: true })
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
      describes: [{ table: 'shelves.aisle', column: null, columnLabel: null }], editedHere: false,
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

describe('review fixes', () => {
  test('the mark that the app\'s wording changed goes once the term is saved back to the app\'s wording, and stays gone', async ({ admin }) => {
    await install(admin)
    await reword(admin, 'Coverage', 'The aisles you answer for.')
    await upgrade(admin)
    await reword(admin, 'Coverage', 'The aisles a person is answerable for on a shift.')
    await reword(admin, 'Coverage', 'Mine again.')
    expect(await named(admin, 'Coverage')).toMatchObject({ editedHere: true, appWordingChanged: false })
  })

  test('renaming a Table or column in an upgrade carries every term that names it', async ({ admin }) => {
    await install(admin)
    await reword(admin, 'Coverage', 'The aisles you answer for.')
    await admin.post('/api/save_row', { table: 'Glossary Term', row: { term: 'Bay', definition: 'A run of shelving.',
      describes: [{ link_table: 'shelves.aisle' }, { link_table: 'shelves.assignment', link_column: 'job' }] } })
    await upgrade(admin, renamed)
    expect(await named(admin, 'Shelf Lead')).toMatchObject({ editedHere: false,
      describes: [{ table: 'shelves.assignment', column: 'role', columnLabel: 'Job' }] })
    expect(await named(admin, 'Coverage')).toMatchObject({ editedHere: true, appWordingChanged: false,
      describes: [{ table: 'shelves.bay', column: null }] })
    const bay = (await named(admin, 'Bay'))!
    expect(bay.describes.map(d => [d.table, d.column])).toEqual([['shelves.bay', null], ['shelves.assignment', 'role']])
    await reword(admin, 'Bay', 'A run of shelving, end to end.')
  })

  test('an example over two lines, or one term declared twice in different case, is refused', () => {
    expect(glossaryDeclaration.safeParse({ version: 1, terms: [{ term: 'A', definition: 'B', examples: ['one\ntwo'] }] }).success).toBe(false)
    expect(glossaryDeclaration.safeParse({ version: 1, terms: [{ term: 'Bay', definition: 'B' }, { term: 'bay', definition: 'C' }] }).success).toBe(false)
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

// #1037: a term may carry a picture, such as a diagram of how words relate.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function uploadPicture(as: TestClient, id: string, isPrivate = false): Promise<string> {
  const form = new FormData()
  form.append('file', new File([Buffer.from(PNG, 'base64')], 'sites.png', { type: 'image/png' }))
  form.append('ref_table', 'Glossary Term')
  form.append('ref_name', id)
  if (isPrivate) form.append('is_private', '1')
  const res = await as.fetch('/api/upload_file', { method: 'POST', body: form })
  await expectStatus(res, 201)
  return ((await res.json()) as { file_url: string }).file_url
}

async function setPicture(client: TestClient, id: string, picture: string | null) {
  await client.post('/api/save_row', { table: 'Glossary Term', row: { row_id: id, updated_at: (await loaded(client, id)).updated_at, picture } })
}

describe('a term carries a picture', () => {
  test('the picture is an image column right after the definition', async () => {
    const columns = await sql`select column_name, label, column_type from column_def where parent = 'Glossary Term' order by position`
    expect(columns.slice(0, 5).map(c => c.column_name)).toEqual(['term', 'app', 'definition', 'picture', 'examples'])
    expect(columns.find(c => c.column_name === 'picture')).toMatchObject({ label: 'Picture', column_type: 'Attach Image' })
  })

  test('a term has no picture until one is set; everyone who reads the glossary sees it and can open it', async ({ admin, createUser }) => {
    await install(admin)
    const staff = await createUser({ email: 'staff@example.test' })
    const id = (await named(admin, 'Coverage'))!.id
    expect((await named(staff, 'Coverage'))!.picture).toBeNull()
    for (const isPrivate of [false, true]) {
      const url = await uploadPicture(admin, id, isPrivate)
      try {
        await setPicture(admin, id, url)
        // A picture is not wording: setting one leaves an app's term unedited.
        expect(await named(staff, 'Coverage')).toMatchObject({ picture: url, editedHere: false })
        const res = await staff.fetch(url)
        await expectStatus(res, 200)
        expect(res.headers.get('content-type')).toBe('image/png')
      } finally {
        await deleteStored(url)
      }
    }
  })

  test('an upgrade, and taking the app\'s wording, keep the picture', async ({ admin }) => {
    await install(admin)
    const shelfLead = (await named(admin, 'Shelf Lead'))!.id
    const coverage = (await named(admin, 'Coverage'))!.id
    await setPicture(admin, shelfLead, '/files/lead.png')
    await setPicture(admin, coverage, '/files/coverage.png')
    await reword(admin, 'Coverage', 'The aisles you answer for.')
    await upgrade(admin)
    expect(await named(admin, 'Shelf Lead')).toMatchObject({ editedHere: false, picture: '/files/lead.png',
      definition: 'The person who keeps one aisle\'s shelves full and tidy for a whole shift.' })
    await admin.post('/api/glossary/take_app_wording', { id: coverage })
    expect(await named(admin, 'Coverage')).toMatchObject({ editedHere: false, picture: '/files/coverage.png' })
  })
})

describe('taking an app\'s wording', () => {
  test('of a term that does not exist is not found', async () => {
    await expect(takeAppWording('gt_missing', 'Administrator')).rejects.toMatchObject({ type: 'NotFoundError' })
  })

  test('of an instance term, which has none, is refused', async ({ admin }) => {
    const term = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Glossary Term', row: { term: 'Plant', definition: 'A store.' } })
    await expect(takeAppWording(term.row_id, 'Administrator')).rejects.toMatchObject({ type: 'ValidationError', message: 'This term belongs to the instance; it has no app wording to take' })
  })

  // A code-registered app keeps no manifest on its installed row.
  test('an installed app with no stored manifest adds nothing, and the instance terms still show', async ({ admin }) => {
    registerApp({ name: 'glossary-code-app' })
    try {
      await installApp('glossary-code-app')
      await admin.post('/api/save_row', { table: 'Glossary Term', row: { term: 'Plant', definition: 'A store.' } })
      expect(JSON.stringify(await readGlossary('Administrator'))).toContain('A store.')
    } finally {
      await uninstallApp('glossary-code-app').catch(() => {})
    }
  })

  test('reading the glossary without the grant to read terms is refused', async () => {
    await expect(readGlossary('Guest')).rejects.toMatchObject({ type: 'PermissionError', message: 'Not permitted to read the glossary' })
  })
})

describe('what a term describes', () => {
  test('a term that describes nothing is valid for any app', () => {
    expect(() => validateGlossary({ version: 1, terms: [{ term: 'Bay', definition: 'A run of shelving.' }] }, [], [])).not.toThrow()
  })

  test("a term describing a column the app's own Table does not have names the column", () => {
    expect(() => validateGlossary(
      { version: 1, terms: [{ term: 'Bay', definition: 'A run of shelving.', describes: [{ table: 'shelves.aisle', column: 'bay' }] }] },
      [{ name: 'shelves.aisle', columns: [{ column_name: 'label' }] }],
      [],
    )).toThrow('The glossary term Bay describes shelves.aisle.bay, which the app does not own or declare')
  })

  test('an app term that names no Table, and a word to avoid with no reason, is written with neither', async () => {
    await syncAppGlossary('shelves', { version: 1, terms: [{ term: 'Bay', definition: 'A run of shelving.', avoid: [{ word: 'slot' }] }] }, 'Administrator')
    const [row] = await sql`select row_id from glossary_term where app = 'shelves' and app_key = 'Bay'`
    expect(await sql`select word, reason from glossary_avoid_word where parent = ${row.row_id}`).toEqual([{ word: 'slot', reason: null }])
    expect(await sql`select 1 from glossary_link where parent = ${row.row_id}`).toHaveLength(0)
  })

  test("the instance's own terms are listed after every app's, by term", async ({ admin }) => {
    for (const term of ['Zone', 'Aisle End'])
      await admin.post('/api/save_row', { table: 'Glossary Term', row: { term, definition: 'An instance word.' } })
    const own = (await glossary(admin)).terms.filter(t => t.app === null).map(t => t.term)
    expect(own.indexOf('Aisle End')).toBeLessThan(own.indexOf('Zone'))
  })

  test('a described column that is gone from its Table is shown by its name', async ({ admin }) => {
    await install(admin)
    await sql`delete from column_def where parent = 'shelves.assignment' and column_name = 'job'`
    expect((await named(admin, 'Shelf Lead'))!.describes).toEqual([{ table: 'shelves.assignment', column: 'job', columnLabel: 'job' }])
  })

  test('a described column with no label is shown by its name', async ({ admin }) => {
    await install(admin)
    await sql`update column_def set label = null where parent = 'shelves.assignment' and column_name = 'job'`
    expect((await named(admin, 'Shelf Lead'))!.describes).toEqual([{ table: 'shelves.assignment', column: 'job', columnLabel: 'job' }])
  })

  test('a blank Table is skipped, and a Table that does not exist is refused', async ({ admin }) => {
    await expectRefused(admin.post('/api/save_row', { table: 'Glossary Term', row: {
      term: 'Ghost', definition: 'Nothing.', describes: [{ link_table: '  ' }, { link_table: 'No Such Table' }],
    } }), 417, 'There is no Table No Such Table')
  })
})
