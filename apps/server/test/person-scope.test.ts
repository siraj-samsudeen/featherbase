// #559 (design E1): the `person_scope` operation policy. An app declares the
// provider that fills a person's scope; the platform calls it fresh on every
// request, validates and freezes the answer, and fails closed. Fixtures:
// runtime-apps/scope-proof consumes the scope, runtime-apps/fixtures/place-roster
// provides it from its own roster Table.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from './pg-test'
import { availableRuntimeVersions, discoverPackages, runPackageRead } from '../src/runtime-packages'
import { sql } from '../src/db'
import { expectApiError, tableRef } from './fixtures'
import { newIdentifierId } from '../src/person-identifiers'

const consumer = resolve('../..', 'runtime-apps/scope-proof')
const provider = resolve('../..', 'runtime-apps/fixtures/place-roster')
const read = '/api/app_reads/scopeproof/'
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': 'scopeproof@1.0.0', ...init?.headers },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

async function fixtureModule(name: string, directory: string, file: string) {
  const digest = availableRuntimeVersions().find(p => p.name === name)!.digest
  return import(`${pathToFileURL(resolve(directory, file)).href}?artifact=${digest}`)
}

async function setup(admin: TestClient, createUser: CreateUserFn, { roles = ['Scope Reader'], withProvider = true, providerAt = provider } = {}) {
  expect(await discoverPackages([consumer, providerAt])).toEqual([])
  await admin.post('/api/install_app', { name: 'scopeproof' })
  if (withProvider) await admin.post('/api/install_app', { name: 'placeroster' })
  const user = await createUser({ email: 'placed@example.test', roles })
  const roster = await fixtureModule('placeroster', providerAt, 'server.mjs')
  const app = await fixtureModule('scopeproof', consumer, 'server.mjs')
  for (const key of Object.keys(roster.faults)) delete roster.faults[key]
  roster.calls.provider = 0
  roster.calls.person = undefined
  app.calls.handler = 0
  return { user, roster, app }
}

async function position(admin: TestClient, person: string, place: string, store: string, section: string, extra: Record<string, unknown> = {}) {
  await admin.post('/api/save_row', { table: 'placeroster.position', row: { row_id: `${person}-${place}`, person, place, store, section, ...extra } })
}

