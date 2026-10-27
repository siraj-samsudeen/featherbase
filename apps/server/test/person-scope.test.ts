// #559 (design E1): the `person_scope` operation policy. An app declares the
// provider that fills a person's scope; the platform calls it fresh on every
// request, validates and freezes the answer, and fails closed. Fixtures:
// runtime-apps/scope-proof consumes the scope, runtime-apps/fixtures/place-roster
// provides it from its own roster Table.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from './pg-test'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'

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

async function setup(admin: TestClient, createUser: CreateUserFn, { roles = ['Scope Reader'], withProvider = true } = {}) {
  expect(await discoverPackages([consumer, provider])).toEqual([])
  await admin.post('/api/install_app', { name: 'scopeproof' })
  if (withProvider) await admin.post('/api/install_app', { name: 'placeroster' })
  const user = await createUser({ email: 'placed@example.test', roles })
  const roster = await fixtureModule('placeroster', provider, 'server.mjs')
  const app = await fixtureModule('scopeproof', consumer, 'server.mjs')
  for (const key of Object.keys(roster.faults)) delete roster.faults[key]
  roster.calls.provider = 0
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

  test('an empty scope is not read as everything for an administrator either', async ({ admin, createUser }) => {
    const { app } = await setup(admin, createUser)
    await expect(admin.post(read + 'places', { payload: {} })).rejects.toMatchObject({ status: 403 })
    expect(app.calls.handler).toBe(0)
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

async function refusals(user: TestClient) {
  const rows = await sql`select method from access_log where "user" = ${user.user} and operation = 'app_access_denied' order by created_at`
  return rows.map(row => row.method)
}
