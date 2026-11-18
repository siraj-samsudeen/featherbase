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
import { api, setSession } from '../src/lib/api'
import { setViewedPerson } from '../src/lib/viewing-as'
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
    expect(control()).not.toHaveAttribute('title')

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

// Seen on staging (17-Nov): viewing as a Store Manager, the sidebar read the
// tester's choice (the rail) while its foot read the viewed person's (open),
// so Help and Theme were drawn past the rail's edge, and Collapse could be
// undone by the next read. The choice is the tester's, at the keyboard.
test("viewing as someone, the sidebar and its foot keep the tester's own choice and agree", async ({ admin, createUser }) => {
  const person = await createUser({ fullName: 'Vas Person' })
  localStorage.setItem(`fc-sidebar-collapsed:${admin.user}`, '1')
  setViewedPerson({ row_id: person.user!, full_name: 'Vas Person' })
  // The server agrees whom the browser views (as in view-as-me.test.tsx), so the bar keeps the marker.
  const realGet = api.get.bind(api)
  vi.spyOn(api, 'get').mockImplementation(((path: string) =>
    path === '/api/view_as'
      ? Promise.resolve({ may: true, viewing: { person: person.user!, name: 'Vas Person', expires_at: new Date(Date.now() + 3_600_000).toISOString() }, recent: [], frequent: [] })
      : realGet(path)) as typeof api.get)
  openAppPage(admin, APPS[0])
  await signedIn()
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/view_as'))
  const foot = () => sidebar().shadowRoot!.querySelector<HTMLElement>('[data-testid=sidebar-account]')!
  // The rail's foot is a stack in its 56px; the open sidebar's, one row.
  const stacked = () => /\bflex-col\b/.test(foot().className)

  expect(collapsed()).toBe(true)
  expect(stacked()).toBe(true)

  await userEvent.click(control())
  expect(collapsed()).toBe(false)
  // The row waits until the sidebar has widened, so nothing hangs outside meanwhile (the owner, 18-Nov).
  await waitFor(() => expect(stacked()).toBe(false))

  await userEvent.click(control())
  expect(collapsed()).toBe(true)
  expect(stacked()).toBe(true)
  expect(localStorage.getItem(`fc-sidebar-collapsed:${person.user}`)).toBeNull()
})

