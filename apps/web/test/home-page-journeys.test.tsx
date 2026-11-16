// Home Pages as the way round the Admin (UI-027, #80, #831). Moved from the
// Playwright home-page spec (#1080): the sidebar, the System page's cards and
// All tables, rendered on the real router against the in-process server.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Sql } from 'postgres'
import { tableHref, tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Hpj Task'
const WAIT = { timeout: 8000 }
const pathOf = (r: { router: unknown }) => (r.router as { state: { location: { pathname: string } } }).state.location.pathname

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] })
  await admin.post('/api/save_row', {
    table: 'Dashboard',
    row: { row_id: 'hpj-board', label: 'Hpj Board', config: JSON.stringify({ cards: [{ label: 'All', table: DT }] }) },
  })
  await admin.post('/api/save_row', {
    table: 'Home Page',
    row: {
      row_id: 'hpj-sales',
      label: 'Sales',
      shortcuts: JSON.stringify([
        { label: 'Tasks', type: 'table', link_to: DT },
        { label: 'Board', type: 'dashboard', link_to: 'hpj-board' },
      ]),
    },
  })
}

test('the sidebar shows a Home Page with its icon, and one stored with no label by its id', async ({ admin, db }) => {
  await admin.post('/api/save_row', { table: 'Home Page', row: { row_id: 'hpj-iconed', label: 'Stores', icon: '🏬' } })
  await admin.post('/api/save_row', { table: 'Home Page', row: { row_id: 'hpj-unnamed', label: 'Unnamed' } })
  await (db as Sql)`update home_page set label = '' where row_id = 'hpj-unnamed'`
  await renderApp('/featherbase/admin', admin)
  expect(await screen.findByTestId('home-page-link-hpj-iconed', {}, WAIT)).toHaveTextContent(/^🏬 Stores$/)
  expect(screen.getByTestId('home-page-link-hpj-unnamed')).toHaveTextContent(/^hpj-unnamed$/)
})

test('UI-027: the sidebar opens a Home Page, with its title and shortcuts', async ({ admin }) => {
  await seed(admin)
  const r = await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('home-page-link-hpj-sales', {}, WAIT))
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/admin/home/hpj-sales'))
  expect(await screen.findByTestId('home-page-title', {}, WAIT)).toHaveTextContent(/^Sales$/)
  expect(await screen.findByTestId('shortcut-Tasks')).toBeInTheDocument()
  expect(screen.getByTestId('shortcut-Board')).toBeInTheDocument()
})

test('UI-027: a Table shortcut opens that Table\'s list', async ({ admin }) => {
  await seed(admin)
  const r = await renderApp('/featherbase/admin/home/hpj-sales', admin)
  await userEvent.click(await screen.findByTestId('shortcut-Tasks', {}, WAIT))
  await waitFor(() => expect(pathOf(r)).toBe(`/featherbase/admin/table/${tableSlug(DT)}`))
  expect(await screen.findByTestId('list-view', {}, WAIT)).toBeInTheDocument()
})

test('UI-027: a Dashboard shortcut opens that dashboard', async ({ admin }) => {
  await seed(admin)
  const r = await renderApp('/featherbase/admin/home/hpj-sales', admin)
  await userEvent.click(await screen.findByTestId('shortcut-Board', {}, WAIT))
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/admin/dashboard/hpj-board'))
  expect(await screen.findByTestId('dashboard-title', {}, WAIT)).toBeInTheDocument()
})

test('#80: the Admin opens on the first Home Page the person can see', async ({ admin }) => {
  const first = (await admin.get<{ pages: { row_id: string }[] }>('/api/home_pages')).pages[0].row_id
  const r = await renderApp('/featherbase/admin', admin)
  await waitFor(() => expect(pathOf(r)).toBe(`/featherbase/admin/home/${first}`), WAIT)
})

test('#80: the System page opens from the sidebar, its cards grouped, and a card link opens the Table list', async ({ admin }) => {
  const r = await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('home-page-link-system', {}, WAIT))
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/admin/home/system'))
  expect(await screen.findByTestId('home-page-title', {}, WAIT)).toHaveTextContent(/^System$/)
  expect(await screen.findByTestId('home-card-Users & Access')).toBeInTheDocument()
  await userEvent.click(screen.getByTestId('home-link-Person'))
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/admin/table/person'))
  expect(await screen.findByTestId('list-view', {}, WAIT)).toBeInTheDocument()
})

test('#80: the sidebar holds no Table links; All tables lists them, the System group folded with its count', async ({ admin }) => {
  await seed(admin)
  const r = await renderApp('/featherbase/admin/home/system', admin)
  const sidebar = await screen.findByTestId('admin-sidebar', {}, WAIT)
  await screen.findByTestId('home-page-link-system', {}, WAIT)
  expect(within(sidebar).queryAllByTestId('table-nav')).toHaveLength(0)

  await userEvent.click(screen.getByTestId('all-tables-link'))
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/admin/all-tables'))
  const nav = await screen.findByTestId('table-nav', {}, WAIT)
  expect(await within(nav).findByText(DT, { exact: true }, WAIT)).toBeVisible()
  expect(screen.getByTestId('system-group-count')).not.toHaveTextContent(/^0$/)
  expect(within(nav).queryByText('Role', { exact: true })).toBeNull()
  await userEvent.click(screen.getByTestId('system-group-toggle'))
  expect(within(nav).getByText('Role', { exact: true })).toBeVisible()
})

for (const table of ['Sign In Method', 'Data Source', 'System Settings']) {
  test(`#831: the System page's ${table} link opens its own address`, async ({ admin }) => {
    const r = await renderApp('/featherbase/admin/home/system', admin)
    const link = await screen.findByTestId(`home-link-${table}`, {}, WAIT)
    expect(link).toHaveAttribute('href', tableHref(table))
    await userEvent.click(link)
    await waitFor(() => expect(pathOf(r)).toBe(tableHref(table)))
    expect(await screen.findByTestId(table === 'System Settings' ? 'form-view' : 'list-view', {}, WAIT)).toBeInTheDocument()
  })
}
