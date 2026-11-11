// app-navigation's fenced scenarios (#1070), rendered in jsdom against the
// real in-process server. Each test is one scenario of
// openspec/specs/app-navigation/spec.md, step by step.
//
// An app's page is drawn as the served document draws it: the platform's bar
// (src/bar, mounted into its <featherbase-bar> host) above the app's own React
// page (Tasker's real source, and Store Reports' page from test-apps), with
// their shared sidebar element.
// Leaving for another document (the switcher, a plain link) renders that
// document; jsdom cannot navigate. The redirects between the served documents
// themselves are the server's (runtime-shell tests) and a real browser's.
import { resolve } from 'node:path'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { createSession } from 'feather-testing-postgres/session'
import { discoverPackages } from 'server/src/runtime-packages'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { admitTasker, taskerClient } from 'server/test/tasker-client'
import { scenarioFor } from 'server/test/scenario'
import { setSession } from '../../src/lib/api'
import { mountBar } from '../../src/bar/mount'
import { FeatherbaseSidebar } from '../../src/bar/sidebar'
import { TaskManagementPage } from '../../../../example-apps/tasker/src/TaskManagement'
import { drawPage } from '../../../../test-apps/fixtures/store-reports/client/page.mjs'
import { test, expect, renderApp } from '../pg-test'

const scenario = scenarioFor(test, 'app-navigation')
const WAIT = { timeout: 15_000 }
const TASKER_DIR = resolve('../..', 'example-apps/tasker')
const STORE_REPORTS_DIR = resolve('../..', 'test-apps/fixtures/store-reports')
if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)

/** Tasker and Store Reports installed. */
async function install() {
  expect(await discoverPackages([TASKER_DIR, STORE_REPORTS_DIR])).toEqual([])
  for (const name of ['tasker', 'storereports']) {
    if (await isInstalled(name)) await uninstallApp(name)
    await installApp(name)
  }
}
afterEach(async () => { await discoverPackages([]) })

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
async function openAppPage(as: TestClient, app: 'tasker' | 'storereports', path: string) {
  closePage()
  window.history.replaceState(null, '', path)
  setSession(as.token!, { row_id: as.user!, email: null, full_name: null })
  // The apps' own clients read the session the platform keeps.
  localStorage.setItem('fc_token', as.token!)
  localStorage.setItem('fc_user', JSON.stringify({ row_id: as.user }))
  const host = document.createElement('featherbase-bar')
  host.dataset.app = app
  host.dataset.title = app === 'tasker' ? 'Tasker' : 'Store Reports'
  document.body.prepend(host)
  left = []
  sendSessionCookie(as.token!)
  const mounted = mountBar(host, { leave: (href) => { left.push(href) } })
  bar = { ...mounted, host }
  await act(async () => {
    if (app === 'tasker')
      appPage = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TaskManagementPage /></QueryClientProvider>)
    else {
      const root = document.body.appendChild(document.createElement('div'))
      const undraw = drawPage(root)
      appPage = { unmount: () => { undraw(); root.remove() } }
    }
  })
  reopen = async (href) => { await openAppPage(as, app, href) }
  return within(host.shadowRoot as unknown as HTMLElement)
}
const sidebar = () => document.querySelector('featherbase-sidebar') as HTMLElement
/** The app's own page, driven through the Session DSL. The bar's checks stay raw
 *  Testing Library over its shadow root: they read a select's option values, an
 *  element's absence and a select's whole text, which no DSL verb checks the same way. */
const page = () => createSession({ timeout: WAIT.timeout })
const switcher = (barView: ReturnType<typeof within>) => barView.findByRole('combobox', { name: 'Switch application' }, WAIT)

/** The person who may open Tasker and Store Reports but not Featherbase. */
async function tlWithoutFeatherbase(admin: TestClient, createUser: (o: { email?: string; roles: string[] }) => Promise<TestClient>) {
  await install()
  await admitTasker(admin)
  return createUser({ email: 'nav.reader@example.test', roles: ['Store Reports Reader', 'Tasker Member'] })
}

