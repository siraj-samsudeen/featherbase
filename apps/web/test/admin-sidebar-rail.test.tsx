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
  // #1251's keyboard-shortcut list finds it by these.
  expect(control).toHaveAttribute('data-shortcut-id', 'sidebar')
  expect(control.getAttribute('data-shortcut-key')).toMatch(/^(⌘B|Ctrl\+B)$/)

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

test('a fold menu works by keyboard, and a click outside closes it', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: DEPT, id_pattern: 'prompt', title_column: 'dept_name',
    columns: [{ column_name: 'dept_name', column_type: 'Data', label: 'Department', in_list_view: true },
      { column_name: 'store', column_type: 'Data', label: 'Store', in_list_view: true }],
  })
  await admin.post('/api/saved_views', { table: DEPT, label: 'ATK Departments', filters: [['store', '=', 'Attakulangara']], shared: true })
  await admin.post('/api/saved_views', { table: DEPT, label: 'Lakeside Departments', filters: [['store', '=', 'Lakeside']], shared: true })
  await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('sidebar-saved-views', {}, T)
  await userEvent.click(screen.getByTestId('sidebar-collapse'))
  const fold = within(aside()).getByRole('button', { name: 'Saved views' })

  // The right arrow opens it on its first item; the arrows move; Escape returns to the icon.
  fold.focus()
  fireEvent.keyDown(fold, { key: 'ArrowRight' })
  const menu = await screen.findByRole('menu', { name: 'Saved views' })
  const [first, second] = within(menu).getAllByRole('menuitem')
  await waitFor(() => expect(first).toHaveFocus())
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(second).toHaveFocus()
  fireEvent.keyDown(menu, { key: 'ArrowUp' })
  expect(first).toHaveFocus()
  fireEvent.keyDown(menu, { key: 'Escape' })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(fold).toHaveFocus()

  await userEvent.click(fold)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()

  await userEvent.click(fold)
  fireEvent.pointerDown(document.body)
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
})

test('Recently opened folds into one icon in the rail, and its menu opens the place again', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: DEPT, id_pattern: 'prompt', title_column: 'dept_name',
    columns: [{ column_name: 'dept_name', column_type: 'Data', label: 'Department', in_list_view: true }],
  })
  const { router } = await renderApp(`/featherbase/admin/table/rail-department`, admin)
  await screen.findByTestId('table-page', {}, T)
  const nav = router as unknown as { navigate: (to: { href: string }) => Promise<void>; state: { location: { pathname: string } } }
  await nav.navigate({ href: '/featherbase/admin/all-tables' })
  await screen.findByTestId('sidebar-recents', {}, T)
  await userEvent.click(screen.getByTestId('sidebar-collapse'))
  await userEvent.click(within(aside()).getByRole('button', { name: 'Recently opened' }))
  await userEvent.click(within(screen.getByRole('menu', { name: 'Recently opened' })).getByRole('menuitem', { name: new RegExp(DEPT) }))
  await waitFor(() => expect(nav.state.location.pathname).toBe('/featherbase/admin/table/rail-department'), T)
})

// Owner's review (17-Nov): the tooltip read "SySystem", the initials tile and the name together.
test("a module's tooltip is its name alone, not its initials too", async ({ admin }) => {
  await renderApp('/featherbase/admin/all-tables', admin)
  const system = await screen.findByTestId('home-page-link-system', {}, T)
  await userEvent.click(screen.getByTestId('sidebar-collapse'))
  fireEvent.pointerOver(system)
  expect(screen.getByRole('tooltip')).toHaveTextContent(/^System$/)
  expect(system).toHaveAccessibleName('System')
})

// Owner's review (17-Nov): in the rail the "+" menu was clipped by the narrow sidebar.
test('in the rail, + opens its New menu outside the sidebar, and New table opens', async ({ admin }) => {
  const { router } = await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('sidebar-new', {}, T)
  await userEvent.click(screen.getByTestId('sidebar-collapse'))
  await userEvent.click(within(aside()).getByRole('button', { name: 'New' }))
  const menu = screen.getByRole('menu', { name: 'New' })
  // Drawn in the page, not inside the rail that would clip it.
  expect(aside()).not.toContainElement(menu)
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'New table' }))
  await waitFor(() => expect((router as unknown as { state: { location: { pathname: string } } }).state.location.pathname).toBe('/featherbase/admin/new-table'), T)
})
