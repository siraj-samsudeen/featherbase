// trusted-runtime-packages' scenarios a person reads in the shared bar
// (#1070): the destination switcher, an app's page following the theme, the
// app's accent, and signing in at an app's address. The real Admin and the
// real bar (mounted as the served document mounts it) in jsdom, against the
// in-process server; the server's own scenarios are in
// apps/server/test/scenarios/.
//
// jsdom paints nothing through the platform's stylesheet and makes no full
// page loads: the accent's painted colour is read from the stylesheet's own
// rules, and a full load is the page's request for one.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { FEATHERBASE_ADMIN_DESTINATION } from 'shared'
import { discoverAppLibrary } from 'server/src/app-library'
import { loadInstalledApps } from 'server/src/apps'
import { setUserPassword } from 'server/src/auth'
import { discoverPackages } from 'server/src/runtime-packages'
import { sandboxRequest } from 'server/test/pg-test-shared'
import { scenarioFor } from 'server/test/scenario'
import { admitTasker, taskerClient } from 'server/test/tasker-client'
import { setSession } from '../../src/lib/api'
import { mountBar } from '../../src/bar/mount'
import { FeatherbaseSidebar } from '../../src/bar/sidebar'
import { safeLoginNext } from '../../src/pages/Login'
import { test, expect, renderApp } from '../pg-test'

const scenario = scenarioFor(test, 'trusted-runtime-packages')
const REPO = resolve('../..')
const TASKER = join(REPO, 'example-apps/tasker')
const TICKETS = join(REPO, 'example-apps/tickets')
const BAR_PROOF = join(REPO, 'test-apps/fixtures/bar-proof')
const PASSWORD = 'trusted-runtime-admin-pw'
const LONG = { timeout: 15_000 }
const manifest = (dir: string) => JSON.parse(readFileSync(join(dir, 'featherbase.json'), 'utf8')) as { accent?: string; title: string }
if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)

let mounted: { unmount: () => void; host: HTMLElement } | undefined
let device: 'light' | 'dark' = 'light'
afterEach(async () => {
  act(() => mounted?.unmount())
  mounted?.host.remove()
  mounted = undefined
  document.body.replaceChildren()
  document.head.querySelectorAll('style[data-app-page]').forEach((s) => s.remove())
  for (const name of ['data-theme', 'data-featherbase-theme', 'data-featherbase-accent']) document.documentElement.removeAttribute(name)
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
  await discoverAppLibrary([])
  await loadInstalledApps()
})

/** The device's own setting, as the browser reports it. */
function deviceIs(scheme: 'light' | 'dark') {
  device = scheme
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query.includes('dark') ? device === 'dark' : false,
    media: query, onchange: null, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList)
}

/** The app's own page at `path` as the server serves it: the shared bar's host
 *  first, with the app's accent if it names one, mounted as the bar script does. */
async function openAppPage(as: TestClient, app: string, path = `/${app}/`) {
  const served = await sandboxRequest(path, { headers: { accept: 'text/html', authorization: `Bearer ${as.token}` } })
  expect(served.status).toBe(200)
  const html = await served.text()
  const hostTag = /<featherbase-bar[^>]*>/.exec(html)?.[0]
  expect(hostTag, 'the served page carries the shared bar').toBeDefined()
  const attribute = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(hostTag!)?.[1]
  window.history.replaceState(null, '', path)
  setSession(as.token!, { row_id: as.user!, email: null, full_name: null })
  const host = document.createElement('featherbase-bar')
  host.dataset.app = attribute('data-app')!
  host.dataset.title = attribute('data-title')!
  const accent = attribute('data-accent')
  if (accent) host.dataset.accent = accent
  document.body.prepend(host)
  const { unmount } = mountBar(host, { leave: () => {} })
  mounted = { unmount, host }
  return { bar: within(host.shadowRoot as unknown as HTMLElement), html }
}

