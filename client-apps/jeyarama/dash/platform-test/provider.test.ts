// Dash's scope provider on the real platform: the platform's own resolvePersonScope calls it, and
// it reads real rows of the core Tables through the platform's provider read context, one reader
// per job in #967's table. Made-up stores (9901, 9902 in one cluster; 9903 in another) and people.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import type { TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { availableRuntimeVersions } from '../../src/runtime-packages'
import { NoPersonScope, resolvePersonScope } from '../../src/person-scope'
import { APP_DIR, VERSION, createCoreTables, installApp, markTables, pinned, saveRow } from './helpers'
// @ts-expect-error a plain .mjs module, copied in beside this file by the runner
import { SCOPE_TABLES } from './mark-scope-tables.mjs'

const test = pgTest.extend<{ admin: TestClient }>({ admin: async ({ admin }, use) => use(pinned(admin)) })

async function binding() {
  const manifest = JSON.parse(await readFile(resolve(APP_DIR, 'featherbase.json'), 'utf8'))
  const digest = availableRuntimeVersions().find(p => p.name === 'dash')!.digest
  const module = await import(`${pathToFileURL(resolve(APP_DIR, 'dist/server.mjs')).href}?artifact=${digest}`)
  return { app: 'dash', title: manifest.title, version: VERSION, tables: manifest.scopeProvider.tables,
    identifiers: manifest.scopeProvider.identifiers ?? [], provide: module.scopeProviders.org_chart }
}

const SARI = ['010101001', '010101002']
const LEHENGA = ['010101003']
const BELTS = ['010404001']

/** The app installed, the core Tables created and (unless told which) marked, and a made-up org chart. */
async function setup(admin: TestClient, createUser: (o: { email: string }) => Promise<TestClient>, marked: readonly string[] = SCOPE_TABLES) {
  await installApp(admin)
  await createCoreTables(admin, marked)
  const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)
  for (const [code, name] of [['NORTH', 'North'], ['SOUTH', 'South']]) await save('Cluster', { code, name })
  for (const [code, name, cluster] of [['LKS', 'Lakeside', 'NORTH'], ['HIL', 'Hillview', 'NORTH'], ['RIV', 'Riverside', 'SOUTH']])
    await save('Site', { code, name, is_store: true, cluster })
  await save('Site', { code: 'WHS', name: 'Warehouse', is_store: false, cluster: 'NORTH' })
  await save('Site', { code: 'HOF', name: 'Head Office', is_store: false })
  for (const [plant_code, plant_type, site] of [['9901', 'Store', 'LKS'], ['9981', 'Warehouse', 'LKS'], ['9902', 'Store', 'HIL'], ['9903', 'Store', 'RIV'], ['9980', 'Warehouse', 'WHS']])
    await save('Plant', { plant_code, plant_type, site })
  for (const [row_id, name] of [['LKS-F1', 'Ground'], ['LKS-F2', 'First']]) await save('Store Floor', { row_id, name, site: 'LKS' })
  for (const [row_id, name, site, floor] of [['LKS-S1', 'Sarees', 'LKS', 'LKS-F1'], ['LKS-S2', 'Lehenga', 'LKS', 'LKS-F1'], ['LKS-S3', 'Belts', 'LKS', 'LKS-F2'], ['HIL-S1', 'Hillview Belts', 'HIL', null]])
    await save('Section', { row_id, name, site, floor, status: 'Active' })
  for (const code of [...SARI, ...LEHENGA, ...BELTS, '010909001']) await save('Subcategory', { row_id: code, subcategory: `Made-up ${code}`, subcategory_type: 'Merchandise' })
  const place = (id: string, store: string, subcategory: string, section: string, over: object = {}) =>
    save('Section Subcategory', { section_subcategory_id: id, store, subcategory, section, starts_on: '2026-01-01', ...over })
  await place('P1', 'LKS', SARI[0], 'LKS-S1')
  await place('P2', 'LKS', SARI[1], 'LKS-S1')
  await place('P3', 'LKS', LEHENGA[0], 'LKS-S2')
  await place('P4', 'LKS', BELTS[0], 'LKS-S3')
  await place('P5', 'HIL', BELTS[0], 'HIL-S1')
  // Over, and yet to come: neither is in force.
  await place('P6', 'LKS', '010909001', 'LKS-S1', { ends_on: '2026-02-01' })
  await place('P7', 'LKS', '010909001', 'LKS-S2', { starts_on: '2999-01-01' })

  let number = 100
  /** Someone on the staff list, with these jobs (on Lakeside unless a job says otherwise). */
  const reader = async (jobs: Record<string, unknown>[], status = 'Current') => {
    const person = await createUser({ email: `p-${++number}@example.test` })
    await save('Employee', { employee_code: String(number), name: `Made-up ${number}`, person: person.user, status })
    for (const [i, job] of jobs.entries())
      await save('Job Assignment', { assignment_id: `JA-${number}-${i}`, employee: String(number), site: 'LKS', starts_on: '2026-01-01', ...job })
    return person.user!
  }
  return { reader, save, place }
}
const stores = (scope: { filters: Record<string, string[]> }[]) => scope.map(place => place.filters.store[0])
const sections = (scope: { label: string; filters: Record<string, string[]> }[]) => scope.map(place => [place.label, place.filters.subcategory])

