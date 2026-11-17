// #1248: collapsed, the Admin sidebar is an icon rail, never hidden; its control
// is the sidebar's own footer row and edge. Real Admin in jsdom against the
// in-process server; pixels are the verifier's.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const T = { timeout: 10_000 }
const DEPT = 'Rail Department'
beforeEach(() => localStorage.clear())

const aside = () => screen.getByTestId('admin-sidebar')
const collapsed = () => aside().hasAttribute('data-collapsed')

test('the control is the sidebar footer, not the top bar, and collapsing leaves a rail', async ({ admin }) => {
  await renderApp('/featherbase/admin/all-tables', admin)
  const control = await screen.findByTestId('sidebar-collapse', {}, T)
  expect(aside()).toContainElement(control)
  expect(screen.getByTestId('top-bar')).not.toContainElement(control)
  expect(control).toHaveAccessibleName('Collapse sidebar')

  await userEvent.click(control)
  expect(collapsed()).toBe(true)
  // A rail: not hidden away at any width.
  expect(aside().className).not.toMatch(/\bmd:hidden\b/)
  expect(aside()).not.toHaveAttribute('aria-hidden')
  expect(control).toHaveAccessibleName('Expand sidebar')
  expect(within(aside()).getByRole('link', { name: 'All tables' })).toBeInTheDocument()

  await userEvent.click(screen.getByTestId('sidebar-edge'))
  expect(collapsed()).toBe(false)
})

test('in the rail a link is named at once by a tooltip; open, it is not', async ({ admin }) => {
  await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('sidebar-collapse', {}, T)
  const link = within(aside()).getByRole('link', { name: 'Glossary' })
  fireEvent.pointerOver(link)
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

  await userEvent.click(screen.getByTestId('sidebar-collapse'))
  fireEvent.pointerOver(link)
  expect(screen.getByRole('tooltip')).toHaveTextContent('Glossary')
  fireEvent.pointerOut(link)
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
})

test('a module without an emoji of its own shows its initials in the rail', async ({ admin }) => {
  await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('sidebar-collapse', {}, T)
  expect(await screen.findByTestId('home-page-link-system', {}, T)).toHaveAttribute('data-rail-mark', 'Sy')
})

test('Saved views fold into one icon in the rail, whose menu opens a view', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: DEPT, id_pattern: 'prompt', title_column: 'dept_name',
    columns: [{ column_name: 'dept_name', column_type: 'Data', label: 'Department', in_list_view: true },
      { column_name: 'store', column_type: 'Data', label: 'Store', in_list_view: true }],
  })
  await admin.post('/api/saved_views', { table: DEPT, label: 'ATK Departments', filters: [['store', '=', 'Attakulangara']], shared: true })
  await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('sidebar-saved-views', {}, T)
  await userEvent.click(screen.getByTestId('sidebar-collapse'))

  const fold = within(aside()).getByRole('button', { name: 'Saved views' })
  expect(fold).toHaveAttribute('aria-haspopup', 'menu')
  await userEvent.click(fold)
  const menu = screen.getByRole('menu', { name: 'Saved views' })
  await userEvent.click(within(menu).getByRole('menuitem', { name: /ATK Departments/ }))
  // The view's list, with its one filter on.
  expect(await screen.findByTestId('table-page', {}, T)).toBeInTheDocument()
  const [chip, ...more] = await screen.findAllByTestId('filter-chip', {}, T)
  expect(more).toHaveLength(0)
  expect(chip).toHaveTextContent('Attakulangara')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})