describe('a person_scope operation', () => {
  test('hands the handler the places the provider says the person covers', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids', { basis: 'team leader' })
    await position(admin, user.user!, 'South / Mens', 'S1', 'mens')
    await position(admin, 'someone-else', 'East / Baby', 'E1', 'baby')
    expect(await user.post(read + 'places', { payload: {} })).toEqual({ result: { places: [
      { label: 'North / Kids', filters: { store: ['N1'], section: ['kids'] }, basis: 'team leader', confirmation: { section: { kids: 'confirmed' } } },
      { label: 'South / Mens', filters: { store: ['S1'], section: ['mens'] }, confirmation: { section: { mens: 'confirmed' } } },
    ] } })
  })

  test('a request naming a filter value inside the scope gets only the places that cover it', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    await position(admin, user.user!, 'South / Mens', 'S1', 'mens')
    const answer = await user.post<{ result: { places: { label: string }[] } }>(read + 'places', { payload: { scope: { filters: { store: ['S1'] } } } })
    expect(answer.result.places.map(place => place.label)).toEqual(['South / Mens'])
  })

  test('a request naming a filter value outside the scope is refused whole, logged, and reveals nothing', async ({ admin, createUser }) => {
    const { user, app } = await setup(admin, createUser)
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    const response = await user.fetch(read + 'places', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { scope: { filters: { store: ['N1', 'S1'] } } } }) })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: { type: 'PermissionError', message: 'Application access refused' } })
    expect(app.calls.handler).toBe(0)
    expect(await refusals(user)).toEqual(['scopeproof.places:scope'])
  })

  test('a person the provider gives no places is refused', async ({ admin, createUser }) => {
    const { user, app } = await setup(admin, createUser)
    await expect(user.post(read + 'places', { payload: {} })).rejects.toMatchObject({ status: 403 })
    expect(app.calls.handler).toBe(0)
    expect(await refusals(user)).toEqual(['scopeproof.places:scope'])
  })

  test('an empty scope is not read as everything for a System Manager either', async ({ admin, createUser }) => {
    const { user, app } = await setup(admin, createUser, { roles: ['System Manager', 'Scope Reader'] })
    await expect(user.post(read + 'places', { payload: {} })).rejects.toMatchObject({ status: 403 })
    expect(app.calls.handler).toBe(0)
    expect(await refusals(user)).toEqual(['scopeproof.places:scope'])
  })

  test('a caller without one of the operation\'s roles is refused before the provider runs', async ({ admin, createUser }) => {
    const { user, roster } = await setup(admin, createUser, { roles: [] })
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    await expect(user.post(read + 'places', { payload: {} })).rejects.toMatchObject({ status: 403 })
    expect(roster.calls.provider).toBe(0)
  })

  test('with no app providing the scope, every request is refused', async ({ admin, createUser }) => {
    const { user, app } = await setup(admin, createUser, { withProvider: false })
    await expect(user.post(read + 'places', { payload: {} })).rejects.toMatchObject({ status: 403 })
    expect(app.calls.handler).toBe(0)
    expect(await refusals(user)).toEqual(['scopeproof.places:configuration'])
  })

  test('a provider that throws refuses the request', async ({ admin, createUser }) => {
    const { user, roster, app } = await setup(admin, createUser)
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    roster.faults.provider = new Error('Roster for store N1 is private')
    await expect(user.post(read + 'places', { payload: {} })).rejects.toMatchObject({ status: 403 })
    expect(app.calls.handler).toBe(0)
    expect(await refusals(user)).toEqual(['scopeproof.places:provider'])
  })

  test.for([
    ['a place with no filter values', [{ label: 'Everywhere', filters: {} }]],
    ['not a list', { label: 'North', filters: { store: ['N1'] } }],
    ['an unknown key on a place', [{ label: 'North', filters: { store: ['N1'] }, everything: true }]],
  ] as const)('a provider answer that is %s refuses the request', async ([, result], { admin, createUser }) => {
    const { user, roster, app } = await setup(admin, createUser)
    roster.faults.result = result
    await expect(user.post(read + 'places', { payload: {} })).rejects.toMatchObject({ status: 403 })
    expect(app.calls.handler).toBe(0)
    expect(await refusals(user)).toEqual(['scopeproof.places:provider'])
  })
})

