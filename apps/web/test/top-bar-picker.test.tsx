// #642 (design E8): an app's declared bar control. On the app's address the
// shared top bar draws a picker after the app's name, filled from the app's
// own read under the reader's scope, and keeps the choice in the address.
// The fixture `test-apps/fixtures/bar-proof` declares
// `{ picker: 'Store', options: 'stores', sets: 'store' }`; its `stores` read
// answers the reader's places from `test-apps/fixtures/place-roster`.
// Widths, pixels and the focus ring's look are layout checks, not tested
// here (#1080).
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { ACCOUNT_SIGN_IN_METHODS_PATH } from 'shared'
import { config } from 'server/src/config'
import { parseInstanceAddresses } from 'server/src/instance-addresses'
import { discoverPackages } from 'server/src/runtime-packages'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test, expect, renderApp } from './pg-test'

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const ROSTER = resolve('../..', 'test-apps/fixtures/place-roster')

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

// The next three moved from e2e/top-bar-picker.spec.ts (#1080).
test("Tab from the app's name reaches the picker", async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  const store = await picker()
  screen.getByTestId('top-bar-name').focus()
  await userEvent.tab()
  expect(store).toHaveFocus()
})

test('Home, End, PageUp, PageDown and the arrows move within the list, stopping at each end, and change no choice', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  const { router } = await renderApp(`${ACCOUNT_SIGN_IN_METHODS_PATH}?store=S103`, reader)
  const store = await picker()
  store.focus()
  await userEvent.keyboard('{ArrowDown}')
  await screen.findByRole('listbox', { name: 'Store' })
  const active = () => document.getElementById(store.getAttribute('aria-activedescendant') ?? '')?.textContent
  const moves: [string, string][] = [
    ['{End}', 'Riverside'],
    ['{ArrowDown}', 'Riverside'],
    ['{ArrowUp}', 'Lake View'],
    ['{Home}', 'Hill Road'],
    ['{ArrowUp}', 'Hill Road'],
    ['{PageDown}', 'Riverside'],
    ['{PageUp}', 'Hill Road'],
  ]
  for (const [key, name] of moves) {
    await userEvent.keyboard(key)
    expect([key, active()]).toEqual([key, name])
    expect(locationOf(router)).toBe(`${ACCOUNT_SIGN_IN_METHODS_PATH}?store=S103`)
  }
})

test('Tab out of the open list closes it, moves focus on and keeps the choice', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  const { router } = await renderApp(`${ACCOUNT_SIGN_IN_METHODS_PATH}?store=S103`, reader)
  const store = await picker()
  store.focus()
  await userEvent.keyboard('{ArrowDown}')
  await screen.findByRole('listbox', { name: 'Store' })
  await userEvent.keyboard('{Home}')
  await userEvent.tab()
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(store).not.toHaveFocus()
  expect(store).toHaveTextContent('Lake View')
  expect(locationOf(router)).toBe(`${ACCOUNT_SIGN_IN_METHODS_PATH}?store=S103`)
})

// Codex round 1 on #658: two declared controls, both missing from the address,
// must not overwrite each other when each writes its first option in place.
test('two declared controls missing from the address both get their first option', async ({ admin, createUser }) => {
  const copy = await mkdtemp(resolve('test/.b650-two-controls-'))
  try {
    await cp(BAR_PROOF, copy, { recursive: true })
    const file = resolve(copy, 'featherbase.json')
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    manifest.bar = [...manifest.bar, { picker: 'Region', options: 'stores', sets: 'region' }]
    await writeFile(file, JSON.stringify(manifest))
    expect(await discoverPackages([copy, ROSTER])).toEqual([])
    await admin.post('/api/install_app', { name: 'barproof' })
    await admin.post('/api/install_app', { name: 'placeroster' })
    const reader = await createUser({ email: 'bar-reader-two-controls@example.test', roles: ['Bar Reader'] })
    for (const [place, store] of STORES)
      await admin.post('/api/save_row', {
        table: 'placeroster.position',
        row: { row_id: `${reader.user}-${store}`, person: reader.user, place, store, section: 'all' },
      })
    onAddressThatOpens('barproof')
    const { router } = await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
    await waitFor(() => {
      const params = new URLSearchParams(locationOf(router).split('?')[1] ?? '')
      expect([params.get('store'), params.get('region')]).toEqual(['S102', 'S102'])
    })
  } finally {
    await rm(copy, { recursive: true, force: true })
  }
})

