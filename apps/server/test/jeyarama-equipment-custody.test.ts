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

async function pilot(createUser: (options: { roles: string[]; fullName?: string }) => Promise<TestClient>) {
  expect(await discoverPackages([resolve('../..', 'client-apps/jeyarama/equipment')])).toEqual([])
  await installApp('equipment')
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'], fullName: 'Asset manager' }))
  const meena = assetsClient(await createUser({ roles: ['Assets Manager'], fullName: 'Meena' }))
  const suresh = assetsClient(await createUser({ roles: ['Assets Member'], fullName: 'Suresh' }))
  const other = assetsClient(await createUser({ roles: ['Assets Member'], fullName: 'Someone else' }))
  const save = (table: string, row: Record<string, unknown>, as = manager) => as.post<Row>('/api/save_row', { table, row })
  const atk = await save('equipment.place', { place_name: 'ATK 1501', place_level: 'Site' })
  const enchakkal = await save('equipment.place', { place_name: 'Enchakkal WH 9151', place_level: 'Site' })
  const jrpl = await save('equipment.entity', { entity_name: 'JRPL', entity_status: 'Verified' })
  const kaipl = await save('equipment.entity', { entity_name: 'KAIPL', entity_status: 'Verified' })
  const type = await save('equipment.asset_type', { type_name: 'Other' })
  const asset = (asset_name: string) => save('equipment.asset', { asset_name, asset_type: type.row_id, place: atk.row_id, owner_entity: jrpl.row_id })
  const pc = await asset('Billing PC, till 3')
  const ac1 = await asset('Voltas AC 1')
  const ac2 = await asset('Voltas AC 2')
  const dg = await asset('Kirloskar DG')
  const act = <T = Row>(as: TestClient, name: string, payload: Record<string, unknown>) =>
    as.post<{ result: T }>(`/api/app_actions/equipment/${name}`, { idempotencyKey: crypto.randomUUID(), payload }).then(r => r.result)
  const get = (table: string, id: string) => manager.get<Row>(`/api/table/${table}/${id}`)
  return { manager, meena, suresh, other, save, act, get, atk, enchakkal, jrpl, kaipl, pc, ac1, ac2, dg }
}

const answer = (as: TestClient, custody: Row, custody_state: string) =>
  as.post<Row>('/api/save_row', { table: 'equipment.custody', row: { row_id: custody.row_id, updated_at: custody.updated_at, custody_state } })

test('an issued asset waits until its custodian accepts it, and only they can answer', async ({ createUser }) => {
  const p = await pilot(createUser)
  const custody = await p.act(p.manager, 'issue_custody', { asset: p.pc.row_id, person: p.suresh.user, kind: 'Employee' })
  expect(custody).toMatchObject({ custody_state: 'Pending', custodian: p.suresh.user })
  expect(await p.get('equipment.asset', p.pc.row_id)).toMatchObject({ custodian: p.suresh.user, custody_status: 'With custodian', location_custodian: false })
  await expect(answer(p.other, custody, 'Accepted')).rejects.toThrow('Only the person it was issued to can answer')
  expect(await answer(p.suresh, custody, 'Accepted')).toMatchObject({ custody_state: 'Accepted' })
  await expect(p.act(p.manager, 'issue_custody', { asset: p.pc.row_id, person: p.other.user, kind: 'Employee' }))
    .rejects.toThrow('Billing PC, till 3 is already in someone’s custody; take it back first')
})

test('a custodian can say it is not with them or hand it back, and a manager takes it back', async ({ createUser }) => {
  const p = await pilot(createUser)
  const first = await p.act(p.manager, 'issue_custody', { asset: p.pc.row_id, person: p.suresh.user, kind: 'Employee' })
  expect(await answer(p.suresh, first, 'Not with me')).toMatchObject({ custody_state: 'Not with me' })
  await p.act(p.manager, 'return_custody', { custody: first.row_id })
  expect(await p.get('equipment.asset', p.pc.row_id)).toMatchObject({ custodian: null, custody_status: 'At location' })
  const second = await p.act(p.manager, 'issue_custody', { asset: p.pc.row_id, person: p.suresh.user, kind: 'Location custodian' })
  expect(await p.get('equipment.asset', p.pc.row_id)).toMatchObject({ custodian: p.suresh.user, custody_status: 'At location', location_custodian: true })
  const accepted = await answer(p.suresh, second, 'Accepted')
  const handing = await answer(p.suresh, accepted, 'Return requested')
  await expect(p.act(p.suresh, 'return_custody', { custody: handing.row_id })).rejects.toThrow('Only an Assets Manager can take an asset back')
  expect(await p.act(p.meena, 'return_custody', { custody: handing.row_id })).toMatchObject({ custody_state: 'Returned' })
})