describe("the scope provider's read context", () => {
  test('refuses a Table the provider did not declare', async ({ admin, createUser }) => {
    const { user, roster } = await setup(admin, createUser)
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    roster.faults.readUndeclared = true
    await expect(user.post(read + 'places', { payload: {} })).rejects.toMatchObject({ status: 403 })
    expect(await refusals(user)).toEqual(['scopeproof.places:provider'])
  })

  test.for([[false, 403], [true, 200]] as const)('reads a declared instance Table only when it is marked as deciding scope (marked: %s)', async ([marked, status], { admin, createUser }) => {
    const { user, roster } = await setup(admin, createUser)
    await admin.post('/api/table_def', { name: 'Roster Extra', decides_scope: marked, columns: [{ column_name: 'note', column_type: 'Data' }] })
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    roster.faults.readInstance = true
    const response = await user.fetch(read + 'places', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: {} }) })
    expect(response.status).toBe(status)
  })

  test('reads one row of a declared Table by its id', async ({ admin, createUser }) => {
    const { user, roster } = await setup(admin, createUser)
    await position(admin, 'roster-row', 'West', 'W1', 'kids')
    roster.faults.getRow = 'roster-row-West'
    const answer = await user.post<{ result: { places: unknown[] } }>(read + 'places', { payload: {} })
    expect(answer.result.places).toEqual([{ label: 'West', filters: { store: ['W1'] } }])
  })

  test('refuses reads that are not awaited one at a time', async ({ admin, createUser }) => {
    const { user, roster } = await setup(admin, createUser)
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    roster.faults.parallel = true
    await expect(user.post(read + 'places', { payload: {} })).rejects.toMatchObject({ status: 403 })
    expect(await refusals(user)).toEqual(['scopeproof.places:provider'])
  })

  // Codex round 1: a row read loads its Sub-table rows, which would hand the
  // provider an undeclared, unmarked child Table. Such a Table is refused.
  test('refuses a marked Table with a Sub-table, so its child rows never reach the provider', async ({ admin, createUser }) => {
    const { user, roster } = await setup(admin, createUser)
    await admin.post('/api/table_def', { name: 'Roster Extra Line', kind: 'sub_table', columns: [{ column_name: 'code', column_type: 'Data' }] })
    await admin.post('/api/table_def', { name: 'Roster Extra', decides_scope: true, columns: [
      { column_name: 'note', column_type: 'Data' }, { column_name: 'lines', column_type: 'Sub-table', row_table: 'Roster Extra Line' }] })
    const parent = await admin.post<{ row_id: string }>(tableRef('Roster Extra').url, { note: 'x', lines: [{ code: 'hidden-child' }] })
    roster.faults.getInstance = parent.row_id
    const response = await user.fetch(read + 'places', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: {} }) })
    expect(response.status).toBe(403)
    expect(await refusals(user)).toEqual(['scopeproof.places:provider'])
  })

  // Codex round 1: the provider reads as itself, so a consumer's client, which
  // names only its own app's version, still gets a scope from an upgraded
  // provider (one with a migration ledger).
  test('reads as the provider app, not with the consuming request\'s app versions', async ({ admin, createUser }) => {
    const upgraded = await mkdtemp(resolve('test/.upgraded-provider-'))
    try {
      await cp(provider, upgraded, { recursive: true })
      const manifest = JSON.parse(await readFile(resolve(upgraded, 'featherbase.json'), 'utf8'))
      await writeFile(resolve(upgraded, 'featherbase.json'), JSON.stringify({ ...manifest,
        migrations: [{ id: 'code_only', fromVersion: '1.0.0', toVersion: '1.1.0', operations: [] }] }))
      await writeFile(resolve(upgraded, 'package.json'), JSON.stringify({ name: 'featherbase-place-roster', version: '1.1.0', type: 'module' }))
      expect(await discoverPackages([consumer, upgraded])).toEqual([])
      await admin.post('/api/install_app', { name: 'scopeproof' })
      await admin.post('/api/install_app', { name: 'placeroster' })
      expect((await sql`select jsonb_array_length(migration_ledger) as n from installed_app where name = 'placeroster'`)[0].n).toBe(1)
      const user = await createUser({ email: 'upgraded@example.test', roles: ['Scope Reader'] })
      const seeded = await admin.fetch('/api/save_row', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': 'placeroster@1.1.0' },
        body: JSON.stringify({ table: 'placeroster.position', row: { row_id: 'up-1', person: user.user, place: 'North / Kids', store: 'N1', section: 'kids' } }) })
      expect(seeded.status).toBe(201)
      // The consumer's client names only its own app's version.
      const answer = await user.post<{ result: { places: { label: string }[] } }>(read + 'places', { payload: {} })
      expect(answer.result.places.map(place => place.label)).toEqual(['North / Kids'])
    } finally { await rm(upgraded, { recursive: true, force: true }) }
  })

  test('an in-process read, which names no app versions, resolves the scope too', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    const answer = await runPackageRead('scopeproof', 'places', { payload: {} }, user.user!) as { result: { places: { label: string }[] } }
    expect(answer.result.places.map(place => place.label)).toEqual(['North / Kids'])
  })

  test('passes confirmation statuses through to the handler', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids', { assumed: true })
    const answer = await user.post<{ result: { places: { confirmation: unknown }[] } }>(read + 'places', { payload: {} })
    expect(answer.result.places[0].confirmation).toEqual({ section: { kids: 'assumed' } })
  })
})

