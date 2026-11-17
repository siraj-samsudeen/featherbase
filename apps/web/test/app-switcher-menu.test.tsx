// #1236: the application switcher is a menu button. Its menu lists each app the
// person can open, with its icon and what it is for (the app's manifest), the
// current one ticked, and ends with Featherbase Admin after a separator. It is
// worked by keyboard as a menu is. Choosing an app is app-switcher-closed,
// admin-shell-extras and the app-navigation scenarios.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resolve } from 'node:path'
import { discoverPackages } from 'server/src/runtime-packages'
import { admitTasker } from 'server/test/tasker-client'
import { test, expect, renderApp } from './pg-test'
import { appChoices, chooseApp, openSwitcher, switcherButton } from './app-switcher'

const WAIT = { timeout: 10_000 }
type Admin = Parameters<typeof renderApp>[1]

async function withTasker(admin: Admin) {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await admin.post('/api/install_app', { name: 'tasker' })
  await admitTasker(admin)
}

const rows = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLElement>('[data-testid="app-switcher-item"], [role="separator"]')]

test("each app shows its icon and what it is for; the current one is ticked; Featherbase Admin comes last", async ({ admin }) => {
  await withTasker(admin)
  await renderApp('/featherbase/admin', admin)
  await waitFor(async () => expect(await appChoices(screen, WAIT)).toContain('Tasker'), WAIT)
  const { menu } = await openSwitcher(screen, WAIT)
  const tasker = menu.querySelector<HTMLElement>('[data-app="tasker"]')!
  expect(tasker).toHaveTextContent('Tasks and store work, with what is due')
  expect(tasker.querySelector('svg')).not.toBeNull()
  expect(tasker).toHaveAttribute('aria-checked', 'false')
  // The Admin is last, after a separator, and is the one ticked here.
  const order = rows(menu).map((el) => el.getAttribute('role') === 'separator' ? '—' : el.dataset.title)
  expect(order.slice(-2)).toEqual(['—', 'Featherbase'])
  expect(menu.querySelector('[data-app="featherbase-admin"]')).toHaveAttribute('aria-checked', 'true')
})

test('the button names the current app, and the menu is worked by keyboard', async ({ admin }) => {
  await withTasker(admin)
  await renderApp('/featherbase/admin', admin)
  const button = await switcherButton(screen, WAIT)
  expect(button).toHaveAccessibleName('Switch application: Featherbase')
  expect(button).toHaveAttribute('aria-haspopup', 'menu')
  await waitFor(async () => expect(await appChoices(screen, WAIT)).toContain('Tasker'), WAIT)
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('app-switcher-menu')).not.toBeInTheDocument())
  expect(button).toHaveFocus()

  // The down arrow opens it on the current app; the arrows move; Escape closes it.
  fireEvent.keyDown(button, { key: 'ArrowDown' })
  const menu = await screen.findByRole('menu', { name: 'Applications' })
  await waitFor(() => expect(menu.querySelector('[data-app="featherbase-admin"]')).toHaveFocus())
  await userEvent.keyboard('{ArrowDown}')
  expect(within(menu).getAllByRole('menuitemradio')[0]).toHaveFocus()
  await userEvent.keyboard('{ArrowUp}')
  expect(menu.querySelector('[data-app="featherbase-admin"]')).toHaveFocus()
  // Home and End go to the first and the last choice.
  await userEvent.keyboard('{Home}')
  expect(within(menu).getAllByRole('menuitemradio')[0]).toHaveFocus()
  await userEvent.keyboard('{End}')
  expect(menu.querySelector('[data-app="featherbase-admin"]')).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(button).toHaveFocus()
})

test('a click outside closes the menu', async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  await openSwitcher(screen, WAIT)
  fireEvent.mouseDown(document.body)
  await waitFor(() => expect(screen.queryByTestId('app-switcher-menu')).not.toBeInTheDocument())
})

test('choosing the app you are in closes the menu and stays', async ({ admin }) => {
  const r = await renderApp('/featherbase/admin/all-tables', admin)
  await chooseApp(screen, 'Featherbase', WAIT)
  await waitFor(() => expect(screen.queryByTestId('app-switcher-menu')).not.toBeInTheDocument())
  expect((r.router as { state: { location: { pathname: string } } }).state.location.pathname).toBe('/featherbase/admin/all-tables')
})

test("choosing Featherbase from an app's page on the Admin's own address goes to the Admin", async ({ admin }) => {
  const r = await renderApp('/featherbase/sales-target', admin)
  await chooseApp(screen, 'Featherbase', WAIT)
  await waitFor(() => expect((r.router as { state: { location: { pathname: string } } }).state.location.pathname).toMatch(/^\/featherbase\/admin/), WAIT)
})