test('a clearance closes only when the leaver holds nothing', async ({ createUser }) => {
  const p = await pilot(createUser)
  const custody = await p.act(p.manager, 'issue_custody', { asset: p.pc.row_id, person: p.suresh.user, kind: 'Employee' })
  const clearance = await p.save('equipment.clearance', { person: p.suresh.user, reason: 'Leaving', leaving_date: '2026-11-30' })
  await expect(p.save('equipment.clearance', { row_id: clearance.row_id, updated_at: clearance.updated_at, clearance_state: 'Cleared' }))
    .rejects.toThrow('Return or reassign every asset before clearing')
  await p.act(p.manager, 'return_custody', { custody: custody.row_id })
  expect(await p.save('equipment.clearance', { row_id: clearance.row_id, updated_at: clearance.updated_at, clearance_state: 'Cleared' })).toMatchObject({ clearance_state: 'Cleared' })
})

test('someone else approves a transfer; dispatch scans every item; an asset is on one transfer at a time', async ({ createUser }) => {
  const p = await pilot(createUser)
  const transfer = await p.save('equipment.transfer', { transfer_kind: 'Between sites', from_place: p.atk.row_id, to_place: p.enchakkal.row_id, reason: 'Store refit' })
  await p.save('equipment.transfer_line', { transfer: transfer.row_id, asset: p.ac1.row_id })
  await p.save('equipment.transfer_line', { transfer: transfer.row_id, asset: p.ac2.row_id })
  await expect(p.save('equipment.transfer', { row_id: transfer.row_id, updated_at: transfer.updated_at, transfer_state: 'Approved' }))
    .rejects.toThrow('Someone other than the requester approves a transfer')
  const approved = await p.save('equipment.transfer', { row_id: transfer.row_id, updated_at: transfer.updated_at, transfer_state: 'Approved' }, p.meena)
  expect(approved).toMatchObject({ transfer_state: 'Approved', approver: p.meena.user })

  const second = await p.save('equipment.transfer', { transfer_kind: 'Within site', from_place: p.atk.row_id, to_place: p.atk.row_id, reason: 'Move to billing' })
  await expect(p.save('equipment.transfer_line', { transfer: second.row_id, asset: p.ac1.row_id })).rejects.toThrow(/Voltas AC 1 is already on transfer TRF-/)

  await expect(p.act(p.manager, 'dispatch_transfer', { transfer: transfer.row_id, transporter: 'Sri Murugan Logistics', scanned: [p.ac1.row_id] }))
    .rejects.toThrow('Scan every item before dispatch: Voltas AC 2 is not scanned')
  const dispatched = await p.act(p.manager, 'dispatch_transfer', { transfer: transfer.row_id, transporter: 'Sri Murugan Logistics', scanned: [p.ac1.row_id, p.ac2.row_id] })
  expect(dispatched).toMatchObject({ transfer_state: 'Dispatched', transporter: 'Sri Murugan Logistics' })
  expect(Date.parse(String(dispatched.expected_receipt_at)) - Date.parse(String(dispatched.dispatched_at))).toBe(72 * 3_600_000)
  expect(await p.get('equipment.asset', p.ac1.row_id)).toMatchObject({ custody_status: 'In transit', place: p.atk.row_id })
})

