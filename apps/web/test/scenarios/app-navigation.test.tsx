// app-navigation's fenced scenarios (#1070), rendered in jsdom against the
// real in-process server. Each test is one scenario of
// openspec/specs/app-navigation/spec.md, step by step.
//
// An app's page is drawn as the served document draws it: the platform's bar
// (src/bar, mounted into its <featherbase-bar> host) above the app's own React
// page, Tasker's and Dash's real source, with their shared sidebar element.
// Leaving for another document (the switcher, a plain link) renders that
// document; jsdom cannot navigate. The redirects between the served documents
// themselves are the server's (runtime-shell tests) and a real browser's.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe } from 'vitest'
import type { SeedFn, TestClient } from 'feather-testing-postgres'
import { makeClient } from 'feather-testing-postgres'
import { createSession } from 'feather-testing-postgres/session'
import { discoverPackages } from 'server/src/runtime-packages'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { admitTasker, taskerClient } from 'server/test/tasker-client'
import { scenarioFor } from 'server/test/scenario'
import { setSession } from '../../src/lib/api'
import { mountBar } from '../../src/bar/mount'
import { FeatherbaseSidebar } from '../../src/bar/sidebar'
import { TaskManagementPage } from '../../../../example-apps/tasker/src/TaskManagement'
import { Dash } from '../../../../client-apps/jeyarama/dash/src/app'
// @ts-expect-error a plain .mjs module of Dash's own platform tests
import { ACCESS_ROWS, BASE_TABLES, LINKED_TABLES, REPORT_ROWS } from '../../../../client-apps/jeyarama/dash/platform-test/base-tables.mjs'
import { test, expect, renderApp } from '../pg-test'
import { appChoices, chooseApp, currentApp, switcherButton } from '../app-switcher'

const scenario = scenarioFor(test, 'app-navigation')
const WAIT = { timeout: 15_000 }
const TASKER_DIR = resolve('../..', 'example-apps/tasker')
const DASH_DIR = resolve('../..', 'client-apps/jeyarama/dash')
const DASH_VERSION: string = JSON.parse(readFileSync(resolve(DASH_DIR, 'package.json'), 'utf8')).version
if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)

const dashClient = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': `dash@${DASH_VERSION}`, ...init?.headers },
}) }, client.token, client.user)

/** Tasker and Dash installed. */
async function install(admin: TestClient) {
  expect(await discoverPackages([TASKER_DIR, DASH_DIR])).toEqual([])
  for (const name of ['tasker', 'dash']) {
    if (await isInstalled(name)) await uninstallApp(name)
    await installApp(name)
  }
  // Satisfy Dash's declared host secret without a real warehouse token.
  process.env.MOTHERDUCK_TOKEN = 'scenario-unused-warehouse-token'
}
const hostToken = process.env.MOTHERDUCK_TOKEN
afterEach(async () => {
  if (hostToken === undefined) delete process.env.MOTHERDUCK_TOKEN
  else process.env.MOTHERDUCK_TOKEN = hostToken
  await discoverPackages([])
})

/** #1046: Dash opens only for someone with a report they can open; Dash reads a reader's reach from the core Tables. */
async function storesFor(admin: TestClient, seed: SeedFn, reader: TestClient) {
  for (const table of BASE_TABLES) await admin.post('/api/table_def', table)
  await seed('App Setting', { row_id: 'dash.linked_tables', value: JSON.stringify(LINKED_TABLES) })
  // Dash's own Tables answer only a client that names Dash's version, which seed's admin does not.
  const dash = dashClient(admin)
  for (const [plant_code, code, name] of [['9901', 'HIL', 'Hill Road'], ['9902', 'LKS', 'Lakeside']]) {
    await seed('Site', { code, name, is_store: true })
    await seed('Plant', { plant_code, plant_type: 'Store', site: code })
  }
  for (const row of REPORT_ROWS) await dash.post('/api/save_row', { table: 'dash.report', row })
  for (const row of ACCESS_ROWS) await dash.post('/api/save_row', { table: 'dash.report_access', row })
  const employee = `E-${reader.user}`
  await seed('Employee', { employee_code: employee, name: 'Made-up Manager', person: reader.user, status: 'Current' })
  for (const code of ['HIL', 'LKS'])
    await seed('Job Assignment', { assignment_id: `JA-${employee}-${code}`, employee, job: 'Store Manager', site: code, starts_on: '2026-01-01' })
}

