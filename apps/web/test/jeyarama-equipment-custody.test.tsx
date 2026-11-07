import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { discoverPackages } from 'server/src/runtime-packages'
import { resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { makeClient, type TestClient } from 'feather-testing-postgres'
import { AssetsApp } from '../../../client-apps/jeyarama/equipment/src/AssetsApp'
import { version } from '../../../client-apps/jeyarama/equipment/package.json'
import { setSession } from '../src/lib/api'
import { test, expect } from './pg-test'

type Row = { row_id: string; updated_at: string; [field: string]: unknown }

function assetsClient(client: TestClient): TestClient {
  return makeClient({ request: (path, init) => client.fetch(String(path), {
    ...init,
    headers: { 'X-Featherbase-App-Version': `equipment@${version}`, ...init?.headers },
  }) }, client.token, client.user)
}

async function install() {
  expect(await discoverPackages([resolve('../..', 'client-apps/jeyarama/equipment')])).toEqual([])
  if (await isInstalled('equipment')) await uninstallApp('equipment')
  await installApp('equipment')
}

function renderAssets(as: TestClient, roles: string[], hash: string) {
  cleanup()
  setSession(as.token!, { row_id: as.user!, email: as.user!, full_name: null })
  location.hash = hash
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AssetsApp roles={roles} />
  </QueryClientProvider>)
}

async function pilot(createUser: (options: { roles: string[]; fullName?: string }) => Promise<TestClient>) {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'], fullName: 'Asset manager' }))
  const meena = assetsClient(await createUser({ roles: ['Assets Manager'], fullName: 'Meena' }))
  const suresh = assetsClient(await createUser({ roles: ['Assets Member'], fullName: 'Suresh' }))
  const save = (table: string, row: Record<string, unknown>, as = manager) => as.post<Row>('/api/save_row', { table, row })
  const act = (as: TestClient, name: string, payload: Record<string, unknown>) =>
    as.post<{ result: Row }>(`/api/app_actions/equipment/${name}`, { idempotencyKey: crypto.randomUUID(), payload }).then(r => r.result)
  const atk = await save('equipment.place', { place_name: 'ATK 1501', place_level: 'Site' })
  const enchakkal = await save('equipment.place', { place_name: 'Enchakkal WH 9151', place_level: 'Site' })
  const jrpl = await save('equipment.entity', { entity_name: 'JRPL', entity_status: 'Verified' })
  const kaipl = await save('equipment.entity', { entity_name: 'KAIPL', entity_status: 'Verified' })
  const type = await save('equipment.asset_type', { type_name: 'Other' })
  const asset = (asset_name: string) => save('equipment.asset', { asset_name, asset_type: type.row_id, place: atk.row_id, owner_entity: jrpl.row_id })
  const pc = await asset('Billing PC, till 3')
  const ac = await asset('Voltas AC 1')
  const dg = await asset('Kirloskar DG')
  return { manager, meena, suresh, save, act, atk, enchakkal, jrpl, kaipl, pc, ac, dg }
}

/** A transfer someone else approved, ready to dispatch. */
async function approved(p: Awaited<ReturnType<typeof pilot>>, values: Record<string, unknown>, assets: Row[]) {
  const transfer = await p.save('equipment.transfer', { from_place: p.atk.row_id, to_place: p.enchakkal.row_id, reason: 'Needed at the warehouse', ...values })
  for (const asset of assets) await p.save('equipment.transfer_line', { transfer: transfer.row_id, asset: asset.row_id })
  return p.save('equipment.transfer', { row_id: transfer.row_id, updated_at: transfer.updated_at, transfer_state: 'Approved' }, p.meena)
}

test('a manager issues an asset and the custodian accepts it', async ({ createUser }) => {
  const p = await pilot(createUser)
  renderAssets(p.manager, ['Assets Manager'], '#custody')
  const user = userEvent.setup()
  const issue = await screen.findByRole('region', { name: 'Issue an asset' })
  await within(issue).findByRole('option', { name: 'Billing PC, till 3' })
  await user.selectOptions(within(issue).getByRole('combobox', { name: 'Asset' }), p.pc.row_id)
  await within(issue).findByRole('option', { name: 'Suresh' })
  await user.selectOptions(within(issue).getByRole('combobox', { name: 'Person' }), p.suresh.user!)
  await user.click(within(issue).getByRole('button', { name: 'Issue' }))
  const held = await screen.findByRole('table', { name: 'Custody' })
  expect(await within(held).findByRole('row', { name: /Billing PC, till 3/ })).toHaveTextContent('Pending')

  renderAssets(p.suresh, ['Assets Member'], '#custody')
  const mine = await screen.findByRole('region', { name: 'Your assets' })
  const item = await within(mine).findByRole('listitem', { name: 'Billing PC, till 3' })
  expect(item).toHaveTextContent('Waiting for you')
  await user.click(within(item).getByRole('button', { name: 'Accept' }))
  await waitFor(() => expect(within(mine).getByRole('listitem', { name: 'Billing PC, till 3' })).toHaveTextContent('Accepted'))
  expect(screen.queryByRole('region', { name: 'Issue an asset' })).not.toBeInTheDocument()
})