// #660: a provider that declares identifier systems gets the person's
// current values for those systems, and nothing else about the person.
describe("the person's identifiers a provider receives", () => {
  test('a provider that declares no identifier systems gets none', async ({ admin, createUser }) => {
    const { user, roster } = await setup(admin, createUser)
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    await user.post(read + 'places', { payload: {} })
    expect(roster.calls.person).toEqual({ id: user.user, email: 'placed@example.test', identifiers: {} })
  })

  // The place-roster fixture, its provider declaring `identifiers`.
  async function declaring(identifiers: string[], fn: (providerAt: string) => Promise<void>) {
    const copy = await mkdtemp(resolve('test/.identifier-provider-'))
    try {
      await cp(provider, copy, { recursive: true })
      const manifest = JSON.parse(await readFile(resolve(copy, 'featherbase.json'), 'utf8'))
      await writeFile(resolve(copy, 'featherbase.json'), JSON.stringify({ ...manifest, scopeProvider: { ...manifest.scopeProvider, identifiers } }))
      await fn(copy)
    } finally { await rm(copy, { recursive: true, force: true }) }
  }
  async function system(admin: TestClient, key: string) {
    await admin.post('/api/save_row', { table: 'Identifier System', row: { row_id: key, label: key, kind: 'employee-record' } })
  }
  async function identifier(person: string, system: string, value: string | null, { ended = false } = {}) {
    await sql`insert into person_identifier ${sql({ id: newIdentifierId(), person_id: person, system, assigner: '', value, value_hint: value === null ? 'ends 12' : null,
      valid: ended ? '[2020-01-01,2021-01-01)' : '[2020-01-01,)', verified: true, one_holder: false, one_per_person: false,
      source: 'test', recorded_by: 'test' } as unknown as Record<string, never>)}`
  }

  test("passes the person's current values in a declared system", async ({ admin, createUser }) => {
    await declaring(['roster-code'], async providerAt => {
      await system(admin, 'roster-code')
      const { user, roster } = await setup(admin, createUser, { providerAt })
      const other = await createUser({ email: 'other@example.test' })
      await identifier(user.user!, 'roster-code', 'R-2')
      await identifier(user.user!, 'roster-code', 'R-1')
      await identifier(other.user!, 'roster-code', 'R-9')
      await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
      await user.post(read + 'places', { payload: {} })
      expect(roster.calls.person.identifiers).toEqual({ 'roster-code': ['R-1', 'R-2'] })
    })
  })

  test('an ended value is not passed', async ({ admin, createUser }) => {
    await declaring(['roster-code'], async providerAt => {
      await system(admin, 'roster-code')
      const { user, roster } = await setup(admin, createUser, { providerAt })
      await identifier(user.user!, 'roster-code', 'R-OLD', { ended: true })
      await identifier(user.user!, 'roster-code', 'R-NEW')
      await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
      await user.post(read + 'places', { payload: {} })
      expect(roster.calls.person.identifiers).toEqual({ 'roster-code': ['R-NEW'] })
    })
  })

  test('a system the provider did not declare is never passed', async ({ admin, createUser }) => {
    await declaring(['roster-code'], async providerAt => {
      await system(admin, 'roster-code')
      await system(admin, 'payroll-code')
      const { user, roster } = await setup(admin, createUser, { providerAt })
      await identifier(user.user!, 'roster-code', 'R-1')
      await identifier(user.user!, 'payroll-code', 'P-1')
      await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
      await user.post(read + 'places', { payload: {} })
      expect(roster.calls.person.identifiers).toEqual({ 'roster-code': ['R-1'] })
    })
  })

  test('a declared system the person has no current value in is passed empty', async ({ admin, createUser }) => {
    await declaring(['roster-code'], async providerAt => {
      await system(admin, 'roster-code')
      const { user, roster } = await setup(admin, createUser, { providerAt })
      await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
      await user.post(read + 'places', { payload: {} })
      expect(roster.calls.person.identifiers).toEqual({ 'roster-code': [] })
    })
  })

  // A Secret system stores only a hint, never the value.
  test('a row that holds no value is not passed', async ({ admin, createUser }) => {
    await declaring(['roster-code'], async providerAt => {
      await system(admin, 'roster-code')
      const { user, roster } = await setup(admin, createUser, { providerAt })
      await identifier(user.user!, 'roster-code', null)
      await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
      await user.post(read + 'places', { payload: {} })
      expect(roster.calls.person.identifiers).toEqual({ 'roster-code': [] })
    })
  })

  test('a provider that changes the values it was given gets no scope', async ({ admin, createUser }) => {
    await declaring(['roster-code'], async providerAt => {
      await system(admin, 'roster-code')
      const { user, roster } = await setup(admin, createUser, { providerAt })
      await identifier(user.user!, 'roster-code', 'R-1')
      await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
      roster.faults.addIdentifier = 'roster-code'
      await expect(user.post(read + 'places', { payload: {} })).rejects.toMatchObject({ status: 403 })
      expect(await refusals(user)).toEqual(['scopeproof.places:provider'])
    })
  })

  test('a declared system the instance does not have answers "not set up yet", and no one gets a scope', async ({ admin, createUser }) => {
    await declaring(['roster-code'], async providerAt => {
      const { user, roster, app } = await setup(admin, createUser, { providerAt })
      await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
      await expectApiError(user.post(read + 'places', { payload: {} }), { status: 409, type: 'NotSetUpError',
        message: expect.stringContaining('Place roster proof is not set up yet. An administrator needs to finish setting it up.') })
      expect([roster.calls.provider, app.calls.handler]).toEqual([0, 0])
    })
  })
})