// ---- An app's page: the bar and the app, in one document.
let bar: { unmount: () => void; host: HTMLElement } | null = null
let appPage: { unmount: () => void } | null = null
let left: string[] = []
let bridged: typeof fetch | null = null
function closePage() {
  act(() => { bar?.unmount(); appPage?.unmount() })
  bar?.host.remove()
  bar = appPage = null
  if (bridged) globalThis.fetch = bridged
  bridged = null
}

/** The browser's session cookie rides along on the page's own same-origin requests. */
function sendSessionCookie(token: string) {
  const inner = (bridged = globalThis.fetch)
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    if (!headers.has('cookie')) headers.set('cookie', `sid=${token}`)
    return inner(input, { ...init, headers })
  }) as typeof fetch
}
afterEach(() => { closePage(); window.history.replaceState(null, '', '/') })

// A plain link's click is a document load: the page is drawn again there.
let loading: Promise<void> = Promise.resolve()
let reopen: ((href: string) => Promise<void>) | null = null
function followDocumentLinks(event: MouseEvent) {
  const anchor = (event.composedPath()[0] as Element | null)?.closest?.('a')
  if (!anchor || event.defaultPrevented || !anchor.getAttribute('href') || !reopen) return
  event.preventDefault()
  const href = anchor.getAttribute('href')!
  const again = reopen
  loading = new Promise<void>((done) => setTimeout(done, 0)).then(() => again(href))
}
document.addEventListener('click', followDocumentLinks)

/** An installed app's page at `path`, signed in as `as`: the bar the served document mounts, then the app. */
async function openAppPage(as: TestClient, app: 'tasker' | 'dash', path: string) {
  closePage()
  window.history.replaceState(null, '', path)
  setSession(as.token!, { row_id: as.user!, email: null, full_name: null })
  // The apps' own clients read the session the platform keeps.
  localStorage.setItem('fc_token', as.token!)
  localStorage.setItem('fc_user', JSON.stringify({ row_id: as.user }))
  const host = document.createElement('featherbase-bar')
  host.dataset.app = app
  host.dataset.title = app === 'tasker' ? 'Tasker' : 'Dash'
  document.body.prepend(host)
  left = []
  sendSessionCookie(as.token!)
  const mounted = mountBar(host, { leave: (href) => { left.push(href) } })
  bar = { ...mounted, host }
  await act(async () => {
    appPage = render(app === 'tasker'
      ? <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TaskManagementPage /></QueryClientProvider>
      : <Dash />)
  })
  reopen = async (href) => { await openAppPage(as, app, href) }
  return within(host.shadowRoot as unknown as HTMLElement)
}
const sidebar = () => document.querySelector('featherbase-sidebar') as HTMLElement
/** The app's own page, driven through the Session DSL. The bar's checks stay raw
 *  Testing Library over its shadow root: they read a select's option values, an
 *  element's absence and a select's whole text, which no DSL verb checks the same way. */
const page = () => createSession({ timeout: WAIT.timeout })

/** The person who may open Tasker and Dash but not Featherbase. */
async function tlWithoutFeatherbase(admin: TestClient, seed: SeedFn, createUser: (o: { email?: string; roles: string[] }) => Promise<TestClient>) {
  await install(admin)
  await admitTasker(admin)
  const reader = await createUser({ email: 'nav.reader@example.test', roles: ['Dash Reader', 'Tasker Member'] })
  await storesFor(admin, seed, reader)
  return reader
}

