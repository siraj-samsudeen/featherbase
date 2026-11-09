import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  const avadi = await save('equipment.place', { place_name: 'ATK 1501', place_level: 'Site', site_kind: 'Store', sap_plant: '1501' })
  const billing = await save('equipment.place', { place_name: 'Billing area', place_level: 'Area', parent_place: avadi.row_id })
  const keel = await save('equipment.place', { place_name: 'Enchakkal WH 9151', place_level: 'Site', site_kind: 'Warehouse' })
  const ac = await save('equipment.asset_type', { type_name: 'AC' })
  const pos = await save('equipment.asset_type', { type_name: 'POS terminal' })
  const cold = await save('equipment.asset_type', { type_name: 'Cold room' })
  const voltas = await save('equipment.asset', { asset_name: 'Voltas 2-ton split AC', asset_type: ac.row_id, place: billing.row_id, warranty_until: '2027-03-12' })
  const till = await save('equipment.asset', { asset_name: 'Billing PC, till 3', asset_type: pos.row_id, place: avadi.row_id })
  const room = await save('equipment.asset', { asset_name: 'Blue Star cold room', asset_type: cold.row_id, place: keel.row_id })
  return { avadi, keel, billing, voltas, till, room }
}

test('store staff report a fault from the asset page and see it as an open job', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const staff = assetsClient(await createUser({ roles: ['Assets Member'] }))
  const { voltas } = await register(manager)
  renderAssets(staff, ['Assets Member'], `#asset=${voltas.row_id}`)
  expect(await screen.findByRole('heading', { name: 'Voltas 2-ton split AC' })).toBeInTheDocument()
  expect(await screen.findByText('ATK 1501 › Billing area', { selector: '.asset-sub' })).toBeInTheDocument()
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

// Moved from e2e/jeyarama-equipment.spec.ts (assets_fault_report, #1080): the
// way from the asset page to the board. The job's place and fix-by time are
// the server's jeyarama-equipment.test.ts.
test('from an asset page the Repair jobs link opens the board, where a reported fault waits under Reported', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const { voltas } = await register(manager)
  await manager.post('/api/save_row', { table: 'equipment.job', row: { asset: voltas.row_id, problem: 'Not cooling', priority: 'Urgent' } })
  renderAssets(manager, ['Assets Manager'], `#asset=${voltas.row_id}`)
  expect(await screen.findByRole('heading', { name: 'Voltas 2-ton split AC' })).toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('link', { name: 'Repair jobs' }))
  const reported = await screen.findByRole('region', { name: 'Reported' })
  expect(await within(reported).findByText('Not cooling')).toBeInTheDocument()
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
  const card = await within(reported).findByRole('article', { name: 'Not cooling' })
  expect(within(card).getByText('Unassigned')).toBeInTheDocument()
  await user.click(within(card).getByRole('button', { name: 'Open Not cooling' }))
  const panel = await screen.findByRole('dialog', { name: 'Not cooling' })
  await within(panel).findByRole('option', { name: 'Ravi' })
  await user.selectOptions(within(panel).getByRole('combobox', { name: 'Assign Not cooling' }), ravi.user!)
  const assigned = await screen.findByRole('region', { name: 'Assigned' })
  const assignedCard = await within(assigned).findByRole('article', { name: 'Not cooling' })
  expect(within(assignedCard).getByTitle('Ravi')).toHaveTextContent('R')
  managerView.unmount()

  renderAssets(ravi, ['Assets Technician'], '#jobs')
  const mine = await within(await screen.findByRole('region', { name: 'Assigned' })).findByRole('article', { name: 'Not cooling' })
  await user.click(within(mine).getByRole('button', { name: 'Open Not cooling' }))
  const sheet = await screen.findByRole('dialog', { name: 'Not cooling' })
  await user.selectOptions(within(sheet).getByRole('combobox', { name: 'Stage for Not cooling' }), 'Fixed')
  await user.click(within(sheet).getByRole('button', { name: 'Mark fixed' }))
  expect(await within(sheet).findByRole('alert')).toHaveTextContent('Say what was done to fix it')
  await user.type(within(sheet).getByRole('textbox', { name: 'Work done' }), 'Refilled gas')
  await user.type(within(sheet).getByRole('spinbutton', { name: 'Repair cost' }), '2400')
  await user.click(within(sheet).getByRole('button', { name: 'Mark fixed' }))
  const fixed = await screen.findByRole('region', { name: 'Fixed' })
  const done = await within(fixed).findByRole('article', { name: 'Not cooling' })
  expect(done).toHaveTextContent('Fixed on time · Refilled gas')
})

