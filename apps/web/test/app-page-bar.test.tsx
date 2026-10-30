// #650 (design D3): an installed app's own pages carry the platform's shared
// top bar. The server puts a `<featherbase-bar data-app data-title>` host
// first in the app's body and loads the bar bundle (src/bar), which draws the
// real TopBar into the host's shadow root. The app owns its document; the bar
// never runs app code, and its styles and theme never reach the app's page.
// Widths, real styles and the fixture app's own page are in
// e2e/app-page-bar.spec.ts.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { act, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { ACCOUNT_SIGN_IN_METHODS_PATH } from 'shared'
import { discoverPackages } from 'server/src/runtime-packages'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { setSession } from '../src/lib/api'
import { BAR_CHANGE_EVENT } from '../src/lib/bar-address'
import { mountBar } from '../src/bar/mount'
import { PHONE_QUERY } from '../src/components/TopBar'
import { test, expect } from './pg-test'

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const ROSTER = resolve('../..', 'test-apps/fixtures/place-roster')
const STORES: [string, string][] = [['Hill Road', 'S102'], ['Lake View', 'S103'], ['Riverside', 'S101']]

let mounted: { unmount: () => void; host: HTMLElement } | undefined

afterEach(() => {
  act(() => mounted?.unmount())
  mounted?.host.remove()
  mounted = undefined
  window.history.replaceState(null, '', '/')
})

