// keyboard-shortcuts' fenced scenarios (#1251), on the real Admin in jsdom
// against the in-process server. Each test is one scenario of
// openspec/specs/keyboard-shortcuts/spec.md, step by step. Opening search
// (the sidebar's search field, Ctrl/Cmd+K) is the shortcut they teach: it is on
// every Admin page. The sidebar's own key teaches no tip (the owner, 18-Nov).
//
// What only a real browser can witness (where the tip lands, that it covers no
// header button) is the e2e test's.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, vi } from 'vitest'
import { DAY_MS, SHORTCUT_SETTINGS } from 'shared'
import { fmtDay } from '@featherbase/shop-floor'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp } from '../pg-test'

type Admin = Parameters<typeof renderApp>[1]
const scenario = scenarioFor(test, 'keyboard-shortcuts')
const WAIT = { timeout: 8000 }
const KEY = /^(⌘B|Ctrl\+B)$/

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

async function openAdmin(admin: Admin) {
  await renderApp('/featherbase/admin/all-tables', admin)
  return screen.findByTestId('sidebar-collapse', {}, WAIT)
}
const openList = () => {
  fireEvent.keyDown(document.body, { key: '?', shiftKey: true })
  return screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })
}
const sidebarRow = (list: HTMLElement) => within(list).getByText('Collapse Or Expand The Sidebar').closest('[data-shortcut-row]') as HTMLElement
async function clickSidebar(times: number) {
  const control = await screen.findByTestId('sidebar-collapse', {}, WAIT)
  for (let i = 0; i < times; i++) await userEvent.click(control)
}
const searchRow = (list: HTMLElement) => within(list).getByText('Search or Command').closest('[data-shortcut-row]') as HTMLElement
/** Opens search from the sidebar's field, by mouse, and closes it again, `times` times. */
async function clickSearch(times: number) {
  for (let i = 0; i < times; i++) {
    await userEvent.click(await screen.findByTestId('command-field', {}, WAIT))
    await userEvent.keyboard('{Escape}')
  }
}
const seed = (admin: Admin, learning: unknown) => admin.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, learning)

describe('keyboard-shortcuts', () => {
  scenario("Looking up the page's shortcuts", async ({ admin }, step) => {
    await step('the user is on an Admin page with the sidebar', () => openAdmin(admin))
    let list!: HTMLElement
    await step('the user opens the list of keyboard shortcuts', async () => {
      list = await openList()
    })
    await step('the list includes collapsing the sidebar with its key', () => {
      expect(within(sidebarRow(list)).getByText(KEY)).toBeInTheDocument()
    })
    await step("the sidebar's control shows that key next to it", async () => {
      const badge = await screen.findByTestId('shortcut-badge-sidebar')
      expect(badge).toHaveTextContent(KEY)
    })
  })

  scenario('Opening search by mouse three times', async ({ admin }, step) => {
    await step('the user has never opened search with its key', () => openAdmin(admin))
    await step("the user opens search from the sidebar's search field three times in a row", async () => {
      await clickSearch(2)
      expect(screen.queryByRole('status', { name: 'Tip' })).toBeNull()
      await clickSearch(1)
    })
    await step('a tip names the key for opening search', async () => {
      const tip = await screen.findByRole('status', { name: 'Tip' }, WAIT)
      expect(tip).toHaveTextContent(/Press (⌘K|Ctrl\+K) to search or run a command from anywhere\./)
    })
  })

  scenario('Going back to the mouse a day later', async ({ admin }, step) => {
    await step('the user opened search with its key two days ago', async () => {
      await seed(admin, { use: { command: { keys: 1, mouse: 0, shown: 0, lastKey: Date.now() - 2 * DAY_MS } } })
      await openAdmin(admin)
    })
    await step("the user opens search from the sidebar's search field three times in a row", () => clickSearch(3))
    await step('a reminder says they have used the mouse three times since they last used the key', async () => {
      const reminder = await screen.findByRole('status', { name: 'Reminder' }, WAIT)
      expect(reminder).toHaveTextContent(/You've done this by mouse 3 times since you last used (⌘K|Ctrl\+K)\./)
    })
    await step('the list of shortcuts shows opening search as slipping', async () => {
      const list = await openList()
      expect(searchRow(list)).toHaveTextContent('Slipping · mouse 3× since')
    })
  })

  scenario('Collapsing the sidebar by mouse brings no tip', async ({ admin }, step) => {
    await step('the user has never collapsed the sidebar with its key', () => openAdmin(admin))
    await step('the user collapses or expands the sidebar with the mouse three times in a row', () => clickSidebar(3))
    await step('no tip appears', async () => {
      // A tip would come at once (the tip scenario's own wait shows it does); give it the time anyway.
      await new Promise((r) => setTimeout(r, 300))
      expect(screen.queryByRole('status', { name: 'Tip' })).toBeNull()
      expect(screen.queryByRole('status', { name: 'Reminder' })).toBeNull()
    })
    await step('the list of shortcuts shows collapsing the sidebar as not tried yet', async () => {
      const list = await openList()
      expect(sidebarRow(list)).toHaveTextContent('Not Tried Yet')
    })
  })

  // The spec's dates are an example: the test quiets tips today and expects
  // them back 30 days on. The server checks the session against the real
  // clock, so only the page's clock is moved forward, after the quiet.
  scenario('Quieting tips twice', async ({ admin }, step) => {
    const today = Date.now()
    await step('the user quieted tips once before', async () => {
      await seed(admin, { quiets: 1 })
      await openAdmin(admin)
    })
    await step('the user quiets tips from a tip on 17-Nov-2026', async () => {
      await clickSearch(3)
      const tip = await screen.findByRole('status', { name: 'Tip' }, WAIT)
      await userEvent.click(within(tip).getByRole('button', { name: 'Quiet Tips For A Month' }))
    })
    await step('no tip appears until 17-Dec-2026', async () => {
      const until = fmtDay(new Date(today + 30 * DAY_MS))
      expect(await screen.findByText(`Tips are quiet until ${until}. They come back after that.`)).toBeInTheDocument()
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(today + 29 * DAY_MS)
      await clickSearch(12)
      expect(screen.queryByRole('status', { name: 'Tip' })).toBeNull()
    })
  })

  scenario('Signing in on another computer', async ({ admin }, step) => {
    await step('the user collapsed the sidebar with its key on one computer', async () => {
      await openAdmin(admin)
      expect(fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true })).toBe(false)
      // Leaving the page sends what was learnt at once.
      cleanup()
      await waitFor(async () => {
        const stored = await admin.get<{ settings: { use?: { sidebar?: { keys: number } } } | null }>(`/api/user_settings/${SHORTCUT_SETTINGS}`)
        expect(stored.settings?.use?.sidebar?.keys).toBe(1)
      }, WAIT)
    })
    let list!: HTMLElement
    await step('the user signs in on another computer and opens the list of keyboard shortcuts', async () => {
      localStorage.clear()
      await openAdmin(admin)
      list = await openList()
    })
    await step('collapsing the sidebar shows as in use', () => waitFor(() => expect(sidebarRow(list)).toHaveTextContent('In Use · 1×')))
  })
})
