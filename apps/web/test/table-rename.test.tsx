// #871: a System Manager renames a custom Table from its list. Its rows come
// along, and the old address says where the Table went.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { holdResponses } from './held-requests'

type Admin = Parameters<typeof renderApp>[1]
const OLD = 'Twr SAP Plant'
const NEW = 'Twr Plant'
const pathOf = (r: { router: unknown }) => (r.router as { state: { location: { pathname: string } } }).state.location.pathname

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: OLD, columns: [{ column_name: 'city', column_type: 'Data', label: 'City' }] })
  await admin.post('/api/save_row', { table: OLD, row: { city: 'Chennai' } })
}

test('renaming a Table from its list opens it under the new name, with its rows', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  const app = await renderApp('/featherbase/admin/table/twr-sap-plant', admin)
  await user.click(await screen.findByRole('button', { name: 'Table administration' }))
  await user.click(await screen.findByTestId('rename-table', undefined, { timeout: 10_000 }))
  const dialog = await screen.findByTestId('rename-table-dialog')
  expect(dialog).toHaveTextContent(`Rename ${OLD}`)
  const input = within(dialog).getByTestId('rename-table-input')
  expect(input).toHaveValue(OLD)
  await user.clear(input)
  await user.type(input, NEW)
  await user.click(within(dialog).getByTestId('rename-table-confirm'))

  await waitFor(() => expect(pathOf(app)).toBe('/featherbase/admin/table/twr-plant'))
  expect(await screen.findByRole('heading', { level: 1, name: NEW }, { timeout: 10_000 })).toBeInTheDocument()
  expect(await screen.findByText('Chennai', undefined, { timeout: 10_000 })).toBeInTheDocument()
})

test('the list just opened stays in recently opened under the new name', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp('/featherbase/admin/table/twr-sap-plant', admin)
  await user.click(await screen.findByRole('button', { name: 'Table administration' }))
  await user.click(await screen.findByTestId('rename-table', undefined, { timeout: 10_000 }))
  const input = screen.getByTestId('rename-table-input')
  await user.clear(input)
  await user.type(input, NEW)
  await user.click(screen.getByTestId('rename-table-confirm'))
  await screen.findByRole('heading', { level: 1, name: NEW }, { timeout: 10_000 })
  const cached = JSON.parse(localStorage.getItem(`fc-recents:${admin.user}`) ?? '[]') as { key: string; label: string; path: string }[]
  expect(cached.map((e) => e.key)).not.toContain(`list:${OLD}?`)
  expect(cached).toContainEqual(expect.objectContaining({ key: `list:${NEW}?`, label: NEW, path: '/featherbase/admin/table/twr-plant' }))
})

test('a name already in use is refused in the dialog, and nothing changes', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await admin.post('/api/table_def', { name: NEW, columns: [{ column_name: 'code', column_type: 'Data' }] })
  await renderApp('/featherbase/admin/table/twr-sap-plant', admin)
  await user.click(await screen.findByRole('button', { name: 'Table administration' }))
  await user.click(await screen.findByTestId('rename-table', undefined, { timeout: 10_000 }))
  const input = screen.getByTestId('rename-table-input')
  await user.clear(input)
  await user.type(input, NEW)
  await user.click(screen.getByTestId('rename-table-confirm'))
  expect(await screen.findByTestId('rename-table-error')).toHaveTextContent(`Table ${NEW} already exists`)
  expect(screen.getByTestId('rename-table-dialog')).toBeInTheDocument()
  expect(await admin.get(`/api/table/${encodeURIComponent(OLD)}:meta`)).toMatchObject({ name: OLD })
})

test('the old address says the Table was renamed and links to it', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await admin.post(`/api/table_def/${encodeURIComponent(OLD)}/rename`, { to: NEW })
  const app = await renderApp('/featherbase/admin/table/twr-sap-plant', admin)
  const moved = await screen.findByTestId('table-renamed', undefined, { timeout: 10_000 })
  expect(moved).toHaveTextContent(`${OLD} is now called ${NEW}`)
  expect(moved).toHaveTextContent('Renamed by Administrator on')
  await user.click(within(moved).getByRole('link', { name: `Open ${NEW}` }))
  await waitFor(() => expect(pathOf(app)).toBe('/featherbase/admin/table/twr-plant'))
})

test('a platform Table offers no Rename', async ({ admin }) => {
  await renderApp('/featherbase/admin/table/comment', admin)
  await screen.findByTestId('list-view', undefined, { timeout: 10_000 })
  expect(screen.queryByTestId('rename-table')).not.toBeInTheDocument()
})

async function openRename(admin: Admin) {
  await seed(admin)
  await renderApp('/featherbase/admin/table/twr-sap-plant', admin)
  await userEvent.click(await screen.findByRole('button', { name: 'Table administration' }, { timeout: 10_000 }))
  await userEvent.click(await screen.findByTestId('rename-table', undefined, { timeout: 10_000 }))
  return screen.findByTestId('rename-table-dialog')
}

test('Cancel closes the Rename dialog, renaming nothing', async ({ admin }) => {
  const dialog = await openRename(admin)
  await userEvent.click(within(dialog).getByTestId('rename-table-cancel'))
  expect(screen.queryByTestId('rename-table-dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: OLD })).toBeInTheDocument()
})

test('a click outside the Rename dialog while it renames keeps it open', async ({ admin }) => {
  const dialog = await openRename(admin)
  const input = within(dialog).getByTestId('rename-table-input')
  await userEvent.clear(input)
  await userEvent.type(input, NEW)
  const renaming = holdResponses('/rename')
  await userEvent.click(within(dialog).getByTestId('rename-table-confirm'))
  await renaming.asked
  await userEvent.click(dialog.parentElement!)
  expect(screen.getByTestId('rename-table-dialog')).toBeInTheDocument()
  await act(async () => { renaming.release() })
  expect(await screen.findByRole('heading', { level: 1, name: NEW }, { timeout: 10_000 })).toBeInTheDocument()
})
