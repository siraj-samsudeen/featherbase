// #1248: collapsed, every app's sidebar (<featherbase-sidebar>) is an icon rail,
// never hidden, and its control is the sidebar's own: a footer row and its edge.
// #1385 (slice 4): the app gives its rows as data (setSidebarRows) and the frame draws them.
// The bar and the sidebar are mounted the way an app's served document mounts
// them (runtime-shell.ts, bar/main.tsx). Widths and pixels are the verifier's.
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { setSession } from '../src/lib/api'
import { mountBar } from '../src/bar/mount'
import { FeatherbaseSidebar } from '../src/bar/sidebar'
import { setSidebarRows, type SidebarRows } from '@featherbase/shop-floor/sidebar'
import { SIDEBAR_ROWS_GLOBAL } from 'shared'
import { test, expect } from './pg-test'

if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)

let mounted: { unmount: () => void } | undefined
beforeEach(() => {
  localStorage.clear()
  delete (window as unknown as Record<string, unknown>)[SIDEBAR_ROWS_GLOBAL]
})
afterEach(() => {
  act(() => mounted?.unmount())
  mounted = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** A Tickets-like sidebar, given as data (#1385): two views with icons and counts, a Types section that folds
 *  its types into one icon, and a report row asking for initials. */
const ROWS: SidebarRows = {
  current: '#all',
  sections: [
    { id: 'views', items: [
      { label: 'All Tickets', address: '#all', icon: 'inbox', count: 12 },
      { label: 'My Requests', address: '#mine', icon: 'person', count: 2 },
    ] },
    { id: 'types', title: 'Types', icon: 'tag', items: [
      { label: 'Access Request', address: '#access', icon: 'tag', count: 3 },
      { label: 'Backfill', address: '#backfill', icon: 'tag', count: 0 },
    ] },
    { id: 'reports', title: 'Reports', items: [
      { label: 'Repair Jobs', address: '#jobs', icon: 'wrench' },
      { label: 'Sales Versus Target', address: '#report', icon: 'report', initials: true },
    ] },
  ],
}

function openAppPage(as: TestClient, rows: SidebarRows = ROWS) {
  setSession(as.token!, { row_id: as.user!, email: null, full_name: null })
  setSidebarRows(rows)
  const host = document.createElement('featherbase-bar')
  host.dataset.app = 'tickets'
  host.dataset.title = 'Tickets'
  document.body.prepend(host)
  mounted = mountBar(host)
  const sidebar = document.createElement('featherbase-sidebar')
  sidebar.setAttribute('aria-label', 'Ticket views')
  document.body.append(sidebar)
  return { bar: within(host.shadowRoot as unknown as HTMLElement), sidebar }
}

const shadow = (el: HTMLElement) => within(el.shadowRoot as unknown as HTMLElement)
const collapsed = (el: HTMLElement) => el.hasAttribute('data-collapsed')

/** The sidebar's frame, drawn, with the app's rows in it. */
async function framed(sidebar: HTMLElement) {
  await shadow(sidebar).findByTestId('session-user')
  await shadow(sidebar).findByRole('link', { name: /All Tickets/ })
}

test('the control is on the sidebar, not in the bar, and collapses it to a rail that stays usable', async ({ admin }) => {
  const { bar, sidebar } = openAppPage(admin)
  // #1253: the account sits at the sidebar's foot, in its shadow.
  await framed(sidebar)
  expect(bar.queryByTestId('sidebar-collapse')).not.toBeInTheDocument()

  const control = shadow(sidebar).getByTestId('sidebar-collapse')
  expect(control).toHaveAccessibleName('Collapse sidebar')
  expect(control.title).toMatch(/^Collapse Sidebar · (⌘B|Ctrl\+B)$/)
  // #1251's keyboard-shortcut list finds it by these.
  expect(control).toHaveAttribute('data-shortcut-id', 'sidebar')
  expect(control.getAttribute('data-shortcut-key')).toMatch(/^(⌘B|Ctrl\+B)$/)
  await userEvent.click(control)
  expect(collapsed(sidebar)).toBe(true)
  // A rail, not a hidden sidebar: still in the tab order and the accessibility tree.
  expect(sidebar.inert).toBe(false)
  expect(sidebar).not.toHaveAttribute('aria-hidden')
  expect(control).toHaveAccessibleName('Expand sidebar')
  // Every row keeps its name.
  expect(shadow(sidebar).getByRole('link', { name: /All Tickets/ })).toBeInTheDocument()

  await userEvent.click(control)
  expect(collapsed(sidebar)).toBe(false)
})

test("the sidebar's edge toggles it too", async ({ admin }) => {
  const { sidebar } = openAppPage(admin)
  await framed(sidebar)
  const edge = shadow(sidebar).getByTestId('sidebar-edge')
  await userEvent.click(edge)
  expect(collapsed(sidebar)).toBe(true)
  await userEvent.click(edge)
  expect(collapsed(sidebar)).toBe(false)
})

test('the open row is marked, and each row is a link to its address with its count beside it', async ({ admin }) => {
  const { sidebar } = openAppPage(admin)
  await framed(sidebar)
  const all = shadow(sidebar).getByRole('link', { name: /All Tickets/ })
  expect(all).toHaveAttribute('aria-current', 'page')
  expect(all).toHaveAttribute('href', '#all')
  expect(all).toHaveTextContent('All Tickets12')
  expect(shadow(sidebar).getByRole('link', { name: /My Requests/ })).not.toHaveAttribute('aria-current')
  // Open, a folding section is a heading and its rows.
  expect(shadow(sidebar).getByRole('heading', { name: 'Types' })).toBeInTheDocument()
  expect(shadow(sidebar).getByRole('link', { name: /Backfill/ })).toHaveTextContent('Backfill0')
})

test('rows the app gives again are drawn again, and the open row follows', async ({ admin }) => {
  const { sidebar } = openAppPage(admin)
  await framed(sidebar)
  act(() => setSidebarRows({ ...ROWS, current: '#mine' }))
  await waitFor(() => expect(shadow(sidebar).getByRole('link', { name: /My Requests/ })).toHaveAttribute('aria-current', 'page'))
  expect(shadow(sidebar).getByRole('link', { name: /All Tickets/ })).not.toHaveAttribute('aria-current')
})

test('in the rail a row that asks for initials shows them; a row with its own icon keeps the icon', async ({ admin }) => {
  const { sidebar } = openAppPage(admin)
  await framed(sidebar)
  await userEvent.click(shadow(sidebar).getByTestId('sidebar-collapse'))
  expect(shadow(sidebar).getByRole('link', { name: 'Sales Versus Target' })).toHaveAttribute('data-rail-mark', 'SV')
  expect(shadow(sidebar).getByRole('link', { name: 'Repair Jobs' })).not.toHaveAttribute('data-rail-mark')
  expect(shadow(sidebar).getByRole('link', { name: /My Requests/ })).not.toHaveAttribute('data-rail-mark')
})

test('in the rail a count is a badge on its icon, and a zero count shows none', async ({ admin }) => {
  const { sidebar } = openAppPage(admin, { sections: [{ id: 'views', items: [
    { label: 'All Tickets', address: '#all', icon: 'inbox', count: 12 },
    { label: 'Nothing Waiting', address: '#none', icon: 'check', count: 0 },
  ] }] })
  await framed(sidebar)
  await userEvent.click(shadow(sidebar).getByTestId('sidebar-collapse'))
  expect(shadow(sidebar).getByRole('link', { name: /All Tickets/ }).querySelector('[data-sidebar-count]')).toHaveTextContent('12')
  expect(shadow(sidebar).getByRole('link', { name: /Nothing Waiting/ }).querySelector('[data-sidebar-count]')).toBeNull()
})

test("hovering or focusing a rail icon names it at once, with its count; open, nothing is shown", async ({ admin }) => {
  const { sidebar } = openAppPage(admin)
  await framed(sidebar)
  const row = () => shadow(sidebar).getByRole('link', { name: /All Tickets/ })
  fireEvent.pointerOver(row())
  expect(shadow(sidebar).queryByRole('tooltip')).not.toBeInTheDocument()

  await userEvent.click(shadow(sidebar).getByTestId('sidebar-collapse'))
  fireEvent.pointerOver(row())
  expect(shadow(sidebar).getByRole('tooltip')).toHaveTextContent('All Tickets · 12')
  fireEvent.pointerOut(row())
  await waitFor(() => expect(shadow(sidebar).queryByRole('tooltip')).not.toBeInTheDocument())

  // jsdom sends no focusin out of a shadow root whose host already holds the focus (the collapse control had
  // it); a browser does. The event is sent as the browser sends it.
  act(() => row().focus())
  fireEvent.focusIn(row())
  expect(shadow(sidebar).getByRole('tooltip')).toHaveTextContent('All Tickets · 12')
})

test('a folding section becomes one icon whose menu lists its rows, and choosing one opens its address', async ({ admin }) => {
  const { sidebar } = openAppPage(admin)
  await framed(sidebar)
  await userEvent.click(shadow(sidebar).getByTestId('sidebar-collapse'))
  const fold = shadow(sidebar).getByRole('button', { name: 'Types' })
  expect(fold).toHaveAttribute('aria-haspopup', 'menu')
  // In the rail the section's rows are not shown: the menu stands for them.
  expect(shadow(sidebar).queryByRole('link', { name: /Backfill/ })).not.toBeInTheDocument()

  await userEvent.click(fold)
  const menu = shadow(sidebar).getByRole('menu', { name: 'Types' })
  expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Access Request3', 'Backfill0'])
  await userEvent.click(within(menu).getByRole('menuitem', { name: /Backfill/ }))
  expect(window.location.hash).toBe('#backfill')
  expect(shadow(sidebar).queryByRole('menu')).not.toBeInTheDocument()

  // By keyboard: Enter opens it, Escape closes it and returns to the fold.
  act(() => fold.focus())
  await userEvent.keyboard('{Enter}')
  expect(shadow(sidebar).getByRole('menu', { name: 'Types' })).toBeInTheDocument()
  fireEvent.keyDown(shadow(sidebar).getByRole('menu'), { key: 'Escape' })
  expect(shadow(sidebar).queryByRole('menu')).not.toBeInTheDocument()
  expect(sidebar.shadowRoot!.activeElement).toBe(fold)

  // Expanded again, the section is a heading and its rows once more.
  await userEvent.click(shadow(sidebar).getByTestId('sidebar-collapse'))
  expect(shadow(sidebar).getByRole('heading', { name: 'Types' })).toBeInTheDocument()
  window.location.hash = ''
})

test('Ctrl/Cmd+B still toggles from the page, and the choice is kept for this person', async ({ admin }) => {
  const { sidebar } = openAppPage(admin)
  await framed(sidebar)
  expect(fireEvent.keyDown(document.body, { key: 'b', metaKey: true })).toBe(false)
  expect(collapsed(sidebar)).toBe(true)
  expect(localStorage.getItem(`fc-sidebar-collapsed:${admin.user}`)).toBe('1')
})

test('at phone width the sidebar is the drawer as before, and the bar keeps its menu button', async ({ admin }) => {
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: q === '(width < 48rem)', media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList)
  const { bar, sidebar } = openAppPage(admin)
  const menu = await bar.findByTestId('sidebar-toggle')
  expect(sidebar.inert).toBe(true)
  await userEvent.click(menu)
  expect(sidebar.hasAttribute('data-open')).toBe(true)
  expect(collapsed(sidebar)).toBe(false)
  // Choosing a row closes the drawer.
  await userEvent.click(await shadow(sidebar).findByRole('link', { name: /My Requests/ }))
  expect(sidebar.hasAttribute('data-open')).toBe(false)
  window.location.hash = ''
})

test('the fold menu: arrows move, Tab and a click outside close it, and the fold toggles it', async ({ admin }) => {
  const { sidebar } = openAppPage(admin, { ...ROWS, current: ['#all', '#backfill'] })
  await framed(sidebar)
  await userEvent.click(shadow(sidebar).getByTestId('sidebar-collapse'))
  const fold = shadow(sidebar).getByRole('button', { name: 'Types' })
  await userEvent.click(fold)
  const menu = shadow(sidebar).getByRole('menu', { name: 'Types' })
  const [first, second] = within(menu).getAllByRole('menuitem')
  // The open type is marked in the menu as it is in the list.
  expect(second).toHaveAttribute('aria-current', 'page')
  // Focus inside a shadow root shows on the root, not the document.
  const focused = () => sidebar.shadowRoot!.activeElement
  expect(focused()).toBe(first)
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(focused()).toBe(second)
  fireEvent.keyDown(menu, { key: 'ArrowUp' })
  expect(focused()).toBe(first)
  fireEvent.keyDown(menu, { key: 'Tab' })
  expect(shadow(sidebar).queryByRole('menu')).not.toBeInTheDocument()

  await userEvent.click(fold)
  expect(shadow(sidebar).getByRole('menu')).toBeInTheDocument()
  // The fold again: closed.
  await userEvent.click(fold)
  expect(shadow(sidebar).queryByRole('menu')).not.toBeInTheDocument()

  await userEvent.click(fold)
  fireEvent.pointerDown(document.body)
  expect(shadow(sidebar).queryByRole('menu')).not.toBeInTheDocument()
})

test('a sidebar the app does not name is called Application navigation', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  const bare = document.createElement('featherbase-sidebar')
  document.body.append(bare)
  expect(bare).toHaveAttribute('aria-label', 'Application navigation')
})

// #1385 (slice 4): one frame. The app's rows are the platform's own, drawn in the frame's links from data, between
// the top and the platform's groups; nothing the app puts in the element is drawn.
test("an app's rows sit in the shared frame's links, before the platform's groups", async ({ admin }) => {
  const { sidebar } = openAppPage(admin)
  await framed(sidebar)
  const links = shadow(sidebar).getByTestId('sidebar-links')
  expect(links.querySelector('slot')).toBeNull()
  const sections = shadow(sidebar).getByTestId('sidebar-slot-sections')
  expect(sections.compareDocumentPosition(shadow(sidebar).getByTestId('sidebar-slot-defaults')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect([...sections.querySelectorAll('[data-sidebar-section]')].map((section) => section.getAttribute('data-sidebar-section'))).toEqual(['views', 'types', 'reports'])
})

test("a row named after one of the platform's pieces, or going to another site, is not drawn", async ({ admin }) => {
  const { sidebar } = openAppPage(admin, { sections: [{ id: 'views', items: [
    { label: 'All Tickets', address: '#all', icon: 'inbox' },
    { label: 'Recently Opened', address: '#recent', icon: 'list' },
    { label: 'Elsewhere', address: '//example.com/', icon: 'link' },
    { label: 'Run', address: 'javascript:void(0)', icon: 'link' },
  ] }] })
  await framed(sidebar)
  const sections = shadow(sidebar).getByTestId('sidebar-slot-sections')
  expect(within(sections).getAllByRole('link').map((link) => link.textContent)).toEqual(['All Tickets'])
})

test('a sidebar the app moves within its page keeps its frame', async ({ admin }) => {
  const { sidebar } = openAppPage(admin)
  await framed(sidebar)
  const frame = sidebar.shadowRoot!.querySelector('.sidebar-frame')
  document.body.append(sidebar)
  await act(async () => {})
  expect(sidebar.shadowRoot!.querySelector('.sidebar-frame')).toBe(frame)
})

test('a sidebar the app takes out and puts back draws its frame again', async ({ admin }) => {
  const { sidebar } = openAppPage(admin)
  await framed(sidebar)
  sidebar.remove()
  await act(async () => {})
  expect(sidebar.shadowRoot!.querySelector('.sidebar-frame')).toBeNull()
  document.body.append(sidebar)
  expect(shadow(sidebar).getByTestId('sidebar-collapse')).toHaveAccessibleName('Collapse sidebar')
})