/** bar-proof installed, and a Bar Reader responsible for `places`. */
async function readerOf(admin: TestClient, createUser: CreateUserFn, places: [string, string][] = STORES) {
  expect(await discoverPackages([BAR_PROOF, ROSTER])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  await admin.post('/api/install_app', { name: 'placeroster' })
  const reader = await createUser({ email: `app-bar-reader-${places.length}@example.test`, roles: ['Bar Reader'] })
  for (const [place, store] of places)
    await admin.post('/api/save_row', {
      table: 'placeroster.position',
      row: { row_id: `${reader.user}-${store}`, person: reader.user, place, store, section: 'all' },
    })
  return reader
}

/** bar-proof's own page at `path`, signed in as `as`, with the bar mounted the
 *  way the served document mounts it. */
function openAppPage(as: TestClient, path = '/barproof/', leave: (href: string) => void = () => {}) {
  window.history.replaceState(null, '', path)
  setSession(as.token!, { row_id: as.user!, email: null, full_name: null })
  const host = document.createElement('featherbase-bar')
  host.dataset.app = 'barproof'
  host.dataset.title = 'Bar proof'
  document.body.prepend(host)
  const { unmount } = mountBar(host, { leave })
  mounted = { unmount, host }
  return within(host.shadowRoot as unknown as HTMLElement)
}

const settle = () => new Promise((done) => setTimeout(done, 150))

test("the bar on an app's page carries the app's title", async ({ admin, createUser }) => {
  const bar = openAppPage(await readerOf(admin, createUser))
  expect(await bar.findByTestId('top-bar-name')).toHaveTextContent('Bar proof')
})

test("the bar draws the app's declared picker", async ({ admin, createUser }) => {
  const bar = openAppPage(await readerOf(admin, createUser))
  expect(await bar.findByRole('combobox', { name: 'Store' })).toHaveTextContent('Hill Road')
})

test("the picker shows the choice already in the page's address", async ({ admin, createUser }) => {
  const bar = openAppPage(await readerOf(admin, createUser), '/barproof/report?store=S103')
  await waitFor(async () => expect(await bar.findByRole('combobox', { name: 'Store' })).toHaveTextContent('Lake View'))
})

test("choosing an option puts it in the page's own address, staying on the page", async ({ admin, createUser }) => {
  const left: string[] = []
  const bar = openAppPage(await readerOf(admin, createUser), '/barproof/report?tab=2#top', (href) => left.push(href))
  await userEvent.click(await bar.findByRole('combobox', { name: 'Store' }))
  await userEvent.click(await bar.findByRole('option', { name: 'Lake View' }))
  await waitFor(() => expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/barproof/report?tab=2&store=S103#top'))
  expect(left).toEqual([])
})

test(`choosing an option tells the app through the ${BAR_CHANGE_EVENT} event`, async ({ admin, createUser }) => {
  const heard: unknown[] = []
  const listen = (event: Event) => heard.push((event as CustomEvent).detail)
  window.addEventListener(BAR_CHANGE_EVENT, listen)
  try {
    const bar = openAppPage(await readerOf(admin, createUser), '/barproof/?store=S102')
    await userEvent.click(await bar.findByRole('combobox', { name: 'Store' }))
    await userEvent.click(await bar.findByRole('option', { name: 'Riverside' }))
    await waitFor(() => expect(heard).toEqual([{ key: 'store', value: 'S101' }]))
  } finally {
    window.removeEventListener(BAR_CHANGE_EVENT, listen)
  }
})

test("the browser's back button brings the picker back to the earlier choice", async ({ admin, createUser }) => {
  const bar = openAppPage(await readerOf(admin, createUser))
  for (const name of ['Lake View', 'Riverside']) {
    await userEvent.click(await bar.findByRole('combobox', { name: 'Store' }))
    await userEvent.click(await bar.findByRole('option', { name }))
  }
  await waitFor(() => expect(window.location.search).toBe('?store=S101'))
  act(() => window.history.back())
  await waitFor(async () => expect(await bar.findByRole('combobox', { name: 'Store' })).toHaveTextContent('Lake View'))
})

test("Open Admin is offered on an app's page to someone who can use Admin, on any address", async ({ admin }) => {
  expect(await discoverPackages([BAR_PROOF, ROSTER])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  const bar = openAppPage(admin)
  expect(await bar.findByTestId('open-admin')).toBeVisible()
})

// #659 (owner decision, 28-Oct-2026): an app's own Tables do not open the
// Admin. A Bar Reader reads only the app's Tables, so the bar offers no Admin.
test("Open Admin is not offered on an app's page to a person who only reads the app", async ({ admin, createUser }) => {
  const bar = openAppPage(await readerOf(admin, createUser))
  await bar.findByTestId('session-user')
  await settle()
  expect(bar.queryByTestId('open-admin')).toBeNull()
})

test("at phone width the Account menu offers no Open Admin to a person who only reads the app", async ({ admin, createUser }) => {
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: q === PHONE_QUERY, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList)
  try {
    const bar = openAppPage(await readerOf(admin, createUser))
    await userEvent.click(await bar.findByTestId('session-user'))
    const menu = within(await bar.findByTestId('account-menu'))
    await menu.findByTestId('theme-toggle')
    expect(menu.queryByTestId('open-admin')).toBeNull()
  } finally {
    vi.restoreAllMocks()
  }
})

test('a link out of the bar loads the platform page in full, leaving the app', async ({ admin, createUser }) => {
  const left: string[] = []
  const bar = openAppPage(await readerOf(admin, createUser), '/barproof/', (href) => left.push(href))
  await userEvent.click(await bar.findByTestId('session-user'))
  await userEvent.click(await bar.findByTestId('account-sign-in-methods'))
  await waitFor(() => expect(left).toEqual([ACCOUNT_SIGN_IN_METHODS_PATH]))
  expect(window.location.pathname).toBe('/barproof/')
})

test("the bar leaves the app's own document title alone", async ({ admin, createUser }) => {
  document.title = "The app's own title"
  const bar = openAppPage(await readerOf(admin, createUser))
  await bar.findByTestId('session-user')
  await settle()
  expect(document.title).toBe("The app's own title")
})

test("the bar's theme is painted on the bar, never on the app's page", async ({ admin, createUser }) => {
  const before = document.documentElement.getAttribute('data-theme')
  const bar = openAppPage(await readerOf(admin, createUser))
  await userEvent.click(await bar.findByTestId('theme-dark'))
  await waitFor(() => expect(bar.getByTestId('bar-theme-root')).toHaveAttribute('data-theme', 'dark'))
  expect(document.documentElement.getAttribute('data-theme')).toBe(before)
})

test("the bar's stylesheet lives in its own shadow root, not in the app's page", async ({ admin, createUser }) => {
  const styles = document.querySelectorAll('style, link[rel=stylesheet]').length
  const reader = await readerOf(admin, createUser)
  openAppPage(reader)
  expect(mounted!.host.shadowRoot!.querySelector('style')).not.toBeNull()
  expect(document.querySelectorAll('style, link[rel=stylesheet]').length).toBe(styles)
})

test("the bar's height is published to the app as --featherbase-bar-height", async ({ admin, createUser }) => {
  const Real = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    constructor(private readonly report: ResizeObserverCallback) {}
    observe() {
      this.report([{ contentRect: { height: 52 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  try {
    openAppPage(await readerOf(admin, createUser))
    expect(document.documentElement.style.getPropertyValue('--featherbase-bar-height')).toBe('52px')
  } finally {
    globalThis.ResizeObserver = Real
    document.documentElement.style.removeProperty('--featherbase-bar-height')
  }
})

// Owner decision, 27-Oct-2026 (#650): a page that loads with no choice, or a
// choice that is not one of the reader's options, gets the first option
// written into its address in place: no new history step, no reload, and the
// app is told once.
for (const [what, path] of [['no store', '/barproof/report?tab=2'], ['a store that is not theirs', '/barproof/report?tab=2&store=S999']]) {
  test(`with ${what} in the address, the bar writes the first store in place`, async ({ admin, createUser }) => {
    const reader = await readerOf(admin, createUser)
    const steps = window.history.length
    const bar = openAppPage(reader, path)
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe('/barproof/report?tab=2&store=S102'))
    expect([window.history.length, (await bar.findByRole('combobox', { name: 'Store' })).textContent]).toEqual([steps, 'Hill Road'])
  })

  test(`with ${what} in the address, the app is told the first store once`, async ({ admin, createUser }) => {
    const reader = await readerOf(admin, createUser)
    const heard: unknown[] = []
    const listen = (event: Event) => heard.push((event as CustomEvent).detail)
    window.addEventListener(BAR_CHANGE_EVENT, listen)
    try {
      openAppPage(reader, path)
      await waitFor(() => expect(window.location.search).toContain('store=S102'))
      await settle()
      expect(heard).toEqual([{ key: 'store', value: 'S102' }])
    } finally {
      window.removeEventListener(BAR_CHANGE_EVENT, listen)
    }
  })
}

test('with exactly one store, the bar writes that store into the address', async ({ admin, createUser }) => {
  openAppPage(await readerOf(admin, createUser, [['Riverside', 'S101']]))
  await waitFor(() => expect(window.location.search).toBe('?store=S101'))
})

// Codex round 1 on #658: the picker and the address stay in step.

test("the bar follows the app's own move to another store", async ({ admin, createUser }) => {
  const bar = openAppPage(await readerOf(admin, createUser), '/barproof/?store=S102')
  await waitFor(async () => expect(await bar.findByRole('combobox', { name: 'Store' })).toHaveTextContent('Hill Road'))
  act(() => window.history.pushState(null, '', '/barproof/?store=S103'))
  await waitFor(async () => expect(await bar.findByRole('combobox', { name: 'Store' })).toHaveTextContent('Lake View'))
})

test('after the app moves to another store, choosing the one shown before goes back to it', async ({ admin, createUser }) => {
  const bar = openAppPage(await readerOf(admin, createUser), '/barproof/?store=S102')
  await bar.findByRole('combobox', { name: 'Store' })
  act(() => window.history.pushState(null, '', '/barproof/?store=S103'))
  await waitFor(async () => expect(await bar.findByRole('combobox', { name: 'Store' })).toHaveTextContent('Lake View'))
  await userEvent.click(await bar.findByRole('combobox', { name: 'Store' }))
  await userEvent.click(await bar.findByRole('option', { name: 'Hill Road' }))
  await waitFor(() => expect(window.location.search).toBe('?store=S102'))
})

test('the app setting a store of its own is not announced back to it', async ({ admin, createUser }) => {
  const bar = openAppPage(await readerOf(admin, createUser), '/barproof/?store=S102')
  await bar.findByRole('combobox', { name: 'Store' })
  const heard: unknown[] = []
  const listen = (event: Event) => heard.push((event as CustomEvent).detail)
  window.addEventListener(BAR_CHANGE_EVENT, listen)
  try {
    act(() => window.history.pushState(null, '', '/barproof/?store=S103'))
    await waitFor(async () => expect(await bar.findByRole('combobox', { name: 'Store' })).toHaveTextContent('Lake View'))
    await settle()
    expect(heard).toEqual([])
  } finally {
    window.removeEventListener(BAR_CHANGE_EVENT, listen)
  }
})

test('when the app drops the store from its address, the bar writes the first store back in place, once', async ({ admin, createUser }) => {
  const bar = openAppPage(await readerOf(admin, createUser), '/barproof/?store=S103')
  await waitFor(async () => expect(await bar.findByRole('combobox', { name: 'Store' })).toHaveTextContent('Lake View'))
  const heard: unknown[] = []
  const listen = (event: Event) => heard.push((event as CustomEvent).detail)
  window.addEventListener(BAR_CHANGE_EVENT, listen)
  try {
    const steps = window.history.length
    act(() => window.history.replaceState(null, '', '/barproof/?tab=2'))
    await waitFor(() => expect(window.location.search).toBe('?tab=2&store=S102'))
    await settle()
    expect([window.history.length, heard]).toEqual([steps, [{ key: 'store', value: 'S102' }]])
  } finally {
    window.removeEventListener(BAR_CHANGE_EVENT, listen)
  }
})

test('going back to an entry with the same wrong store corrects it again', async ({ admin, createUser }) => {
  const reader = await readerOf(admin, createUser)
  window.history.replaceState(null, '', '/barproof/?store=S999')
  window.history.pushState(null, '', '/barproof/?store=S999&n=2')
  openAppPage(reader, '/barproof/?store=S999&n=2')
  await waitFor(() => expect(window.location.search).toBe('?store=S102&n=2'))
  act(() => window.history.back())
  await waitFor(() => expect(window.location.search).toBe('?store=S102'))
})

test('two declared controls missing from the address both get their first option, each announced', async ({ admin, createUser }) => {
  const copy = await mkdtemp(resolve('test/.b650-two-controls-'))
  try {
    await cp(BAR_PROOF, copy, { recursive: true })
    const file = join(copy, 'featherbase.json')
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    manifest.bar = [...manifest.bar, { picker: 'Region', options: 'stores', sets: 'region' }]
    await writeFile(file, JSON.stringify(manifest))
    expect(await discoverPackages([copy, ROSTER])).toEqual([])
    await admin.post('/api/install_app', { name: 'barproof' })
    await admin.post('/api/install_app', { name: 'placeroster' })
    const reader = await createUser({ email: 'app-bar-two-controls@example.test', roles: ['Bar Reader'] })
    for (const [place, store] of STORES)
      await admin.post('/api/save_row', {
        table: 'placeroster.position',
        row: { row_id: `${reader.user}-${store}`, person: reader.user, place, store, section: 'all' },
      })
    const heard: { key: string; value: string }[] = []
    const listen = (event: Event) => heard.push((event as CustomEvent).detail)
    window.addEventListener(BAR_CHANGE_EVENT, listen)
    try {
      openAppPage(reader, '/barproof/')
      await waitFor(() => {
        const params = new URLSearchParams(window.location.search)
        expect([params.get('store'), params.get('region')]).toEqual(['S102', 'S102'])
      })
      await settle()
      expect(heard.sort((a, b) => a.key.localeCompare(b.key))).toEqual([{ key: 'region', value: 'S102' }, { key: 'store', value: 'S102' }])
    } finally {
      window.removeEventListener(BAR_CHANGE_EVENT, listen)
    }
  } finally {
    await rm(copy, { recursive: true, force: true })
  }
})

test('with no stores, the bar writes nothing into the address', async ({ admin, createUser }) => {
  const bar = openAppPage(await readerOf(admin, createUser, []), '/barproof/?tab=2')
  await bar.findByTestId('session-user')
  await settle()
  expect(window.location.search).toBe('?tab=2')
})