test('the board is compact: one-line places, a chip row, collapsed empty and closed columns, and drag to move', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'], fullName: 'Meena' }))
  const { voltas, till } = await register(manager)
  await manager.post('/api/save_row', { table: 'equipment.job', row: { asset: voltas.row_id, problem: 'Not cooling', priority: 'Urgent' } })
  await manager.post('/api/save_row', { table: 'equipment.job', row: { asset: till.row_id, problem: 'Receipt printer jams', priority: 'High' } })
  renderAssets(manager, ['Assets Manager'], '#jobs')
  const user = userEvent.setup()
  const reported = await screen.findByRole('region', { name: 'Reported' })
  const card = await within(reported).findByRole('article', { name: 'Not cooling' })
  const place = await within(card).findByText('Billing area')
  expect(place).toHaveAttribute('title', 'ATK 1501 › Billing area')
  expect(card).not.toHaveTextContent('ATK 1501 › Billing area')
  const chips = within(card).getByRole('list', { name: 'Not cooling at a glance' })
  expect(within(chips).getAllByRole('listitem').map(chip => chip.textContent)).toEqual(['Urgent', expect.stringMatching(/^(3h|4h) left$/), 'Warranty to 12-Mar-2027'])
  expect(within(card).queryByRole('combobox')).not.toBeInTheDocument()

  // Empty columns, and Closed and Cancelled always, fold to a strip that names the column and its count.
  for (const stage of ['Assigned', 'In progress', 'Waiting for parts', 'Fixed', 'Closed', 'Cancelled'])
    expect(screen.getByRole('button', { name: `Show ${stage}, 0 jobs` })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Closed' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Show Closed, 0 jobs' }))
  expect(screen.getByRole('region', { name: 'Closed' })).toBeInTheDocument()

  // Dragging a card onto a column moves the job there.
  const transfer = new Map<string, string>()
  const dataTransfer = { setData: (type: string, value: string) => transfer.set(type, value), getData: (type: string) => transfer.get(type) ?? '', effectAllowed: 'move', dropEffect: 'move' }
  fireEvent.dragStart(card, { dataTransfer })
  const target = screen.getByRole('button', { name: 'Show In progress, 0 jobs' })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  const moving = await screen.findByRole('region', { name: 'In progress' })
  expect(await within(moving).findByRole('article', { name: 'Not cooling' })).toBeInTheDocument()
  const stored = await manager.get<{ data: Row[] }>(`/api/table/equipment.job?fields=["job_state"]&filters=${encodeURIComponent('[["problem","=","Not cooling"]]')}`)
  expect(stored.data[0].job_state).toBe('In progress')
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
  expect(card).not.toHaveAttribute('draggable', 'true')
  await userEvent.setup().click(within(card).getByRole('button', { name: 'Open Not cooling' }))
  const panel = await screen.findByRole('dialog', { name: 'Not cooling' })
  expect(within(panel).queryByRole('combobox')).not.toBeInTheDocument()
  expect(within(panel).getByRole('list', { name: 'Timeline' })).toBeInTheDocument()
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

// ATK tagging plan item 1: the tag is the JRA- number stuck on the asset; the internal ID stays hidden.
test('the assets list shows each asset by its JRA tag, says when one still needs a tag, and finds it by tag', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const { voltas, till } = await register(manager)
  await manager.post('/api/save_row', { table: 'equipment.asset', row: { row_id: voltas.row_id, updated_at: voltas.updated_at, tag_no: 'JRA-000501' } })
  renderAssets(manager, ['Assets Manager'], '#assets')
  const table = await screen.findByRole('table', { name: 'Assets' })
  const row = (name: string) => within(table).getByRole('link', { name }).closest('tr')!
  await waitFor(() => expect(within(row('Voltas 2-ton split AC')).getAllByRole('cell')[0]).toHaveTextContent(/^JRA-000501$/))
  expect(within(row('Billing PC, till 3')).getAllByRole('cell')[0]).toHaveTextContent(/^Needs a tag$/)
  expect(table).not.toHaveTextContent(voltas.row_id)
  expect(table).not.toHaveTextContent(till.row_id)
  await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search' }), 'jra-000501')
  await waitFor(() => expect(within(table).queryByRole('link', { name: 'Billing PC, till 3' })).not.toBeInTheDocument())
  expect(within(table).getByRole('link', { name: 'Voltas 2-ton split AC' })).toBeInTheDocument()
})

test('the asset page heads a tagged asset with its tag and an untagged one with its place only', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const { voltas, till } = await register(manager)
  await manager.post('/api/save_row', { table: 'equipment.asset', row: { row_id: voltas.row_id, updated_at: voltas.updated_at, tag_no: 'JRA-000501' } })
  const tagged = renderAssets(manager, ['Assets Manager'], `#asset=${voltas.row_id}`)
  expect(await screen.findByText('JRA-000501 · ATK 1501 › Billing area')).toBeInTheDocument()
  tagged.unmount()
  renderAssets(manager, ['Assets Manager'], `#asset=${till.row_id}`)
  await screen.findByRole('heading', { name: 'Billing PC, till 3' })
  expect(await screen.findByText('ATK 1501', { selector: '.asset-sub' })).toBeInTheDocument()
  expect(document.body).not.toHaveTextContent(till.row_id)
})

