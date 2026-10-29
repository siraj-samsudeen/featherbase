// #489 (design D3, "One top bar on every address"): one bar, drawn by the
// platform, on the Admin screens, the Sales Target page, the Portal, the
// no-access page and the account pages. The address names it; the right side
// is "Open Admin" (app addresses, people who can use Admin), the theme toggle
// and the Account menu. What jsdom cannot see (widths, pixels, the hand-off's
// cross-host navigation) is in e2e/top-bar.spec.ts.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resolve } from 'node:path'
import { afterEach, vi } from 'vitest'
import { ACCOUNT_SIGN_IN_METHODS_PATH } from 'shared'
import { config } from 'server/src/config'
import { parseInstanceAddresses } from 'server/src/instance-addresses'
import { discoverPackages } from 'server/src/runtime-packages'
import { VIEWER_ROLE } from 'server/src/sales-target'
import { PHONE_QUERY } from '../src/components/TopBar'
import { recordAction } from '../src/lib/recents'
import { followDevice } from '../src/lib/theme'
import { getToken } from '../src/lib/api'
import { test, expect, renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]

afterEach(async () => {
  // An app installed by a test stays loaded in this process after its rows
  // roll back: forget it, so the next test sees no app installed.
  await discoverPackages([])
  config.instanceAddresses = null
  followDevice()
  vi.restoreAllMocks()
})

/** The in-process server is reached as `localhost`: list it as this address. */
function onAddressThatOpens(opens: string) {
  const other = opens === 'admin' ? 'feather_dash' : 'admin'
  config.instanceAddresses = parseInstanceAddresses(
    JSON.stringify([
      { address: 'http://localhost', opens, emails: true },
      { address: 'http://elsewhere.example.test', opens: other },
    ]),
    'test',
  )
}

async function viewerOnly(admin: Client, createUser: (o: { email?: string; roles?: string[] }) => Promise<Client>, email: string) {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: VIEWER_ROLE } })
  return createUser({ email, roles: [VIEWER_ROLE] })
}

const bar = () => screen.findByTestId('top-bar')
const barName = async () => within(await bar()).findByTestId('top-bar-name')
/** The bar once whoami has answered: the Account menu's avatar is drawn. */
const settledBar = async () => {
  await screen.findByTestId('session-user')
  return bar()
}
const openAccountMenu = async () => {
  await userEvent.click(await screen.findByTestId('session-user'))
  return screen.findByTestId('account-menu')
}

// ---- 2. the name ---------------------------------------------------------------

test('on the Admin screens the bar is named Featherbase Admin', async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  expect(await barName()).toHaveTextContent('Featherbase Admin')
})

test('on the Sales Target page the bar is named for the app, Feather Dash', async ({ admin }) => {
  await renderApp('/featherbase/sales-target', admin)
  expect(await barName()).toHaveTextContent('Feather Dash')
})

test("on an app's address the account page is named for the app", async ({ admin }) => {
  onAddressThatOpens('feather_dash')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  await waitFor(async () => expect(await barName()).toHaveTextContent('Feather Dash'))
})

test('on the Admin address the account page is named Featherbase Admin', async ({ admin }) => {
  onAddressThatOpens('admin')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  await waitFor(async () => expect(await barName()).toHaveTextContent('Featherbase Admin'))
})

// Verifier, round 2 on #495: on an app's address every page's tab says the
// app, and app content never shows under the Admin name.
test("on an app's address the account page's tab title is the app's name", async ({ admin }) => {
  document.title = 'Featherbase'
  onAddressThatOpens('feather_dash')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  await waitFor(() => expect(document.title).toBe('Feather Dash'))
})

test('the Sales Target page on the Admin address is named Feather Dash in its bar', async ({ admin }) => {
  onAddressThatOpens('admin')
  await renderApp('/featherbase/sales-target', admin)
  await settledBar()
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(await barName()).toHaveTextContent('Feather Dash')
})

