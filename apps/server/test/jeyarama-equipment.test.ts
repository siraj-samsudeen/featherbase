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
  const avadi = await manager.post<Row>('/api/save_row', { table: 'equipment.place', row: { place_name: 'Avadi Store', place_type: 'Store' } })
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
  await expect(staff.post('/api/save_row', { table: 'equipment.asset', row: { row_id: asset.row_id, updated_at: asset.updated_at, area: 'Billing' } }))
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
  expect(fixed.fixed_at).toBeTruthy()
  const reopened = await ravi.post<Row>('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: fixed.updated_at, job_state: 'In progress' } })
  expect(reopened.fixed_at).toBeNull()
})