describe('the org_chart scope provider on the platform, per job (#967)', () => {
  test('Staff get their section\'s subcategories, in force today', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    expect(await resolvePersonScope(await reader([{ job: 'Staff', section: 'LKS-S1' }]), await binding())).toEqual([{
      label: '9901 / Section: Sarees', filters: { store: ['9901'], subcategory: SARI },
      basis: 'section_staff', reasons: [{ text: 'Staff job assignment', since: '2026-01-01' }],
    }])
  })

  test('a Team Leader gets their section; both Team Leaders of one section get all of it', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    const scopes = [await resolvePersonScope(await reader([{ job: 'Team Leader', section: 'LKS-S1' }]), await binding()),
      await resolvePersonScope(await reader([{ job: 'Team Leader', section: 'LKS-S1' }]), await binding())]
    expect(scopes.map(sections)).toEqual([[['9901 / Section: Sarees', SARI]], [['9901 / Section: Sarees', SARI]]])
    expect(scopes[0][0]).toMatchObject({ basis: 'team_leader' })
  })

  test('an acting Team Leader says so', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    const [place] = await resolvePersonScope(await reader([{ job: 'Team Leader', section: 'LKS-S1', acting: true }]), await binding())
    expect(place.reasons).toEqual([{ text: 'Acting Team Leader job assignment', since: '2026-01-01' }])
  })

  test('Staff or a Team Leader with no section reach nothing', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    for (const job of ['Staff', 'Team Leader'])
      await expect(resolvePersonScope(await reader([{ job }]), await binding())).rejects.toMatchObject(new NoPersonScope('scope'))
  })

  test("a Floor Manager gets their floor's sections, and no other floor's", async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    expect(sections(await resolvePersonScope(await reader([{ job: 'Floor Manager', floor: 'LKS-F1' }]), await binding())))
      .toEqual([['9901 / Section: Lehenga', LEHENGA], ['9901 / Section: Sarees', SARI]])
  })

  test('a Department Manager reaches nothing until departments are filled', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await expect(resolvePersonScope(await reader([{ job: 'Department Manager' }]), await binding())).rejects.toMatchObject(new NoPersonScope('scope'))
  })

  test('a Store Manager gets their store whole, through its Store plant alone', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    const scope = await resolvePersonScope(await reader([{ job: 'Store Manager' }]), await binding())
    expect(scope).toMatchObject([{ label: '9901', filters: { store: ['9901'] }, basis: 'store_manager' }])
    expect(scope[0].filters).not.toHaveProperty('subcategory')
  })

  test('a Cluster Manager gets every store in the cluster of the site on their job row, and no site that is not a store', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    expect(stores(await resolvePersonScope(await reader([{ job: 'Cluster Manager' }]), await binding()))).toEqual(['9901', '9902'])
    expect(stores(await resolvePersonScope(await reader([{ job: 'Cluster Manager', site: 'RIV' }]), await binding()))).toEqual(['9903'])
  })

  test('a Cluster Manager on a site in no cluster reaches nothing', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await expect(resolvePersonScope(await reader([{ job: 'Cluster Manager', site: 'HOF' }]), await binding())).rejects.toMatchObject(new NoPersonScope('scope'))
  })

  test('a Director, Managing Director or Chief Operating Officer gets all stores, wherever their job row sits', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    for (const job of ['Director', 'Managing Director', 'Chief Operating Officer'])
      expect(stores(await resolvePersonScope(await reader([{ job, site: 'HOF' }]), await binding()))).toEqual(['9901', '9902', '9903'])
  })

  test('Head office staff reach nothing', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await expect(resolvePersonScope(await reader([{ job: 'Head office staff', site: 'HOF' }]), await binding())).rejects.toMatchObject(new NoPersonScope('scope'))
  })

  test('a whole store and a section of it stay two places, and another store stays narrow', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    const scope = await resolvePersonScope(await reader([{ job: 'Store Manager' }, { job: 'Team Leader', section: 'LKS-S1' }, { job: 'Team Leader', site: 'HIL', section: 'HIL-S1' }]), await binding())
    expect(sections(scope)).toEqual([['9901', undefined], ['9901 / Section: Sarees', SARI], ['9902 / Section: Hillview Belts', BELTS]])
  })
})