test('receipt moves an asset; refused items go back; transfers between companies wait for Finance', async ({ createUser }) => {
  const p = await pilot(createUser)
  const transfer = await p.save('equipment.transfer', { transfer_kind: 'Between companies', from_place: p.atk.row_id, to_place: p.enchakkal.row_id, to_entity: p.kaipl.row_id, reason: 'DG moves to KAIPL' })
  const lines = [
    await p.save('equipment.transfer_line', { transfer: transfer.row_id, asset: p.dg.row_id }),
    await p.save('equipment.transfer_line', { transfer: transfer.row_id, asset: p.ac1.row_id }),
    await p.save('equipment.transfer_line', { transfer: transfer.row_id, asset: p.ac2.row_id }),
  ]
  await p.save('equipment.transfer', { row_id: transfer.row_id, updated_at: transfer.updated_at, transfer_state: 'Approved' }, p.meena)
  await p.act(p.manager, 'dispatch_transfer', { transfer: transfer.row_id, transporter: 'Own van', scanned: [p.dg.row_id, p.ac1.row_id, p.ac2.row_id] })
  await expect(p.act(p.meena, 'confirm_finance', { transfer: transfer.row_id, sap_reference: '4900012345' })).rejects.toThrow('Confirm Finance only once the transfer is received')
  await expect(p.act(p.suresh, 'receive_line', { line: lines[0].row_id, outcome: 'Received good' })).rejects.toThrow('Only an Assets Manager can receive items into a site')

  await p.act(p.meena, 'receive_line', { line: lines[0].row_id, outcome: 'Received good' })
  expect(await p.get('equipment.asset', p.dg.row_id)).toMatchObject({ place: p.enchakkal.row_id, custody_status: 'At location', owner_entity: p.jrpl.row_id })
  await p.act(p.meena, 'receive_line', { line: lines[1].row_id, outcome: 'Received damaged', note: 'Dent on the front panel' })
  expect(await p.get('equipment.asset', p.ac1.row_id)).toMatchObject({ place: p.enchakkal.row_id, condition: 'Damaged' })
  await p.act(p.meena, 'receive_line', { line: lines[2].row_id, outcome: 'Refused' })
  expect(await p.get('equipment.asset', p.ac2.row_id)).toMatchObject({ place: p.atk.row_id, custody_status: 'In transit' })
  expect((await p.get('equipment.transfer', transfer.row_id)).transfer_state).toBe('Dispatched')
  await p.act(p.manager, 'receive_line', { line: lines[2].row_id, outcome: 'Returned to source' })
  expect(await p.get('equipment.asset', p.ac2.row_id)).toMatchObject({ place: p.atk.row_id, custody_status: 'At location' })
  expect((await p.get('equipment.transfer', transfer.row_id)).transfer_state).toBe('Received')

  await expect(p.act(p.manager, 'confirm_finance', { transfer: transfer.row_id, sap_reference: '4900012345' })).rejects.toThrow('Someone other than the requester confirms Finance')
  const confirmed = await p.act(p.meena, 'confirm_finance', { transfer: transfer.row_id, sap_reference: '4900012345' })
  expect(confirmed).toMatchObject({ finance_reference: '4900012345', finance_confirmed_by: p.meena.user })
  expect((await p.get('equipment.asset', p.dg.row_id)).owner_entity).toBe(p.kaipl.row_id)
  expect((await p.get('equipment.asset', p.ac2.row_id)).owner_entity).toBe(p.jrpl.row_id)
})

test('a repair goes with the vendor and a move within a site is due in a day', async ({ createUser }) => {
  const p = await pilot(createUser)
  const repair = await p.save('equipment.transfer', { transfer_kind: 'Repair with vendor', from_place: p.atk.row_id, to_place: p.atk.row_id, vendor: 'Kirloskar Service', reason: 'Battery fault' })
  await p.save('equipment.transfer_line', { transfer: repair.row_id, asset: p.dg.row_id })
  await p.save('equipment.transfer', { row_id: repair.row_id, updated_at: repair.updated_at, transfer_state: 'Approved' }, p.meena)
  await p.act(p.manager, 'dispatch_transfer', { transfer: repair.row_id, transporter: 'Kirloskar Service', scanned: [p.dg.row_id] })
  expect((await p.get('equipment.asset', p.dg.row_id)).custody_status).toBe('With vendor')
  const move = await p.save('equipment.transfer', { transfer_kind: 'Within site', from_place: p.atk.row_id, to_place: p.atk.row_id, reason: 'To billing' })
  await p.save('equipment.transfer_line', { transfer: move.row_id, asset: p.pc.row_id })
  await p.save('equipment.transfer', { row_id: move.row_id, updated_at: move.updated_at, transfer_state: 'Approved' }, p.meena)
  const sent = await p.act(p.manager, 'dispatch_transfer', { transfer: move.row_id, transporter: 'By hand', scanned: [p.pc.row_id] })
  expect(Date.parse(String(sent.expected_receipt_at)) - Date.parse(String(sent.dispatched_at))).toBe(24 * 3_600_000)
})

