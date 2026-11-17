// #1248: collapsed, every app's sidebar (<featherbase-sidebar>) is an icon rail,
// never hidden, and its control is the sidebar's own: a footer row and its edge.
// The bar and the sidebar are mounted the way an app's served document mounts
// them (runtime-shell.ts, bar/main.tsx). Widths and pixels are the verifier's.
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { setSession } from '../src/lib/api'
import { mountBar } from '../src/bar/mount'
import { FeatherbaseSidebar } from '../src/bar/sidebar'
import { test, expect } from './pg-test'

if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)

let mounted: { unmount: () => void } | undefined
beforeEach(() => localStorage.clear())
afterEach(() => {
  act(() => mounted?.unmount())
  mounted = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const ICON = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>'

/** A Tickets-like sidebar: two views with icons and counts, a Types heading
 *  that folds its nested types, a row with no icon, and a report row asking for initials. */
function openAppPage(as: TestClient) {
  setSession(as.token!, { row_id: as.user!, email: null, full_name: null })
  const host = document.createElement('featherbase-bar')
  host.dataset.app = 'tickets'
  host.dataset.title = 'Tickets'
  document.body.prepend(host)
  mounted = mountBar(host)
  const sidebar = document.createElement('featherbase-sidebar')
  sidebar.setAttribute('aria-label', 'Ticket views')
  sidebar.innerHTML = `
    <button type="button" aria-current="page">${ICON}<span>All tickets</span><span data-sidebar-count>12</span></button>
    <button type="button">${ICON}<span>My requests</span><span data-sidebar-count>2</span></button>
    <div class="sidebar-heading" data-rail-fold>${ICON}<span>Types</span></div>
    <button type="button" data-depth="1"><span>Access request</span><span data-sidebar-count>3</span></button>
    <button type="button" data-depth="1"><span>Backfill</span><span data-sidebar-count>0</span></button>
    <a href="#jobs">Repair jobs</a>
    <a href="#report" data-rail-initials>${ICON}<span>Sales versus target</span></a>`
  document.body.append(sidebar)
  return { bar: within(host.shadowRoot as unknown as HTMLElement), sidebar }
}

const shadow = (el: HTMLElement) => within(el.shadowRoot as unknown as HTMLElement)
const collapsed = (el: HTMLElement) => el.hasAttribute('data-collapsed')

test('the control is on the sidebar, not in the bar, and collapses it to a rail that stays usable', async ({ admin }) => {
  const { bar, sidebar } = openAppPage(admin)
  // #1253: the account sits at the sidebar's foot, in its shadow.
  await within(sidebar.shadowRoot as unknown as HTMLElement).findByTestId('session-user')
  expect(bar.queryByTestId('sidebar-collapse')).not.toBeInTheDocument()

  const control = shadow(sidebar).getByTestId('sidebar-collapse')
  expect(control).toHaveAccessibleName('Collapse sidebar')
  expect(control.title).toMatch(/^Collapse sidebar \((⌘B|Ctrl\+B)\)$/)
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
  expect(within(sidebar).getByRole('button', { name: /All tickets/ })).toBeInTheDocument()

  await userEvent.click(control)
  expect(collapsed(sidebar)).toBe(false)
})

test("the sidebar's edge toggles it too", async ({ admin }) => {
  const { bar, sidebar } = openAppPage(admin)
  // #1253: the account sits at the sidebar's foot, in its shadow.
  await within(sidebar.shadowRoot as unknown as HTMLElement).findByTestId('session-user')
  const edge = shadow(sidebar).getByTestId('sidebar-edge')
  await userEvent.click(edge)
  expect(collapsed(sidebar)).toBe(true)
  await userEvent.click(edge)
  expect(collapsed(sidebar)).toBe(false)
})

test('in the rail a row without an icon, or one that asks for initials, shows its initials', async ({ admin }) => {
  const { bar, sidebar } = openAppPage(admin)
  // #1253: the account sits at the sidebar's foot, in its shadow.
  await within(sidebar.shadowRoot as unknown as HTMLElement).findByTestId('session-user')
  await userEvent.click(shadow(sidebar).getByTestId('sidebar-collapse'))
  expect(within(sidebar).getByRole('link', { name: 'Repair jobs' })).toHaveAttribute('data-rail-mark', 'RJ')
  expect(within(sidebar).getByRole('link', { name: 'Sales versus target' })).toHaveAttribute('data-rail-mark', 'SV')
  // A row with its own icon keeps the icon.
  expect(within(sidebar).getByRole('button', { name: /My requests/ })).not.toHaveAttribute('data-rail-mark')
})

test("hovering or focusing a rail icon names it at once, with its count; open, nothing is shown", async ({ admin }) => {
  const { bar, sidebar } = openAppPage(admin)
  // #1253: the account sits at the sidebar's foot, in its shadow.
  await within(sidebar.shadowRoot as unknown as HTMLElement).findByTestId('session-user')
  const row = within(sidebar).getByRole('button', { name: /All tickets/ })
  fireEvent.pointerOver(row)
  expect(shadow(sidebar).queryByRole('tooltip')).not.toBeInTheDocument()

  await userEvent.click(shadow(sidebar).getByTestId('sidebar-collapse'))
  fireEvent.pointerOver(row)
  expect(shadow(sidebar).getByRole('tooltip')).toHaveTextContent('All tickets · 12')
  fireEvent.pointerOut(row)
  await waitFor(() => expect(shadow(sidebar).queryByRole('tooltip')).not.toBeInTheDocument())

  act(() => row.focus())
  expect(shadow(sidebar).getByRole('tooltip')).toHaveTextContent('All tickets · 12')
})

test('a folding heading becomes one icon whose menu lists its rows, and choosing one chooses the row', async ({ admin }) => {
  const { bar, sidebar } = openAppPage(admin)
  // #1253: the account sits at the sidebar's foot, in its shadow.
  await within(sidebar.shadowRoot as unknown as HTMLElement).findByTestId('session-user')
  const heading = sidebar.querySelector<HTMLElement>('[data-rail-fold]')!
  // Open, the heading is only a heading, and its rows are rows.
  expect(heading).not.toHaveAttribute('role')
  const backfill = within(sidebar).getByRole('button', { name: /Backfill/ })

  await userEvent.click(shadow(sidebar).getByTestId('sidebar-collapse'))
  expect(heading).toHaveAttribute('role', 'button')
  expect(heading).toHaveAccessibleName('Types')
  expect(heading).toHaveAttribute('aria-haspopup', 'menu')
  // In the rail the nested rows are not shown: the menu stands for them.
  expect(within(sidebar).queryByRole('button', { name: /Backfill/ })).not.toBeInTheDocument()

  const chosen = vi.fn()
  backfill.addEventListener('click', chosen)
  await userEvent.click(heading)
  const menu = shadow(sidebar).getByRole('menu', { name: 'Types' })
  expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Access request3', 'Backfill0'])
  await userEvent.click(within(menu).getByRole('menuitem', { name: /Backfill/ }))
  expect(chosen).toHaveBeenCalledTimes(1)
  expect(shadow(sidebar).queryByRole('menu')).not.toBeInTheDocument()

  // By keyboard: Enter opens it, Escape closes it and returns to the heading.
  act(() => heading.focus())
  fireEvent.keyDown(heading, { key: 'Enter' })
  expect(shadow(sidebar).getByRole('menu', { name: 'Types' })).toBeInTheDocument()
  fireEvent.keyDown(shadow(sidebar).getByRole('menu'), { key: 'Escape' })
  expect(shadow(sidebar).queryByRole('menu')).not.toBeInTheDocument()
  expect(heading).toHaveFocus()

  // Expanded again, the heading is a heading once more.
  await userEvent.click(shadow(sidebar).getByTestId('sidebar-collapse'))
  expect(heading).not.toHaveAttribute('role')
  expect(heading).not.toHaveAttribute('tabindex')
})

test('Ctrl/Cmd+B still toggles from the page, and the choice is kept for this person', async ({ admin }) => {
  const { bar, sidebar } = openAppPage(admin)
  // #1253: the account sits at the sidebar's foot, in its shadow.
  await within(sidebar.shadowRoot as unknown as HTMLElement).findByTestId('session-user')
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
})

test('rows the app draws while collapsed get their rail marks too', async ({ admin }) => {
  const { bar, sidebar } = openAppPage(admin)
  // #1253: the account sits at the sidebar's foot, in its shadow.
  await within(sidebar.shadowRoot as unknown as HTMLElement).findByTestId('session-user')
  await userEvent.click(shadow(sidebar).getByTestId('sidebar-collapse'))
  const late = document.createElement('a')
  late.href = '#late'
  late.textContent = 'Pilot setup'
  act(() => { sidebar.append(late) })
  await waitFor(() => expect(late).toHaveAttribute('data-rail-mark', 'PS'))
})

test('the fold menu: arrows move, Tab and a click outside close it, and the heading toggles it', async ({ admin }) => {
  const { bar, sidebar } = openAppPage(admin)
  // #1253: the account sits at the sidebar's foot, in its shadow.
  await within(sidebar.shadowRoot as unknown as HTMLElement).findByTestId('session-user')
  // The current type is marked in the menu as it is in the list.
  within(sidebar).getByRole('button', { name: /Backfill/ }).setAttribute('aria-current', 'page')
  await userEvent.click(shadow(sidebar).getByTestId('sidebar-collapse'))
  const heading = sidebar.querySelector<HTMLElement>('[data-rail-fold]')!
  await userEvent.click(heading)
  const menu = shadow(sidebar).getByRole('menu', { name: 'Types' })
  const [first, second] = within(menu).getAllByRole('menuitem')
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

  await userEvent.click(heading)
  expect(shadow(sidebar).getByRole('menu')).toBeInTheDocument()
  // The heading again: closed.
  await userEvent.click(heading)
  expect(shadow(sidebar).queryByRole('menu')).not.toBeInTheDocument()

  await userEvent.click(heading)
  fireEvent.pointerDown(document.body)
  expect(shadow(sidebar).queryByRole('menu')).not.toBeInTheDocument()
})

test('a sidebar the app does not name is called Application navigation', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  const bare = document.createElement('featherbase-sidebar')
  document.body.append(bare)
  expect(bare).toHaveAttribute('aria-label', 'Application navigation')
})
