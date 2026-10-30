// Feather Dash's scope provider on the real platform: the platform's own
// resolvePersonScope calls it, and it reads real rows through the platform's
// provider read context. Made-up stores (9901 live, 9902 not) and people.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import type { TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { availableRuntimeVersions } from '../../src/runtime-packages'
import { NoPersonScope, resolvePersonScope } from '../../src/person-scope'
import { applySeedPack } from '../../src/seed-packs'
import { sql } from '../../src/db'
import { statusOf } from '../../src/errors'
import { APP_DIR, OLD_TABLES, VERSION, installApp, pinned, saveRow } from './helpers'
// @ts-expect-error a plain .mjs module, copied in beside this file by the runner
import { markScopeTables } from './mark-scope-tables.mjs'

const test = pgTest.extend<{ admin: TestClient }>({ admin: async ({ admin }, use) => use(pinned(admin)) })

async function binding() {
  const manifest = JSON.parse(await readFile(resolve(APP_DIR, 'featherbase.json'), 'utf8'))
  const digest = availableRuntimeVersions().find(p => p.name === 'feather_dash')!.digest
  const module = await import(`${pathToFileURL(resolve(APP_DIR, 'dist/server.mjs')).href}?artifact=${digest}`)
  return { app: 'feather_dash', title: manifest.title, version: VERSION, tables: manifest.scopeProvider.tables,
    identifiers: manifest.scopeProvider.identifiers ?? [], provide: module.scopeProviders.org_chart }
}

/** The app installed, the old Tables created and (unless told not to) marked, and a made-up org chart. */
async function setup(admin: TestClient, createUser: (o: { email: string }) => Promise<TestClient>, { mark = true, codes = true } = {}) {
  // The instance's employee-code identifier system (the jeyarama seed pack), which the provider declares.
  if (codes) await applySeedPack('jeyarama')
  await installApp(admin)
  for (const [name, columns] of OLD_TABLES) await admin.post('/api/table_def', { name, module: 'Store Sections', columns })
  if (mark) await markScopeTables((path: string, init?: RequestInit) =>
    init?.method === 'PUT' ? admin.fetch(path, init).then(r => r.json()) : admin.get(path))
  const people: Record<string, string> = {}
  for (const name of ['p-101', 'p-102', 'p-103', 'p-104', 'p-107', 'p-130', 'p-131', 'p-132', 'p-133', 'p-999'])
    people[name] = (await createUser({ email: `${name}@example.test` })).user!
  const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)
  await save('store_rollout', { store: '9901', live_since: '2026-01-01' })
  const ground = await save('store_floor', { store: '9901', floor_name: 'Ground' })
  const ethnic = await save('department', { store: '9901', department_key: 'dm-P-107', name: 'Ladies Ethnic' })
  const bridal = await save('department', { store: '9901', department_key: 'dm-P-108' })
  const sarees = await save('section', { store: '9901', section_name: 'Sarees', floor: ground.row_id, department: ethnic.row_id, team_leaders_allowed: 2 })
  const lehenga = await save('section', { store: '9901', section_name: 'Lehenga', floor: ground.row_id, department: bridal.row_id })
  await save('section_subcategory', { store: '9901', subcategory: '010101001', section: sarees.row_id, starts_on: '2026-01-01' })
  await save('section_subcategory', { store: '9901', subcategory: '010101003', section: lehenga.row_id, starts_on: '2026-01-01' })
  const jobRow = (person: string, job: string, place: Record<string, unknown> = {}) =>
    save('job_assignment', { person: people[person], job, store: '9901', starts_on: '2026-01-01', ...place })
  await jobRow('p-101', 'Store Manager')
  await jobRow('p-103', 'Team Leader', { section: sarees.row_id })
  await jobRow('p-104', 'Team Leader', { section: sarees.row_id })
  await jobRow('p-107', 'Department Manager', { department: ethnic.row_id })
  await jobRow('p-107', 'Department Manager', { department: bridal.row_id })
  // Hillview (9902) is not live: its people keep the old rules.
  await save('Sales Target Assignment', { employee: people['p-130'], plant_code: '9902', material_group: '010404001' })
  // p-131 has an explicit row and holds EMP-0131 alone; the old Store Manager
  // Table names EMP-0131 for 9902. p-132 and p-133 both hold EMP-0132 (two
  // firms), which the old Store Manager Table also names for 9902.
  await save('Sales Target Assignment', { employee: people['p-131'], plant_code: '9902', material_group: '010404002' })
  await save('Section Merchandise Map', { store_code: '9902', material_group: '010404002', mch_subcategory: 'Wallets', section_name: 'Accessories' })
  await save('Store Manager', { store_code: '9902', employee_code: 'EMP-0131' })
  await save('Store Manager', { store_code: '9902', employee_code: 'EMP-0132' })
  const holds = (id: string, person: string, assigner: string, value: string) => sql`insert into person_identifier
    (id, person_id, system, assigner, value, valid, verified, one_holder, source, recorded_by)
    values (${id}, ${person}, 'stylehr-employee-code', ${assigner}, ${value}, daterange('2024-01-01', null, '[)'), true, true, 'test', 'test')`
  if (codes) {
    await holds('pid_b6p2_131', people['p-131'], 'firm-a', 'EMP-0131')
    await holds('pid_b6p2_132', people['p-132'], 'firm-a', 'EMP-0132')
    await holds('pid_b6p2_133', people['p-133'], 'firm-b', 'EMP-0132')
  }
  await save('Section Merchandise Map', { store_code: '9902', material_group: '010404001', mch_subcategory: 'Belts', section_name: 'Accessories' })
  return { people, sections: { sarees: String(sarees.row_id), lehenga: String(lehenga.row_id) } }
}

