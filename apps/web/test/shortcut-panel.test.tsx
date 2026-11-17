// #1251: the Keyboard Shortcuts panel's own controls and the tip's buttons, on
// the real Admin in jsdom against the in-process server. The scenarios
// (scenarios/keyboard-shortcuts.test.tsx) cover the promises; these cover the
// ways in and out of each state.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach } from 'vitest'
import { DAY_MS, SHORTCUT_SETTINGS } from 'shared'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const WAIT = { timeout: 8000 }

beforeEach(() => localStorage.clear())

async function openAdmin(admin: Admin) {
  await renderApp('/featherbase/admin/all-tables', admin)
  return screen.findByTestId('shortcuts-button', {}, WAIT)
}
const panel = () => screen.queryByRole('dialog', { name: 'Keyboard Shortcuts' })
const sidebarStatus = () => (screen.getByText('Collapse Or Expand The Sidebar').closest('[data-shortcut-row]') as HTMLElement).textContent

test('the Keyboard button, Close and Escape open and close the panel', async ({ admin }) => {
  const button = await openAdmin(admin)
  expect(button).toHaveAttribute('title', 'Keyboard Shortcuts · ?')
  await userEvent.click(button)
  expect(panel()).toBeInTheDocument()
  expect(button).toHaveAttribute('aria-expanded', 'true')
  await userEvent.click(button)
  expect(panel()).toBeNull()

  await userEvent.click(button)
  await userEvent.click(within(panel()!).getByRole('button', { name: 'Close' }))
  expect(panel()).toBeNull()

  await userEvent.click(button)
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(panel()).toBeNull()
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
  await userEvent.click(within(tip).getByRole('button', { name: 'Got It' }))
  expect(screen.queryByRole('status', { name: 'Tip' })).toBeNull()
})

test('while tips are quiet the panel says until when, and Turn Tips On Now ends it', async ({ admin }) => {
  await admin.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, { quietUntil: Date.now() + 7 * DAY_MS, quiets: 1 })
  const button = await openAdmin(admin)
  await userEvent.click(button)
  await waitFor(() => expect(within(panel()!).getByText(/^Tips are quiet until \d\d-[A-Z][a-z]{2}-\d{4}\.$/)).toBeInTheDocument(), WAIT)
  await userEvent.click(within(panel()!).getByRole('button', { name: 'Turn Tips On Now' }))
  expect(within(panel()!).queryByText(/Tips are quiet until/)).toBeNull()
  // The next quiet is the longer one: the ladder is kept.
  expect(within(panel()!).getByRole('button', { name: 'Quiet Tips For A Month' })).toBeInTheDocument()
})

test('Reset Tips forgets what was learnt', async ({ admin }) => {
  await admin.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, { use: { sidebar: { keys: 2, mouse: 0, shown: 0, lastKey: Date.now() } } })
  const button = await openAdmin(admin)
  await userEvent.click(button)
  await waitFor(() => expect(sidebarStatus()).toContain('In Use · 2×'), WAIT)
  await userEvent.click(within(panel()!).getByRole('button', { name: 'Reset Tips' }))
  expect(sidebarStatus()).toContain('Not Tried Yet')
})