test("the Sales Target page on the Admin address has Feather Dash as its tab title", async ({ admin }) => {
  document.title = 'Featherbase'
  onAddressThatOpens('admin')
  await renderApp('/featherbase/sales-target', admin)
  await waitFor(() => expect(document.title).toBe('Feather Dash'))
})

// #501 item 1: the Admin's browser tab and its logo say "Featherbase Admin".
test('on the Admin screens the tab title is Featherbase Admin', async ({ admin }) => {
  document.title = 'Featherbase'
  await renderApp('/featherbase/admin', admin)
  await settledBar()
  await waitFor(() => expect(document.title).toBe('Featherbase Admin'))
})

test("the Admin logo's tooltip is Featherbase Admin", async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  const logo = await within(await settledBar()).findByRole('link', { name: 'Featherbase Admin' })
  expect(logo).toHaveAttribute('title', 'Featherbase Admin')
})

test('on the Admin address the account page tab title is Featherbase Admin for someone who can use Admin', async ({ admin }) => {
  document.title = 'Featherbase'
  onAddressThatOpens('admin')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  await settledBar()
  await waitFor(() => expect(document.title).toBe('Featherbase Admin'))
})

// #501 item 3: on the Admin address the account page is named for where the
// person belongs.
test('on the Admin address the account page is named for the app a person who cannot use Admin can open', async ({ admin, createUser }) => {
  onAddressThatOpens('admin')
  const viewer = await viewerOnly(admin, createUser, 'viewer.account@example.com')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, viewer)
  await settledBar()
  await waitFor(async () => expect(await barName()).toHaveTextContent(/^Feather Dash$/))
})

test("on the Admin address the account page's tab title names the app a person who cannot use Admin can open", async ({ admin, createUser }) => {
  document.title = 'Featherbase'
  onAddressThatOpens('admin')
  const viewer = await viewerOnly(admin, createUser, 'viewer.account.tab@example.com')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, viewer)
  await settledBar()
  await waitFor(() => expect(document.title).toBe('Feather Dash'))
})

test('on the Admin address the account page is named Featherbase for someone who can open nothing', async ({ createUser }) => {
  onAddressThatOpens('admin')
  const nobody = await createUser({ email: 'nobody.account@example.com' })
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, nobody)
  await settledBar()
  await waitFor(async () => expect(await barName()).toHaveTextContent(/^Featherbase$/))
})

test("on the Admin address the account page's tab title is Featherbase for someone who can open nothing", async ({ createUser }) => {
  document.title = 'Feather Dash'
  onAddressThatOpens('admin')
  const nobody = await createUser({ email: 'nobody.account.tab@example.com' })
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, nobody)
  await settledBar()
  await waitFor(() => expect(document.title).toBe('Featherbase'))
})

test("on an app's address the account page stays named for the app for someone who cannot use Admin", async ({ createUser }) => {
  onAddressThatOpens('feather_dash')
  const nobody = await createUser({ email: 'nobody.dash.account@example.com' })
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, nobody)
  await settledBar()
  await waitFor(async () => expect(await barName()).toHaveTextContent(/^Feather Dash$/))
})

// ---- 2b. an installed app of the interim name (#671) -----------------------------
// INTERIM_APPS stands in for Feather Dash only until an app of that name is
// installed (design D8): from then on the bar leads to the app's own root.

const DASH_STAND_IN = resolve('../..', 'runtime-apps/fixtures/dash-stand-in')

/** An app installed under the name feather_dash, open to everyone (its entry
 *  Table is readable by All, which is no Table grant of a person's own). */
async function installDashApp(admin: Client) {
  expect(await discoverPackages([DASH_STAND_IN])).toEqual([])
  await admin.post('/api/install_app', { name: 'feather_dash' })
}

test("on an app's address whose app is installed, the bar's name leads to the app's root", async ({ admin }) => {
  await installDashApp(admin)
  onAddressThatOpens('feather_dash')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  await settledBar()
  await waitFor(async () => expect(await barName()).toHaveAttribute('href', '/feather_dash/'))
})

