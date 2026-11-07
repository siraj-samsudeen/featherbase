import { render, screen, waitFor, within } from '@testing-library/react'
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

function renderAssets(as: TestClient, roles: string[], hash = '') {
  setSession(as.token!, { row_id: as.user!, email: as.user!, full_name: null })
  location.hash = hash
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AssetsApp roles={roles} />
  </QueryClientProvider>)
}

async function register(manager: TestClient) {
  const save = (table: string, row: Record<string, unknown>) => manager.post<Row>('/api/save_row', { table, row })
  const avadi = await save('equipment.place', { place_name: 'Avadi Store' })
  const keel = await save('equipment.place', { place_name: 'Keelkattalai Store' })
  const ac = await save('equipment.asset_type', { type_name: 'AC' })
  const pos = await save('equipment.asset_type', { type_name: 'POS terminal' })
  const cold = await save('equipment.asset_type', { type_name: 'Cold room' })
  const voltas = await save('equipment.asset', { asset_name: 'Voltas 2-ton split AC', asset_type: ac.row_id, place: avadi.row_id, area: 'Billing area', warranty_until: '2027-03-12' })
  const till = await save('equipment.asset', { asset_name: 'Billing PC, till 3', asset_type: pos.row_id, place: avadi.row_id })
  const room = await save('equipment.asset', { asset_name: 'Blue Star cold room', asset_type: cold.row_id, place: keel.row_id })
  return { avadi, keel, voltas, till, room }
}

test('store staff report a fault from the asset page and see it as an open job', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const staff = assetsClient(await createUser({ roles: ['Assets Member'] }))
  const { voltas } = await register(manager)
  renderAssets(staff, ['Assets Member'], `#asset=${voltas.row_id}`)
  expect(await screen.findByRole('heading', { name: 'Voltas 2-ton split AC' })).toBeInTheDocument()
  expect(await screen.findByText(`${voltas.row_id} · Avadi Store · Billing area`)).toBeInTheDocument()
  expect(screen.getByText('Warranty until 12-Mar-2027')).toBeInTheDocument()
  const user = userEvent.setup()
  const report = screen.getByRole('region', { name: 'Report a fault' })
  await user.type(within(report).getByRole('textbox', { name: 'What’s wrong?' }), 'Not cooling')
  await user.click(within(report).getByRole('radio', { name: 'Urgent' }))
  await user.click(within(report).getByRole('button', { name: 'Send report' }))
  const open = await screen.findByRole('region', { name: 'Open jobs' })
  expect(await within(open).findByText('Not cooling')).toBeInTheDocument()
  expect(within(open).getByText(/^(3h|4h) left$/)).toBeInTheDocument()
  const jobs = await staff.get<{ data: Row[] }>('/api/table/equipment.job?fields=["problem","priority","job_state"]')
  expect(jobs.data).toEqual([{ problem: 'Not cooling', priority: 'Urgent', job_state: 'Reported' }])
})

test('the label sheet has a QR label for each asset in the chosen place only', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const { avadi, voltas, till, room } = await register(manager)
  renderAssets(manager, ['Assets Manager'], '#labels')
  const user = userEvent.setup()
  await screen.findByRole('option', { name: 'Avadi Store' })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Place' }), avadi.row_id)
  const sheet = await screen.findByRole('region', { name: 'Labels for Avadi Store' })
  for (const asset of [voltas, till])
    expect(await within(sheet).findByRole('img', { name: `QR code for ${asset.row_id}` })).toBeInTheDocument()
  expect(within(sheet).getByText('Voltas 2-ton split AC')).toBeInTheDocument()
  expect(within(sheet).queryByText(room.row_id)).not.toBeInTheDocument()
})

test('a manager assigns a job and a technician fixes it with a note and a cost', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'], fullName: 'Meena' }))
  const ravi = assetsClient(await createUser({ roles: ['Assets Technician'], fullName: 'Ravi' }))
  const { voltas } = await register(manager)
  await manager.post('/api/save_row', { table: 'equipment.job', row: { asset: voltas.row_id, problem: 'Not cooling', priority: 'Urgent' } })
  const managerView = renderAssets(manager, ['Assets Manager'], '#jobs')
  const user = userEvent.setup()
  const reported = await screen.findByRole('region', { name: 'Reported' })
  await within(reported).findByText('Not cooling')
  await within(reported).findByRole('option', { name: 'Ravi' })
  await user.selectOptions(within(reported).getByRole('combobox', { name: 'Assign Not cooling' }), ravi.user!)
  const assigned = screen.getByRole('region', { name: 'Assigned' })
  expect(await within(assigned).findByText('Not cooling')).toBeInTheDocument()
  managerView.unmount()

  renderAssets(ravi, ['Assets Technician'], '#jobs')
  const card = await within(await screen.findByRole('region', { name: 'Assigned' })).findByRole('article', { name: 'Not cooling' })
  await user.selectOptions(within(card).getByRole('combobox', { name: 'Stage for Not cooling' }), 'Fixed')
  await user.click(within(card).getByRole('button', { name: 'Mark fixed' }))
  expect(await within(card).findByRole('alert')).toHaveTextContent('Say what was done to fix it')
  await user.type(within(card).getByRole('textbox', { name: 'Work done' }), 'Refilled gas')
  await user.type(within(card).getByRole('spinbutton', { name: 'Repair cost' }), '2400')
  await user.click(within(card).getByRole('button', { name: 'Mark fixed' }))
  const fixed = await screen.findByRole('region', { name: 'Fixed' })
  expect(await within(fixed).findByText('Not cooling')).toBeInTheDocument()
  expect(within(fixed).getByText(/^Fixed in .*, on time$/)).toBeInTheDocument()
})

test('store staff see jobs but get no controls to change them', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const staff = assetsClient(await createUser({ roles: ['Assets Member'] }))
  const { voltas } = await register(manager)
  await manager.post('/api/save_row', { table: 'equipment.job', row: { asset: voltas.row_id, problem: 'Not cooling', priority: 'Urgent' } })
  renderAssets(staff, ['Assets Member'], '#jobs')
  const card = await within(await screen.findByRole('region', { name: 'Reported' })).findByRole('article', { name: 'Not cooling' })
  expect(within(card).queryByRole('combobox')).not.toBeInTheDocument()
})

test('the assets list shows each place’s assets with an open job or a warranty about to end', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const { voltas, till } = await register(manager)
  const soon = new Date(); soon.setDate(soon.getDate() + 10)
  await manager.post('/api/save_row', { table: 'equipment.asset', row: { row_id: till.row_id, updated_at: till.updated_at, warranty_until: soon.toISOString().slice(0, 10) } })
  await manager.post('/api/save_row', { table: 'equipment.job', row: { asset: voltas.row_id, problem: 'Not cooling', priority: 'Urgent' } })
  renderAssets(manager, ['Assets Manager'], '#assets')
  const table = await screen.findByRole('table', { name: 'Assets' })
  const row = (name: string) => within(table).getByRole('link', { name }).closest('tr')!
  await waitFor(() => expect(row('Voltas 2-ton split AC')).toHaveTextContent('Open job'))
  expect(row('Billing PC, till 3')).toHaveTextContent('Warranty ends soon')
  expect(within(table).getByRole('link', { name: 'Voltas 2-ton split AC' })).toHaveAttribute('href', `#asset=${voltas.row_id}`)
})
