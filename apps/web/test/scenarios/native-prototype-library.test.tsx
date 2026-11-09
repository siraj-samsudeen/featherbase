// native-prototype-library's fenced scenarios (#1070). The synthetic UI Lab is
// the real prototype server (vite.prototype.config.ts, started here as its own
// process, as `pnpm --filter web exec vite --config vite.prototype.config.ts`
// starts it), and its screens are the real prototype router rendered in jsdom
// with every request going to that server and nowhere else. The isolated real
// server is the in-process one. Each test is one scenario of
// openspec/specs/native-prototype-library/spec.md, step by step.
//
// A link that loads a new document (a plain anchor) and a reload are the page
// rendered again at that address; sessionStorage stays, as in one browser tab.
// jsdom lays nothing out: that the real server's form keeps the synthetic
// form's positions and widths is measured only in a real browser. Here it
// keeps the same controls, in the same order, with the same labels.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { afterAll, afterEach, beforeAll, describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { rowHref } from 'shared'
import { scenarioFor } from 'server/test/scenario'
import { setSession } from '../../src/lib/api'
import { createPrototypeRouter } from '../../src/gallery/PrototypeApp'
import { PrototypeLibrary } from '../../src/gallery/PrototypeLibrary'
import { test, expect, renderApp, onScreen, inside } from '../pg-test'

const scenario = scenarioFor(test, 'native-prototype-library')
const WAIT = { timeout: 15_000 }

// Captured before the in-process bridge replaces fetch: the prototype must
// never reach the real app.
const networkFetch = globalThis.fetch
let origin = ''
let server: ChildProcess

const freePort = () => new Promise<number>((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as { port: number }
    probe.close(() => resolve(port))
  })
})

beforeAll(async () => {
  const port = await freePort()
  origin = `http://127.0.0.1:${port}`
  server = spawn('node_modules/.bin/vite', ['--config', 'vite.prototype.config.ts', '--host', '127.0.0.1'], {
    env: { ...process.env, PROTOTYPE_PORT: String(port) }, stdio: 'ignore',
  })
  const deadline = Date.now() + 30_000
  for (;;) {
    const ready = await networkFetch(`${origin}/__lab/scenario`).then((r) => r.ok, () => false)
    if (ready) break
    if (Date.now() > deadline) throw new Error('The synthetic prototype did not start')
    await new Promise((r) => setTimeout(r, 200))
  }
}, 40_000)
afterAll(() => { server?.kill() })

/** Any request the prototype makes, to the prototype server. */
const synthetic = (path: string, init?: RequestInit) => {
  // The page's AbortSignal belongs to jsdom; Node's Request rejects it.
  const { signal: _signal, ...rest } = init ?? {}
  return networkFetch(new URL(path, origin), rest)
}
let bridged: typeof fetch | null = null
let page: { unmount: () => void } | null = null
function useSyntheticServer() {
  if (bridged) return
  bridged = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const { pathname, search } = new URL(url, 'http://prototype.invalid')
    return synthetic(pathname + search, init)
  }) as typeof fetch
}
function leaveSyntheticServer() {
  unload()
  if (bridged) globalThis.fetch = bridged
  bridged = null
}
// A page leaving: its router's history lets go of window.history, as a new document's would.
let history: { destroy: () => void } | null = null
function unload() {
  page?.unmount()
  page = null
  history?.destroy()
  history = null
}
afterEach(leaveSyntheticServer)

// A plain anchor's click is a document load: render the page again there.
let loading: Promise<void> = Promise.resolve()
function followDocumentLinks(event: MouseEvent) {
  const anchor = (event.target as Element | null)?.closest?.('a')
  if (!anchor || event.defaultPrevented || !anchor.getAttribute('href')) return
  event.preventDefault()
  // The new document loads after this click has finished, not inside its handler.
  const href = anchor.getAttribute('href')!
  loading = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => load(href))
}
beforeAll(() => document.addEventListener('click', followDocumentLinks))
afterAll(() => document.removeEventListener('click', followDocumentLinks))