// Codex round 1 on #672: the link follows the installation, not whether the
// app can be opened right now; a disabled app's root says it is unavailable.
// #501 names the account page for the app a person belongs to: an app that
// everyone can open (Tasker grants All) is no one's in particular, so only the
// app installed under the interim name takes Feather Dash's place (e2e
// top-bar.spec.ts, items 3).
const OTHER_APP = resolve('../..', 'runtime-apps/other')

test('on the Admin address the account page is Featherbase for someone who can open only an app open to everyone', async ({ admin, createUser }) => {
  expect(await discoverPackages([OTHER_APP])).toEqual([])
  await admin.post('/api/install_app', { name: 'other' })
  onAddressThatOpens('admin')
  const nobody = await createUser({ email: 'nobody.other.app@example.com' })
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, nobody)
  await settledBar()
  await waitFor(async () => expect(await barName()).toHaveTextContent(/^Featherbase$/))
})

test('on the Admin address the account page names Feather Dash for a report viewer who can also open an app open to everyone', async ({ admin, createUser }) => {
  expect(await discoverPackages([OTHER_APP])).toEqual([])
  await admin.post('/api/install_app', { name: 'other' })
  onAddressThatOpens('admin')
  const viewer = await viewerOnly(admin, createUser, 'viewer.other.app@example.com')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, viewer)
  await settledBar()
  await waitFor(async () => expect(await barName()).toHaveTextContent(/^Feather Dash$/))
})

test("on an app's address whose installed app is disabled, the bar's name still leads to the app's root", async ({ admin }) => {
  await installDashApp(admin)
  await admin.post('/api/set_app_enabled', { name: 'feather_dash', enabled: false })
  onAddressThatOpens('feather_dash')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  await settledName('Dash stand-in')
  expect(await barName()).toHaveAttribute('href', '/feather_dash/')
})

test("on an app's address whose app is not installed, the bar's name leads to the interim page", async ({ admin }) => {
  onAddressThatOpens('feather_dash')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  await settledName('Feather Dash')
  expect(await barName()).toHaveAttribute('href', '/featherbase/sales-target')
})

test('on the Admin address the account page is named for the installed app a person who cannot use Admin can open', async ({ admin, createUser }) => {
  await installDashApp(admin)
  onAddressThatOpens('admin')
  const reader = await createUser({ email: 'dash.app.reader@example.com' })
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, reader)
  await settledBar()
  await waitFor(async () => expect(await barName()).toHaveTextContent(/^Dash stand-in$/))
})

// ---- 3. Admin menus on the Admin screens only ---------------------------------

test('the account page has the bar and no Admin menus', async ({ admin }) => {
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  await settledBar()
  expect(await screen.findByTestId('sign-in-methods')).toBeInTheDocument()
  for (const id of ['awesomebar', 'admin-sidebar', 'notif-bell', 'sidebar-toggle'])
    expect(screen.queryByTestId(id)).not.toBeInTheDocument()
})

test('the Sales Target page has no Admin menus in its bar', async ({ admin }) => {
  await renderApp('/featherbase/sales-target', admin)
  await settledBar()
  for (const id of ['awesomebar', 'notif-bell', 'sidebar-toggle', 'admin-app-switcher'])
    expect(screen.queryByTestId(id)).not.toBeInTheDocument()
})

// ---- 4. the right side, and "Open Admin" ---------------------------------------

test("Open Admin is offered on an app's address to a person who can use Admin", async ({ admin }) => {
  onAddressThatOpens('feather_dash')
  await renderApp('/featherbase/sales-target', admin)
  expect(await within(await settledBar()).findByTestId('open-admin')).toHaveTextContent('Open Admin')
})

test('Open Admin is not offered to a person who cannot use Admin', async ({ admin, createUser }) => {
  onAddressThatOpens('feather_dash')
  const viewer = await viewerOnly(admin, createUser, 'viewer.bar@example.com')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, viewer)
  await waitFor(async () => expect(await barName()).toHaveTextContent('Feather Dash'))
  expect(within(await settledBar()).queryByTestId('open-admin')).not.toBeInTheDocument()
})