// #1153: a long list. 24 made-up stores, listed by name, as the roster's read answers them.
const MANY: [string, string][] = ['Alder', 'Birch', 'Cedar', 'Cypress', 'Elm', 'Fir', 'Hazel', 'Holly', 'Juniper', 'Larch', 'Laurel', 'Linden',
  'Maple', 'Myrtle', 'Oak', 'Olive', 'Palm', 'Pine', 'Poplar', 'Rowan', 'Spruce', 'Teak', 'Walnut', 'Willow']
  .map((name, index) => [`${name} Market`, `S${String(201 + index)}`])
const filterBox = () => screen.findByRole('searchbox', { name: 'Find a store' })
const shown = () => within(screen.getByRole('listbox', { name: 'Store' })).queryAllByRole('option').map((o) => o.textContent)

test('the open list is capped to the room below the picker, and scrolls inside it', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, MANY)
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  const store = await picker()
  // jsdom lays nothing out: the picker's bottom edge as a 56px bar would put it.
  vi.spyOn(store, 'getBoundingClientRect').mockReturnValue({ bottom: 56, top: 12, left: 0, right: 200, width: 200, height: 44, x: 0, y: 12, toJSON: () => ({}) })
  await userEvent.click(store)
  const popup = (await screen.findByRole('listbox', { name: 'Store' })).parentElement!
  // The list starts 4px under the picker and stops 8px above the window's bottom edge.
  expect([popup.style.maxHeight, screen.getByRole('listbox', { name: 'Store' }).className.includes('overflow-y-auto')])
    .toEqual([`${window.innerHeight - 56 - 4 - 8}px`, true])
})

test('with more than 10 options the open list starts with a filter box, which has focus', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, MANY)
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  await userEvent.click(await picker())
  expect(await filterBox()).toHaveFocus()
  expect(shown()).toHaveLength(24)
})

test('typing narrows the list to the names containing the text, in any case, and says when none match', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, MANY)
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  await userEvent.click(await picker())
  await userEvent.type(await filterBox(), 'PL')
  const narrowed = shown()
  await userEvent.type(await filterBox(), 'zz')
  expect([narrowed, shown(), screen.getByTestId('bar-no-match-store').textContent])
    .toEqual([['Maple Market', 'Poplar Market'], [], 'No store matches'])
})

test('in the filter box the arrows move through the options shown, in view, and Enter chooses', async ({ admin, createUser }) => {
  const scrolled: string[] = []
  const scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this.textContent ?? '') })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
  try {
    const reader = await readerOf(admin, createUser, MANY)
    onAddressThatOpens('barproof')
    const { router } = await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
    await userEvent.click(await picker())
    const box = await filterBox()
    await userEvent.type(box, 'market')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}')
    const active = document.getElementById(box.getAttribute('aria-activedescendant') ?? '')?.textContent
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(locationOf(router)).toBe(`${ACCOUNT_SIGN_IN_METHODS_PATH}?store=S203`))
    expect([active, scrolled.at(-1), screen.queryByRole('listbox')]).toEqual(['Cedar Market', 'Cedar Market', null])
  } finally {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  }
})

test('Escape in the filter box closes the list and leaves focus on the picker, choosing nothing', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, MANY)
  onAddressThatOpens('barproof')
  const { router } = await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  const store = await picker()
  await userEvent.click(store)
  await userEvent.type(await filterBox(), 'oak')
  const before = locationOf(router)
  await userEvent.keyboard('{Escape}')
  expect([screen.queryByRole('listbox'), store === document.activeElement, locationOf(router)]).toEqual([null, true, before])
})

test('with 10 options or fewer there is no filter box', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser, STORES)
  onAddressThatOpens('barproof')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  await userEvent.click(await picker())
  await screen.findByRole('listbox', { name: 'Store' })
  expect(screen.queryByRole('searchbox')).toBeNull()
})