const patch = (p: Awaited<ReturnType<typeof pilot>>, table: string, row: Row, values: Record<string, unknown>, as?: TestClient) =>
  p.get(table, row.row_id).then(current => p.save(table, { row_id: current.row_id, updated_at: current.updated_at, ...values }, as))

test('a transfer moves only through approval, dispatch and receipt; saving its fields directly skips nothing', async ({ createUser }) => {
  const p = await pilot(createUser)
  const forged = await p.save('equipment.transfer', { transfer_kind: 'Between sites', from_place: p.atk.row_id, to_place: p.enchakkal.row_id, reason: 'Refit',
    transfer_state: 'Approved', approver: p.manager.user, approved_at: '2026-01-01T00:00:00.000Z', dispatched_at: '2026-01-01T00:00:00.000Z' })
  expect(forged).toMatchObject({ transfer_state: 'Requested', approver: null, approved_at: null, dispatched_at: null })
  const line = await p.save('equipment.transfer_line', { transfer: forged.row_id, asset: p.ac1.row_id })

  await expect(patch(p, 'equipment.transfer', forged, { transfer_state: 'Received' })).rejects.toThrow('A requested transfer can’t become Received')
  await expect(patch(p, 'equipment.transfer', forged, { transfer_state: 'Dispatched', dispatched_at: new Date().toISOString() }))
    .rejects.toThrow('A requested transfer can’t become Dispatched')
  await expect(patch(p, 'equipment.transfer_line', line, { line_state: 'Received good' })).rejects.toThrow('This item can’t go from Requested to Received good')

  await patch(p, 'equipment.transfer', forged, { transfer_state: 'Approved' }, p.meena)
  expect(await patch(p, 'equipment.transfer', forged, { approver: p.manager.user, approved_at: '2026-01-01T00:00:00.000Z' })).toMatchObject({ approver: p.meena.user })
  await expect(patch(p, 'equipment.transfer', forged, { transfer_state: 'Dispatched', transporter: 'Own van' })).rejects.toThrow('Dispatch every item before the transfer')
  await expect(patch(p, 'equipment.transfer_line', line, { line_state: 'Dispatched' })).rejects.toThrow('Voltas AC 1 must be scanned out before it is dispatched')

  const sent = await p.act(p.manager, 'dispatch_transfer', { transfer: forged.row_id, transporter: 'Own van', scanned: [p.ac1.row_id] })
  expect(await patch(p, 'equipment.transfer', forged, { dispatched_at: '2026-01-01T00:00:00.000Z', received_at: '2026-01-01T00:00:00.000Z' }))
    .toMatchObject({ dispatched_at: sent.dispatched_at, received_at: null })
  await expect(patch(p, 'equipment.transfer', forged, { transfer_state: 'Received' })).rejects.toThrow('Receive every item before the transfer')
  await expect(patch(p, 'equipment.transfer_line', line, { line_state: 'Received good' })).rejects.toThrow('Voltas AC 1 must be at Enchakkal WH 9151 before it is received')
  expect(await p.get('equipment.asset', p.ac1.row_id)).toMatchObject({ place: p.atk.row_id, custody_status: 'In transit' })
})

test('once approved, a transfer and its items keep what was approved, and only Finance’s confirmer stamps it', async ({ createUser }) => {
  const p = await pilot(createUser)
  const transfer = await p.save('equipment.transfer', { transfer_kind: 'Between companies', from_place: p.atk.row_id, to_place: p.enchakkal.row_id, to_entity: p.kaipl.row_id, reason: 'DG moves' })
  const line = await p.save('equipment.transfer_line', { transfer: transfer.row_id, asset: p.dg.row_id })
  await expect(patch(p, 'equipment.transfer_line', line, { asset: p.ac1.row_id })).rejects.toThrow('A transfer item keeps its asset and transfer')
  await patch(p, 'equipment.transfer', transfer, { transfer_state: 'Approved' }, p.meena)
  for (const change of [{ to_place: p.atk.row_id }, { from_place: p.enchakkal.row_id }, { transfer_kind: 'Between sites' }, { to_entity: p.jrpl.row_id }])
    await expect(patch(p, 'equipment.transfer', transfer, change)).rejects.toThrow('An approved transfer keeps its kind, places, new owner and vendor')
  await expect(p.save('equipment.transfer_line', { transfer: transfer.row_id, asset: p.ac1.row_id })).rejects.toThrow('Add items only while the transfer is requested')

  await p.act(p.manager, 'dispatch_transfer', { transfer: transfer.row_id, transporter: 'Own van', scanned: [p.dg.row_id] })
  await p.act(p.manager, 'receive_line', { line: line.row_id, outcome: 'Received good' })
  await expect(patch(p, 'equipment.transfer', transfer, { finance_reference: '4900012345' })).rejects.toThrow('Someone other than the requester confirms Finance')
  expect(await patch(p, 'equipment.transfer', transfer, { finance_reference: '4900012345', finance_confirmed_by: p.manager.user }, p.meena))
    .toMatchObject({ finance_reference: '4900012345', finance_confirmed_by: p.meena.user })
  await expect(patch(p, 'equipment.transfer', transfer, { finance_reference: '4900099999' }, p.meena)).rejects.toThrow('Finance has already confirmed this transfer')
})