test('Open Admin is not offered on the Admin screens', async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  expect(within(await settledBar()).queryByTestId('open-admin')).not.toBeInTheDocument()
})

// #501 item 2: the bar never offers to go where the person already is.
const settledName = async (name: string) => {
  const bar = await settledBar()
  await waitFor(async () => expect(await barName()).toHaveTextContent(name))
  await new Promise((resolve) => setTimeout(resolve, 50))
  return bar
}

test('Open Admin is not offered on the Sales Target page opened on the Admin address', async ({ admin }) => {
  onAddressThatOpens('admin')
  await renderApp('/featherbase/sales-target', admin)
  expect(within(await settledName('Feather Dash')).queryByTestId('open-admin')).not.toBeInTheDocument()
})

test('Open Admin is not offered on the account page on the Admin address', async ({ admin }) => {
  onAddressThatOpens('admin')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  expect(within(await settledName('Featherbase Admin')).queryByTestId('open-admin')).not.toBeInTheDocument()
})

test('Open Admin is not offered on a host the list does not name, which holds the Admin', async ({ admin }) => {
  await renderApp('/featherbase/sales-target', admin)
  expect(within(await settledName('Feather Dash')).queryByTestId('open-admin')).not.toBeInTheDocument()
})

test('at phone width Open Admin is not in the Account menu on the Admin address', async ({ admin }) => {
  phoneWidth()
  onAddressThatOpens('admin')
  await renderApp('/featherbase/sales-target', admin)
  await settledName('Feather Dash')
  expect(within(await openAccountMenu()).queryByTestId('open-admin')).not.toBeInTheDocument()
})

test('the right side reads Open Admin, the theme toggle, then the Account menu', async ({ admin }) => {
  onAddressThatOpens('feather_dash')
  await renderApp('/featherbase/sales-target', admin)
  const right = within(await settledBar()).getByTestId('top-bar-right')
  const order = [...right.querySelectorAll('[data-testid="open-admin"], [data-testid="theme-toggle"], [data-testid="session-user"]')]
    .map((el) => el.getAttribute('data-testid'))
  expect(order).toEqual(['open-admin', 'theme-toggle', 'session-user'])
})

// ---- 5. the Account menu --------------------------------------------------------

test('the Account menu holds the name, Sign-in methods, then Log out', async ({ admin }) => {
  await renderApp('/featherbase/sales-target', admin)
  const menu = await openAccountMenu()
  const order = [...menu.querySelectorAll('[data-testid="account-identity"], [role="menuitem"]')].map((el) => el.getAttribute('data-testid'))
  expect(order).toEqual(['account-identity', 'account-sign-in-methods', 'logout'])
})

test("the Account menu's Sign-in methods opens the account page", async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  await openAccountMenu()
  expect(screen.getByTestId('account-sign-in-methods')).toHaveAttribute('href', ACCOUNT_SIGN_IN_METHODS_PATH)
})

test("the person's name in the Account menu is not a control", async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  await openAccountMenu()
  const identity = screen.getByTestId('account-identity')
  expect(identity).toHaveTextContent('Administrator')
  expect(within(identity).queryByRole('button')).toBeNull()
  expect(within(identity).queryByRole('link')).toBeNull()
})

// ---- 6. no loose Sign-in methods or Log out --------------------------------------

test.for([
  ['the Sales Target page', '/featherbase/sales-target'],
  ['the Portal', '/featherbase/portal/Person'],
  ['the Admin screens', '/featherbase/admin'],
] as const)('%s has no Sign-in methods or Log out outside the Account menu', async ([, path], { admin }) => {
  await renderApp(path, admin)
  await settledBar()
  expect(screen.queryByText('Log out')).toBeNull()
  expect(screen.queryByText('Sign-in methods')).toBeNull()
})

test('the no-access page has no Log out outside the Account menu', async ({ createUser }) => {
  const nobody = await createUser({ email: 'nobody.bar@example.com' })
  await renderApp('/featherbase/admin', nobody)
  await screen.findByTestId('no-access')
  await settledBar()
  expect(screen.queryByText('Log out')).toBeNull()
})