/** bar-proof's own page (its markup, styles and script) under the bar. */
async function openBarProof(as: TestClient) {
  const page = readFileSync(join(BAR_PROOF, 'client/index.html'), 'utf8')
  document.documentElement.setAttribute('data-theme', 'app-owned')
  const style = document.createElement('style')
  style.dataset.appPage = ''
  style.textContent = /<style>([\s\S]*?)<\/style>/.exec(page)![1]!
  document.head.append(style)
  // The person's own choice arrives with who they are: wait for it, then for the paint.
  const real = globalThis.fetch
  let known!: () => void
  const whoami = new Promise<void>((r) => (known = r))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const res = await real(input, init)
    if (String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith('/api/whoami')) known()
    return res
  })
  const opened = await openAppPage(as, 'barproof')
  await whoami
  await new Promise((r) => setTimeout(r, 150))
  const body = document.createElement('div')
  body.innerHTML = /<body>([\s\S]*?)<script>/.exec(page)![1]!
  document.body.append(...body.childNodes)
  // The page's own script, run as its document runs it.
  new Function(/<script>([\s\S]*?)<\/script>/.exec(page)![1]!)()
  return opened
}

/** What the bar-proof page shows and paints for the theme it was told. */
async function expectApp(theme: 'light' | 'dark') {
  const follower = document.getElementById('theme-follower')!
  await waitFor(() => expect(follower).toHaveTextContent(theme), LONG)
  const [r, g, b] = getComputedStyle(follower).backgroundColor.match(/\d+/g)!.map(Number)
  expect({
    told: follower.textContent,
    painted: (r! + g! + b!) / 3 > 128 ? 'light' : 'dark',
    ownTheme: document.documentElement.getAttribute('data-theme'),
    ownBackground: getComputedStyle(document.body).backgroundColor,
  }).toEqual({ told: theme, painted: theme, ownTheme: 'app-owned', ownBackground: 'rgb(250, 245, 230)' })
}