// A second provider: the place-roster fixture under another app name.
async function withSecondProvider(fn: (directory: string) => Promise<void>) {
  const copy = await mkdtemp(resolve('test/.second-provider-'))
  try {
    await cp(provider, copy, { recursive: true })
    for (const file of ['featherbase.json', 'package.json']) {
      const path = resolve(copy, file)
      await writeFile(path, (await readFile(path, 'utf8')).replaceAll('placeroster', 'otherroster').replaceAll('place-roster', 'other-roster'))
    }
    await fn(copy)
  } finally { await rm(copy, { recursive: true, force: true }) }
}

describe('one scope provider per instance', () => {
  test('a second providing app is refused at install', async ({ admin }) => {
    await withSecondProvider(async second => {
      expect(await discoverPackages([consumer, provider, second])).toEqual([])
      await admin.post('/api/install_app', { name: 'placeroster' })
      await expectApiError(admin.post('/api/install_app', { name: 'otherroster' }),
        { status: 409, message: expect.stringContaining("placeroster already does") })
    })
  })

  test('a second providing app is refused at enable', async ({ admin }) => {
    await withSecondProvider(async second => {
      expect(await discoverPackages([consumer, provider, second])).toEqual([])
      await admin.post('/api/install_app', { name: 'otherroster' })
      await admin.post('/api/set_app_enabled', { name: 'otherroster', enabled: false })
      await admin.post('/api/install_app', { name: 'placeroster' })
      await expectApiError(admin.post('/api/set_app_enabled', { name: 'otherroster', enabled: true }),
        { status: 409, message: expect.stringContaining("placeroster already does") })
    })
  })

  // Codex round 1: an upgrade may not make a second app provide the scope.
  async function rosterVersions(fn: (v1: string, v11: string, other: string) => Promise<void>) {
    const v1 = await mkdtemp(resolve('test/.roster-v1-'))
    const v11 = await mkdtemp(resolve('test/.roster-v11-'))
    try {
      for (const directory of [v1, v11]) await cp(provider, directory, { recursive: true })
      const manifest = JSON.parse(await readFile(resolve(provider, 'featherbase.json'), 'utf8'))
      const { scopeProvider: _declared, ...withoutProvider } = manifest
      await writeFile(resolve(v1, 'featherbase.json'), JSON.stringify(withoutProvider))
      await writeFile(resolve(v1, 'server.mjs'), (await readFile(resolve(provider, 'server.mjs'), 'utf8')).replace('export const scopeProviders =', 'const unused ='))
      await writeFile(resolve(v11, 'featherbase.json'), JSON.stringify({ ...manifest,
        migrations: [{ id: 'provides_scope', fromVersion: '1.0.0', toVersion: '1.1.0', operations: [] }] }))
      await writeFile(resolve(v11, 'package.json'), JSON.stringify({ name: 'featherbase-place-roster', version: '1.1.0', type: 'module' }))
      await withSecondProvider(other => fn(v1, v11, other))
    } finally {
      for (const directory of [v1, v11]) await rm(directory, { recursive: true, force: true })
    }
  }
  async function upgradeToProvider(admin: TestClient) {
    const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'placeroster', version: '1.1.0' })
    return admin.post('/api/upgrade_app', { name: 'placeroster', version: '1.1.0', planId: plan.planId })
  }

  test('an upgrade that starts providing the scope while another app provides it is refused, and changes nothing', async ({ admin }) => {
    await rosterVersions(async (v1, v11, other) => {
      expect(await discoverPackages([v1, other])).toEqual([])
      await admin.post('/api/install_app', { name: 'placeroster' })
      await admin.post('/api/install_app', { name: 'otherroster' })
      expect(await discoverPackages([v1, v11, other])).toEqual([])
      await expectApiError(upgradeToProvider(admin), { status: 409, message: expect.stringContaining('otherroster already does') })
      expect((await sql`select package_version from installed_app where name = 'placeroster'`)[0].package_version).toBe('1.0.0')
    })
  })

  test('activating an upgrade that starts providing the scope while another app provides it is refused', async ({ admin }) => {
    await rosterVersions(async (v1, v11, other) => {
      expect(await discoverPackages([v1, other])).toEqual([])
      await admin.post('/api/install_app', { name: 'placeroster' })
      await admin.post('/api/install_app', { name: 'otherroster' })
      await admin.post('/api/set_app_enabled', { name: 'otherroster', enabled: false })
      expect(await discoverPackages([v1, v11, other])).toEqual([])
      await upgradeToProvider(admin)
      await sql`update installed_app set enabled = true where name = 'otherroster'`
      await expectApiError(admin.post('/api/activate_app_upgrade', { name: 'placeroster', version: '1.1.0' }),
        { status: 409, message: expect.stringContaining('otherroster already does') })
      expect((await sql`select activation_pending from installed_app where name = 'placeroster'`)[0].activation_pending).toBe(true)
    })
  })

  test('an instance that somehow has two enabled providers gives no one a scope', async ({ admin, createUser }) => {
    const { user, app } = await setup(admin, createUser)
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    await sql`update installed_app set manifest = manifest || ${sql.json({ scopeProvider: { name: 'positions', tables: ['scopeproof.store'] } })} where name = 'scopeproof'`
    await expect(user.post(read + 'places', { payload: {} })).rejects.toMatchObject({ status: 403 })
    expect(app.calls.handler).toBe(0)
    expect(await refusals(user)).toEqual(['scopeproof.places:configuration'])
  })
})