test('the no-access Admin address names the platform in the bar and tab, retaining Account actions', async ({ createUser }) => {
  onAddressThatOpens('admin')
  document.title = 'Featherbase Admin'
  const nobody = await createUser({ roles: [] })
  await renderApp('/featherbase/admin', nobody)
  await screen.findByTestId('no-access')
  await settledBar()
  await waitFor(async () => expect(await barName()).toHaveTextContent(/^Featherbase$/))
  expect(document.title).toBe('Featherbase')
  const menu = await openAccountMenu()
  expect(within(menu).getByRole('menuitem', { name: 'Sign-in methods' })).toBeInTheDocument()
  expect(within(menu).getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument()
})

// ---- 7. the Sales Target page's identity line ---------------------------------

test("the Sales Target page's identity line sits below the bar, not in it", async ({ admin }) => {
  await renderApp('/featherbase/sales-target', admin)
  const identity = await screen.findByTestId('identity')
  expect((await bar()).contains(identity)).toBe(false)
})

// ---- 9. phone width --------------------------------------------------------------

function phoneWidth() {
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: q === PHONE_QUERY, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList)
}

test('at phone width Open Admin and the theme toggle move into the Account menu, above Sign-in methods', async ({ admin }) => {
  phoneWidth()
  onAddressThatOpens('feather_dash')
  await renderApp('/featherbase/sales-target', admin)
  const right = within(await settledBar()).getByTestId('top-bar-right')
  expect(within(right).queryByTestId('open-admin')).toBeNull()
  expect(within(right).queryByTestId('theme-toggle')).toBeNull()
  const menu = await openAccountMenu()
  const order = [...menu.querySelectorAll('[data-testid="open-admin"], [data-testid="theme-toggle"], [data-testid="account-sign-in-methods"]')]
    .map((el) => el.getAttribute('data-testid'))
  expect(order).toEqual(['open-admin', 'theme-toggle', 'account-sign-in-methods'])
})

// Verifier, round 2 on #495: "Same as device" wrapped onto two lines in the
// phone menu; it reads "Device" there, and keeps the full accessible name.
test("at phone width the menu's device choice reads Device and is named Same as device", async ({ admin }) => {
  phoneWidth()
  await renderApp('/featherbase/sales-target', admin)
  await settledBar()
  const menu = await openAccountMenu()
  const device = within(menu).getByTestId('theme-device')
  expect(device).toHaveTextContent(/^Device$/)
  expect(within(menu).getByRole('radio', { name: 'Same as device' })).toBe(device)
})

// Codex round 1 on #495 (P2): closing the phone menu unmounts the toggle; the
// theme's save must not go with it.
test('at phone width a theme chosen in the Account menu sticks after the menu closes before the save lands', async ({ admin }) => {
  phoneWidth()
  const real = globalThis.fetch
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.includes('/api/set_theme')) await held
    return real(input, init)
  })
  await renderApp('/featherbase/sales-target', admin)
  await settledBar()
  const menu = await openAccountMenu()
  await userEvent.click(within(menu).getByTestId('theme-dark'))
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument())
  release()
  await waitFor(async () => expect(((await admin.get('/api/whoami')) as { theme?: string }).theme).toBe('dark'))
  await new Promise((resolve) => setTimeout(resolve, 50))
  const reopened = await openAccountMenu()
  expect(within(reopened).getByTestId('theme-dark')).toHaveAttribute('aria-checked', 'true')
  expect(document.documentElement.dataset.theme).toBe('dark')
})

// Codex round 2 on #495 (P2): a public page makes no signed-in request, so a
// stale token left in the browser never sends it to the sign-in page.
test.for([
  ['a password-reset link', '/featherbase/reset-password?key=some-reset-key'],
  ['a public web form', '/featherbase/form/no-such-form'],
] as const)('%s with a stale token stored asks nothing signed in and stays put', async ([, path]) => {
  const urls: string[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    urls.push(String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url))
    return real(input, init)
  })
  await renderApp(path, { token: 'stale-token', user: 'someone-gone' } as never)
  await waitFor(() => expect(document.body.textContent?.trim()).not.toBe(''))
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(urls.filter((u) => u.includes('/api/whoami'))).toEqual([])
  // A 401 would have cleared the stored token on its way to the sign-in page.
  expect(getToken()).toBe('stale-token')
})

