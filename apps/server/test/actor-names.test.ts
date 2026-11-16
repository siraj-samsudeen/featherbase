import { afterEach, expect } from 'vitest'
import { resolve } from 'node:path'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { test } from './pg-test'
import { expectStatus, grantRole } from './fixtures'
import { discoverPackages } from '../src/runtime-packages'
import { actorNames, serviceAccountName } from '../src/actor-names'

// #1224: who did something is named wherever it is shown — a person by their
// display name even to a viewer who may not read Person, a service account by
// a readable label, a system step by a plain phrase. Never an address, never
// the opaque id.

interface Explanation {
  roles: { role: string; given_by: string | null; given_by_name: string | null }[]
  limits: { set_by: string; set_by_name: string | null }[]
  shares: { shared_by: string; shared_by_name: string | null }[]
}

const patch = async (client: { fetch: (path: string, init?: RequestInit) => Promise<Response> }, path: string, body: unknown) => {
  const res = await client.fetch(path, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  expect(res.status).toBe(200)
}

const pageOf = (person: string) => `/api/access_explanation/${encodeURIComponent(person)}`

test('a viewer who may not read Person still sees who gave them a role, by name and nothing more', async ({ admin, createUser }) => {
  await grantRole(admin, { role: 'An Editor Role', table: [] })
  const giver = await createUser({ roles: ['System Manager'] })
  await admin.post('/api/save_row', { table: 'Person', row: { row_id: giver.user, full_name: 'Giver Fullname', updated_at: (await admin.get<{ updated_at: string }>(`/api/table/Person/${giver.user}`)).updated_at } })
  const viewer = await createUser({ roles: [] })
  const doc = await admin.get<{ updated_at: string; roles: { role: string }[] }>(`/api/table/Person/${viewer.user}`)
  await giver.post('/api/save_row', { table: 'Person', row: { row_id: viewer.user, updated_at: doc.updated_at, roles: [...doc.roles, { role: 'An Editor Role' }] } })

  // The viewer cannot read Person: the generic name lookup still says nothing.
  expect((await viewer.post<{ names: Record<string, string | null> }>('/api/people/names', { ids: [giver.user] })).names[giver.user!]).toBeNull()

  const page = await viewer.get<Explanation>(pageOf(viewer.user!))
  const role = page.roles.find((r) => r.role === 'An Editor Role')!
  expect(role).toMatchObject({ given_by: giver.user, given_by_name: 'Giver Fullname' })
  // Only the display name travels: never the giver's address.
  expect(JSON.stringify(page)).not.toContain('@example')
})

test('a service account reads as automation, or by the display name an admin gives it', async ({ admin, createUser }) => {
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-installer', roles: ['System Manager'] })
  expect(serviceAccountName({ label: 'svc-installer', display_name: null })).toBe('Automation (installer)')
  expect(serviceAccountName({ label: 'svc-dash-review', display_name: '  ' })).toBe('Automation (dash review)')
  expect(serviceAccountName({ label: 'importer', display_name: null })).toBe('Automation (importer)')
  expect((await actorNames([account.row_id])).get(account.row_id)).toBe('Automation (installer)')

  // The role it gave reads that way on the person's own page.
  await grantRole(admin, { role: 'Svc Given Role', table: [] })
  const person = await createUser({ roles: [] })
  await patch(admin, `/api/service_accounts/${account.row_id}`, { display_name: 'Claude — setup agent' })
  expect((await actorNames([account.row_id])).get(account.row_id)).toBe('Claude — setup agent')
  // The label (a lookup key) is unchanged.
  const listed = await admin.get<{ service_accounts: { row_id: string; label: string; display_name: string | null }[] }>('/api/service_accounts')
  expect(listed.service_accounts.find((s) => s.row_id === account.row_id)).toMatchObject({ label: 'svc-installer', display_name: 'Claude — setup agent' })
  // Clearing it falls back to the automation label.
  await patch(admin, `/api/service_accounts/${account.row_id}`, { display_name: '' })
  expect((await actorNames([account.row_id])).get(account.row_id)).toBe('Automation (installer)')
  void person
})

test('only a System Manager names a service account', async ({ admin, createUser }) => {
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-other', roles: [] })
  const someone = await createUser({ roles: [] })
  const res = await someone.fetch(`/api/service_accounts/${account.row_id}`, { method: 'PATCH', body: JSON.stringify({ display_name: 'Me' }), headers: { 'content-type': 'application/json' } })
  expect(res.status).toBe(403)
})

test('system steps read as plain phrases; an unknown opaque id names nobody', async () => {
  const names = await actorNames(['roster-link', 'google-sign-in', 'delegated-password-sign-in', 'Administrator', 'psn_aaaaaaaaaaaaaaaaaaaa'])
  expect(names.get('roster-link')).toBe('Staff roster sync')
  expect(names.get('google-sign-in')).toBe('Google sign-in')
  expect(names.get('delegated-password-sign-in')).toBe('Connected service sign-in')
  expect(names.get('Administrator')).toBe('Administrator')
  expect(names.get('psn_aaaaaaaaaaaaaaaaaaaa')).toBeUndefined()
})

const directories: string[] = []
afterEach(async () => { for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }) })

