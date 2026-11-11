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

function renderAssets(as: TestClient, roles: string[], hash = '') {
  setSession(as.token!, { row_id: as.user!, email: as.user!, full_name: null })
  location.hash = hash
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AssetsApp roles={roles} />
  </QueryClientProvider>)
}

async function pilot(createUser: (options: { roles: string[]; fullName?: string }) => Promise<TestClient>) {
  expect(await discoverPackages([resolve('../..', 'client-apps/jeyarama/equipment')])).toEqual([])
  if (await isInstalled('equipment')) await uninstallApp('equipment')
  await installApp('equipment')
  const person = async (fullName: string, ...roles: string[]) => assetsClient(await createUser({ roles: ['Assets Member', ...roles], fullName }))
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'], fullName: 'Pilot lead' }))
  const ravi = await person('Ravi'), meena = await person('Meena'), senthil = await person('Senthil')
  const accountant = await person('Anand', 'Assets Accountant'), controller = await person('Lakshmi', 'Assets Finance Controller')
  const save = (table: string, row: Record<string, unknown>, as: TestClient = manager) => as.post<Row>('/api/save_row', { table, row })
  await save('equipment.finance_person', { person: accountant.user, finance_role: 'Asset accountant' })
  await save('equipment.finance_person', { person: controller.user, finance_role: 'Finance controller' })
  const atk = await save('equipment.place', { place_name: 'ATK 1501', place_level: 'Site', sap_plant: '1501', site_manager: senthil.user })
  const dairy = await save('equipment.place', { place_name: 'Dairy', place_level: 'Area', parent_place: atk.row_id, area_code: 'ATK-GF-A03' })
  const cold = await save('equipment.asset_class', { class_name: 'Refrigeration and cold chain', sap_class_code: '3300' })
  const chiller = await save('equipment.asset_type', { type_name: 'Display chiller', asset_class: cold.row_id, sticker: 'Freezer-grade', counting_note: 'Outside the door' })
  await save('equipment.tag_roll', { roll_name: 'Freezer-grade roll 1', sticker: 'Freezer-grade', first_no: 101, last_no: 200, team: 'Team A' })
  const count = await save('equipment.count', { count_name: 'ATK 1501 fresh count', scope_place: atk.row_id, count_kind: 'Fresh inventory', reviewer: manager.user })
  for (const counter of [ravi, meena]) await save('equipment.counter', { count: count.row_id, person: counter.user })
  await manager.post('/api/app_actions/equipment/start_count', { idempotencyKey: crypto.randomUUID(),
    payload: { row_id: count.row_id, updated_at: (await manager.get<Row>(`/api/table/equipment.count/${count.row_id}`)).updated_at } })
  const line = (tag_no: string) => save('equipment.count_line', { count: count.row_id, place: dairy.row_id, tag_status: 'Tagged', tag_no, asset_type: chiller.row_id,
    asset_name: '3-door upright chiller', serial_no: 'BS23K44871', tagged_by: ravi.user }, meena)
  return { manager, ravi, meena, senthil, accountant, controller, save, atk, dairy, count, line }
}

test('labels print by roll range with the group line, the do-not-remove line, the tag in large print and its QR code', async ({ createUser }) => {
  const p = await pilot(createUser)
  renderAssets(p.manager, ['Assets Manager'], '#labels')
  const user = userEvent.setup()
  const log = await screen.findByRole('table', { name: 'Tag roll log' })
  expect(await within(log).findByRole('rowheader', { name: 'Freezer-grade roll 1' })).toBeInTheDocument()
  expect(within(log).getByText('JRA-000101 to JRA-000200')).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Print from' }), 'JRA-000101')
  await user.type(screen.getByRole('textbox', { name: 'Print to' }), 'JRA-000103')
  const sheet = screen.getByRole('region', { name: 'Label sheet' })
  const label = within(sheet).getByRole('article', { name: 'Label JRA-000101' })
  expect(label).toHaveTextContent('Jeyarama Group property')
  expect(label).toHaveTextContent('Please do not remove')
  expect(await within(label).findByRole('img', { name: 'QR code for JRA-000101' })).toBeInTheDocument()
  expect(within(sheet).getAllByRole('article')).toHaveLength(3)
  expect(sheet).not.toHaveTextContent('ATK 1501')
})