// The owner (18-Nov): the key (Ctrl+B) is in the hover tooltip only, never on the row.
test('the Collapse row names its key only in its hover tooltip; in the rail, one tooltip names it', async ({ admin }) => {
  openAppPage(admin, APPS[0])
  await signedIn()
  expect(control().querySelector('kbd')).toBeNull()
  expect(control()).toHaveTextContent(/^Collapse$/)
  expect(control()).not.toHaveAttribute('title')
  // Its menus and tooltips are drawn above the app's page (a report's pinned table header,
  // the pickers' strip): the frame has a layer of its own. Pixels are the verifier's.
  expect(sidebar().shadowRoot!.querySelector('style')!.textContent).toMatch(/\.sidebar-frame \{ position:sticky; z-index:30;/)
  // Open, the sidebar's own tooltip names it and its key, at once.
  fireEvent.pointerOver(control(), { composed: true })
  expect(sidebar().shadowRoot!.querySelector('[role=tooltip]')?.textContent).toMatch(/^Collapse sidebar · (⌘B|Ctrl\+B)$/)
  fireEvent.pointerOut(control(), { composed: true })

  await userEvent.click(control())
  expect(collapsed()).toBe(true)
  // The rail's tooltip, at once; no browser tooltip as well.
  expect(control()).not.toHaveAttribute('title')
  // A real pointer's events cross the shadow boundary (composed).
  fireEvent.pointerOver(control(), { composed: true })
  const tip = sidebar().shadowRoot!.querySelector('[role=tooltip]')
  expect(tip?.textContent).toMatch(/^Expand sidebar · (⌘B|Ctrl\+B)$/)
})

// The owner (18-Nov): in the rail every control names itself on hover, the
// sidebar's own top and foot as well as the app's rows, as in the Admin.
test("in the rail the sidebar's own top and foot controls are named by a tooltip on hover", async ({ admin }) => {
  localStorage.setItem(`fc-sidebar-collapsed:${admin.user}`, '1')
  openAppPage(admin, APPS[0])
  await signedIn()
  const shadow = within(sidebar().shadowRoot as unknown as HTMLElement)
  const tipFor = (el: HTMLElement) => {
    fireEvent.pointerOver(el, { composed: true })
    return sidebar().shadowRoot!.querySelector('[role=tooltip]')?.textContent
  }
  expect(tipFor(await shadow.findByTestId('top-bar-name'))).toMatch(/^Switch application: /)
  expect(tipFor(shadow.getByTestId('help-button'))).toBe('Help')
  expect(tipFor(shadow.getByTestId('theme-button'))).toMatch(/^Theme: /)
  // Not an open menu's own items.
  await userEvent.click(shadow.getByTestId('theme-button'))
  fireEvent.pointerOut(shadow.getByTestId('theme-button'), { composed: true })
  fireEvent.pointerOver(shadow.getByTestId('theme-dark'), { composed: true })
  expect(sidebar().shadowRoot!.querySelector('[role=tooltip]')).toBeNull()
})

// The owner (18-Nov, option A): the Theme menu is a short list, an icon and a
// name on each row and a tick on the one in use; choosing closes it.
test('the Theme menu is a list with a tick on the theme in use, and choosing closes it', async ({ admin }) => {
  openAppPage(admin, APPS[0])
  await signedIn()
  const shadow = within(sidebar().shadowRoot as unknown as HTMLElement)
  await userEvent.click(shadow.getByTestId('theme-button'))
  const menu = shadow.getByRole('menu', { name: 'Theme' })
  const rows = within(menu).getAllByRole('menuitemradio')
  expect(rows.map((row) => row.textContent)).toEqual(['Light', 'Dark', 'Same as device'])
  expect(rows.filter((row) => row.getAttribute('aria-checked') === 'true')).toHaveLength(1)

  await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Dark' }))
  expect(shadow.queryByRole('menu', { name: 'Theme' })).toBeNull()
  expect(shadow.getByTestId('theme-button')).toHaveAccessibleName('Theme: Dark')
  await userEvent.click(shadow.getByTestId('theme-button'))
  expect(within(shadow.getByRole('menu', { name: 'Theme' })).getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
})

/** A drag on the sidebar's edge, as a mouse does it: down on the edge, moved,
 *  let go, and the click the browser then sends to the edge. */
function drag(edge: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(edge, { clientX: from, button: 0, pointerId: 1 })
  fireEvent.pointerMove(document, { clientX: (from + to) / 2, pointerId: 1 })
  fireEvent.pointerMove(document, { clientX: to, pointerId: 1 })
  fireEvent.pointerUp(document, { clientX: to, pointerId: 1 })
  fireEvent.click(edge)
}

// The owner (17-Nov): the sidebar should be "a little adjustable". Its edge is
// dragged to any width from 200 to 360px; the width is the person's own, like
// the collapsed choice; a click on the edge still folds it.
test("dragging the edge sets the open sidebar's width, from 200 to 360px, kept for the person; a click on it still folds it", async ({ admin }) => {
  openAppPage(admin, APPS[0])
  await signedIn()
  const edge = () => sidebar().shadowRoot!.querySelector<HTMLElement>('[data-testid=sidebar-edge]')!
  const width = () => sidebar().style.getPropertyValue('--featherbase-sidebar-width')
  expect(width()).toBe('240px')

  drag(edge(), 240, 300)
  expect(width()).toBe('300px')
  expect(collapsed()).toBe(false)
  drag(edge(), 300, 900)
  expect(width()).toBe('360px')
  drag(edge(), 360, 0)
  expect(width()).toBe('200px')
  expect(collapsed()).toBe(false)

  // A reload, in another app: the same person, the same width.
  act(() => mounted?.unmount())
  document.body.replaceChildren()
  openAppPage(admin, APPS[2])
  await signedIn()
  expect(width()).toBe('200px')

  await userEvent.click(edge())
  expect(collapsed()).toBe(true)
  // The owner (18-Nov): the rail's edge drags too. Pulled out, the sidebar opens at the pointer's width.
  drag(edge(), 56, 186)
  expect(collapsed()).toBe(false)
  expect(width()).toBe('200px')
  await userEvent.click(edge())
  drag(edge(), 56, 356)
  expect(collapsed()).toBe(false)
  expect(width()).toBe('356px')
  expect(localStorage.getItem(`fc-sidebar-width:${admin.user}`)).toBe('356')
  // A pull inward from the rail is no drag: the click that ends it opens the sidebar, as a click does.
  await userEvent.click(edge())
  drag(edge(), 56, 20)
  expect(collapsed()).toBe(false)
  expect(width()).toBe('356px')
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
