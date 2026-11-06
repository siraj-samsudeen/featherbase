import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { discoverPackages } from 'server/src/runtime-packages'
import { getDoc, saveDoc } from 'server/src/document'
import { resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TestClient } from 'feather-testing-postgres'
import { TaskManagementPage } from '../../../example-apps/tasker/src/TaskManagement'
import { localDay } from '../../../example-apps/tasker/src/storeWork'
import { setSession } from '../src/lib/api'
import { test as base, expect } from './pg-test'
import { taskerClient } from '../../server/test/tasker-client'

const test = base.extend<{ admin: TestClient }>({
  admin: async ({ admin }, use) => use(taskerClient(admin)),
})
type Row = { row_id: string; updated_at: string }

function day(offset: number) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return localDay(date)
}

async function install() {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  if (await isInstalled('tasker')) await uninstallApp('tasker')
  await installApp('tasker')
  const admin = await getDoc('Person', 'Administrator', 'Administrator')
  await saveDoc('Person', { ...admin, roles: [...admin.roles as Record<string, unknown>[], { role: 'Tasker Member' }] }, 'Administrator')
}

function renderTasker(as: TestClient) {
  setSession(as.token!, { row_id: as.user!, email: as.user!, full_name: null })
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TaskManagementPage /></QueryClientProvider>)
}

async function storeWork(admin: TestClient) {
  const keel = await admin.post<Row>('/api/save_row', { table: 'tasker.store', row: { store_name: 'Keelkattalai Store' } })
  const avadi = await admin.post<Row>('/api/save_row', { table: 'tasker.store', row: { store_name: 'Avadi Store' } })
  const project = await admin.post<Row>('/api/save_row', { table: 'tasker.project', row: { project_name: 'September stock review' } })
  const task = (task_title: string, row: Record<string, unknown>) =>
    admin.post<Row>('/api/save_row', { table: 'tasker.task', row: { task_title, project: project.row_id, ...row } })
  await task('Archive the count sheets', { store: keel.row_id, is_done: true })
  await task('Reconcile stock variance', { store: keel.row_id, due_date: day(-2) })
  await task('Diwali display change-over', { store: keel.row_id, start_date: day(4) })
  await task('Check the cold room', { store: keel.row_id })
  await task('Price-tag audit', { store: keel.row_id, due_date: day(0) })
  await task('Dropped supplier visit', { store: keel.row_id, task_state: 'Cancelled' })
  await task('Fix the billing printer', { store: avadi.row_id, due_date: day(-1) })
  await task('Plan the next review', {})
  return { keel, avadi, project }
}

test('task details set a store and dates, and the task row shows them', async ({ admin }) => {
  await install()
  const keel = await admin.post<Row>('/api/save_row', { table: 'tasker.store', row: { store_name: 'Keelkattalai Store' } })
  const task = await admin.post<Row>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Reconcile stock variance' } })
  renderTasker(admin)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^Inbox/ }))
  await user.click(await screen.findByRole('link', { name: 'Reconcile stock variance' }))
  const detail = await screen.findByRole('region', { name: 'Task detail content' })
  await user.selectOptions(await within(detail).findByRole('combobox', { name: 'Task store' }), 'Keelkattalai Store')
  await waitFor(async () => expect((await admin.get<{ store: string }>(`/api/table/tasker.task/${task.row_id}`)).store).toBe(keel.row_id))
  await waitFor(() => expect(within(detail).getByLabelText('Due date')).toBeEnabled())
  fireEvent.change(within(detail).getByLabelText('Due date'), { target: { value: day(-2) } })
  await waitFor(async () => expect(String((await admin.get<{ due_date: string }>(`/api/table/tasker.task/${task.row_id}`)).due_date).slice(0, 10)).toBe(day(-2)))
  expect(await within(detail).findByText('Overdue by 2 days')).toBeInTheDocument()
  const row = screen.getByRole('link', { name: 'Reconcile stock variance' }).closest('article')!
  await waitFor(() => expect(row).toHaveTextContent('Keelkattalai Store'))
  expect(within(row).getByText(/^Overdue/)).toBeInTheDocument()
})