describe('app-navigation', () => {
  scenario('Featherbase is a destination alongside the applications', async ({ admin }, step) => {
    let barView: ReturnType<typeof within>
    await step('the user can open Featherbase, Tasker and Store Reports', async () => {
      await install()
      await admitTasker(admin)
    })
    await step("the user chooses Featherbase from Tasker's application name", async () => {
      barView = await openAppPage(admin, 'tasker', '/tasker/')
      const choices = (await switcher(barView)) as HTMLSelectElement
      await waitFor(() => expect([...choices.options].map((o) => o.value)).toContain('/featherbase/admin'), WAIT)
      await userEvent.selectOptions(choices, '/featherbase/admin')
      await waitFor(() => expect(left).toEqual(['/featherbase/admin']), WAIT)
    })
    await step('Featherbase opens', async () => {
      closePage()
      await renderApp(left[0]!, admin)
      expect(await screen.findByTestId('admin-sidebar', {}, WAIT)).toBeInTheDocument()
    })
    await step('no separate administration control is offered on Tasker', async () => {
      barView = await openAppPage(admin, 'tasker', '/tasker/')
      await switcher(barView)
      await waitFor(() => expect(sidebar()).not.toBeNull(), WAIT)
      expect(barView.queryByTestId('open-admin')).toBeNull()
      expect(screen.queryByTestId('open-admin')).toBeNull()
      expect(within(sidebar()).queryAllByRole('link', { name: /Featherbase|Admin/ })).toHaveLength(0)
    })
  })

  scenario('A reader sees only accessible destinations', async ({ admin, createUser }, step) => {
    let reader: TestClient
    let barView: ReturnType<typeof within>
    await step('the user can open Tasker and Store Reports but cannot open Featherbase', async () => { reader = await tlWithoutFeatherbase(admin, createUser) })
    await step('the user opens the application choices in Store Reports', async () => {
      barView = await openAppPage(reader, 'storereports', '/storereports/')
    })
    await step('Tasker and Store Reports are offered', async () => {
      expect(await barView.findByTestId('session-user', {}, WAIT)).toBeInTheDocument()
      const choices = (await switcher(barView)) as HTMLSelectElement
      // The switcher holds only the current app until the catalog answers.
      await waitFor(() => expect([...choices.options].some((o) => o.textContent === 'Tasker')).toBe(true), WAIT)
      expect([...choices.options].map((o) => o.textContent).sort()).toEqual(['Store Reports', 'Tasker'])
    })
    await step('Featherbase is not offered', async () => {
      const choices = (await switcher(barView)) as HTMLSelectElement
      expect(choices.querySelector('option[value="/featherbase/admin"]')).toBeNull()
    })
  })

  scenario('Tasker keeps its project work', async ({ admin, createUser }, step) => {
    let reader: TestClient
    await step('the user can open Tasker and Store Reports but cannot open Featherbase', async () => { reader = await tlWithoutFeatherbase(admin, createUser) })
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

  scenario('The selected store is kept', async ({ admin, createUser }, step) => {
    let reader: TestClient
    let barView: ReturnType<typeof within>
    const storePicker = () => barView.findByRole('combobox', { name: 'Store' }, WAIT)
    await step('the user can open Tasker and Store Reports but cannot open Featherbase', async () => { reader = await tlWithoutFeatherbase(admin, createUser) })
    await step('the user has selected Lakeside in Store Reports', async () => {
      barView = await openAppPage(reader, 'storereports', '/storereports/?store=9902')
      const answer = await reader.get<{ controls: { options: { label: string; value: string }[] }[] }>('/api/app_bar/storereports')
      expect(answer.controls[0]?.options).toEqual([{ label: 'Hill Road', value: '9901' }, { label: 'Lakeside', value: '9902' }])
      await waitFor(async () => expect(await storePicker()).toHaveTextContent('Lakeside'), WAIT)
    })
    await step('the user opens the store report through the shared navigation', async () => {
      await page().within('featherbase-sidebar', (nav) => nav.clickLink('Store report'))
      await loading
      barView = within(bar!.host.shadowRoot as unknown as HTMLElement)
    })
    await step('Lakeside remains selected', async () => {
      await waitFor(async () => expect(await storePicker()).toHaveTextContent('Lakeside'), WAIT)
      expect(new URLSearchParams(window.location.search).get('store')).toBe('9902')
    })
    await step('Store Reports shows the report for Lakeside', async () => {
      const report = screen.getByTestId('store-reports')
      expect(report.dataset.view).toBe('report')
      expect(report.dataset.store).toBe('9902')
    })
  })
})