describe('app-navigation', () => {
  scenario('Featherbase is a destination alongside the applications', async ({ admin }, step) => {
    let barView: ReturnType<typeof within>
    await step('the user can open Featherbase, Tasker and Dash', async () => {
      await install(admin)
      await admitTasker(admin)
    })
    await step("the user chooses Featherbase from Tasker's application name", async () => {
      barView = await openAppPage(admin, 'tasker', '/tasker/')
      await waitFor(async () => expect(await appChoices(barView, WAIT)).toContain('Featherbase'), WAIT)
      await chooseApp(barView, 'Featherbase')
      await waitFor(() => expect(left).toEqual(['/featherbase/admin']), WAIT)
    })
    await step('Featherbase opens', async () => {
      closePage()
      await renderApp(left[0]!, admin)
      expect(await screen.findByTestId('admin-sidebar', {}, WAIT)).toBeInTheDocument()
    })
    await step('no separate administration control is offered on Tasker', async () => {
      barView = await openAppPage(admin, 'tasker', '/tasker/')
      await switcherButton(barView, WAIT)
      await waitFor(() => expect(sidebar()).not.toBeNull(), WAIT)
      expect(barView.queryByTestId('open-admin')).toBeNull()
      expect(screen.queryByTestId('open-admin')).toBeNull()
      expect(within(sidebar()).queryAllByRole('link', { name: /Featherbase|Admin/ })).toHaveLength(0)
    })
  })

  scenario('A reader sees only accessible destinations', async ({ admin, createUser, seed }, step) => {
    let reader: TestClient
    let barView: ReturnType<typeof within>
    await step('the user can open Tasker and Dash but cannot open Featherbase', async () => { reader = await tlWithoutFeatherbase(admin, seed, createUser) })
    await step('the user opens the application choices in Dash', async () => {
      barView = await openAppPage(reader, 'dash', '/dash/')
    })
    await step('Tasker and Dash are offered', async () => {
      expect(await barView.findByTestId('session-user', {}, WAIT)).toBeInTheDocument()
      // The switcher holds only the current app until the catalog answers.
      await waitFor(async () => expect(await appChoices(barView, WAIT)).toContain('Tasker'), WAIT)
      expect((await appChoices(barView, WAIT)).sort()).toEqual(['Dash', 'Tasker'])
    })
    await step('Featherbase is not offered', async () => {
      expect(await appChoices(barView, WAIT)).not.toContain('Featherbase')
    })
  })

  scenario('Tasker keeps its project work', async ({ admin, createUser, seed }, step) => {
    let reader: TestClient
    await step('the user can open Tasker and Dash but cannot open Featherbase', async () => { reader = await tlWithoutFeatherbase(admin, seed, createUser) })
    await step('Tasker has a project named September stock review with two tasks', async () => {
      const tasker = taskerClient(admin)
      const { row_id } = await tasker.post<{ row_id: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'September stock review' } })
      for (const task_title of ['Count the blue shirts', 'Review the missing sizes'])
        await tasker.post('/api/save_row', { table: 'tasker.task', row: { task_title, project: row_id } })
    })
    await step('the user opens September stock review through the shared navigation', async () => {
      await openAppPage(reader, 'tasker', '/tasker/')
      await page().within('featherbase-sidebar', (nav) => nav.clickButton('September stock review'))
      await loading
    })
    await step("the project's two tasks are shown", async () => {
      for (const name of ['Count the blue shirts', 'Review the missing sizes'])
        expect(await screen.findByRole('link', { name }, WAIT)).toBeInTheDocument()
    })
    await step('the shared navigation identifies September stock review as current', () =>
      page().within('featherbase-sidebar button[aria-label="September stock review"]', (project) => project.assertAttribute('aria-current', 'page')))
  })

  scenario('Dash keeps the selected store', async ({ admin, createUser, seed }, step) => {
    let reader: TestClient
    let barView: ReturnType<typeof within>
    const storePicker = () => barView.findByRole('combobox', { name: 'Store' }, WAIT)
    await step('the user can open Tasker and Dash but cannot open Featherbase', async () => { reader = await tlWithoutFeatherbase(admin, seed, createUser) })
    await step('the user has selected Lakeside in Dash', async () => {
      barView = await openAppPage(reader, 'dash', '/dash/?store=9902')
      const answer = await reader.get<{ controls: { options: { label: string; value: string }[] }[] }>('/api/app_bar/dash')
      expect(answer.controls[0]?.options).toEqual([{ label: 'Hill Road', value: '9901' }, { label: 'Lakeside', value: '9902' }])
      await waitFor(async () => expect(await storePicker()).toHaveTextContent('Lakeside'), WAIT)
    })
    await step('the user opens the report through the shared navigation', async () => {
      await page()
        .until('the shared navigation lists the report', () => within(sidebar()).queryByRole('link', { name: 'Sales versus target' }))
        .within('featherbase-sidebar', (nav) => nav.clickLink('Sales versus target'))
      await loading
      barView = within(bar!.host.shadowRoot as unknown as HTMLElement)
    })
    await step('Lakeside remains selected', async () => {
      await waitFor(async () => expect(await storePicker()).toHaveTextContent('Lakeside'), WAIT)
      expect(new URLSearchParams(window.location.search).get('store')).toBe('9902')
    })
    await step('Dash shows the report state for Lakeside', async () => {
      // Any view but these: assertAttribute checks one value, refuteAttribute only absence.
      await waitFor(() => expect(screen.getByTestId('dash').getAttribute('data-view')).not.toBe('opening'), WAIT)
      expect(screen.getByTestId('dash').getAttribute('data-view')).not.toBe('no_access')
      await waitFor(async () => expect(await storePicker()).toHaveTextContent('Lakeside'), WAIT)
      expect(new URLSearchParams(window.location.search).get('store')).toBe('9902')
    })
  })

  // #1227: one top bar and sidebar on every page.
  // #1248: collapsed, the sidebar is a rail of icons: still there, still usable.
  const rail = () => sidebar().hasAttribute('data-collapsed') && !sidebar().inert
  /** The sidebar's own collapse control (its footer row, in its shadow). */
  const sidebarControl = () => waitFor(() => {
    const control = sidebar().shadowRoot?.querySelector<HTMLElement>('[data-testid=sidebar-collapse]')
    expect(control).toBeTruthy()
    return control!
  }, WAIT)
  const appSidebar = () => waitFor(() => expect(sidebar()).not.toBeNull(), WAIT)

  scenario('The sidebar collapses the same way in every application', async ({ admin, createUser, seed }, step) => {
    let reader: TestClient
    let barView: ReturnType<typeof within>
    await step('the user can open Tasker and Dash but cannot open Featherbase', async () => { reader = await tlWithoutFeatherbase(admin, seed, createUser) })
    await step('the user presses Ctrl+B in Tasker', async () => {
      barView = await openAppPage(reader, 'tasker', '/tasker/')
      await appSidebar()
      await sidebarControl()
      await barView.findByTestId('session-user', {}, WAIT)
      // false: the page took the key, so the browser's own use of it does not happen.
      expect(fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true })).toBe(false)
    })
    await step("Tasker's navigation shows only its icons", () => expect(rail()).toBe(true))
    await step('the user opens Dash', async () => {
      barView = await openAppPage(reader, 'dash', '/dash/')
      await appSidebar()
    })
    await step("Dash's navigation shows only its icons too", () => expect(rail()).toBe(true))
    await step('the user expands the sidebar from the sidebar itself', async () => {
      const control = await sidebarControl()
      expect(control).toHaveAccessibleName('Expand sidebar')
      await userEvent.click(control)
    })
    await step("Dash's navigation is shown in full", () => {
      expect(sidebar().hasAttribute('data-collapsed')).toBe(false)
      expect(sidebar().inert).toBe(false)
    })
  })

  scenario('Typing keeps the shortcut for the field', async ({ admin, createUser, seed }, step) => {
    let reader: TestClient
    await step('the user can open Tasker and Dash but cannot open Featherbase', async () => { reader = await tlWithoutFeatherbase(admin, seed, createUser) })
    await step("the user presses Ctrl+B while typing in Tasker's search", async () => {
      const barView = await openAppPage(reader, 'tasker', '/tasker/')
      await appSidebar()
      await sidebarControl()
      await barView.findByTestId('session-user', {}, WAIT)
      const search = await screen.findByPlaceholderText('Search tasks', {}, WAIT)
      await userEvent.type(search, 'shirts{Control>}b{/Control}')
      // true: nothing took the key from the field.
      expect(fireEvent.keyDown(search, { key: 'b', metaKey: true })).toBe(true)
    })
    await step("Tasker's navigation stays shown", () => expect(sidebar().hasAttribute('data-collapsed')).toBe(false))
  })

  scenario('The account pages carry the application switcher', async ({ admin, createUser, seed }, step) => {
    let reader: TestClient
    await step('the user can open Tasker and Dash but cannot open Featherbase', async () => { reader = await tlWithoutFeatherbase(admin, seed, createUser) })
    await step("the user opens Sign-in methods from Dash's account menu", async () => {
      const barView = await openAppPage(reader, 'dash', '/dash/')
      await userEvent.click(await barView.findByTestId('session-user', {}, WAIT))
      await userEvent.click(await barView.findByTestId('account-sign-in-methods', {}, WAIT))
      await waitFor(() => expect(left).toEqual(['/featherbase/account/sign-in-methods']), WAIT)
      closePage()
      await renderApp(left[0]!, reader)
      expect(await screen.findByTestId('account-layout', {}, WAIT)).toBeInTheDocument()
    })
    await step('the application name shows Dash', async () => {
      await waitFor(async () => expect(await currentApp(screen, WAIT)).toBe('Dash'), WAIT)
    })
    await step('Tasker is offered beside it', async () => {
      await waitFor(async () => expect(await appChoices(screen, WAIT)).toContain('Tasker'), WAIT)
    })
  })
})
