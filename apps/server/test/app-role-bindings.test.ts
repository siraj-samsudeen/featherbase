// #620 (design D4): people never hold an app's roles by hand. An App Role
// Binding row says which of the instance's roles carry one of the app's
// roles; a System Manager edits them in Admin, and the app's `roleDefaults`
// suggestions are written once, at install. The role check honours bindings,
// fresh on every request. Fixtures: runtime-apps/fixtures/setup-proof-v1 and
// -v2, with runtime-apps/fixtures/place-roster providing scope.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { withNamedVariable } from '../src/env'
import { sql } from '../src/db'
import { expectApiError } from './fixtures'

const v1 = resolve('../..', 'runtime-apps/fixtures/setup-proof-v1')
const v2 = resolve('../..', 'runtime-apps/fixtures/setup-proof-v2')
const roster = resolve('../..', 'runtime-apps/fixtures/place-roster')
const read = '/api/app_reads/setupproof/'
const pinned = (client: TestClient, version = '1.0.0') => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': `setupproof@${version}`, ...init?.headers },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

const role = (admin: TestClient, name: string) => admin.post('/api/save_row', { table: 'Role', row: { row_id: name } })

async function install(admin: TestClient, { roles = ['Setup Staff'], paths = [v1] } = {}) {
  for (const name of roles) await role(admin, name)
  expect(await discoverPackages(paths)).toEqual([])
  await admin.post('/api/install_app', { name: 'setupproof' })
  await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'setupproof.report_id', value: 'R-1' } })
}

const bindings = async () => (await sql`select app, app_role, bound_role from app_role_binding order by app, app_role, bound_role`)
  .map(row => `${row.app}: ${row.app_role} <- ${row.bound_role}`)

describe('seeding from the app\'s suggestions', () => {
  test('an install writes the suggested bindings for the roles this instance has', async ({ admin }) => {
    await install(admin)
    expect(await bindings()).toEqual(['setupproof: Setup Reader <- Setup Staff'])
  })
})

const TOKEN = 'binding-token-620'
const config = (client: TestClient) => withNamedVariable('SETUPPROOF_TOKEN', TOKEN, () => client.post(read + 'config', { payload: {} }))

describe('the role check honours bindings', () => {
  test('a person holding a bound role holds the app role', async ({ admin, createUser }) => {
    await install(admin)
    const staff = await createUser({ email: 'staff@example.test', roles: ['Setup Staff'] })
    expect(await config(staff)).toMatchObject({ result: { settings: { report_id: 'R-1' } } })
  })

  test('a person holding only an unbound role does not', async ({ admin, createUser }) => {
    await install(admin, { roles: ['Setup Staff', 'Setup Visitor'] })
    const visitor = await createUser({ email: 'visitor@example.test', roles: ['Setup Visitor'] })
    await expectApiError(config(visitor), { status: 403 })
  })

  test('a person_scope operation\'s read roles are held through a binding', async ({ admin, createUser }) => {
    await install(admin, { paths: [v1, roster] })
    await admin.post('/api/install_app', { name: 'placeroster' })
    const staff = await createUser({ email: 'staff@example.test', roles: ['Setup Staff'] })
    await admin.post('/api/save_row', { table: 'placeroster.position', row: { row_id: 'p-1', person: staff.user, place: 'North', store: 'N1', section: 'kids' } })
    expect(await withNamedVariable('SETUPPROOF_TOKEN', TOKEN, () => staff.post(read + 'places', { payload: {} })))
      .toEqual({ result: { places: ['North'] } })
  })

  test('removing a binding takes the app role away on the next request', async ({ admin, createUser }) => {
    await install(admin)
    const staff = await createUser({ email: 'staff@example.test', roles: ['Setup Staff'] })
    await config(staff)
    const [binding] = await sql`select row_id from app_role_binding`
    await admin.delete(`/api/table/${encodeURIComponent('App Role Binding')}/${binding.row_id}`)
    await expectApiError(config(staff), { status: 403 })
  })

  test('a binding to a role the app does not declare grants nothing', async ({ admin, createUser }) => {
    await install(admin)
    await sql`insert into app_role_binding (row_id, app, app_role, bound_role) values ('raw-1', 'setupproof', 'System Manager', 'Setup Staff')`
    const staff = await createUser({ email: 'staff@example.test', roles: ['Setup Staff'] })
    expect(await staff.get<{ roles: string[] }>('/api/me').catch(() => null)).not.toMatchObject({ roles: expect.arrayContaining(['System Manager']) })
    await expectApiError(staff.post('/api/save_row', { table: 'Role', row: { row_id: 'Escalated' } }), { status: 403 })
  })
})

const bind = (client: TestClient, row: Record<string, unknown>) => client.post('/api/save_row', { table: 'App Role Binding', row: { app: 'setupproof', app_role: 'Setup Reader', ...row } })

