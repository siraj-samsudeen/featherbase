// #1227: every app's sidebar (<featherbase-sidebar>) collapses the way the
// Admin's does (#1018, sidebar-collapse.test.tsx): since #1248 to an icon rail,
// by the sidebar's own control and Ctrl/Cmd+B, never while typing, remembered
// per person in this browser, and a drawer at phone width. The bar and the sidebar are mounted the way an app's
// served document mounts them (runtime-shell.ts, bar/main.tsx), once for each
// app's own sidebar. Real widths and pixels are the verifier's (#1080).
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { setSession } from '../src/lib/api'
import { mountBar } from '../src/bar/mount'
import { FeatherbaseSidebar } from '../src/bar/sidebar'
import { test, expect } from './pg-test'

if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)

/** Each app's sidebar as the app draws it: its name, label and first two rows. */
const APPS = [
  { app: 'dash', title: 'Dash', label: 'Dash navigation', rows: ['Sales vs target', 'Your sections'] },
  { app: 'tickets', title: 'Tickets', label: 'Ticket views', rows: ['Open', 'Waiting on me'] },
  { app: 'tasker', title: 'Tasker', label: 'Task views', rows: ['Today', 'Upcoming'] },
  { app: 'equipment', title: 'Assets', label: 'Assets pages', rows: ['Assets', 'Jobs'] },
]

let mounted: { unmount: () => void } | undefined

beforeEach(() => localStorage.clear())
afterEach(() => {
  act(() => mounted?.unmount())
  mounted = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** An app's page, signed in as `as`: the bar first in the body, then the app's
 *  shell with its sidebar and a search field of its own. */
function openAppPage(as: TestClient, { app, title, label, rows }: (typeof APPS)[number], withSidebar = true) {
  setSession(as.token!, { row_id: as.user!, email: null, full_name: null })
  const host = document.createElement('featherbase-bar')
  host.dataset.app = app
  host.dataset.title = title
  document.body.prepend(host)
  mounted = mountBar(host)
  const shell = document.createElement('div')
  if (withSidebar) {
    const sidebar = document.createElement('featherbase-sidebar')
    sidebar.setAttribute('aria-label', label)
    for (const row of rows) {
      const link = document.createElement('a')
      link.href = `#${row}`
      link.textContent = row
      sidebar.append(link)
    }
    shell.append(sidebar)
  }
  const search = document.createElement('input')
  search.type = 'search'
  search.setAttribute('aria-label', 'Search')
  shell.append(search)
  document.body.append(shell)
  return { bar: within(host.shadowRoot as unknown as HTMLElement), search }
}

const sidebar = () => document.querySelector('featherbase-sidebar') as HTMLElement
/** The sidebar's own collapse control (#1248: its footer row, in its shadow). */
const control = () => sidebar().shadowRoot!.querySelector<HTMLElement>('[data-testid=sidebar-collapse]')!
const collapsed = () => sidebar().hasAttribute('data-collapsed')
/** #1253: the account sits at the sidebar's foot, in its shadow, once whoami answers. */
const signedIn = () => within(sidebar().shadowRoot as unknown as HTMLElement).findByTestId('session-user')

function atPhoneWidth() {
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: q === '(width < 48rem)', media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList)
}

describe.each(APPS)("$title's sidebar", (page) => {
  test("the sidebar's own control collapses it to a rail and reopens it, and says what it will do", async ({ admin }) => {
    const { bar } = openAppPage(admin, page)
    await signedIn()
    // #1248: the bar has no control for it on a wide window.
    expect(bar.queryByTestId('sidebar-collapse')).not.toBeInTheDocument()
    expect(control()).toHaveAccessibleName('Collapse sidebar')
    expect(control().title).toMatch(/^Collapse sidebar \((⌘B|Ctrl\+B)\)$/)

    await userEvent.click(control())
    expect(collapsed()).toBe(true)
    // A rail: still in the tab order and the accessibility tree.
    expect(sidebar().inert).toBe(false)
    expect(control()).toHaveAccessibleName('Expand sidebar')

    await userEvent.click(control())
    expect(collapsed()).toBe(false)
    expect(sidebar().inert).toBe(false)
  })

  test('Ctrl+B and Cmd+B collapse and reopen it from the page', async ({ admin }) => {
    openAppPage(admin, page)
    await signedIn()
    expect(fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true })).toBe(false)
    expect(collapsed()).toBe(true)
    expect(fireEvent.keyDown(sidebar().querySelector('a')!, { key: 'b', metaKey: true })).toBe(false)
    expect(collapsed()).toBe(false)
  })

  test("typing in the app's own field leaves Ctrl/Cmd+B to the field", async ({ admin }) => {
    const { search } = openAppPage(admin, page)
    await signedIn()
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const textarea = document.createElement('textarea')
    document.body.append(editor, textarea)
    for (const field of [search, textarea, editor]) {
      expect(fireEvent.keyDown(field, { key: 'b', metaKey: true })).toBe(true)
      expect(fireEvent.keyDown(field, { key: 'b', ctrlKey: true })).toBe(true)
    }
    await userEvent.type(search, 'b{Control>}b{/Control}')
    expect(collapsed()).toBe(false)
  })
})