describe('declaring a scope provider', () => {
  async function variant(change: (manifest: Record<string, any>, server: string) => [Record<string, any>, string]) {
    const copy = await mkdtemp(resolve('test/.provider-variant-'))
    await cp(provider, copy, { recursive: true })
    const [manifest, server] = change(JSON.parse(await readFile(resolve(copy, 'featherbase.json'), 'utf8')), await readFile(resolve(copy, 'server.mjs'), 'utf8'))
    await writeFile(resolve(copy, 'featherbase.json'), JSON.stringify(manifest))
    await writeFile(resolve(copy, 'server.mjs'), server)
    return copy
  }

  test.for([
    ['without the exported function', (m: Record<string, any>, s: string) => [m, s.replace('export const scopeProviders =', 'export const unused =')],
      'Package handlers and authorization callbacks must match declared names'],
    ['over an owned Table that is not marked as deciding scope', (m: Record<string, any>, s: string) =>
      [{ ...m, tables: m.tables.map((t: Record<string, unknown>) => ({ ...t, decides_scope: false })) }, s],
      'A scope provider reads only Tables marked decides_scope'],
    ['over an owned Table with a Sub-table', (m: Record<string, any>, s: string) => [{ ...m, tables: [
      ...m.tables.map((t: Record<string, any>) => ({ ...t, columns: [...t.columns, { column_name: 'lines', column_type: 'Sub-table', row_table: 'placeroster.line' }] })),
      { name: 'placeroster.line', label: 'line', kind: 'sub_table', columns: [{ column_name: 'code', column_type: 'Data' }] }] }, s],
      'A scope provider cannot read Tables with Sub-tables'],
  ] as const)('an app declaring a provider %s is not loaded', async ([, change, error]) => {
    const copy = await variant(change as never)
    try {
      expect(await discoverPackages([copy])).toMatchObject([{ error }])
    } finally { await rm(copy, { recursive: true, force: true }) }
  })

  // #660: the identifier systems the provider needs, by key.
  test('an app declaring the identifier systems its provider needs is loaded', async () => {
    const copy = await variant((m, s) => [{ ...m, scopeProvider: { ...m.scopeProvider, identifiers: ['roster-code', 'other-code'] } }, s])
    try {
      expect(await discoverPackages([copy])).toEqual([])
    } finally { await rm(copy, { recursive: true, force: true }) }
  })

  test.for([
    ['a name that is not an identifier system key', ['Roster Code']],
    ['the same system twice', ['roster-code', 'roster-code']],
  ] as const)('an app whose provider declares %s is not loaded', async ([, identifiers]) => {
    const copy = await variant((m, s) => [{ ...m, scopeProvider: { ...m.scopeProvider, identifiers } }, s])
    try {
      expect(await discoverPackages([copy])).toMatchObject([{ error: expect.stringContaining('scopeProvider') }])
    } finally { await rm(copy, { recursive: true, force: true }) }
  })
})