describe('editing bindings in Admin', () => {
  test('a System Manager adds a binding the app did not suggest', async ({ admin }) => {
    await install(admin, { roles: ['Setup Staff', 'Setup Visitor'] })
    await bind(admin, { bound_role: 'Setup Visitor' })
    expect(await bindings()).toEqual(['setupproof: Setup Reader <- Setup Staff', 'setupproof: Setup Reader <- Setup Visitor'])
  })

  test.for(['All', 'Guest'])('a binding to %s is refused', async (everyone, { admin }) => {
    await install(admin)
    await expectApiError(bind(admin, { bound_role: everyone }), { status: 417, message: expect.stringMatching(new RegExp(`cannot be held through ${everyone}`)) })
  })

  test('a binding to a role the app does not declare is refused', async ({ admin }) => {
    await install(admin)
    await expectApiError(bind(admin, { app_role: 'System Manager', bound_role: 'Setup Staff' }),
      { status: 417, message: expect.stringMatching(/setupproof does not declare the role System Manager/) })
  })

  test('a binding for an app that is not installed is refused', async ({ admin }) => {
    await install(admin)
    await expectApiError(bind(admin, { app: 'notinstalled', bound_role: 'Setup Staff' }), { status: 417, message: expect.stringMatching(/App notinstalled is not installed/) })
  })

  test('the same binding twice is refused', async ({ admin }) => {
    await install(admin)
    await expectApiError(bind(admin, { bound_role: 'Setup Staff' }), { status: 417, message: expect.stringMatching(/already carries/) })
  })
})

describe('only a System Manager writes app settings and bindings', () => {
  test.for([
    ['App Role Binding', { app: 'setupproof', app_role: 'Setup Reader', bound_role: 'Setup Staff' }],
    ['App Setting', { row_id: 'setupproof.theme', value: 'dark' }],
  ] as const)('a person granted write on %s is still refused', async ([table, row], { admin, createUser }) => {
    await install(admin, { roles: [] })
    await role(admin, 'Setup Staff')
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: table, role: 'Setup Editor', can_read: true, can_write: true, can_create: true } }).catch(async () => {
      await role(admin, 'Setup Editor')
      await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: table, role: 'Setup Editor', can_read: true, can_write: true, can_create: true } })
    })
    const editor = await createUser({ email: 'editor@example.test', roles: ['Setup Editor'] })
    await expectApiError(editor.post('/api/save_row', { table, row }), { status: 403, message: expect.stringMatching(new RegExp(`Only a System Manager can change ${table} rows`)) })
  })
})

describe('an upgrade never re-imposes the suggestions', () => {
  async function upgrade(admin: TestClient) {
    expect(await discoverPackages([v1, v2])).toEqual([])
    const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'setupproof', version: '1.1.0' })
    await admin.post('/api/upgrade_app', { name: 'setupproof', version: '1.1.0', planId: plan.planId })
    await admin.post('/api/activate_app_upgrade', { name: 'setupproof', version: '1.1.0' })
  }

  test('a suggestion the admin removed stays removed, and the admin\'s own binding stays', async ({ admin, createUser }) => {
    await install(admin, { roles: ['Setup Staff', 'Setup Visitor', 'Setup Other'] })
    const [seeded] = await sql`select row_id from app_role_binding`
    await admin.delete(`/api/table/${encodeURIComponent('App Role Binding')}/${seeded.row_id}`)
    await bind(admin, { bound_role: 'Setup Visitor' })
    await upgrade(admin)
    expect(await bindings()).toEqual(['setupproof: Setup Reader <- Setup Visitor'])
    const visitor = pinned(await createUser({ email: 'visitor@example.test', roles: ['Setup Visitor'] }), '1.1.0')
    expect(await config(visitor)).toMatchObject({ result: { settings: { report_id: 'R-1' } } })
  })
})


describe('declaring role suggestions', () => {
  async function variant(change: (manifest: Record<string, any>) => Record<string, any>) {
    const copy = await mkdtemp(resolve('test/.setup-variant-'))
    await cp(v1, copy, { recursive: true })
    await writeFile(resolve(copy, 'featherbase.json'), JSON.stringify(change(JSON.parse(await readFile(resolve(copy, 'featherbase.json'), 'utf8')))))
    return copy
  }

  test.for([
    ['for a role the app does not declare', { 'Setup Writer': ['Setup Staff'] }, 'roleDefaults suggests Setup Writer, which the app does not declare in roles'],
    ['for a platform role', { 'System Manager': ['Setup Staff'] }, 'roleDefaults suggests System Manager, which the app does not declare in roles'],
    ['through All', { 'Setup Reader': ['All'] }, 'roleDefaults cannot suggest that All carries Setup Reader: it would open the app to everyone'],
    ['through Guest', { 'Setup Reader': ['Guest'] }, 'roleDefaults cannot suggest that Guest carries Setup Reader: it would open the app to everyone'],
  ] as const)('an app suggesting a binding %s is not loaded', async ([, roleDefaults, error]) => {
    const copy = await variant(manifest => ({ ...manifest, roleDefaults }))
    try {
      expect(await discoverPackages([copy])).toMatchObject([{ error }])
    } finally { await rm(copy, { recursive: true, force: true }) }
  })
})
