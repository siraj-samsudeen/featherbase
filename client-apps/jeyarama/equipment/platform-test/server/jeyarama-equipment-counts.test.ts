import { resolve } from 'node:path'
import { expect } from 'vitest'
import { makeClient, type TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { installApp } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { version } from '../../../client-apps/jeyarama/equipment/package.json'
import { expectRefused } from './fixtures'

type Row = { row_id: string; updated_at: string; [field: string]: unknown }

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

/** ATK with three assets (one in an area), Enchakkal with one, and one retired asset at ATK. */
async function pilot(createUser: (options: { roles: string[]; fullName?: string }) => Promise<TestClient>) {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'], fullName: 'Asset manager' }))
  const meena = assetsClient(await createUser({ roles: ['Assets Manager'], fullName: 'Meena' }))
  const suresh = assetsClient(await createUser({ roles: ['Assets Member'], fullName: 'Suresh' }))
  const other = assetsClient(await createUser({ roles: ['Assets Member'], fullName: 'Not counting' }))
  const save = (table: string, row: Record<string, unknown>) => manager.post<Row>('/api/save_row', { table, row })
  const atk = await save('equipment.place', { place_name: 'ATK 1501', place_level: 'Site', site_kind: 'Store' })
  const dairy = await save('equipment.place', { place_name: 'Dairy aisle', place_level: 'Area', parent_place: atk.row_id })
  const enchakkal = await save('equipment.place', { place_name: 'Enchakkal WH 9151', place_level: 'Site', site_kind: 'Warehouse' })
  const type = await save('equipment.asset_type', { type_name: 'Other' })
  const asset = (asset_name: string, place: string, extra: Record<string, unknown> = {}) =>
    save('equipment.asset', { asset_name, asset_type: type.row_id, place, ...extra })
  const chiller = await asset('Display chiller 1', dairy.row_id)
  const scale = await asset('Weighing scale 2', atk.row_id)
  const forklift = await asset('Godrej forklift', atk.row_id)
  await asset('Cold room', enchakkal.row_id)
  await asset('Old till', atk.row_id, { book_status: 'Retired' })
  const count = await save('equipment.count', { count_name: 'ATK full count', scope_place: atk.row_id, count_kind: 'Full', reviewer: meena.user })
  await save('equipment.counter', { count: count.row_id, person: suresh.user })
  return { manager, meena, suresh, other, save, atk, dairy, enchakkal, chiller, scale, forklift, count }
}

async function start(as: TestClient, count: Row) {
  const current = await as.get<Row>(`/api/table/equipment.count/${count.row_id}`)
  return as.post<{ result: { expected: number } }>('/api/app_actions/equipment/start_count', { idempotencyKey: crypto.randomUUID(), payload: { row_id: current.row_id, updated_at: current.updated_at } })
}
const latest = (as: TestClient, count: Row) => as.get<Row>(`/api/table/equipment.count/${count.row_id}`)

test('a planned count keeps its reviewer apart from its counters and starts only from Assets', async ({ createUser }) => {
  const { manager, meena, save, count } = await pilot(createUser)
  expect(count).toMatchObject({ count_state: 'Planned', snapshot_at: null })
  await expect(save('equipment.counter', { count: count.row_id, person: meena.user })).rejects.toThrow('The reviewer can’t also be a counter on this count')
  const current = await latest(manager, count)
  await expect(save('equipment.count', { row_id: count.row_id, updated_at: current.updated_at, count_state: 'Counting', snapshot_at: new Date().toISOString(), expected_total: 3 }))
    .rejects.toThrow('Start the count from Assets to fix its expected list')
})

test('starting a count fixes its expected list, which counters cannot read', async ({ createUser }) => {
  const { manager, suresh, save, atk, count } = await pilot(createUser)
  const started = await start(manager, count)
  expect(started.result.expected).toBe(3)
  const fixed = await latest(manager, count)
  expect(fixed).toMatchObject({ count_state: 'Counting', expected_total: 3 })
  expect(fixed.snapshot_at).toBeTruthy()
  const type = (await manager.get<{ data: Row[] }>('/api/table/equipment.asset_type?fields=["row_id"]')).data[0]
  await save('equipment.asset', { asset_name: 'Bought after the start', asset_type: type.row_id, place: atk.row_id })
  const expected = await manager.get<{ data: Row[] }>(`/api/table/equipment.count_expected?fields=["asset"]&filters=${encodeURIComponent(JSON.stringify([['count', '=', count.row_id]]))}`)
  expect(expected.data).toHaveLength(3)
  await expectRefused(suresh.get('/api/table/equipment.count_expected'), 403)
  await expect(start(manager, count)).rejects.toThrow('This count has already started')
  const chiller = (await manager.get<{ data: Row[] }>(`/api/table/equipment.asset?fields=["row_id"]&filters=${encodeURIComponent(JSON.stringify([['asset_name', '=', 'Display chiller 1']]))}`)).data[0]
  await expect(save('equipment.count_expected', { count: count.row_id, asset: chiller.row_id, expected_place: atk.row_id }))
    .rejects.toThrow('The expected list is fixed when the count starts')
  const [line] = (await manager.get<{ data: Row[] }>(`/api/table/equipment.count_expected?fields=["row_id","updated_at"]&filters=${encodeURIComponent(JSON.stringify([['count', '=', count.row_id]]))}`)).data
  await expect(save('equipment.count_expected', { row_id: line.row_id, updated_at: line.updated_at, expected_place: atk.row_id }))
    .rejects.toMatchObject({ status: 403 })
})

test('a count needs a counter to start, and a sample count expects only its sample', async ({ createUser }) => {
  const { manager, meena, suresh, save, atk } = await pilot(createUser)
  const empty = await save('equipment.count', { count_name: 'No counters', scope_place: atk.row_id, reviewer: meena.user })
  await expect(start(manager, empty)).rejects.toThrow('Add at least one counter before starting')
  const sample = await save('equipment.count', { count_name: 'ATK sample', scope_place: atk.row_id, count_kind: 'Sample', sample_size: 2, reviewer: meena.user })
  await save('equipment.counter', { count: sample.row_id, person: suresh.user })
  expect((await start(manager, sample)).result.expected).toBe(2)
})

test('counters record what they find, with who, where and why, and repeats are flagged', async ({ createUser }) => {
  const { manager, suresh, other, dairy, enchakkal, chiller, scale, count } = await pilot(createUser)
  const record = (as: TestClient, row: Record<string, unknown>) => as.post<Row>('/api/save_row', { table: 'equipment.scan', row: { count: count.row_id, ...row } })
  await expect(record(suresh, { asset: chiller.row_id, outcome: 'Found here', area: dairy.row_id })).rejects.toThrow('This count is not counting yet')
  await start(manager, count)
  const damaged = await record(suresh, { asset: chiller.row_id, outcome: 'Damaged', area: dairy.row_id, condition: 'Damaged' })
  expect(damaged).toMatchObject({ created_by: suresh.user, area: dairy.row_id, outcome: 'Damaged', duplicate: false })
  expect((await record(suresh, { asset: chiller.row_id, outcome: 'Found here', area: dairy.row_id })).duplicate).toBe(true)
  await expect(record(other, { asset: scale.row_id, outcome: 'Found here', area: dairy.row_id })).rejects.toThrow('Only this count’s counters record items')
  await expect(record(suresh, { asset: scale.row_id, outcome: 'Found here', area: enchakkal.row_id })).rejects.toThrow('Record items only in the place being counted')
  await expect(record(suresh, { typed_tag: scale.row_id, outcome: 'Found here', area: dairy.row_id })).rejects.toThrow('Say why the tag was typed')
  expect(await record(suresh, { typed_tag: scale.row_id, outcome: 'Found here', area: dairy.row_id, reason: 'Label torn' })).toMatchObject({ asset: scale.row_id, manual: true })
  await expect(record(suresh, { outcome: 'Not on the list', area: dairy.row_id, reason: 'No tag' })).rejects.toThrow('Describe the item that is not on the list')
  expect(await record(suresh, { outcome: 'Not on the list', area: dairy.row_id, description: 'Blue plastic crate stand', new_tag: 'AST-NEW-001', reason: 'No tag found' }))
    .toMatchObject({ asset: null, manual: true })
})

test('the reviewer sends lines back, decides every exception, and only then closes the count', async ({ createUser }) => {
  const { manager, meena, suresh, save, dairy, enchakkal, chiller, scale, forklift, count } = await pilot(createUser)
  await start(manager, count)
  const record = (row: Record<string, unknown>) => suresh.post<Row>('/api/save_row', { table: 'equipment.scan', row: { count: count.row_id, ...row } })
  await record({ asset: chiller.row_id, outcome: 'Found here', area: dairy.row_id })
  const unlisted = await record({ outcome: 'Not on the list', area: dairy.row_id, description: 'Crate stand', reason: 'No tag' })
  const moved = await manager.get<Row>(`/api/table/equipment.asset/${forklift.row_id}`)
  await save('equipment.asset', { row_id: forklift.row_id, updated_at: moved.updated_at, place: enchakkal.row_id })
  await save('equipment.count', { row_id: count.row_id, updated_at: (await latest(manager, count)).updated_at, count_state: 'In review' })

  const decide = (as: TestClient, row: Record<string, unknown>) => as.post<Row>('/api/save_row', { table: 'equipment.count_decision', row: { count: count.row_id, ...row } })
  await expect(decide(manager, { asset: scale.row_id, decision: 'To Loss Prevention' })).rejects.toThrow('Only the count’s reviewer decides its lines')
  await expect(decide(meena, { asset: scale.row_id, decision: 'Capitalize' })).rejects.toThrow('Choose a decision that fits a missing item')
  await expect(record({ asset: forklift.row_id, outcome: 'Found here', area: dairy.row_id })).rejects.toThrow('Only items sent back for recount can be recorded during review')
  const first = await decide(meena, { asset: scale.row_id, decision: 'Found later' })
  const changed = await meena.post<Row>('/api/save_row', { table: 'equipment.count_decision', row: { row_id: first.row_id, updated_at: first.updated_at, decision: 'Recount' } })
  expect(changed.decision).toBe('Recount')
  const recount = changed
  await expect(meena.post('/api/save_row', { table: 'equipment.count', row: { row_id: count.row_id, updated_at: (await latest(meena, count)).updated_at, count_state: 'Closed' } }))
    .rejects.toThrow('Decide every missing and unlisted line before closing')
  expect(await record({ asset: scale.row_id, outcome: 'Found here', area: dairy.row_id })).toMatchObject({ for_recount: true })
  await decide(meena, { scan: unlisted.row_id, decision: 'Controlled item' })
  expect(recount).toMatchObject({ decision: 'Recount' })
  const closed = await meena.post<Row>('/api/save_row', { table: 'equipment.count', row: { row_id: count.row_id, updated_at: (await latest(meena, count)).updated_at, count_state: 'Closed' } })
  expect(closed.count_state).toBe('Closed')
  expect(closed.closed_at).toBeTruthy()
  await expect(record({ asset: chiller.row_id, outcome: 'Found here', area: dairy.row_id })).rejects.toThrow('This count is closed')
  await expect(meena.post('/api/save_row', { table: 'equipment.count', row: { row_id: count.row_id, updated_at: closed.updated_at, count_name: 'Renamed' } }))
    .rejects.toThrow('A closed count stays closed')
  const after = await manager.get<Row>(`/api/table/equipment.asset/${scale.row_id}`)
  expect(after.book_status).toBe('Not yet in SAP')
})