test('an app names only who acted on its own data; any other id is null (no name lookup)', async ({ admin, createUser }) => {
  const directory = await mkdtemp(resolve('test/.b5-1224-actors-'))
  directories.push(directory)
  await cp(resolve('../..', 'test-apps/fixtures/bar-proof'), directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.roles = ['Bar Reader']
  manifest.reads.operations = { ...manifest.reads.operations, actor_names: { policy: { kind: 'table' }, authorization: { kind: 'generic' } } }
  await writeFile(file, JSON.stringify(manifest))
  await appendFile(resolve(directory, 'server.mjs'), `\nreads.actor_names = ({ people, payload }) => people.actorNames(payload.ids)\n`)
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })

  const named = async (id: string, fullName: string) => {
    const doc = await admin.get<{ updated_at: string }>(`/api/table/Person/${id}`)
    await admin.post('/api/save_row', { table: 'Person', row: { row_id: id, full_name: fullName, updated_at: doc.updated_at } })
  }
  // The actor wrote one of the app's own rows.
  const actor = await createUser({ roles: ['System Manager'] })
  await named(actor.user!, 'Acting Person')
  await actor.post('/api/save_row', { table: 'barproof.note', row: { row_id: 'n-1224', body: 'by the actor' } })
  // These two never touched the app's data.
  const stranger = await createUser({ roles: [] })
  await named(stranger.user!, 'Unrelated Person')
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-dash-review', roles: [] })
  const caller = await createUser({ roles: ['Bar Reader'] })

  const res = await caller.fetch('/api/app_reads/barproof/actor_names', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Featherbase-App-Version': 'barproof@1.0.0' },
    body: JSON.stringify({ payload: { ids: [actor.user, stranger.user, account.row_id, 'roster-link', 'psn_aaaaaaaaaaaaaaaaaaaa'] } }),
  })
  await expectStatus(res, 200)
  expect(((await res.json()) as { result: unknown }).result).toEqual({
    [actor.user!]: 'Acting Person',
    [stranger.user!]: null,
    [account.row_id]: null,
    'roster-link': 'Staff roster sync',
    psn_aaaaaaaaaaaaaaaaaaaa: null,
  })
})

test('the name an admin gives a service account shows only to those who may read Service Account', async ({ admin, createUser }) => {
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-installer', roles: [] })
  await patch(admin, `/api/service_accounts/${account.row_id}`, { display_name: 'Claude — setup agent' })
  const someone = await createUser({ roles: [] })
  const lookup = async (client: typeof admin) =>
    (await client.post<{ names: Record<string, string | null> }>('/api/people/names', { ids: [account.row_id] })).names[account.row_id]
  expect(await lookup(admin)).toBe('Claude — setup agent')
  expect(await lookup(someone)).toBe('Automation (installer)')
})

test('a reader whose Service Account grant covers only rows they made does not learn other accounts\' given names', async ({ admin, createUser }) => {
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-installer', roles: [] })
  await patch(admin, `/api/service_accounts/${account.row_id}`, { display_name: 'Claude — setup agent' })
  await grantRole(admin, { role: 'Own Accounts Reader', table: 'Service Account', can_read: true, own_rows_only: true })
  const restricted = await createUser({ roles: ['Own Accounts Reader'] })
  const { names } = await restricted.post<{ names: Record<string, string | null> }>('/api/people/names', { ids: [account.row_id] })
  expect(names[account.row_id]).toBe('Automation (installer)')
})

test('the activity feed names a service account the same way as everywhere else', async ({ admin }) => {
  const { whoLabels } = await import('../src/events')
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-installer', roles: [] })
  expect((await whoLabels([account.row_id])).get(account.row_id)).toEqual({ name: 'Automation (installer)', role: 'Service account' })
  await patch(admin, `/api/service_accounts/${account.row_id}`, { display_name: 'Claude — setup agent' })
  expect((await whoLabels([account.row_id])).get(account.row_id)?.name).toBe('Claude — setup agent')
})

const actorNamesOn = (client: { post: <T>(path: string, body: unknown) => Promise<T> }, table: string, ids: string[]) =>
  client.post<{ names: Record<string, string | null> }>('/api/people/actor_names', { table, ids }).then((r) => r.names)

