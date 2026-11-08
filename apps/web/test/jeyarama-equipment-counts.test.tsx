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

function renderAssets(as: TestClient, roles: string[], hash: string) {
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
  const save = (table: string, row: Record<string, unknown>) => manager.post<Row>('/api/save_row', { table, row })
  const atk = await save('equipment.place', { place_name: 'ATK 1501', place_level: 'Site', site_kind: 'Store' })
  const dairy = await save('equipment.place', { place_name: 'Dairy aisle', place_level: 'Area', parent_place: atk.row_id })
  const enchakkal = await save('equipment.place', { place_name: 'Enchakkal WH 9151', place_level: 'Site' })
  const type = await save('equipment.asset_type', { type_name: 'Other' })
  const asset = (asset_name: string, place: string) => save('equipment.asset', { asset_name, asset_type: type.row_id, place })
  const chiller = await asset('Display chiller 1', dairy.row_id)
  const scale = await asset('Weighing scale 2', atk.row_id)
  const forklift = await asset('Godrej forklift', atk.row_id)
  return { manager, meena, suresh, save, atk, dairy, enchakkal, chiller, scale, forklift }
}

async function startedCount(p: Awaited<ReturnType<typeof pilot>>) {
  const count = await p.save('equipment.count', { count_name: 'ATK full count', scope_place: p.atk.row_id, reviewer: p.meena.user })
  await p.save('equipment.counter', { count: count.row_id, person: p.suresh.user })
  const current = await p.manager.get<Row>(`/api/table/equipment.count/${count.row_id}`)
  await p.manager.post('/api/app_actions/equipment/start_count', { idempotencyKey: crypto.randomUUID(), payload: { row_id: current.row_id, updated_at: current.updated_at } })
  return count
}

test('a manager plans a count with counters and a reviewer, then starts it', async ({ createUser }) => {
  const p = await pilot(createUser)
  renderAssets(p.manager, ['Assets Manager'], '#counts')
  const user = userEvent.setup()
  const plan = await screen.findByRole('region', { name: 'Plan a count' })
  await user.type(within(plan).getByRole('textbox', { name: 'Count name' }), 'ATK full count')
  await within(plan).findByRole('option', { name: 'ATK 1501' })
  await user.selectOptions(within(plan).getByRole('combobox', { name: 'Place to count' }), p.atk.row_id)
  await within(plan).findByRole('option', { name: 'Meena' })
  await user.selectOptions(within(plan).getByRole('combobox', { name: 'Reviewer' }), p.meena.user!)
  await user.click(within(within(plan).getByRole('group', { name: 'Counters' })).getByRole('checkbox', { name: 'Suresh' }))
  await user.click(within(plan).getByRole('button', { name: 'Plan count' }))
  const table = await screen.findByRole('table', { name: 'Counts' })
  const row = await within(table).findByRole('row', { name: /ATK full count/ })
  expect(row).toHaveTextContent('Planned')
  await user.click(within(row).getByRole('button', { name: 'Start count' }))
  await waitFor(() => expect(within(table).getByRole('row', { name: /ATK full count/ })).toHaveTextContent('Counting · 3 expected'))
})