test('a leaver’s clearance past the leaving date asks for escalation, and Assets never holds pay', async ({ createUser }) => {
  const p = await pilot(createUser)
  await p.act(p.manager, 'issue_custody', { asset: p.pc.row_id, person: p.suresh.user!, kind: 'Employee' })
  await p.save('equipment.clearance', { person: p.suresh.user, reason: 'Leaving', leaving_date: '2026-01-05' })
  renderAssets(p.manager, ['Assets Manager'], '#custody')
  const clearances = await screen.findByRole('region', { name: 'Clearances' })
  const row = await within(clearances).findByRole('row', { name: /Suresh/ })
  expect(row).toHaveTextContent('05-Jan-2026')
  expect(row).toHaveTextContent('Escalate to HR and Operations: 1 asset not returned')
  expect(within(row).queryByRole('button', { name: 'Mark cleared' })).not.toBeInTheDocument()
  expect(clearances).toHaveTextContent('Assets never holds pay')
})

test('a transfer is requested, approved by another manager, scanned out and received', async ({ createUser }) => {
  const p = await pilot(createUser)
  renderAssets(p.manager, ['Assets Manager'], '#transfers')
  const user = userEvent.setup()
  const form = await screen.findByRole('region', { name: 'Request a transfer' })
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Kind' }), 'Between sites')
  await within(within(form).getByRole('combobox', { name: 'To' })).findByRole('option', { name: 'Enchakkal WH 9151' })
  await user.selectOptions(within(form).getByRole('combobox', { name: 'From' }), p.atk.row_id)
  await user.selectOptions(within(form).getByRole('combobox', { name: 'To' }), p.enchakkal.row_id)
  await user.type(within(form).getByRole('textbox', { name: 'Reason' }), 'Spare AC for the warehouse office')
  await user.click(await within(within(form).getByRole('group', { name: 'Items' })).findByRole('checkbox', { name: 'Voltas AC 1' }))
  await user.click(within(form).getByRole('button', { name: 'Request transfer' }))
  const list = await screen.findByRole('table', { name: 'Transfers' })
  const row = await within(list).findByRole('row', { name: /Spare AC/ })
  expect(row).toHaveTextContent('Requested')
  expect(row).toHaveTextContent('Waiting for another manager')
  expect(within(row).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()

  renderAssets(p.meena, ['Assets Manager'], '#transfers')
  const theirs = await within(await screen.findByRole('table', { name: 'Transfers' })).findByRole('row', { name: /Spare AC/ })
  await user.click(within(theirs).getByRole('button', { name: 'Approve' }))
  await waitFor(() => expect(within(screen.getByRole('table', { name: 'Transfers' })).getByRole('row', { name: /Spare AC/ })).toHaveTextContent('Approved'))

  const [transfer] = (await p.manager.get<{ data: Row[] }>('/api/table/equipment.transfer?fields=["row_id"]')).data
  renderAssets(p.manager, ['Assets Manager'], `#transfer=${transfer.row_id}`)
  const dispatch = await screen.findByRole('region', { name: 'Dispatch' })
  await user.type(within(dispatch).getByRole('textbox', { name: 'Transporter or vendor' }), 'TN 09 AB 1234, Murugan Transports')
  await user.click(within(dispatch).getByRole('button', { name: 'Dispatch' }))
  expect(await within(dispatch).findByRole('alert')).toHaveTextContent('Scan every item before dispatch: Voltas AC 1 is not scanned')
  await user.type(within(dispatch).getByRole('textbox', { name: 'Scan tag' }), `${p.ac.row_id}{Enter}`)
  expect(within(dispatch).getByRole('list', { name: 'Scanned' })).toHaveTextContent('Voltas AC 1')
  await user.click(within(dispatch).getByRole('button', { name: 'Dispatch' }))

  const receive = await screen.findByRole('region', { name: 'Receive' })
  expect(screen.getByText(/Receive by/)).toHaveTextContent(/\d{2}-[A-Z][a-z]{2}-\d{4}/)
  const line = await within(receive).findByRole('listitem', { name: 'Voltas AC 1' })
  await user.selectOptions(await within(line).findByRole('combobox', { name: 'Outcome for Voltas AC 1' }), 'Received good')
  await waitFor(() => expect(within(line).getByRole('button', { name: 'Receive' })).toBeEnabled())
  await user.click(within(line).getByRole('button', { name: 'Receive' }))
  expect(await screen.findByText('Received', { selector: '.transfer-stage' })).toBeInTheDocument()
  expect((await p.manager.get<Row>(`/api/table/equipment.asset/${p.ac.row_id}`)).place).toBe(p.enchakkal.row_id)
})

test('an overdue transfer shows how late it is in red', async ({ createUser }) => {
  const p = await pilot(createUser)
  const transfer = await approved(p, { transfer_kind: 'Between sites', reason: 'AC to warehouse', expected_receipt_at: '2026-01-02T04:00:00.000Z' }, [p.ac])
  await p.act(p.manager, 'dispatch_transfer', { transfer: transfer.row_id, transporter: 'Murugan Transports', scanned: [p.ac.row_id] })
  renderAssets(p.manager, ['Assets Manager'], '#transfers')
  const row = await within(await screen.findByRole('table', { name: 'Transfers' })).findByRole('row', { name: /AC to warehouse/ })
  const clock = within(row).getByText(/Late by/)
  expect(clock).toHaveClass('is-late')
  expect(row).toHaveTextContent('Dispatched')
})

test('between companies, ownership changes only when another manager records the Finance confirmation', async ({ createUser }) => {
  const p = await pilot(createUser)
  const transfer = await approved(p, { transfer_kind: 'Between companies', to_entity: p.kaipl.row_id, reason: 'DG moves to KAIPL' }, [p.dg])
  await p.act(p.manager, 'dispatch_transfer', { transfer: transfer.row_id, transporter: 'Murugan Transports', scanned: [p.dg.row_id] })
  const [line] = (await p.manager.get<{ data: Row[] }>(`/api/table/equipment.transfer_line?fields=["row_id"]&filters=[["transfer","=","${transfer.row_id}"]]`)).data
  await p.act(p.manager, 'receive_line', { line: line.row_id, outcome: 'Received good' })

  renderAssets(p.manager, ['Assets Manager'], `#transfer=${transfer.row_id}`)
  const finance = await screen.findByRole('region', { name: 'Finance confirmation' })
  expect(finance).toHaveTextContent('Needs Finance and tax approval')
  expect(within(finance).queryByRole('button', { name: 'Confirm Finance' })).not.toBeInTheDocument()

  renderAssets(p.meena, ['Assets Manager'], `#transfer=${transfer.row_id}`)
  const user = userEvent.setup()
  const theirs = await screen.findByRole('region', { name: 'Finance confirmation' })
  await user.type(within(theirs).getByRole('textbox', { name: 'SAP transaction reference' }), 'ABUMN 4900012345')
  await user.click(within(theirs).getByRole('button', { name: 'Confirm Finance' }))
  await waitFor(() => expect(screen.getByRole('region', { name: 'Finance confirmation' })).toHaveTextContent('ABUMN 4900012345'))
  expect((await p.manager.get<Row>(`/api/table/equipment.asset/${p.dg.row_id}`)).owner_entity).toBe(p.kaipl.row_id)
})

test('the asset page shows custody and movement history', async ({ createUser }) => {
  const p = await pilot(createUser)
  await p.act(p.manager, 'issue_custody', { asset: p.ac.row_id, person: p.suresh.user!, kind: 'Employee' })
  const custody = (await p.manager.get<{ data: Row[] }>('/api/table/equipment.custody?fields=["row_id"]')).data[0]
  await p.act(p.manager, 'return_custody', { custody: custody.row_id })
  const transfer = await approved(p, { transfer_kind: 'Between sites', reason: 'AC to warehouse' }, [p.ac])
  await p.act(p.manager, 'dispatch_transfer', { transfer: transfer.row_id, transporter: 'Murugan Transports', scanned: [p.ac.row_id] })
  renderAssets(p.manager, ['Assets Manager'], `#asset=${p.ac.row_id}`)
  const history = await screen.findByRole('region', { name: 'Custody and movements' })
  expect(await within(history).findByText(/Issued to Suresh/)).toBeInTheDocument()
  expect(within(history).getByText(/Returned/)).toBeInTheDocument()
  expect(within(history).getByRole('link', { name: String(transfer.row_id) })).toHaveAttribute('href', `#transfer=${transfer.row_id}`)
  expect(history).toHaveTextContent('ATK 1501 → Enchakkal WH 9151')
  expect(history).toHaveTextContent('Dispatched')
})