// Codex round 2 on #495 (P2): the theme state belongs to one signed-in person.
// A's slow save, finishing after B has signed in, must not keep B's own
// stored theme from being applied.
test("a slow theme save from the person before does not hide the next person's theme", async ({ admin, createUser }) => {
  const b = await createUser({ email: 'theme.next@example.com' })
  await admin.post('/api/set_password', { user: b.user, password: 'theme-next-pw-1' })
  await b.post('/api/set_theme', { theme: 'light' })
  const real = globalThis.fetch
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const answer = real(input, init)
    if (url.includes('/api/set_theme')) await held // the write lands; its answer is slow
    return answer
  })
  await renderApp('/featherbase/sales-target', admin)
  await settledBar()
  await userEvent.click(screen.getByTestId('theme-dark'))
  await openAccountMenu()
  await userEvent.click(screen.getByTestId('logout'))
  const email = await waitFor(() => {
    const field = document.querySelector<HTMLInputElement>('input[name=email]')
    if (!field) throw new Error('no sign-in form yet')
    return field
  })
  await userEvent.type(email, 'theme.next@example.com')
  await userEvent.type(document.querySelector<HTMLInputElement>('input[name=password]')!, 'theme-next-pw-1')
  await userEvent.click(document.querySelector<HTMLButtonElement>('button[type=submit]')!)
  await screen.findByTestId('no-access')
  await settledBar()
  release()
  await new Promise((resolve) => setTimeout(resolve, 100))
  await waitFor(() => expect(screen.getByTestId('theme-light')).toHaveAttribute('aria-checked', 'true'))
  expect(document.documentElement.dataset.theme).toBe('light')
})

// ---- 10. states -------------------------------------------------------------------

test('while whoami loads the bar shows its name and nothing on the right', async ({ admin }) => {
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).includes('/api/whoami')
      ? new Promise<Response>(() => {})
      : real(input, init))
  await renderApp('/featherbase/sales-target', admin)
  expect(await barName()).toHaveTextContent('Feather Dash')
  expect(within(await bar()).getByTestId('top-bar-right')).toBeEmptyDOMElement()
})

// ---- 11. keyboard -------------------------------------------------------------------

test('Escape closes the Account menu and returns focus to the avatar', async ({ admin }) => {
  await renderApp('/featherbase/sales-target', admin)
  await openAccountMenu()
  screen.getByTestId('logout').focus()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument())
  expect(screen.getByTestId('session-user')).toHaveFocus()
})

test("Tab from the Admin command bar reaches its recents instead of closing them", async ({ admin }) => {
  recordAction('Administrator', { kind: 'list', key: 'list:Person?', label: 'Person', path: '/featherbase/admin/Person' })
  await renderApp('/featherbase/admin', admin)
  const input = await screen.findByRole('textbox', { name: 'Search or type a command' })
  await userEvent.click(input)
  await screen.findByTestId('awesomebar-recents')
  await userEvent.tab()
  expect(document.activeElement).toHaveAttribute('data-testid', 'awesomebar-recent')
})

test('Enter on the avatar opens the Account menu', async ({ admin }) => {
  await renderApp('/featherbase/sales-target', admin)
  ;(await screen.findByTestId('session-user')).focus()
  await userEvent.keyboard('{Enter}')
  expect(await screen.findByTestId('account-menu')).toBeInTheDocument()
})

test('Space on the avatar opens the Account menu', async ({ admin }) => {
  await renderApp('/featherbase/sales-target', admin)
  ;(await screen.findByTestId('session-user')).focus()
  await userEvent.keyboard(' ')
  expect(await screen.findByTestId('account-menu')).toBeInTheDocument()
})