describe('the org_chart scope provider on the platform', () => {
  test('gives a Team Leader of a live store their section', async ({ admin, createUser }) => {
    const { people } = await setup(admin, createUser)
    expect(await resolvePersonScope(people['p-103'], await binding())).toEqual([{
      label: '9901 / Section: Sarees', filters: { store: ['9901'], subcategory: ['010101001'] },
      basis: 'team_leader', confirmation: { store: { '9901': 'confirmed' }, subcategory: { '010101001': 'confirmed' } },
    }])
  })

  test('gives both Team Leaders of one section the whole section', async ({ admin, createUser }) => {
    const { people } = await setup(admin, createUser)
    const scopes = [await resolvePersonScope(people['p-103'], await binding()), await resolvePersonScope(people['p-104'], await binding())]
    expect(scopes.map(scope => scope.map(place => place.filters.subcategory))).toEqual([[['010101001']], [['010101001']]])
  })

  test('gives a Department Manager with two departments the sections of both', async ({ admin, createUser }) => {
    const { people } = await setup(admin, createUser)
    const scope = await resolvePersonScope(people['p-107'], await binding())
    expect(scope.map(place => place.label)).toEqual(['9901 / Section: Lehenga', '9901 / Section: Sarees'])
  })

  test('gives a Store Manager the whole store', async ({ admin, createUser }) => {
    const { people } = await setup(admin, createUser)
    const [store] = await resolvePersonScope(people['p-101'], await binding())
    expect(store).toMatchObject({ label: '9901', filters: { store: ['9901'] } })
  })

  test("gives a person with no employee code their explicit old-rule rows for a store not yet live", async ({ admin, createUser }) => {
    const { people } = await setup(admin, createUser)
    expect(await resolvePersonScope(people['p-130'], await binding())).toMatchObject([{
      label: '9902 / Section: Accessories', filters: { store: ['9902'], subcategory: ['010404001'] }, basis: 'assignment', confirmation: { store: { '9902': 'assumed' } },
    }])
  })

  test('gives a person who alone holds their employee code what it derives plus their explicit rows', async ({ admin, createUser }) => {
    const { people } = await setup(admin, createUser)
    expect(await resolvePersonScope(people['p-131'], await binding())).toMatchObject([{
      label: '9902 / Section: Accessories', filters: { store: ['9902'], subcategory: ['010404001', '010404002'] }, basis: 'assignment, store_manager',
      confirmation: { store: { '9902': 'assumed' } },
    }])
  })

  test('gives both people who hold the same employee code nothing from the old rules', async ({ admin, createUser }) => {
    const { people } = await setup(admin, createUser)
    for (const person of ['p-132', 'p-133'])
      await expect(resolvePersonScope(people[person], await binding())).rejects.toMatchObject({ reason: 'scope' })
  })

  test('answers "not set up yet" when the instance lacks the employee-code identifier system', async ({ admin, createUser }) => {
    const { people } = await setup(admin, createUser, { codes: false })
    const error = await resolvePersonScope(people['p-103'], await binding()).catch((e: unknown) => e)
    expect([(error as { type?: string }).type, statusOf(error)]).toEqual(['NotSetUpError', 409])
  })

  test('an empty scope means no access', async ({ admin, createUser }) => {
    const { people } = await setup(admin, createUser)
    await expect(resolvePersonScope(people['p-999'], await binding())).rejects.toMatchObject(new NoPersonScope('scope'))
  })

  test('until the old Tables are marked, a person the old rules reach has no scope', async ({ admin, createUser }) => {
    // p-103 holds no employee code, so the old rules read the old Tables for
    // their explicit rows, and an unmarked Table fails the whole scope.
    const { people } = await setup(admin, createUser, { mark: false })
    await expect(resolvePersonScope(people['p-103'], await binding())).rejects.toMatchObject({ reason: 'provider' })
  })

  test('the instance setup marks the six old Tables, and a second run leaves them alone', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const again = await markScopeTables((path: string) => admin.get(path))
    expect(again.map((r: { outcome: string }) => r.outcome)).toEqual(Array(6).fill('already marked'))
  })
})
