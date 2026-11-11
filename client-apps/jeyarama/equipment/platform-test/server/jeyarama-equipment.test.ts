import { resolve } from 'node:path'
import { expect } from 'vitest'
import { makeClient, type TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { installApp } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { version } from '../../../client-apps/jeyarama/equipment/package.json'

type Row = { row_id: string; updated_at: string; [field: string]: unknown }

// A client built with the Assets app, as Tasker's tests model theirs.
function assetsClient(client: TestClient): TestClient {
  return makeClient({ request: (path, init) => client.fetch(String(path), {
    ...init,
    headers: { 'X-Featherbase-App-Version': `equipment@${version}`, ...init?.headers },
  }) }, client.token, client.user)
}

async function install() {
  expect(await discoverPackages([resolve('../..', 'client-apps/jeyarama/equipment')])).toEqual([])
  await installApp('equipment')
}

const HOUR = 3_600_000

async function register(manager: TestClient) {
  const avadi = await manager.post<Row>('/api/save_row', { table: 'equipment.place', row: { place_name: 'ATK 1501', place_level: 'Site', site_kind: 'Store' } })
  const ac = await manager.post<Row>('/api/save_row', { table: 'equipment.asset_type', row: { type_name: 'AC' } })
  const asset = await manager.post<Row>('/api/save_row', { table: 'equipment.asset', row: {
    asset_name: 'Voltas 2-ton split AC', asset_type: ac.row_id, place: avadi.row_id, warranty_until: '2027-03-12',
  } })
  return { avadi, asset }
}

test('a manager keeps the register; store staff see it but cannot change it', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const staff = assetsClient(await createUser({ roles: ['Assets Member'] }))
  const { avadi, asset } = await register(manager)
  expect(asset.row_id).toMatch(/^AST-\d{4}$/)
  const seen = await staff.get<{ data: Row[] }>('/api/table/equipment.asset?fields=["asset_name","place"]')
  expect(seen.data).toEqual([{ asset_name: 'Voltas 2-ton split AC', place: avadi.row_id }])
  await expect(staff.post('/api/save_row', { table: 'equipment.asset', row: { row_id: asset.row_id, updated_at: asset.updated_at, condition: 'Idle' } }))
    .rejects.toMatchObject({ status: 403 })
})

test('a fault report becomes a job for the asset’s place, due by its priority', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const staff = assetsClient(await createUser({ roles: ['Assets Member'] }))
  const { avadi, asset } = await register(manager)
  const job = await staff.post<Row>('/api/save_row', { table: 'equipment.job', row: {
    asset: asset.row_id, problem: 'Not cooling', priority: 'Urgent', job_state: 'Fixed', place: 'somewhere else',
  } })
  expect(job).toMatchObject({ job_state: 'Reported', place: avadi.row_id, assigned_to: null })
  expect(Date.parse(String(job.fix_by)) - Date.parse(String(job.reported_at))).toBe(4 * HOUR)
})

test('changing the priority moves the fix-by time from when the fault was reported', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const { asset } = await register(manager)
  const job = await manager.post<Row>('/api/save_row', { table: 'equipment.job', row: { asset: asset.row_id, problem: 'Door seal torn' } })
  expect(Date.parse(String(job.fix_by)) - Date.parse(String(job.reported_at))).toBe(72 * HOUR)
  const raised = await manager.post<Row>('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: job.updated_at, priority: 'High' } })
  expect(raised.reported_at).toEqual(job.reported_at)
  expect(Date.parse(String(raised.fix_by)) - Date.parse(String(raised.reported_at))).toBe(24 * HOUR)
})

