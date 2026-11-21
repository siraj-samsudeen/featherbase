// #1385 (slice 1): Search or Command is the platform's, on every page. An app's
// page (Dash, Tasker, Tickets) draws the same field at the top of its sidebar
// and opens the same command bar with Ctrl/Cmd+K as the Admin does. The bar
// offers only what the viewer can open: someone who cannot use the Admin finds
// their apps and account pages, never a Table or an Admin page. Mounted the way
// an app's served document mounts the bar and its sidebar (app-sidebar-collapse).
import { resolve } from 'node:path'
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { tableHref } from 'shared'
import { discoverPackages } from 'server/src/runtime-packages'
import type { TestClient } from 'feather-testing-postgres'
import { setSession } from '../src/lib/api'
import { mountBar } from '../src/bar/mount'
import { FeatherbaseSidebar } from '../src/bar/sidebar'
import { test, expect } from './pg-test'

if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const WAIT = { timeout: 10_000 }

let mounted: { unmount: () => void } | undefined
beforeEach(() => localStorage.clear())
afterEach(() => {
  act(() => mounted?.unmount())
  mounted = undefined
  document.body.replaceChildren()
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

async function installBarProof(admin: TestClient) {
  expect(await discoverPackages([BAR_PROOF])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
}

/** bar-proof's page, signed in as `as`: the bar first, then the app's sidebar. */
function openAppPage(as: TestClient, leave: (href: string) => void = () => {}) {
  window.history.replaceState(null, '', '/barproof/')
  setSession(as.token!, { row_id: as.user!, email: null, full_name: null })
  const host = document.createElement('featherbase-bar')
  host.dataset.app = 'barproof'
  host.dataset.title = 'Bar proof'
  document.body.prepend(host)
  mounted = mountBar(host, { leave })
  const sidebar = document.createElement('featherbase-sidebar')
  sidebar.setAttribute('aria-label', 'Bar proof views')
  document.body.append(sidebar)
  const root = host.shadowRoot!
  return {
    bar: within(root as unknown as HTMLElement),
    sidebar: within(sidebar.shadowRoot as unknown as HTMLElement),
    /** The open command bar, drawn in the bar's own shadow root. */
    dialog: () => root.querySelector<HTMLElement>('[role="dialog"][aria-label="Search or Command"]'),
    input: () => root.querySelector<HTMLInputElement>('input[aria-label="Search or type a command"]')!,
  }
}

/** Ctrl+K from the page, and the command bar's input once it is open. */
async function openWithKeys(page: ReturnType<typeof openAppPage>) {
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
  await waitFor(() => expect(page.dialog()).not.toBeNull(), WAIT)
  return page.input()
}

function type(input: HTMLInputElement, text: string) {
  fireEvent.change(input, { target: { value: text } })
}

test("an app's sidebar has the Search or Command field", async ({ admin }) => {
  await installBarProof(admin)
  const { sidebar } = openAppPage(admin)
  const field = await sidebar.findByTestId('command-field', {}, WAIT)
  expect(field).toHaveAccessibleName('Search or Command')
  expect(field).toHaveTextContent(/^Search or Command(⌘K|Ctrl\+K)$/)
})

test("the field opens the command bar on an app's page", async ({ admin }) => {
  await installBarProof(admin)
  const page = openAppPage(admin)
  const { bar, sidebar } = page
  fireEvent.click(await sidebar.findByTestId('command-field', {}, WAIT))
  await waitFor(() => expect(page.dialog()).not.toBeNull(), WAIT)
})

test("Ctrl+K on an app's page opens the command bar with its input focused", async ({ admin }) => {
  await installBarProof(admin)
  const page = openAppPage(admin)
  const { bar, sidebar } = page
  await sidebar.findByTestId('command-field', {}, WAIT)
  const input = await openWithKeys(page)
  expect(input.getRootNode()).toBeInstanceOf(ShadowRoot)
  await waitFor(() => expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input))
})

test('Ctrl+Shift+K (View As) leaves the command bar closed', async ({ admin }) => {
  await installBarProof(admin)
  const page = openAppPage(admin)
  const { bar, sidebar } = page
  await sidebar.findByTestId('command-field', {}, WAIT)
  fireEvent.keyDown(document.body, { key: 'K', ctrlKey: true, shiftKey: true })
  await new Promise((done) => setTimeout(done, 100))
  expect(page.dialog()).toBeNull()
})

test("clicking inside the open command bar keeps it open on an app's page", async ({ admin }) => {
  await installBarProof(admin)
  const page = openAppPage(admin)
  const { bar, sidebar } = page
  await sidebar.findByTestId('command-field', {}, WAIT)
  const input = await openWithKeys(page)
  fireEvent.pointerDown(input)
  expect(page.dialog()).not.toBeNull()
})

test("someone who can use the Admin finds a Table on an app's page, and it opens with a full page load", async ({ admin }) => {
  await installBarProof(admin)
  const leave = vi.fn()
  const page = openAppPage(admin, leave)
  const { bar, sidebar } = page
  await sidebar.findByTestId('command-field', {}, WAIT)
  type(await openWithKeys(page), 'Person')
  const person = await waitFor(() => {
    const hit = bar.getAllByTestId('awesomebar-table').find((e) => e.getAttribute('href') === tableHref('Person'))
    expect(hit).toBeDefined()
    return hit!
  }, WAIT)
  fireEvent.click(person)
  expect(leave).toHaveBeenCalledWith(tableHref('Person'))
})

test('a Table result opened with a modifier key is left to the browser', async ({ admin }) => {
  await installBarProof(admin)
  const leave = vi.fn()
  const page = openAppPage(admin, leave)
  const { bar, sidebar } = page
  await sidebar.findByTestId('command-field', {}, WAIT)
  type(await openWithKeys(page), 'Person')
  const person = await waitFor(() => {
    const hit = bar.getAllByTestId('awesomebar-table').find((e) => e.getAttribute('href') === tableHref('Person'))
    expect(hit).toBeDefined()
    return hit!
  }, WAIT)
  // A new tab is the browser's: the page stays, and so does the command bar.
  expect(fireEvent.click(person, { ctrlKey: true })).toBe(true)
  expect(leave).not.toHaveBeenCalled()
  expect(page.dialog()).not.toBeNull()
})

test("someone who can use the Admin finds an Admin page on an app's page", async ({ admin }) => {
  await installBarProof(admin)
  const page = openAppPage(admin)
  const { bar, sidebar } = page
  await sidebar.findByTestId('command-field', {}, WAIT)
  type(await openWithKeys(page), 'Jobs')
  await waitFor(() => expect(bar.getAllByTestId('awesomebar-page').map((e) => e.getAttribute('href'))).toContain('/featherbase/admin/jobs'), WAIT)
})

test('someone who cannot use the Admin finds their app and account pages', async ({ admin, createUser }) => {
  await installBarProof(admin)
  const reader = await createUser({ roles: ['Bar Reader'] })
  const page = openAppPage(reader)
  const { bar, sidebar } = page
  await sidebar.findByTestId('command-field', {}, WAIT)
  const input = await openWithKeys(page)
  type(input, 'Bar proof')
  await waitFor(() => expect(bar.getAllByTestId('awesomebar-page').map((e) => e.getAttribute('href'))).toContain('/barproof/'), WAIT)
  type(input, 'Sign-in')
  await waitFor(() => expect(bar.getAllByTestId('awesomebar-page').map((e) => e.getAttribute('href'))).toContain('/featherbase/account/sign-in-methods'), WAIT)
})

test('someone who cannot use the Admin is offered no Table, record or Admin page', async ({ admin, createUser }) => {
  await installBarProof(admin)
  const reader = await createUser({ roles: ['Bar Reader'] })
  const search = vi.spyOn(globalThis, 'fetch')
  const page = openAppPage(reader)
  const { bar, sidebar } = page
  await sidebar.findByTestId('command-field', {}, WAIT)
  const input = await openWithKeys(page)
  type(input, 'Person')
  // Nothing they can open is called that: the bar says so, without searching records.
  expect(await bar.findByTestId('search-no-match', {}, WAIT)).toBeInTheDocument()
  expect(bar.queryByTestId('awesomebar-table')).not.toBeInTheDocument()
  expect(bar.queryByTestId('awesomebar-new')).not.toBeInTheDocument()
  expect(bar.queryByTestId('awesomebar-doc')).not.toBeInTheDocument()
  expect(search.mock.calls.some(([url]) => String(url).includes('/api/search'))).toBe(false)
  type(input, 'Jobs')
  await waitFor(() => expect(bar.getByTestId('search-no-match')).toHaveTextContent('Jobs'), WAIT)
  expect(bar.queryByTestId('awesomebar-page')).not.toBeInTheDocument()
})

test('someone who cannot use the Admin is offered no Admin command', async ({ admin, createUser }) => {
  await installBarProof(admin)
  const reader = await createUser({ roles: ['Bar Reader'] })
  const page = openAppPage(reader)
  const { bar, sidebar } = page
  await sidebar.findByTestId('command-field', {}, WAIT)
  const input = await openWithKeys(page)
  type(input, 'Theme')
  await bar.findByTestId('awesomebar-cmd-theme-dark', {}, WAIT)
  type(input, 'Go to Admin')
  await waitFor(() => expect(bar.getByTestId('search-no-match')).toBeInTheDocument(), WAIT)
  expect(bar.queryByTestId('awesomebar-cmd-home')).not.toBeInTheDocument()
})
