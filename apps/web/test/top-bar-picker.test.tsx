// #642 (design E8): an app's declared bar control. On the app's address the
// shared top bar draws a picker after the app's name, filled from the app's
// own read under the reader's scope, and keeps the choice in the address.
// The fixture `runtime-apps/fixtures/bar-proof` declares
// `{ picker: 'Store', options: 'stores', sets: 'store' }`; its `stores` read
// answers the reader's places from `runtime-apps/fixtures/place-roster`.
// Widths, pixels and real focus rings are in e2e/top-bar-picker.spec.ts.
import { resolve } from 'node:path'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach } from 'vitest'
import { ACCOUNT_SIGN_IN_METHODS_PATH } from 'shared'
import { config } from 'server/src/config'
import { parseInstanceAddresses } from 'server/src/instance-addresses'
import { discoverPackages } from 'server/src/runtime-packages'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test, expect, renderApp } from './pg-test'

const BAR_PROOF = resolve('../..', 'runtime-apps/fixtures/bar-proof')
const ROSTER = resolve('../..', 'runtime-apps/fixtures/place-roster')

afterEach(() => {
  config.instanceAddresses = null
})

/** The in-process server is reached as `localhost`: list it as this address. */
function onAddressThatOpens(opens: string) {
  config.instanceAddresses = parseInstanceAddresses(
    JSON.stringify([
      { address: 'http://localhost', opens, emails: true },
      { address: 'http://elsewhere.example.test', opens: opens === 'admin' ? 'barproof' : 'admin' },
    ]),
    'test',
  )
}

/** bar-proof installed, and a Bar Reader responsible for `places` ([place, store]). */
async function readerOf(admin: TestClient, createUser: CreateUserFn, places: [string, string][]) {
  expect(await discoverPackages([BAR_PROOF, ROSTER])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  await admin.post('/api/install_app', { name: 'placeroster' })
  const reader = await createUser({ email: `bar-reader-${places.length}@example.test`, roles: ['Bar Reader'] })
  for (const [place, store] of places)
    await admin.post('/api/save_row', {
      table: 'placeroster.position',
      row: { row_id: `${reader.user}-${store}`, person: reader.user, place, store, section: 'all' },
    })
  return reader
}

// Listed in the order the roster's read answers them: by place name.
const STORES: [string, string][] = [['Hill Road', 'S102'], ['Lake View', 'S103'], ['Riverside', 'S101']]

type Router = Awaited<ReturnType<typeof renderApp>>['router']
/** The router's own history: the memory history the page navigates in. */
const routerHistory = (router: Router) => (router as unknown as { history: { back(): void } }).history
const locationOf = (router: Router) => {
  const { pathname, searchStr } = (router.state as { location: { pathname: string; searchStr: string } }).location
  return `${pathname}${searchStr}`
}

const picker = () => screen.findByRole('combobox', { name: 'Store' })

test("on the app's address the bar draws the declared picker, named by its label", async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  const store = await picker()
  expect(screen.getByTestId('top-bar')).toContainElement(store)
})

test("the picker sits after the app's name, before the Account menu", async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  const store = await picker()
  const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
  expect([before(screen.getByTestId('top-bar-name'), store), before(store, screen.getByTestId('session-user'))]).toEqual([true, true])
})

test("the picker offers the reader's own options, in the order the app's read gives them", async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  const { controls } = await reader.get<{ controls: { options: { label: string }[] }[] }>('/api/app_bar/barproof')
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  await userEvent.click(await picker())
  const listbox = await screen.findByRole('listbox', { name: 'Store' })
  expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual(controls[0].options.map((o) => o.label))
})

test('with exactly one option the bar shows it as plain text, with no picker', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, [['Riverside', 'S101']])
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  const bar = await screen.findByTestId('top-bar')
  expect(await within(bar).findByText('Riverside')).toBeInTheDocument()
  expect(within(bar).queryByRole('combobox')).not.toBeInTheDocument()
})

/** Long enough for the bar's own request to have answered. */
const settle = () => new Promise((done) => setTimeout(done, 150))

test('with no options the control is not shown', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, [])
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  await screen.findByTestId('session-user')
  await settle()
  expect(within(screen.getByTestId('top-bar')).queryByText('Store')).not.toBeInTheDocument()
})

test("on the Admin address the bar draws no app's picker", async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('admin')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  await screen.findByTestId('session-user')
  await settle()
  expect(screen.queryByRole('combobox', { name: 'Store' })).not.toBeInTheDocument()
})

test('with no choice in the address the picker shows the first option', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  await waitFor(async () => expect(await picker()).toHaveTextContent('Hill Road'))
})

test('the choice in the address is the value the picker shows', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  await renderApp(`${ACCOUNT_SIGN_IN_METHODS_PATH}?store=S103`, reader)
  await waitFor(async () => expect(await picker()).toHaveTextContent('Lake View'))
})

test('the current option is marked selected in the list', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  await renderApp(`${ACCOUNT_SIGN_IN_METHODS_PATH}?store=S103`, reader)
  await userEvent.click(await picker())
  const listbox = await screen.findByRole('listbox', { name: 'Store' })
  expect(within(listbox).getByRole('option', { selected: true })).toHaveTextContent('Lake View')
})

test('choosing an option puts it in the address, inside the page', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  const { router } = await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  await userEvent.click(await picker())
  await userEvent.click(await screen.findByRole('option', { name: 'Lake View' }))
  await waitFor(() => expect(locationOf(router)).toBe(`${ACCOUNT_SIGN_IN_METHODS_PATH}?store=S103`))
  expect(await picker()).toHaveTextContent('Lake View')
})

test('back steps to the earlier choice', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  const { router } = await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  for (const name of ['Lake View', 'Riverside']) {
    await userEvent.click(await picker())
    await userEvent.click(await screen.findByRole('option', { name }))
  }
  await waitFor(() => expect(locationOf(router)).toBe(`${ACCOUNT_SIGN_IN_METHODS_PATH}?store=S101`))
  routerHistory(router).back()
  await waitFor(async () => expect(await picker()).toHaveTextContent('Lake View'))
})

test('the arrow keys and Enter choose an option', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  const { router } = await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  ;(await picker()).focus()
  await userEvent.keyboard('{ArrowDown}')
  await screen.findByRole('listbox', { name: 'Store' })
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await waitFor(() => expect(locationOf(router)).toBe(`${ACCOUNT_SIGN_IN_METHODS_PATH}?store=S103`))
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('the active option is announced on the picker as the arrow keys move it', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  const store = await picker()
  store.focus()
  await userEvent.keyboard('{ArrowDown}{ArrowDown}')
  expect(document.getElementById(store.getAttribute('aria-activedescendant') ?? '')).toHaveTextContent('Lake View')
})

test('Escape closes the list and leaves focus on the picker', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  const store = await picker()
  await userEvent.click(store)
  await screen.findByRole('listbox', { name: 'Store' })
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(store).toHaveFocus()
})