test('assigning a reported job moves it to Assigned; store staff cannot change it', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const ravi = await createUser({ roles: ['Assets Technician'] })
  const staff = assetsClient(await createUser({ roles: ['Assets Member'] }))
  const { asset } = await register(manager)
  const job = await staff.post<Row>('/api/save_row', { table: 'equipment.job', row: { asset: asset.row_id, problem: 'Not cooling', priority: 'Urgent' } })
  const assigned = await manager.post<Row>('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: job.updated_at, assigned_to: ravi.user } })
  expect(assigned).toMatchObject({ job_state: 'Assigned', assigned_to: ravi.user })
  await expect(staff.post('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: assigned.updated_at, job_state: 'Fixed', work_done: 'Done' } }))
    .rejects.toMatchObject({ status: 403 })
})

test('a job is fixed only with a note of the work done, and keeps its cost', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const ravi = assetsClient(await createUser({ roles: ['Assets Technician'] }))
  const { asset } = await register(manager)
  const job = await manager.post<Row>('/api/save_row', { table: 'equipment.job', row: { asset: asset.row_id, problem: 'Not cooling', priority: 'Urgent' } })
  await expect(ravi.post('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: job.updated_at, job_state: 'Fixed' } }))
    .rejects.toThrow('Say what was done to fix it')
  const fixed = await ravi.post<Row>('/api/save_row', { table: 'equipment.job', row: {
    row_id: job.row_id, updated_at: job.updated_at, job_state: 'Fixed', work_done: 'Refilled gas', repair_cost: 2400,
  } })
  expect(fixed).toMatchObject({ job_state: 'Fixed', work_done: 'Refilled gas' })
  expect(Number(fixed.repair_cost)).toBe(2400)
  expect(fixed.restored_at).toBeTruthy()
  const reopened = await ravi.post<Row>('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: fixed.updated_at, job_state: 'In progress' } })
  expect(reopened.restored_at).toBeNull()
})

test('a job keeps when it failed, was reported, answered, started and restored', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const ravi = await createUser({ roles: ['Assets Technician'] })
  const { asset } = await register(manager)
  const failed = new Date(Date.now() - 2 * HOUR).toISOString()
  let job = await manager.post<Row>('/api/save_row', { table: 'equipment.job', row: { asset: asset.row_id, problem: 'Door seal torn', failure_started_at: failed } })
  expect(job).toMatchObject({ responded_at: null, repair_started_at: null, restored_at: null })
  expect(Date.parse(String(job.failure_started_at))).toBe(Date.parse(failed))
  const step = (change: Record<string, unknown>) => manager.post<Row>('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: job.updated_at, ...change } })
  job = await step({ assigned_to: ravi.user })
  const responded = job.responded_at
  expect(responded).toBeTruthy()
  job = await step({ job_state: 'In progress' })
  const started = job.repair_started_at
  expect(started).toBeTruthy()
  job = await step({ job_state: 'Waiting for parts', spares: 'Door gasket, 1 no.' })
  job = await step({ job_state: 'In progress', cause: 'Seal worn out', outside_service: 'Blue Star AMC' })
  expect(job).toMatchObject({ responded_at: responded, repair_started_at: started, cause: 'Seal worn out', spares: 'Door gasket, 1 no.', outside_service: 'Blue Star AMC' })
  job = await step({ job_state: 'Fixed', work_done: 'Replaced the door gasket' })
  expect(job.restored_at).toBeTruthy()
})

test('a fault cannot have started after it was reported', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const { asset } = await register(manager)
  await expect(manager.post('/api/save_row', { table: 'equipment.job', row: {
    asset: asset.row_id, problem: 'Door seal torn', failure_started_at: new Date(Date.now() + 2 * HOUR).toISOString(),
  } })).rejects.toThrow('It can’t have stopped working after it was reported')
})

test('someone other than the technician confirms the repair, and a confirmed job stays closed', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const ravi = assetsClient(await createUser({ roles: ['Assets Technician'] }))
  const staff = assetsClient(await createUser({ roles: ['Assets Member'] }))
  const { asset } = await register(manager)
  let job = await manager.post<Row>('/api/save_row', { table: 'equipment.job', row: { asset: asset.row_id, problem: 'Not cooling', priority: 'Urgent', assigned_to: ravi.user } })
  await expect(staff.post('/api/save_row', { table: 'equipment.restoration', row: { job: job.row_id } }))
    .rejects.toThrow('Confirm a job only once it is Fixed')
  job = await ravi.post<Row>('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: job.updated_at, job_state: 'Fixed', work_done: 'Refilled gas' } })
  await expect(ravi.post('/api/save_row', { table: 'equipment.restoration', row: { job: job.row_id } }))
    .rejects.toThrow('Someone other than the technician who fixed it confirms the repair')
  const confirmed = await staff.post<Row>('/api/save_row', { table: 'equipment.restoration', row: { job: job.row_id, note: 'Cooling again' } })
  expect(confirmed).toMatchObject({ job: job.row_id, created_by: staff.user })
  await expect(staff.post('/api/save_row', { table: 'equipment.restoration', row: { job: job.row_id } })).rejects.toBeTruthy()
  await expect(ravi.post('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: job.updated_at, job_state: 'In progress' } }))
    .rejects.toThrow('The store confirmed this repair; report a new fault instead')
  for (const change of [{ assigned_to: manager.user }, { work_done: 'Replaced the compressor' }])
    await expect(manager.post('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: job.updated_at, ...change } }))
      .rejects.toThrow('The store confirmed this repair; report a new fault instead')
})

test('whoever marks a job fixed can’t confirm it, even after reassigning it', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const ravi = assetsClient(await createUser({ roles: ['Assets Technician'] }))
  const { asset } = await register(manager)
  let job = await manager.post<Row>('/api/save_row', { table: 'equipment.job', row: { asset: asset.row_id, problem: 'Not cooling', assigned_to: ravi.user } })
  job = await manager.post<Row>('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: job.updated_at, job_state: 'Fixed', work_done: 'Refilled gas', fixed_by: ravi.user } })
  expect(job.fixed_by).toBe(manager.user)
  job = await manager.post<Row>('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: job.updated_at, assigned_to: null } })
  expect(job.fixed_by).toBe(manager.user)
  await expect(manager.post('/api/save_row', { table: 'equipment.restoration', row: { job: job.row_id } }))
    .rejects.toThrow('Someone other than the technician who fixed it confirms the repair')
})

test('places nest from site to building, floor and area', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const place = (row: Record<string, unknown>) => manager.post<Row>('/api/save_row', { table: 'equipment.place', row })
  const site = await place({ place_name: 'Enchakkal WH 9151', place_level: 'Site', site_kind: 'Warehouse', sap_plant: '9151' })
  const building = await place({ place_name: 'Main building', place_level: 'Building', parent_place: site.row_id })
  const floor = await place({ place_name: 'Ground floor', place_level: 'Floor', parent_place: building.row_id })
  await place({ place_name: 'Cold chain', place_level: 'Area', parent_place: floor.row_id })
  await expect(place({ place_name: 'Loose floor', place_level: 'Floor' })).rejects.toThrow('Choose the place this floor is inside')
  await expect(place({ place_name: 'Site in a site', place_level: 'Site', parent_place: site.row_id })).rejects.toThrow('A site is not inside another place')
  await expect(place({ place_name: 'Upside down', place_level: 'Building', parent_place: floor.row_id })).rejects.toThrow('A building sits inside a site')
})