test('a counter records blind: only areas and their own numbers, never the expected list', async ({ createUser }) => {
  const p = await pilot(createUser)
  const count = await startedCount(p)
  renderAssets(p.suresh, ['Assets Member'], `#count=${count.row_id}`)
  const user = userEvent.setup()
  expect(await screen.findByRole('heading', { name: 'ATK full count' })).toBeInTheDocument()
  await screen.findByRole('option', { name: 'ATK 1501 › Dairy aisle' })
  expect(screen.queryByRole('option', { name: 'Enchakkal WH 9151' })).not.toBeInTheDocument()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Area' }), p.dairy.row_id)
  await user.type(screen.getByRole('textbox', { name: 'Tag' }), p.chiller.row_id)
  await user.selectOptions(screen.getByRole('combobox', { name: 'Outcome' }), 'Damaged')
  await user.click(screen.getByRole('button', { name: 'Record' }))
  expect(await screen.findByText('You have recorded 1 item in ATK 1501 › Dairy aisle')).toBeInTheDocument()
  expect(screen.queryByText('Weighing scale 2')).not.toBeInTheDocument()
  expect(screen.queryByText('Godrej forklift')).not.toBeInTheDocument()
  expect(screen.queryByText(/expected/i)).not.toBeInTheDocument()

  await user.type(screen.getByRole('textbox', { name: 'Tag' }), p.scale.row_id)
  await user.click(screen.getByRole('checkbox', { name: 'Typed by hand' }))
  await user.click(screen.getByRole('button', { name: 'Record' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Say why the tag was typed')
  await user.type(screen.getByRole('textbox', { name: 'Why typed?' }), 'Label torn')
  await user.click(screen.getByRole('button', { name: 'Record' }))
  expect(await screen.findByText('You have recorded 2 items in ATK 1501 › Dairy aisle')).toBeInTheDocument()

  const unlisted = screen.getByRole('region', { name: 'Not on the list' })
  await user.type(within(unlisted).getByRole('textbox', { name: 'Description' }), 'Blue crate stand')
  await user.type(within(unlisted).getByRole('textbox', { name: 'New tag stuck' }), 'AST-NEW-001')
  await user.type(within(unlisted).getByRole('textbox', { name: 'Reason' }), 'No tag found')
  await user.click(within(unlisted).getByRole('button', { name: 'Record item not on the list' }))
  expect(await screen.findByText('You have recorded 3 items in ATK 1501 › Dairy aisle')).toBeInTheDocument()
})

test('the reviewer sees each outcome, sends a line back, decides the rest and closes', async ({ createUser }) => {
  const p = await pilot(createUser)
  const count = await startedCount(p)
  const record = (row: Record<string, unknown>) => p.suresh.post<Row>('/api/save_row', { table: 'equipment.scan', row: { count: count.row_id, area: p.dairy.row_id, ...row } })
  await record({ asset: p.chiller.row_id, outcome: 'Damaged' })
  await record({ asset: p.chiller.row_id, outcome: 'Damaged' })
  await record({ outcome: 'Not on the list', description: 'Blue crate stand', reason: 'No tag' })
  const forklift = await p.manager.get<Row>(`/api/table/equipment.asset/${p.forklift.row_id}`)
  await p.save('equipment.asset', { row_id: p.forklift.row_id, updated_at: forklift.updated_at, place: p.enchakkal.row_id })

  renderAssets(p.meena, ['Assets Manager'], `#review=${count.row_id}`)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Move to review' }))
  await screen.findByRole('button', { name: 'Close count' })
  const outcomes = await screen.findByRole('table', { name: 'Outcomes' })
  const cell = (name: string) => within(within(outcomes).getByRole('rowheader', { name }).closest('tr')!).getByRole('cell').textContent
  await waitFor(() => expect(cell('Expected')).toBe('3'))
  expect(cell('Damaged')).toBe('1')
  expect(cell('Missing')).toBe('1')
  expect(cell('Moved since the start')).toBe('1')
  expect(cell('Not on the list')).toBe('1')
  expect(cell('Duplicate')).toBe('1')
  expect(within(screen.getByRole('region', { name: 'Moved since the start' })).getByText(/Godrej forklift/)).toBeInTheDocument()

  const missing = screen.getByRole('region', { name: 'Missing' })
  await user.selectOptions(within(missing).getByRole('combobox', { name: 'Decision for Weighing scale 2' }), 'Recount')
  await user.click(screen.getByRole('button', { name: 'Close count' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Decide every missing and unlisted line before closing')
  await user.selectOptions(within(missing).getByRole('combobox', { name: 'Decision for Weighing scale 2' }), 'To Loss Prevention')
  await user.selectOptions(within(screen.getByRole('region', { name: 'Not on the list' })).getByRole('combobox', { name: 'Decision for Blue crate stand' }), 'Controlled item')
  await waitFor(async () => expect((await p.meena.get<{ data: Row[] }>('/api/table/equipment.count_decision?fields=["decision"]')).data.map(d => d.decision).sort())
    .toEqual(['Controlled item', 'To Loss Prevention']))
  await user.click(screen.getByRole('button', { name: 'Close count' }))
  expect(await screen.findByText('Closed')).toBeInTheDocument()
})

test('an asset’s page shows when it was last verified and how', async ({ createUser }) => {
  const p = await pilot(createUser)
  const count = await startedCount(p)
  await p.suresh.post('/api/save_row', { table: 'equipment.scan', row: { count: count.row_id, asset: p.chiller.row_id, outcome: 'Damaged', area: p.dairy.row_id } })
  renderAssets(p.manager, ['Assets Manager'], `#asset=${p.chiller.row_id}`)
  expect(await screen.findByText(/^Last verified \d{2}-[A-Z][a-z]{2}-\d{4} · Damaged · ATK full count$/)).toBeInTheDocument()
})
