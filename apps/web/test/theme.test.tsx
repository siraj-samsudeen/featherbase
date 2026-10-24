// UI-024 / #380: the per-person theme — light, dark, or follow the device — at
// the component layer: the real AdminLayout in jsdom, talking through the fetch
// bridge to the in-process server inside a rolled-back transaction. What stays
// in e2e (dark-mode.spec.ts) is the one assertion jsdom cannot make, that the
// canvas actually repaints, because jsdom loads no stylesheet.
//
// Three representations must agree: the painted `data-theme` on the root, the
// server row the choice is stored on, and a fresh load reading it back.

import { screen, waitFor } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { followDevice } from '../src/lib/theme'

// applyTheme writes to the ONE jsdom document every test shares, and RTL's
// cleanup does not touch documentElement — so reset it, or a later test
// inherits the previous one's theme as its starting point.
afterEach(() => {
  vi.unstubAllGlobals()
  followDevice()
})

type Client = Parameters<typeof renderApp>[1]

const serverTheme = (as: Client) =>
  as.get('/api/whoami').then((w) => (w as { theme?: string }).theme)

/** A device whose light/dark setting the test controls, as matchMedia reports it. */
function deviceSetTo(dark: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    get matches() { return dark },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', (query: string) => (query.includes('prefers-color-scheme') ? media : { matches: false, addEventListener() {}, removeEventListener() {} }))
  return {
    change(next: boolean) {
      dark = next
      listeners.forEach((fn) => fn())
    },
  }
}

/**
 * Mount the Admin and wait until whoami is in the query cache. useTheme
 * re-applies whatever whoami carries, so a choice made before the first
 * response lands would be overwritten by it moments later.
 */
async function mountAdmin(as: Client, theme = 'device') {
  const { queryClient } = await renderApp('/featherbase/admin', as)
  await screen.findByTestId('session-user')
  await waitFor(() => expect(queryClient.getQueryData(['whoami'])).toMatchObject({ theme }))
}

/** Choose a theme in the account menu and wait for the server to own it. */
async function choose(as: Client, theme: 'light' | 'dark' | 'device') {
  if (!screen.queryByTestId('account-menu')) (await screen.findByTestId('session-user')).click()
  const option = await screen.findByTestId(`theme-${theme}`)
  option.click()
  await waitFor(() => expect(option).toHaveAttribute('aria-checked', 'true'))
  await waitFor(async () => expect(await serverTheme(as)).toBe(theme))
}

test('the account menu offers light, dark and same-as-device, with the current one checked', async ({ admin }) => {
  await mountAdmin(admin)
  ;(await screen.findByTestId('session-user')).click()
  const choice = await screen.findByTestId('theme-choice')
  expect(choice).toHaveTextContent('Light')
  expect(choice).toHaveTextContent('Dark')
  expect(choice).toHaveTextContent('Same as device')
  expect(screen.getByTestId('theme-device')).toHaveAttribute('aria-checked', 'true')
})

test('choosing dark marks the document root dark, then light again', async ({ admin }) => {
  await mountAdmin(admin)
  await choose(admin, 'dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
  await choose(admin, 'light')
  expect(document.documentElement.dataset.theme).toBe('light')
})

test('same as device paints what the device says, and repaints when the device changes', async ({ admin }) => {
  const device = deviceSetTo(true)
  await mountAdmin(admin)
  await choose(admin, 'light')
  await choose(admin, 'device')
  expect(document.documentElement.dataset.theme).toBe('dark')
  device.change(false)
  expect(document.documentElement.dataset.theme).toBe('light')
  // A fixed choice ignores the device.
  await choose(admin, 'dark')
  device.change(false)
  expect(document.documentElement.dataset.theme).toBe('dark')
})

test('the choice is stored on the person, not just in the DOM', async ({ admin }) => {
  expect(await serverTheme(admin)).toBe('device')
  await mountAdmin(admin)
  await choose(admin, 'dark')
  expect(await serverTheme(admin)).toBe('dark')
})

test('a fresh load renders dark from the stored preference, with no click', async ({ admin }) => {
  await admin.post('/api/set_theme', { theme: 'dark' })
  await mountAdmin(admin, 'dark')
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
})

test("one account's theme never leaks into another's session", async ({ admin, createUser }) => {
  await admin.post('/api/set_theme', { theme: 'dark' })
  const other = await createUser({ roles: ['System Manager'] })
  // The mirror key is scoped by person (PR #92), so the other account follows
  // its own device setting once its own whoami resolves.
  await mountAdmin(other)
  expect(await serverTheme(other)).toBe('device')
  expect(document.documentElement.dataset.theme).toBe('light')
})

test('signed out, the page follows the device', () => {
  deviceSetTo(true)
  followDevice()
  expect(document.documentElement.dataset.theme).toBe('dark')
  deviceSetTo(false)
  followDevice()
  expect(document.documentElement.dataset.theme).toBe('light')
})
