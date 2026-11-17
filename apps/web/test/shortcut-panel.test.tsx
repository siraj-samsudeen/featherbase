// #1251: the Keyboard Shortcuts panel's own controls and the tip's buttons, on
// the real Admin in jsdom against the in-process server. The scenarios
// (scenarios/keyboard-shortcuts.test.tsx) cover the promises; these cover the
// ways in and out of each state.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach } from 'vitest'
import { DAY_MS, SHORTCUT_SETTINGS } from 'shared'
import { flushShortcutLearning } from '../src/lib/shortcuts'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const WAIT = { timeout: 8000 }

// The page a test closes sends its learning a moment later; wait for that, so
// it can never land on the next test's freshly seeded record.
beforeEach(async () => {
  cleanup()
  await flushShortcutLearning()
  localStorage.clear()
})

async function openAdmin(admin: Admin) {
  await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('shortcut-teaching', {}, WAIT)
}
/** #1253: the panel opens from the sidebar foot's Help menu. */
async function openFromHelp() {
  await userEvent.click(await screen.findByTestId('help-button', {}, WAIT))
  await userEvent.click(screen.getByTestId('keyboard-shortcuts-item'))
}
const panel = () => screen.queryByRole('dialog', { name: 'Keyboard Shortcuts' })
const sidebarStatus = () => (screen.getByText('Collapse Or Expand The Sidebar').closest('[data-shortcut-row]') as HTMLElement).textContent

test("Help's Keyboard Shortcuts item opens the panel and closes the menu; Close, ? and Escape close it", async ({ admin }) => {
  await openAdmin(admin)
  await openFromHelp()
  expect(panel()).toBeInTheDocument()
  expect(screen.queryByTestId('help-button-menu')).toBeNull()
  await userEvent.click(within(panel()!).getByRole('button', { name: 'Close' }))
  expect(panel()).toBeNull()

  await openFromHelp()
  fireEvent.keyDown(document.body, { key: '?', shiftKey: true })
  expect(panel()).toBeNull()

  await openFromHelp()
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(panel()).toBeNull()
})

test("the panel lists the Admin's leader keys: G then N only where there is a Table", async ({ admin }) => {
  await openAdmin(admin)
  fireEvent.keyDown(document.body, { key: 'g' })
  fireEvent.keyDown(document.body, { key: 'd' })
  await openFromHelp()
  const row = (label: string) => (within(panel()!).getByText(label).closest('[data-shortcut-row]') as HTMLElement).textContent
  expect(row('Go To The Admin Home')).toContain('G then D')
  await waitFor(() => expect(row('Go To The Admin Home')).toContain('In Use · 1×'))
  expect(within(panel()!).queryByText('New Row Of This Table')).toBeNull()

  cleanup()
  await renderApp('/featherbase/admin/table/Person', admin)
  await screen.findByTestId('shortcut-teaching', {}, WAIT)
  await openFromHelp()
  await waitFor(() => expect(row('New Row Of This Table')).toContain('G then N'))
})

test('the command search carries its key in its hover text', async ({ admin }) => {
  await openAdmin(admin)
  const search = screen.getByLabelText('Search or type a command')
  expect(search.title).toMatch(/^Search Or Type A Command · (⌘K|Ctrl\+K)$/)
  expect(search).toHaveAttribute('data-shortcut-id', 'command')
})

test('Got It dismisses the tip', async ({ admin }) => {
  await openAdmin(admin)
  const control = await screen.findByTestId('sidebar-collapse', {}, WAIT)
  for (let i = 0; i < 3; i++) await userEvent.click(control)
  const tip = await screen.findByRole('status', { name: 'Tip' }, WAIT)
  // Placed again when the page moves; still there.
  fireEvent(window, new Event('resize'))
  expect(screen.getByRole('status', { name: 'Tip' })).toBe(tip)
  await userEvent.click(within(tip).getByRole('button', { name: 'Got It' }))
  expect(screen.queryByRole('status', { name: 'Tip' })).toBeNull()
})

test('while tips are quiet the panel says until when, and Turn Tips On Now ends it', async ({ admin }) => {
  await admin.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, { quietUntil: Date.now() + 7 * DAY_MS, quiets: 1 })
  await openAdmin(admin)
  await openFromHelp()
  await waitFor(() => expect(within(panel()!).getByText(/^Tips are quiet until \d\d-[A-Z][a-z]{2}-\d{4}\.$/)).toBeInTheDocument(), WAIT)
  await userEvent.click(within(panel()!).getByRole('button', { name: 'Turn Tips On Now' }))
  await waitFor(() => expect(within(panel()!).queryByText(/Tips are quiet until/)).toBeNull())
  // The next quiet is the longer one: the ladder is kept.
  expect(within(panel()!).getByRole('button', { name: 'Quiet Tips For A Month' })).toBeInTheDocument()
})

test('Reset Tips forgets what was learnt', async ({ admin }) => {
  await admin.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, { use: { sidebar: { keys: 2, mouse: 0, shown: 0, lastKey: Date.now() } } })
  await openAdmin(admin)
  await openFromHelp()
  await waitFor(() => expect(sidebarStatus()).toContain('In Use · 2×'), WAIT)
  await userEvent.click(within(panel()!).getByRole('button', { name: 'Reset Tips' }))
  await waitFor(() => expect(sidebarStatus()).toContain('Not Tried Yet'))
})

test('? opens the panel from the page, but not while typing in a text box', async ({ admin }) => {
  await openAdmin(admin)
  const notes = document.createElement('textarea')
  document.body.append(notes)
  fireEvent.keyDown(notes, { key: '?', shiftKey: true })
  expect(panel()).toBeNull()
  notes.remove()
  fireEvent.keyDown(document, { key: '?', shiftKey: true })
  expect(panel()).toBeInTheDocument()
})

test('the key badges follow the controls when the window changes size', async ({ admin }) => {
  await openAdmin(admin)
  await openFromHelp()
  expect(screen.getByTestId('shortcut-badge-sidebar')).toBeInTheDocument()
  fireEvent(window, new Event('resize'))
  // Redrawn from the controls as they are now: the sidebar's badge is still there.
  expect(screen.getByTestId('shortcut-badge-sidebar')).toHaveTextContent(/^(⌘B|Ctrl\+B)$/)
})

test('clicking into the command search three times brings its tip', async ({ admin }) => {
  await openAdmin(admin)
  await admin.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, { use: {}, quietUntil: 0, quiets: 0, lastTip: 0 })
  const search = screen.getByLabelText('Search or type a command')
  for (let i = 0; i < 3; i++) {
    await userEvent.click(search)
    await userEvent.click(document.body)
  }
  const tip = await screen.findByRole('status', { name: 'Tip' }, WAIT)
  expect(tip).toHaveTextContent(/Press (⌘K|Ctrl\+K) to search or type a command from anywhere\./)
})

test('? opens the panel on a page without a sidebar too (Sales Target)', async ({ admin }) => {
  await renderApp('/featherbase/sales-target', admin)
  await screen.findByTestId('shortcut-teaching', {}, WAIT)
  fireEvent.keyDown(document.body, { key: '?', shiftKey: true })
  expect(panel()).toBeInTheDocument()
})
