// Store administration (featherbase#919) on the real platform: Dash's store
// reach provider decides which stores' layout a Store Manager or Cluster
// Manager may read and change, and a Store Manager gives a Store Editor role
// to their own staff. Made-up stores 9901 and 9902 (cluster SOUTH) and 9903
// (cluster NORTH), and made-up people.
import type { TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { expectApiError } from '../fixtures'
import { installApp, pinned, saveRow } from './helpers'
// @ts-expect-error a plain .mjs module, copied in beside this file by the runner
import { markScopeTables } from './mark-scope-tables.mjs'

const test = pgTest.extend<{ admin: TestClient }>({ admin: async ({ admin }, use) => use(pinned(admin)) })
type Row = Record<string, unknown>
type CreateUser = (o: { email: string }) => Promise<TestClient>

const data = (column_name: string) => ({ column_name, column_type: 'Data' })
const GIVEN = '/api/apps/dash/given_roles'
const list = (table: string) => `/api/table/${encodeURIComponent(table)}?${new URLSearchParams({ fields: JSON.stringify(['row_id', 'store']), limit_page_length: '100' })}`

/** The app installed, the organisation masters created and marked as the instance setup does, and a made-up org chart. */
async function setup(admin: TestClient, createUser: CreateUser) {
  await installApp(admin)
  await admin.post('/api/table_def', { name: 'Site Master', module: 'Organisation', id_pattern: 'field:site_code', columns: [data('site_code'), data('cluster')] })
  await admin.post('/api/table_def', { name: 'Plant', module: 'Organisation', id_pattern: 'field:plant_code', columns: [data('plant_code'), { column_name: 'site', column_type: 'Reference', reference_table: 'Site Master' }] })
  await markScopeTables((path: string, init?: RequestInit) =>
    init?.method === 'PUT' ? admin.fetch(path, init).then(r => r.json()) : admin.get(path), ['Plant', 'Site Master'])
  for (const [site_code, cluster] of [['LKS', 'SOUTH'], ['HIL', 'SOUTH'], ['RVR', 'NORTH']]) await saveRow(admin, 'Site Master', { site_code, cluster })
  for (const [plant_code, site] of [['9901', 'LKS'], ['9902', 'HIL'], ['9903', 'RVR']]) await saveRow(admin, 'Plant', { plant_code, site })
  const person = async (name: string) => pinned(await createUser({ email: `${name}@example.test` }))
  const [manager, cluster, staff, other] = [await person('p-201'), await person('p-202'), await person('p-203'), await person('p-204')]
  const job = (who: TestClient, jobName: string, store: string, extra: Row = {}) =>
    saveRow(admin, 'job_assignment', { person: who.user, job: jobName, store, starts_on: '2026-01-01', ...extra })
  const sections: Record<string, string> = {}
  for (const store of ['9901', '9902', '9903']) {
    const floor = await saveRow(admin, 'store_floor', { store, floor_name: 'Ground' })
    sections[store] = String((await saveRow(admin, 'section', { store, section_name: 'Sarees', floor: floor.row_id })).row_id)
  }
  await job(manager, 'Store Manager', '9901')
  await job(cluster, 'Cluster Manager', '9903', { cluster: 'SOUTH' })
  await job(staff, 'Staff', '9901', { section: sections['9901'] })
  await job(other, 'Staff', '9903', { section: sections['9903'] })
  return { manager, cluster, staff, other, sections }
}

const stores = async (client: TestClient, table: string) =>
  (await client.get<{ data: Row[] }>(list(table))).data.map(row => row.store).sort()

describe('store administration on the platform', () => {
  test('a Store Manager reads and changes their own store\'s layout, and no other', async ({ admin, createUser }) => {
    const { manager } = await setup(admin, createUser)
    expect(await stores(manager, 'dash.store_floor')).toEqual(['9901'])
    await saveRow(manager, 'store_floor', { store: '9901', floor_name: 'First' })
    await expectApiError(saveRow(manager, 'store_floor', { store: '9902', floor_name: 'First' }), { status: 403 })
    expect(await stores(manager, 'dash.store_floor')).toEqual(['9901', '9901'])
  })

  test('a Cluster Manager reaches every store whose site is in their cluster', async ({ admin, createUser }) => {
    const { cluster } = await setup(admin, createUser)
    expect(await stores(cluster, 'dash.store_floor')).toEqual(['9901', '9902'])
  })

  test('a Store Manager appoints staff in their store, but never a job that gives reach', async ({ admin, createUser }) => {
    const { manager, other, sections } = await setup(admin, createUser)
    await saveRow(manager, 'job_assignment', { person: other.user, job: 'Team Leader', store: '9901', section: sections['9901'], starts_on: '2026-11-01' })
    await expectApiError(saveRow(manager, 'job_assignment', { person: other.user, job: 'Team Leader', store: '9903', section: sections['9903'], starts_on: '2026-11-01' }), { status: 403 })
    await expectApiError(saveRow(manager, 'job_assignment', { person: other.user, job: 'Store Manager', store: '9901', starts_on: '2026-11-01' }), { status: 403 })
  })

  test('a Store Manager gives their own staff the Store Editor role for their store, and takes it back', async ({ admin, createUser }) => {
    const { manager, staff, other } = await setup(admin, createUser)
    await expectApiError(staff.get(list('dash.store_floor')), { status: 403 })
    // Not past the store, and not to someone who does not work there.
    await expectApiError(manager.post(GIVEN, { person: staff.user, role: 'Dash Store Editor', stores: ['9902'] }), { status: 403 })
    await expectApiError(manager.post(GIVEN, { person: other.user, role: 'Dash Store Editor', stores: ['9901'] }), { status: 403 })
    const given = await manager.post<Row>(GIVEN, { person: staff.user, role: 'Dash Store Editor', stores: ['9901'] })
    expect(await stores(staff, 'dash.store_floor')).toEqual(['9901'])
    await saveRow(staff, 'display_location', { store: '9901', subcategory: '010101001', location_name: 'Window', starts_on: '2026-11-01' })
    // An editor changes placements, never the floors.
    await expectApiError(saveRow(staff, 'store_floor', { store: '9901', floor_name: 'Mezzanine' }), { status: 403 })
    await manager.post(`${GIVEN}/${encodeURIComponent(String(given.row_id))}/take_back`, {})
    await expectApiError(staff.get(list('dash.store_floor')), { status: 403 })
  })
})