test('task details say why a due date before the start date is refused', async ({ admin }) => {
  await install()
  await admin.post<Row>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Reconcile stock variance', start_date: day(4) } })
  renderTasker(admin)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^Inbox/ }))
  await user.click(await screen.findByRole('link', { name: 'Reconcile stock variance' }))
  const detail = await screen.findByRole('region', { name: 'Task detail content' })
  expect(await within(detail).findByText(/^Scheduled/)).toBeInTheDocument()
  fireEvent.change(within(detail).getByLabelText('Due date'), { target: { value: day(1) } })
  expect(await within(detail).findByRole('alert')).toHaveTextContent('The due date can’t be before the start date')
})

test('the Stores page counts each store’s work and opens the tasks behind a number', async ({ admin }) => {
  await install()
  await storeWork(admin)
  renderTasker(admin)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Stores' }))
  const table = await screen.findByRole('table', { name: 'Work by store' })
  const cells = (name: string) => within(within(table).getByRole('rowheader', { name }).closest('tr')!).getAllByRole('cell').map(cell => cell.textContent)
  await waitFor(() => expect(cells('Keelkattalai Store')).toEqual(['5', '2', '1', '1', '1']))
  expect(cells('Avadi Store')).toEqual(['1', '0', '0', '1', '0'])
  expect(cells('No store')).toEqual(['1', '1', '0', '0', '0'])
  expect(cells('All stores')).toEqual(['7', '3', '1', '2', '1'])
  await user.click(within(table).getByRole('button', { name: 'Keelkattalai Store: 1 overdue task' }))
  const list = await screen.findByRole('region', { name: 'Keelkattalai Store · Overdue' })
  expect(within(list).getByRole('link', { name: 'Reconcile stock variance' })).toBeInTheDocument()
  expect(within(list).queryByRole('link', { name: 'Fix the billing printer' })).not.toBeInTheDocument()
  expect(within(list).queryByRole('link', { name: 'Check the cold room' })).not.toBeInTheDocument()
})

test('a member adds a store from the Stores page', async ({ admin }) => {
  await install()
  renderTasker(admin)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Stores' }))
  await user.type(await screen.findByRole('textbox', { name: 'New store' }), 'Manimangalam WH')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Store type' }), 'Warehouse')
  await user.click(screen.getByRole('button', { name: 'Add store' }))
  const table = await screen.findByRole('table', { name: 'Work by store' })
  expect(await within(table).findByRole('rowheader', { name: 'Manimangalam WH' })).toBeInTheDocument()
  const stores = await admin.get<{ data: { store_name: string; store_type: string }[] }>('/api/table/tasker.store?fields=["store_name","store_type"]')
  expect(stores.data).toEqual([{ store_name: 'Manimangalam WH', store_type: 'Warehouse' }])
})

test('task filters narrow a list by store and by when tasks are due', async ({ admin }) => {
  await install()
  const { project } = await storeWork(admin)
  renderTasker(admin)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'September stock review' }))
  const printer = (await screen.findByRole('link', { name: 'Fix the billing printer' })).closest('article')!
  await waitFor(() => expect(printer).toHaveTextContent('Avadi Store'))
  await user.click(screen.getByRole('button', { name: /^Filter/ }))
  const filters = await screen.findByRole('dialog', { name: 'Filter tasks' })
  await user.click(within(within(filters).getByRole('group', { name: 'Due' })).getByRole('checkbox', { name: 'Overdue' }))
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Check the cold room' })).not.toBeInTheDocument())
  expect(screen.getByRole('link', { name: 'Reconcile stock variance' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Fix the billing printer' })).toBeInTheDocument()
  await user.click(within(within(filters).getByRole('group', { name: 'Store' })).getByRole('checkbox', { name: 'Avadi Store' }))
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Reconcile stock variance' })).not.toBeInTheDocument())
  expect(screen.getByRole('link', { name: 'Fix the billing printer' })).toBeInTheDocument()
  expect(project.row_id).toBeTruthy()
})