test('custody keeps its times; only the custodian or a manager writes its note; nothing comes back while it is away', async ({ createUser }) => {
  const p = await pilot(createUser)
  const custody = await p.act(p.manager, 'issue_custody', { asset: p.ac1.row_id, person: p.suresh.user, kind: 'Employee' })
  const answered = await answer(p.suresh, custody, 'Accepted')
  expect(await patch(p, 'equipment.custody', custody, { issued_at: '2026-01-01T00:00:00.000Z', responded_at: null, returned_at: '2026-01-01T00:00:00.000Z' }))
    .toMatchObject({ issued_at: custody.issued_at, responded_at: answered.responded_at, returned_at: null })
  // Validators can't see roles: someone else's save is refused by the manager check itself.
  await expectRefused(patch(p, 'equipment.custody', custody, { note: 'Mine now' }, p.other), 403)
  expect((await p.get('equipment.custody', custody.row_id)).note).toBeNull()
  expect(await patch(p, 'equipment.custody', custody, { note: 'Kept at till 2' }, p.suresh)).toMatchObject({ note: 'Kept at till 2' })

  const transfer = await p.save('equipment.transfer', { transfer_kind: 'Between sites', from_place: p.atk.row_id, to_place: p.enchakkal.row_id, reason: 'Moves with Suresh' })
  const line = await p.save('equipment.transfer_line', { transfer: transfer.row_id, asset: p.ac1.row_id })
  await patch(p, 'equipment.transfer', transfer, { transfer_state: 'Approved' }, p.meena)
  await p.act(p.manager, 'dispatch_transfer', { transfer: transfer.row_id, transporter: 'Own van', scanned: [p.ac1.row_id] })
  await expect(p.act(p.manager, 'return_custody', { custody: custody.row_id })).rejects.toThrow('Voltas AC 1 is in transit; receive it before taking it back')
  await p.act(p.manager, 'receive_line', { line: line.row_id, outcome: 'Received good' })
  expect(await p.get('equipment.asset', p.ac1.row_id)).toMatchObject({ place: p.enchakkal.row_id, custody_status: 'With custodian', custodian: p.suresh.user })
})

test('an item sent back returns to its own area, not just its site', async ({ createUser }) => {
  const p = await pilot(createUser)
  const billing = await p.save('equipment.place', { place_name: 'ATK Billing', place_level: 'Area', parent_place: p.atk.row_id })
  await patch(p, 'equipment.asset', p.ac2, { place: billing.row_id })
  const transfer = await p.save('equipment.transfer', { transfer_kind: 'Between sites', from_place: p.atk.row_id, to_place: p.enchakkal.row_id, reason: 'Refit' })
  const line = await p.save('equipment.transfer_line', { transfer: transfer.row_id, asset: p.ac2.row_id })
  await patch(p, 'equipment.transfer', transfer, { transfer_state: 'Approved' }, p.meena)
  await p.act(p.manager, 'dispatch_transfer', { transfer: transfer.row_id, transporter: 'Own van', scanned: [p.ac2.row_id] })
  expect((await p.get('equipment.transfer_line', line.row_id)).source_place).toBe(billing.row_id)
  await p.act(p.manager, 'receive_line', { line: line.row_id, outcome: 'Refused' })
  await p.act(p.manager, 'receive_line', { line: line.row_id, outcome: 'Returned to source' })
  expect(await p.get('equipment.asset', p.ac2.row_id)).toMatchObject({ place: billing.row_id, custody_status: 'At location' })
})