/** The prototype page at `path`, loaded afresh. */
async function load(path: string) {
  useSyntheticServer()
  unload()
  window.history.replaceState(null, '', path)
  setSession('synthetic-ui-lab', { row_id: 'Administrator', full_name: 'Synthetic designer', email: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createPrototypeRouter(<PrototypeLibrary />)
  history = router.history
  await act(async () => {
    page = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  })
}
const reload = () => load(window.location.pathname + window.location.search)
async function click(element: Element) {
  await userEvent.click(element)
  await loading
}

/** The library, on a freshly populated synthetic scenario. */
async function open() {
  const reset = await synthetic('/__lab/scenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: 'populated' }) })
  expect(reset.ok).toBe(true)
  await load('/prototype.html')
  await screen.findByRole('heading', { name: 'Build with what exists' }, WAIT)
}
const listRows = () => screen.getByTestId('list-rows')
const rowLink = (name: string) => within(listRows()).getByRole('link', { name })
const breadcrumb = (name: string) => within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name })
// Whether a search box is on screen at all: the DSL has no verb for presence.
const searchbox = (name: string) => screen.getByRole('searchbox', { name }) as HTMLInputElement
const fill = (label: string, value: string) => onScreen().fillIn(label, value)

/** The form's controls, in order: what each is and is called. */
function controls() {
  return [...screen.getByTestId('form-view').querySelectorAll<HTMLInputElement>('input[data-field], select[data-field]')].map((control) => ({
    column: control.getAttribute('data-field'), tag: control.tagName, type: control.type,
    label: document.getElementById(control.getAttribute('aria-labelledby') ?? '')?.textContent ?? null,
  }))
}
async function rowForm() {
  await load(rowHref('Lab Project', 'lab-north'))
  await screen.findByRole('textbox', { name: 'Region' }, WAIT)
}
async function save() {
  await onScreen().clickButton('Save')
  await waitFor(() => expect(screen.getByTestId('form-save')).toBeDisabled(), WAIT)
}

describe('native-prototype-library', () => {
  scenario('Find a list example', async ({}, step) => {
    await step('the user is exploring the native prototype library', open)
    await step('the user searches the examples for "list"', async () => {
      await onScreen().clickButton('Component gallery')
      await fill('Search components', 'list')
    })
    await step('the user sees matching working examples and their reuse locations', async () => {
      expect(await screen.findByRole('heading', { name: 'List (a table when wide, cards on a phone)' }, WAIT)).toBeInTheDocument()
      expect(screen.getByText('packages/shop-floor/src/DataList.tsx', { exact: true })).toBeVisible()
    })
    await step('unrelated examples are excluded', () => expect(screen.queryByRole('heading', { name: 'Buttons' })).toBeNull())
  })

  scenario('Return to a searched collection', async ({}, step) => {
    let original = ''
    await step('the user has searched the prototype collection for "North"', async () => {
      await open()
      await fill('Search or type a command', 'Lab')
      await waitFor(() => expect(screen.getAllByTestId('awesomebar-table').some((t) => t.textContent?.includes('Lab Project'))).toBe(true), WAIT)
      expect(screen.getAllByTestId('awesomebar-table')).toHaveLength(2)
      expect(screen.getAllByTestId('awesomebar-new')).toHaveLength(2)
      await click(screen.getAllByTestId('awesomebar-table').find((t) => t.textContent?.includes('Lab Project'))!)
      await fill('Search Lab Project names', 'North')
      await waitFor(() => expect(rowLink('North workshop')).toBeInTheDocument(), WAIT)
      original = window.location.href
      expect(within(listRows()).queryByText('South studio', { exact: true })).toBeNull()
    })
    await step('the user opens an item and follows its related collection', async () => {
      await click(rowLink('North workshop'))
      await screen.findByRole('textbox', { name: 'Name' }, WAIT)
      await click(screen.getByRole('link', { name: 'Related tasks →' }))
      await waitFor(() => expect(within(listRows()).getByText('Prepare workshop', { exact: true })).toBeInTheDocument(), WAIT)
      expect(searchbox('Search Lab Task names')).toBeInTheDocument()
    })
    await step('the user can follow the trail back to the original collection', async () => {
      await click(breadcrumb('Project'))
      await screen.findByRole('textbox', { name: 'Name' }, WAIT)
      await click(breadcrumb('Lab Project'))
      await waitFor(() => expect(within(listRows()).getByText('North workshop', { exact: true })).toBeInTheDocument(), WAIT)
    })
    await step('the original search and selected section are retained', async () => {
      expect(window.location.href).toBe(original)
      await onScreen().assertValue('Search Lab Project names', 'North')
      expect(within(listRows()).queryByText('South studio', { exact: true })).toBeNull()
      await open()
      await onScreen().clickButton('Native Table list')
      await fill('Search Lab Project names', 'South')
      await click(await waitFor(() => rowLink('South studio'), WAIT))
      await screen.findByRole('textbox', { name: 'Region' }, WAIT)
      await click(breadcrumb('Lab Project'))
      expect(await screen.findByRole('tabpanel', { name: 'Native Table list' }, WAIT)).toBeInTheDocument()
      await onScreen().assertValue('Search Lab Project names', 'South')
      await waitFor(() => expect(within(listRows()).getByText('South studio', { exact: true })).toBeInTheDocument(), WAIT)
      expect(within(listRows()).queryByText('North workshop', { exact: true })).toBeNull()
    })
  }, 60_000)

  scenario('Reset a local edit', async ({}, step) => {
    await step('the user is exploring the populated synthetic prototype', open)
    await step('the user edits an example and resets the prototype', async () => {
      await rowForm()
      await fill('Region', 'Edited synthetic region')
      await save()
      await reload()
      await onScreen().assertValue('Region', 'Edited synthetic region')
      await onScreen().clickButton('Reset data')
    })
    await step('the original synthetic example is restored', async () => {
      await waitFor(() => expect(document.querySelector<HTMLInputElement>('input[data-field="region"]')?.value).toBe('North'), WAIT)
      await open()
      await onScreen().clickButton('Native Table list')
      const choose = (value: string) => onScreen().selectOption('Synthetic scenario', value)
      await choose('empty')
      await inside(onScreen(), 'list-rows', (rows) => rows.assertText('No rows'))
      await choose('loading')
      await waitFor(() => expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('Loading Lab Project'))).toBe(true), WAIT)
      await choose('error')
      await waitFor(() => expect(screen.getByTestId('list-rows-error').textContent).toMatch(/Synthetic load failed/), WAIT)
      await choose('permission-limited')
      await waitFor(() => expect(screen.getByTestId('list-rows-error').textContent).toMatch(/Simulated permission restriction/), WAIT)
      await choose('populated')
      await waitFor(() => expect(within(listRows()).getByText('South studio', { exact: true })).toBeInTheDocument(), WAIT)
      await onScreen().clickButton('Reset data')
      await waitFor(() => expect(within(listRows()).getByText('North workshop', { exact: true })).toBeInTheDocument(), WAIT)
      expect(screen.getByRole('tab', { name: 'Native Table list' })).toHaveAttribute('aria-selected', 'true')
    })
    await step('the preview states that access restrictions are simulated', () => {
      expect(screen.getByText(/Permission scenarios are not security evidence/)).toBeVisible()
    })
  }, 60_000)

  scenario('Unsupported actions cannot reach real accounts', async ({}, step) => {
    let original: unknown
    let refusal: Response
    await step('the user is exploring the synthetic prototype', open)
    await step('an action has no synthetic response', async () => {
      original = await (await synthetic('/api/table/Lab%20Project/lab-north')).json()
      refusal = await synthetic('/api/table/Lab%20Project/lab-north', { method: 'DELETE' })
    })
    await step('the action is refused without contacting a real account', async () => {
      expect(refusal.status).toBe(501)
      expect(((await refusal.clone().json()) as { error: { message: string } }).error.message).toMatch(/Nothing was forwarded/)
      expect(await (await synthetic('/api/table/Lab%20Project/lab-north')).json()).toEqual(original)
      for (const path of ['/api/upload', '/files/private-test', '/private/test', '/ws']) {
        const result = await synthetic(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        expect(result.status, path).toBe(501)
      }
    })
    await step('the user is not told that the action succeeded', () => expect(refusal.ok, 'Unsupported action succeeded').toBe(false))
  })

  scenario('Use the same row form with real data', async ({ admin }, step) => {
    let syntheticControls: ReturnType<typeof controls>
    await step('the user has explored a row form in the synthetic prototype', async () => {
      await open()
      await rowForm()
      syntheticControls = controls()
      // The retained native shell reconciles visits using one acknowledgement per event.
      const before = Date.now()
      const visits = [before - 61_000, before - 19_000, 1, before + 86_400_000]
      const response = await synthetic('/api/events', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: visits.map((at) => ({ kind: 'row', key: 'Lab Project/lab-north', at })) }),
      })
      expect(response.status).toBe(200)
      const { inserted, timestamps } = (await response.json()) as { inserted: number; timestamps: number[] }
      const after = Date.now()
      expect(inserted).toBe(4)
      expect(timestamps.slice(0, 2)).toEqual(visits.slice(0, 2))
      expect(timestamps[2]! >= before - 604_800_000 && timestamps[2]! <= after - 604_800_000).toBe(true)
      expect(timestamps[3]! >= before && timestamps[3]! <= after).toBe(true)
    })
    await step('the same screen is connected to an isolated real server', async () => {
      leaveSyntheticServer()
      await admin.post('/api/table_def', { name: 'Lab Project', title_column: 'name', columns: [
        { column_name: 'name', label: 'Name', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'region', label: 'Region', column_type: 'Data', in_list_view: true },
        { column_name: 'enabled', label: 'Enabled', column_type: 'Check', in_list_view: true },
      ] })
      await admin.post('/api/table/Lab%20Project', { row_id: 'lab-north', name: 'North workshop', region: 'North', enabled: true })
      await realForm(admin)
    })
    await step('the row form retains its controls and layout', () => {
      expect(syntheticControls).toEqual([
        { column: 'name', tag: 'INPUT', type: 'text', label: 'Name' },
        { column: 'region', tag: 'INPUT', type: 'text', label: 'Region' },
        { column: 'enabled', tag: 'INPUT', type: 'checkbox', label: 'Enabled' },
      ])
      expect(controls()).toEqual(syntheticControls)
    })
    await step('a saved change is still visible after reloading', async () => {
      await fill('Region', 'Saved on isolated server')
      await save()
      await realForm(admin)
      await onScreen().assertValue('Region', 'Saved on isolated server')
    })
  }, 60_000)
})

let real: { unmount: () => void } | null = null
async function realForm(admin: TestClient) {
  real?.unmount()
  real = await renderApp(rowHref('Lab Project', 'lab-north'), admin)
  await screen.findByRole('textbox', { name: 'Region' }, WAIT)
}
afterEach(() => { real?.unmount(); real = null })