test('a list names who made or changed the rows a viewer may read, without Person read; anyone else stays unnamed', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Act Note', columns: [{ column_name: 'body', column_type: 'Data' }] })
  await grantRole(admin, { role: 'Act Note Reader', table: 'Act Note', can_read: true })
  await grantRole(admin, { role: 'Act Note Writer', table: 'Act Note', can_read: true, can_create: true, can_write: true })
  const writer = await createUser({ roles: ['Act Note Writer'], fullName: 'Act Writer' })
  const stranger = await createUser({ roles: [], fullName: 'Act Stranger' })
  await writer.post('/api/save_row', { table: 'Act Note', row: { body: 'hello' } })
  const reader = await createUser({ roles: ['Act Note Reader'] })

  expect(await actorNamesOn(reader, 'Act Note', [writer.user!, stranger.user!, 'roster-link'])).toEqual({
    [writer.user!]: 'Act Writer', [stranger.user!]: null, 'roster-link': 'Staff roster sync',
  })
  // The generic lookup still says nothing to this reader.
  expect((await reader.post<{ names: Record<string, string | null> }>('/api/people/names', { ids: [writer.user] })).names[writer.user!]).toBeNull()

  // Who archived the Table is named to someone who may read it.
  await admin.post('/api/table_def/Act%20Note/archive', { note: 'done' })
  expect((await actorNamesOn(reader, 'Act Note', ['Administrator']))['Administrator']).toBe('Administrator')
})

test('rows the viewer may not read name nobody: creator-only reach, and a Table they cannot read', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Act Private', columns: [{ column_name: 'body', column_type: 'Data' }] })
  await grantRole(admin, { role: 'Act Private Writer', table: 'Act Private', can_read: true, can_create: true })
  await grantRole(admin, { role: 'Act Private Own', table: 'Act Private', can_read: true, own_rows_only: true })
  const writer = await createUser({ roles: ['Act Private Writer'], fullName: 'Private Writer' })
  await writer.post('/api/save_row', { table: 'Act Private', row: { body: 'secret' } })
  const ownOnly = await createUser({ roles: ['Act Private Own'] })
  const nobody = await createUser({ roles: [] })
  expect(await actorNamesOn(ownOnly, 'Act Private', [writer.user!])).toEqual({ [writer.user!]: null })
  expect(await actorNamesOn(nobody, 'Act Private', [writer.user!])).toEqual({ [writer.user!]: null })
  const bad = await nobody.fetch('/api/people/actor_names', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: 'x' }) })
  expect(bad.status).toBe(417)
})

test('a sub-table names nobody through its rows; anyone the rule does not name is looked up as before', async ({ admin, createUser }) => {
  const { makeTable } = await import('./fixtures')
  await makeTable(admin, { name: 'Act Step', kind: 'sub_table', columns: ['note'] })
  await makeTable(admin, { name: 'Act Plan', columns: ['title', { column_name: 'steps', column_type: 'Sub-table', row_table: 'Act Step' }] })
  await grantRole(admin, { role: 'Act Planner', table: ['Act Plan', 'Act Step'], can_read: true, can_create: true, can_write: true })
  const planner = await createUser({ roles: ['Act Planner'], fullName: 'Act Planner Person' })
  await planner.post('/api/save_row', { table: 'Act Plan', row: { title: 'p', steps: [{ note: 'one' }] } })
  await grantRole(admin, { role: 'Act Plan Reader', table: ['Act Plan', 'Act Step'], can_read: true })
  const reader = await createUser({ roles: ['Act Plan Reader'] })
  // Through the parent, the planner is named; through the child rows, nobody is.
  expect((await actorNamesOn(reader, 'Act Plan', [planner.user!]))[planner.user!]).toBe('Act Planner Person')
  expect((await actorNamesOn(reader, 'Act Step', [planner.user!]))[planner.user!]).toBeNull()
  // A viewer who may read Person but not the Table still gets the name, as before this change.
  await grantRole(admin, { role: 'Act People Reader', table: 'Person', can_read: true })
  const peopleReader = await createUser({ roles: ['Act People Reader'] })
  expect((await actorNamesOn(peopleReader, 'Act Plan', [planner.user!]))[planner.user!]).toBe('Act Planner Person')
})

test('a row shared directly with someone names who made it, though they may read neither the Table nor Person', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Act Shared', columns: [{ column_name: 'body', column_type: 'Data' }] })
  await grantRole(admin, { role: 'Act Shared Writer', table: 'Act Shared', can_read: true, can_create: true })
  const writer = await createUser({ roles: ['Act Shared Writer'], fullName: 'Shared Writer' })
  const row = await writer.post<{ row_id: string }>('/api/save_row', { table: 'Act Shared', row: { body: 'for you' } })
  const recipient = await createUser({ roles: [] })
  await admin.post('/api/save_row', { table: 'Share', row: { share_table: 'Act Shared', share_name: row.row_id, person: recipient.user, read: true } })
  expect(await actorNamesOn(recipient, 'Act Shared', [writer.user!])).toEqual({ [writer.user!]: 'Shared Writer' })
  // Without the share, nothing.
  const other = await createUser({ roles: [] })
  expect(await actorNamesOn(other, 'Act Shared', [writer.user!])).toEqual({ [writer.user!]: null })
})