test('the asset page shows its SAP numbers read-only, its four states and who owns and holds it', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const suresh = await createUser({ roles: ['Assets Member'], fullName: 'Suresh K' })
  const { voltas } = await register(manager)
  const save = (table: string, row: Record<string, unknown>) => manager.post<Row>('/api/save_row', { table, row })
  const kaipl = await save('equipment.entity', { entity_name: 'KAIPL', entity_status: 'Verified', sap_company_code: '2000' })
  const operator = await save('equipment.entity', { entity_name: 'Kannammal Agro' })
  const current = await manager.get<Row>(`/api/table/equipment.asset/${voltas.row_id}`)
  await save('equipment.asset', { row_id: voltas.row_id, updated_at: current.updated_at,
    sap_company_code: '2000', sap_asset_no: '210004512', sap_asset_sub: '0', sap_equipment_no: '10007731', legacy_id: 'ATK-AC-07',
    sap_refreshed_at: '2026-11-07T00:30:00.000Z', book_status: 'Capitalized', condition: 'Under repair', custody_status: 'With vendor',
    owner_entity: kaipl.row_id, operator_entity: operator.row_id, cost_centre: 'KA-ENC-410', custodian: suresh.user,
  })
  await save('equipment.job', { asset: voltas.row_id, problem: 'Door seal torn' })
  renderAssets(manager, ['Assets Manager'], `#asset=${voltas.row_id}`)
  const sap = await screen.findByRole('region', { name: 'From SAP' })
  expect(sap).toHaveTextContent('Company code2000')
  expect(sap).toHaveTextContent('Asset no. / sub210004512 / 0')
  expect(sap).toHaveTextContent('Equipment no.10007731')
  expect(sap).toHaveTextContent('Legacy IDATK-AC-07')
  expect(sap).toHaveTextContent('Refreshed 07-Nov-2026 06:00 IST')
  expect(within(sap).queryByRole('textbox')).not.toBeInTheDocument()
  const states = screen.getByRole('list', { name: 'States' })
  await waitFor(() => expect(within(states).getAllByRole('listitem').map(item => item.textContent)).toEqual([
    'Books: Capitalized', 'Condition: Under repair', 'Custody: With vendor', 'Workflow: Repair job open',
  ]))
  const who = screen.getByRole('region', { name: 'Ownership' })
  await waitFor(() => expect(who).toHaveTextContent('Legal ownerKAIPL · Verified'))
  expect(who).toHaveTextContent('OperatorKannammal Agro · Draft')
  expect(who).toHaveTextContent('Cost centreKA-ENC-410')
  expect(who).toHaveTextContent('CustodianSuresh K')
})

test('store staff confirm a fixed repair, which closes it, and see its timeline and cover', async ({ createUser }) => {
  await install()
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'] }))
  const ravi = assetsClient(await createUser({ roles: ['Assets Technician'], fullName: 'Ravi' }))
  const staff = assetsClient(await createUser({ roles: ['Assets Member'] }))
  const { voltas } = await register(manager)
  let job = await manager.post<Row>('/api/save_row', { table: 'equipment.job', row: { asset: voltas.row_id, problem: 'Not cooling', priority: 'Urgent', assigned_to: ravi.user } })
  job = await ravi.post<Row>('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: job.updated_at, job_state: 'In progress', cause: 'Low gas' } })
  await ravi.post<Row>('/api/save_row', { table: 'equipment.job', row: { row_id: job.row_id, updated_at: job.updated_at, job_state: 'Fixed', work_done: 'Refilled gas', spares: 'R32 gas, 1.2 kg' } })
  const view = renderAssets(staff, ['Assets Member'], `#asset=${voltas.row_id}`)
  const waiting = await screen.findByRole('region', { name: 'Waiting for you to confirm' })
  const item = within(waiting).getByRole('article', { name: 'Not cooling' })
  expect(within(item).getByRole('list', { name: 'Timeline' })).toHaveTextContent(/Reported.*Responded.*Repair started.*Restored/)
  expect(item).toHaveTextContent('Cause: Low gas · Spares: R32 gas, 1.2 kg')
  expect(item).toHaveTextContent('Under warranty until 12-Mar-2027')
  const user = userEvent.setup()
  await user.click(within(item).getByRole('button', { name: 'Confirm it works' }))
  const past = await screen.findByRole('region', { name: 'Past jobs' })
  expect(await within(past).findByText(/Closed · confirmed/)).toBeInTheDocument()
  view.unmount()

  renderAssets(manager, ['Assets Manager'], '#jobs')
  // Closed is folded until opened; the confirmed job has left Fixed, which folds empty.
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Show Closed, 1 job' }))
  const closed = screen.getByRole('region', { name: 'Closed' })
  expect(await within(closed).findByRole('article', { name: 'Not cooling' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Show Fixed, 0 jobs' })).toBeInTheDocument()
})