test("the choice is the person's own and carries from one app to the next", async ({ admin }) => {
  openAppPage(admin, APPS[0])
  await signedIn()
  await userEvent.click(control())
  expect(collapsed()).toBe(true)
  act(() => mounted?.unmount())
  document.body.replaceChildren()

  // A reload into another app: the same person, the same choice.
  openAppPage(admin, APPS[1])
  await signedIn()
  expect(collapsed()).toBe(true)
  expect(Object.keys(localStorage).filter((key) => key === `fc-sidebar-collapsed:${admin.user}`)).toHaveLength(1)
})

test('a page with no sidebar has no sidebar controls, and Ctrl/Cmd+B is left alone', async ({ admin }) => {
  const { bar } = openAppPage(admin, APPS[0], false)
  await bar.findByTestId('session-user')
  expect(bar.queryByTestId('sidebar-collapse')).not.toBeInTheDocument()
  expect(bar.queryByTestId('sidebar-toggle')).not.toBeInTheDocument()
  expect(fireEvent.keyDown(document.body, { key: 'b', metaKey: true })).toBe(true)
})

describe('at phone width', () => {
  test('the sidebar is a drawer: the menu button opens it, the backdrop closes it', async ({ admin }) => {
    atPhoneWidth()
    const { bar } = openAppPage(admin, APPS[0])
    const menu = await bar.findByTestId('sidebar-toggle')
    expect(sidebar().inert).toBe(true)
    expect(menu).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(menu)
    expect(sidebar().hasAttribute('data-open')).toBe(true)
    expect(sidebar().inert).toBe(false)
    expect(menu).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(sidebar().shadowRoot!.querySelector<HTMLElement>('[data-testid=sidebar-backdrop]')!)
    expect(sidebar().hasAttribute('data-open')).toBe(false)
  })

  test('choosing a row or pressing Escape closes the drawer', async ({ admin }) => {
    atPhoneWidth()
    const { bar } = openAppPage(admin, APPS[2])
    const menu = await bar.findByTestId('sidebar-toggle')
    await userEvent.click(menu)
    await userEvent.click(within(sidebar()).getByText('Upcoming'))
    await waitFor(() => expect(sidebar().hasAttribute('data-open')).toBe(false))

    await userEvent.click(menu)
    expect(sidebar().hasAttribute('data-open')).toBe(true)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(sidebar().hasAttribute('data-open')).toBe(false)
  })

  test('a choice to collapse made on a wider window leaves the drawer alone, and the shortcut does nothing', async ({ admin }) => {
    localStorage.setItem(`fc-sidebar-collapsed:${admin.user}`, '1')
    atPhoneWidth()
    const { bar } = openAppPage(admin, APPS[3])
    await bar.findByTestId('sidebar-toggle')
    expect(collapsed()).toBe(false)
    expect(fireEvent.keyDown(document.body, { key: 'b', metaKey: true })).toBe(true)
    expect(collapsed()).toBe(false)
  })
})