describe('what never widens a scope', () => {
  test("a job on a section of another site, or a placement into another store's section", async ({ admin, createUser }) => {
    const { reader, place } = await setup(admin, createUser)
    const expected = [['9901 / Section: Lehenga', LEHENGA]]
    await place('X1', 'HIL', '010909001', 'LKS-S2')
    expect(sections(await resolvePersonScope(await reader([{ job: 'Staff', section: 'LKS-S2' }, { job: 'Team Leader', section: 'HIL-S1' }]), await binding()))).toEqual(expected)
  })

  test('a job that has ended or has not begun, and someone who has left', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    for (const person of [await reader([{ job: 'Store Manager', ends_on: '2026-02-01' }]), await reader([{ job: 'Store Manager', starts_on: '2999-01-01' }]),
      await reader([{ job: 'Store Manager' }], 'Left')])
      await expect(resolvePersonScope(person, await binding())).rejects.toMatchObject(new NoPersonScope('scope'))
  })

  test('someone the staff list does not know has no access', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const person = await createUser({ email: 'p-999@example.test' })
    await expect(resolvePersonScope(person.user!, await binding())).rejects.toMatchObject(new NoPersonScope('scope'))
  })
})

describe('the six core Tables, each marked decides_scope', () => {
  for (const table of SCOPE_TABLES as string[])
    test(`a reader's scope fails closed, never open, while ${table} is unmarked`, async ({ admin, createUser }) => {
      const { reader } = await setup(admin, createUser, (SCOPE_TABLES as string[]).filter(other => other !== table))
      const person = await reader([{ job: 'Team Leader', section: 'LKS-S1' }])
      await expect(resolvePersonScope(person, await binding())).rejects.toMatchObject({ reason: 'provider' })
    })

  test('the instance setup marks all six, and a second run leaves them alone', async ({ admin, createUser }) => {
    await setup(admin, createUser, [])
    expect((await markTables(admin)).map(r => r.outcome)).toEqual(Array(6).fill('marked'))
    expect((await markTables(admin)).map(r => r.outcome)).toEqual(Array(6).fill('already marked'))
  })

  test('the Tables it marks are the ones the manifest declares', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    expect((await binding()).tables).toEqual(SCOPE_TABLES)
  })
})