describe('a person_scope action', () => {
  const action = '/api/app_actions/scopeproof/place'
  test('runs inside the scope, and a replay is authorized by the scope the caller has now', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser, { roles: ['Scope Planner'] })
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    const body = { idempotencyKey: 'place-1', payload: { effect: 'effect-1', scope: { places: ['North / Kids'] } } }
    expect(await user.post(action, body)).toEqual({ result: { places: 'North / Kids' } })
    expect((await sql`select value from scopeproof.effect where row_id = 'effect-1'`)[0].value).toBe('North / Kids')
    expect(await user.post(action, body)).toEqual({ result: { places: 'North / Kids' } })
    await sql`delete from placeroster.position where person = ${user.user}`
    await expect(user.post(action, body)).rejects.toMatchObject({ status: 403 })
  })

  // Codex round 1: a replay returns the original cached result, so it must be
  // authorized by the scope that result was computed under, not only by the
  // scope the caller has now.
  test('a replay after one of the places it covered was revoked is refused', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser, { roles: ['Scope Planner'] })
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    await position(admin, user.user!, 'South / Mens', 'S1', 'mens')
    const body = { idempotencyKey: 'place-partial', payload: { effect: 'effect-partial' } }
    expect(await user.post(action, body)).toEqual({ result: { places: 'North / Kids,South / Mens' } })
    await sql`delete from placeroster.position where person = ${user.user} and place = 'South / Mens'`
    await expect(user.post(action, body)).rejects.toMatchObject({ status: 403 })
    expect(await refusals(user)).toEqual(['scopeproof.place:scope'])
  })

  test('a replay after a place kept its label but lost a filter value is refused', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser, { roles: ['Scope Planner'] })
    await position(admin, user.user!, 'North', 'N1', 'kids', { row_id: 'north-kids' })
    await position(admin, user.user!, 'North', 'N1', 'baby', { row_id: 'north-baby' })
    const body = { idempotencyKey: 'place-shrunk', payload: { effect: 'effect-shrunk' } }
    expect(await user.post(action, body)).toEqual({ result: { places: 'North' } })
    await sql`delete from placeroster.position where row_id = 'north-baby'`
    await expect(user.post(action, body)).rejects.toMatchObject({ status: 403 })
    expect(await refusals(user)).toEqual(['scopeproof.place:scope'])
  })

  test('a replay whose original scope is still covered, even by a wider scope, is answered from the record', async ({ admin, createUser }) => {
    const { user, app } = await setup(admin, createUser, { roles: ['Scope Planner'] })
    await position(admin, user.user!, 'North', 'N1', 'kids', { row_id: 'north-kids' })
    const body = { idempotencyKey: 'place-wider', payload: { effect: 'effect-wider' } }
    await user.post(action, body)
    await position(admin, user.user!, 'North', 'N1', 'baby', { row_id: 'north-baby' })
    await position(admin, user.user!, 'South', 'S1', 'mens')
    expect(await user.post(action, body)).toEqual({ result: { places: 'North' } })
    expect(app.calls.handler).toBe(1)
  })

  // Codex round 2: a fresh place that adds a restriction the stored place did
  // not have covers less than it did.
  test.for([
    ['a whole-store place that became restricted to one section is refused', { store: ['N1'] }, { store: ['N1'], section: ['kids'] }, 403],
    ['a section place that became the whole store still replays', { store: ['N1'], section: ['kids'] }, { store: ['N1'] }, 200],
  ] as const)('on replay, %s', async ([, before, after, status], { admin, createUser }) => {
    const { user, roster } = await setup(admin, createUser, { roles: ['Scope Planner'] })
    const body = { idempotencyKey: `place-restricted-${status}`, payload: { effect: `effect-restricted-${status}` } }
    roster.faults.result = [{ label: 'North', filters: before }]
    expect(await user.post(action, body)).toEqual({ result: { places: 'North' } })
    roster.faults.result = [{ label: 'North', filters: after }]
    const replay = await user.fetch(action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    expect(replay.status).toBe(status)
    expect(await refusals(user)).toEqual(status === 403 ? ['scopeproof.place:scope'] : [])
  })

  test('a replay whose record does not hold the places it ran under is refused', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser, { roles: ['Scope Planner'] })
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    const body = { idempotencyKey: 'place-unrecorded', payload: { effect: 'effect-unrecorded' } }
    await user.post(action, body)
    await sql`update runtime_action_result set "authorization" = "authorization" - 'places' where idempotency_key = 'place-unrecorded'`
    await expect(user.post(action, body)).rejects.toMatchObject({ status: 403 })
    expect(await refusals(user)).toEqual(['scopeproof.place:replay'])
  })

  test('a reader without an action role is refused', async ({ admin, createUser }) => {
    const { user, app } = await setup(admin, createUser, { roles: ['Scope Reader'] })
    await position(admin, user.user!, 'North / Kids', 'N1', 'kids')
    await expect(user.post(action, { idempotencyKey: 'place-2', payload: { effect: 'effect-2' } })).rejects.toMatchObject({ status: 403 })
    expect(app.calls.handler).toBe(0)
    expect(await refusals(user)).toEqual(['scopeproof.place:role'])
  })
})

async function refusals(user: TestClient) {
  const rows = await sql`select method from access_log where "user" = ${user.user} and operation = 'app_access_denied' order by created_at`
  return rows.map(row => row.method)
}