async function barReader(admin: TestClient, createUser: (o: { roles: string[] }) => Promise<TestClient>) {
  expect(await discoverPackages([BAR_PROOF])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  return createUser({ roles: ['Bar Reader'] })
}

async function choose(as: TestClient, theme: 'light' | 'dark') {
  const res = await as.fetch('/api/set_theme', { method: 'POST', body: JSON.stringify({ theme }) })
  expect(res.status, `saving the ${theme} theme`).toBe(200)
}

// ---- The accent's colours: the platform stylesheet's own action tokens ----

const STYLES = readFileSync(join(REPO, 'packages/shop-floor/src/styles.css'), 'utf8')
/** The --color-action a rule block whose selector is exactly `selector` sets. */
function action(selector: string) {
  const at = STYLES.indexOf(`${selector} {`)
  expect(at, `the stylesheet has a ${selector} block`).toBeGreaterThanOrEqual(0)
  return /--color-action:\s*([^;]+);/.exec(STYLES.slice(at))![1]!.trim()
}
const blue = { light: () => action('@theme static'), dark: () => action("[data-theme='dark']") }
const green = { light: () => action("[data-featherbase-accent='green']"), dark: () => action("[data-featherbase-accent='green'][data-theme='dark']") }

/** The app's selected view in the shared navigation: the sidebar's frame, as the app places it. */
function sidebarFrame() {
  const sidebar = document.createElement('featherbase-sidebar')
  document.body.append(sidebar)
  return sidebar.shadowRoot!.querySelector<HTMLElement>('.sidebar-frame')!
}

async function installTasker(admin: TestClient) {
  expect(await discoverPackages([TASKER])).toEqual([])
  await admin.post('/api/install_app', { name: 'tasker' })
  await admitTasker(admin)
}

describe('trusted-runtime-packages', () => {
  // ---- The platform is named Featherbase ----

  scenario('A clean instance identifies the platform', async ({ admin }, step) => {
    let switcher!: HTMLElement
    await step('the user is a System Manager on an instance with no installed apps', async () => {
      await discoverAppLibrary([])
      await loadInstalledApps()
      expect((await admin.get<{ installed: unknown[] }>('/api/apps')).installed).toEqual([])
    })
    await step('the user inspects the destination switcher', async () => {
      await renderApp('/featherbase/admin', admin)
      switcher = await screen.findByRole('combobox', { name: 'Switch application' }, LONG)
    })
    await step('the platform destination is named "Featherbase"', async () => {
      await waitFor(() => expect(within(switcher).getAllByRole('option').map((o) => o.textContent)).toContain('Featherbase'))
    })
  })

  scenario('An installed app preserves the platform name', async ({ admin }, step) => {
    let switcher!: HTMLElement
    await step('the user is a System Manager with Tasker installed', () => installTasker(admin))
    await step('the user inspects the destination switcher while using Tasker', async () => {
      const { bar } = await openAppPage(admin, 'tasker')
      switcher = await bar.findByRole('combobox', { name: 'Switch application' }, LONG)
    })
    await step('the platform destination is named "Featherbase"', async () => {
      const featherbase = await within(switcher).findByRole('option', { name: 'Featherbase' })
      expect(featherbase).toHaveValue(FEATHERBASE_ADMIN_DESTINATION.href)
    })
    await step('Tasker retains its own app name', async () => {
      await waitFor(() => expect(within(switcher).getAllByRole('option').map((o) => o.textContent)).toContain('Tasker'))
    })
  })

  // ---- An app owns its screen under the shared top bar ----

  scenario('Signing in returns to the app that was opened', async ({ admin }, step) => {
    let deep = ''
    let loginAt = ''
    let task = ''
    const loads: string[] = []
    await step('the user is signed out', async () => {
      await installTasker(admin)
      await setUserPassword('Administrator', PASSWORD)
      task = String((await taskerClient(admin).post<{ row_id: string }>('/api/save_row',
        { table: 'tasker.task', row: { task_title: 'Selected nested task' } })).row_id)
    })
    await step('the user opens a nested Tasker address with a selected task and signs in', async () => {
      deep = `/tasker/review/37?filter=a%26b&owner=me#task=${task}`
      // The server sends a signed-out visit to sign in with the address; the browser keeps the fragment.
      const visit = await sandboxRequest(deep.split('#')[0]!, { headers: { accept: 'text/html' } })
      expect(visit.status).toBe(302)
      loginAt = `${visit.headers.get('location')}#task=${task}`
      expect(loginAt).toBe(`/featherbase/login?next=${encodeURIComponent('/tasker/review/37?filter=a%26b&owner=me')}#task=${task}`)
      const error = console.error
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const text = args.map(String).join(' ')
        if (text.includes('navigation to another Document')) loads.push(text)
        else error(...args)
      })
      window.history.replaceState(null, '', loginAt)
      await renderApp(loginAt, { user: null, token: null } as never)
      await userEvent.type(await screen.findByLabelText('Email or username', {}, LONG), 'Administrator')
      await userEvent.type(screen.getByLabelText('Password'), PASSWORD)
      await userEvent.click(screen.getByTestId('login-submit'))
      // Signed in, the page loads the app's address in full (a browser makes that load).
      await waitFor(() => expect(loads).toHaveLength(1), LONG)
    })
    await step('the same address and selected task survive refreshing the page', async () => {
      expect(safeLoginNext(new URLSearchParams(loginAt.split('?')[1]!.split('#')[0]).get('next')!, `#task=${task}`)).toBe(deep)
      const token = localStorage.getItem('fc_token')
      expect(token, 'signed in').toBeTruthy()
      // Opened and refreshed: the same address serves Tasker, and the selected task is there.
      for (let load = 0; load < 2; load++) {
        const page = await sandboxRequest(deep.split('#')[0]!, { headers: { accept: 'text/html', authorization: `Bearer ${token}` } })
        expect(page.status).toBe(200)
        expect(await page.text()).toContain('<featherbase-bar data-app="tasker"')
      }
      expect((await taskerClient(admin).get<{ task_title: string }>(`/api/table/tasker.task/${task}`)).task_title).toBe('Selected nested task')
    })
  })

  // ---- An app's page follows the person's theme ----

  scenario("The app's page follows the person's choice over the device's", async ({ admin, createUser }, step) => {
    let reader!: TestClient
    await step('the user has chosen the light theme on a device set to dark', async () => {
      reader = await barReader(admin, createUser)
      deviceIs('dark')
      await choose(reader, 'light')
    })
    await step("the user opens an app's page that follows the theme", () => openBarProof(reader))
    await step("the app's page is light", () => expectApp('light'))
  })

  scenario("A theme change reaches the open app's page", async ({ admin, createUser }, step) => {
    let bar!: Awaited<ReturnType<typeof openBarProof>>['bar']
    await step("the user is on an app's page that follows the theme, in the light theme", async () => {
      const reader = await barReader(admin, createUser)
      deviceIs('light')
      await choose(reader, 'light')
      ;({ bar } = await openBarProof(reader))
      await expectApp('light')
      ;(window as unknown as { __themeProof?: boolean }).__themeProof = true
    })
    await step('the user switches to the dark theme in the shared bar', async () => {
      await userEvent.click(await bar.findByTestId('theme-dark'))
    })
    await step("the app's page turns dark without reloading", async () => {
      await expectApp('dark')
      expect((window as unknown as { __themeProof?: boolean }).__themeProof, 'the page was reloaded').toBe(true)
    })
  })

  // ---- An app can choose its accent colour ----

  scenario("An app's page and navigation take its accent", async ({ admin }, step) => {
    let bar!: Awaited<ReturnType<typeof openAppPage>>['bar']
    let html = ''
    let frame!: HTMLElement
    await step('Tickets names the green accent', async () => {
      expect(manifest(TICKETS).accent).toBe('green')
      expect(await discoverPackages([TICKETS])).toEqual([])
      await admin.post('/api/install_app', { name: 'tickets' })
    })
    await step('the user opens Tickets', async () => {
      deviceIs('light')
      ;({ bar, html } = await openAppPage(admin, 'tickets'))
      frame = sidebarFrame()
    })
    await step("Tickets' main buttons and its selected view in the shared navigation are green", async () => {
      // The app's page carries the accent its buttons are painted from; the bar and the navigation beside it.
      expect(html).toMatch(/<html[^>]*data-featherbase-accent="green"/)
      const root = await bar.findByTestId('bar-theme-root')
      await waitFor(() => expect(root).toHaveAttribute('data-theme', 'light'))
      expect(root).toHaveAttribute('data-featherbase-accent', 'green')
      await waitFor(() => expect(frame.getAttribute('data-featherbase-accent')).toBe('green'))
      expect(green.light()).not.toBe(blue.light())
    })
    await step('the user switches to the dark theme in the shared bar', async () => {
      await userEvent.click(await bar.findByTestId('theme-dark'))
    })
    await step("they are the dark theme's green", async () => {
      const root = bar.getByTestId('bar-theme-root')
      await waitFor(() => expect(root).toHaveAttribute('data-theme', 'dark'))
      expect(root).toHaveAttribute('data-featherbase-accent', 'green')
      frame.remove()
      const after = sidebarFrame()
      expect([after.dataset.theme, after.getAttribute('data-featherbase-accent')]).toEqual(['dark', 'green'])
      expect(green.dark()).not.toBe(blue.dark())
      expect(green.dark()).not.toBe(green.light())
    })
  })

  scenario("An app that names no accent keeps Featherbase's", async ({ admin }, step) => {
    let bar!: Awaited<ReturnType<typeof openAppPage>>['bar']
    let html = ''
    await step('Tasker names no accent', async () => {
      expect(manifest(TASKER).accent).toBeUndefined()
      await installTasker(admin)
    })
    await step('the user opens Tasker', async () => {
      deviceIs('light')
      ;({ bar, html } = await openAppPage(admin, 'tasker'))
    })
    await step("Tasker's selected view in the shared navigation is Featherbase's own blue", async () => {
      expect(html).not.toMatch(/data-featherbase-accent|data-accent/)
      expect(await bar.findByTestId('bar-theme-root')).not.toHaveAttribute('data-featherbase-accent')
      expect(sidebarFrame().hasAttribute('data-featherbase-accent')).toBe(false)
      // With no accent, the action colour is the stylesheet's own.
      expect(blue.light()).toBe('#1d4ed8')
    })
  })
})