test('a counter records a line with both initials and the site manager closes the area', async ({ createUser }) => {
  const p = await pilot(createUser)
  const counter = renderAssets(p.meena, ['Assets Member'], `#count=${p.count.row_id}`)
  let user = userEvent.setup()
  await screen.findByRole('option', { name: /ATK-GF-A03/ })
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Area' }), p.dairy.row_id)
  const form = await screen.findByRole('form', { name: 'Count line' })
  await user.type(within(form).getByRole('textbox', { name: 'Tag' }), 'JRA-000123')
  await within(form).findByRole('option', { name: 'Display chiller' })
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Asset type' }), 'Display chiller')
  expect(within(form).getByText(/Refrigeration and cold chain · sticker: Freezer-grade · Outside the door/)).toBeInTheDocument()
  await user.type(within(form).getByRole('textbox', { name: 'Description' }), '3-door upright chiller')
  await user.type(within(form).getByRole('textbox', { name: 'Serial' }), 'BS23K44871')
  await within(within(form).getByRole('combobox', { name: 'Tagged by' })).findByRole('option', { name: 'Ravi' })
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Tagged by' }), 'Ravi')
  await user.click(within(form).getByRole('button', { name: 'Record line' }))
  const lines = await screen.findByRole('table', { name: 'Count lines' })
  const row = (await within(lines).findByText('JRA-000123')).closest('tr')!
  expect(row).toHaveTextContent('Tagged Ravi · recorded Meena')
  counter.unmount()

  renderAssets(p.senthil, ['Assets Member'], `#count=${p.count.row_id}`)
  user = userEvent.setup()
  await screen.findByRole('option', { name: /ATK-GF-A03/ })
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Area' }), p.dairy.row_id)
  const close = await screen.findByRole('region', { name: 'Close the area' })
  await waitFor(() => expect(close).toHaveTextContent('Today: 1 tagged line, 0 lines without a group tag, 0 spoiled labels.'))
  await user.type(within(close).getByRole('spinbutton', { name: 'Labels used' }), '2')
  await user.click(within(close).getByRole('button', { name: 'Sign as site manager' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('2 labels used, but 1 tagged line and 0 spoiled labels: find the difference before signing')
  await user.clear(within(close).getByRole('spinbutton', { name: 'Labels used' }))
  await user.type(within(close).getByRole('spinbutton', { name: 'Labels used' }), '1')
  await user.click(within(close).getByRole('button', { name: 'Sign as site manager' }))
  expect(await within(close).findByText('Signed for today.')).toBeInTheDocument()
})

test('the asset accountant pastes the SAP book, matches a tag by serial and sees the reconciliation', async ({ createUser }) => {
  const p = await pilot(createUser)
  await p.line('JRA-000123')
  renderAssets(p.accountant, ['Assets Member', 'Assets Accountant'], '#sap')
  const user = userEvent.setup()
  const paste = await screen.findByRole('form', { name: 'Paste the SAP extract' })
  await user.type(within(paste).getByRole('textbox', { name: 'SAP extract rows' }), '200014\t0\tChiller 3-door\t3300\t12-03-2023\t142000\t1\tBS23K44871')
  await user.click(within(paste).getByRole('button', { name: 'Load rows' }))
  const book = await screen.findByRole('table', { name: 'SAP book' })
  const record = (await within(book).findByRole('rowheader', { name: '200014-0' })).closest('tr')!
  expect(record).toHaveTextContent('Not found yet')
  expect(record).toHaveTextContent('₹1,42,000')
  await user.click(within(record).getByRole('button', { name: 'Match tags' }))
  const match = screen.getByRole('form', { name: 'Match tags' })
  await user.type(within(match).getByRole('textbox', { name: 'Tags' }), 'JRA-000123')
  await waitFor(() => expect(within(match).getByRole('button', { name: 'Match' })).toBeEnabled())
  await user.click(within(match).getByRole('button', { name: 'Match' }))
  await waitFor(() => expect(within(screen.getByRole('table', { name: 'SAP book' })).getByRole('rowheader', { name: '200014-0' }).closest('tr')).toHaveTextContent('Found'), { timeout: 8000 })
  const figures = screen.getByRole('group', { name: 'Reconciliation' })
  await waitFor(() => expect(figures).toHaveTextContent('Book match rate100%'), { timeout: 8000 })
  expect(figures).toHaveTextContent('Tag coverage100%')
})

test('a Finance Controller approves an exception the asset accountant raised, with its reference', async ({ createUser }) => {
  const p = await pilot(createUser)
  await p.save('equipment.exception', { outcome: 'In books, not found', sap_asset_no: '200081-0', detail: 'EAS gate pair not found in any area', owner: p.senthil.user }, p.accountant)
  renderAssets(p.controller, ['Assets Member', 'Assets Finance Controller'], '#exceptions')
  const user = userEvent.setup()
  const log = await screen.findByRole('table', { name: 'Exceptions log' })
  const row = (await within(log).findByText(/EAS gate pair not found/)).closest('tr')!
  await user.type(within(row).getByRole('textbox', { name: 'Approval reference' }), 'FC/ATK/001')
  await user.click(within(row).getByRole('button', { name: 'Approve' }))
  await waitFor(() => expect(within(screen.getByRole('table', { name: 'Exceptions log' })).getByText(/EAS gate pair/).closest('tr')).toHaveTextContent('Approved'))
  expect(within(screen.getByRole('table', { name: 'Exceptions log' })).getByText(/EAS gate pair/).closest('tr')).toHaveTextContent('FC/ATK/001 · Lakshmi')
})
