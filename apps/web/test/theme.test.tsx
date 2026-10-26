// UI-024 / #380: the per-person theme — light, dark, or follow the device — at
// the component layer: the real AdminLayout in jsdom, talking through the fetch
// bridge to the in-process server inside a rolled-back transaction. What stays
// in e2e (dark-mode.spec.ts) is the one assertion jsdom cannot make, that the
// canvas actually repaints, because jsdom loads no stylesheet.
//
// Three representations must agree: the painted `data-theme` on the root, the
// server row the choice is stored on, and a fresh load reading it back.

import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyTheme, followDevice, THEME_MIRROR_PREFIX } from '../src/lib/theme'
import { clearSession, getSessionUser, setSession } from '../src/lib/api'

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
  // #489: the theme toggle sits in the top bar (in the Account menu on a phone).
  const option = await screen.findByTestId(`theme-${theme}`)
  option.click()
  await waitFor(() => expect(option).toHaveAttribute('aria-checked', 'true'))
  await waitFor(async () => expect(await serverTheme(as)).toBe(theme))
}

test("the top bar's theme toggle offers light, dark and same-as-device, with the current one checked", async ({ admin }) => {
  await mountAdmin(admin)
  const toggle = await screen.findByTestId('theme-toggle')
  expect(within(toggle).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Light', 'Dark', 'Same as device'])
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

test('every sign-out follows the device, so the next person on a shared phone never inherits a choice', () => {
  deviceSetTo(false)
  setSession('t', { row_id: 'Shared Phone A', email: null, full_name: null })
  applyTheme('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
  // RestrictedShell, SalesTarget, Portal, AdminLayout and the 401 handler all sign out through clearSession.
  clearSession()
  expect(document.documentElement.dataset.theme).toBe('light')
})

test('a stale mirror is corrected when whoami answers: light cached, device stored, dark phone', async ({ admin }) => {
  deviceSetTo(true)
  // Before any React: the mirror still says light (written before 0117 moved
  // the default to device), so the head script and lib/theme paint light.
  const { row_id } = (await admin.get('/api/whoami')) as { row_id: string }
  localStorage.setItem(`${THEME_MIRROR_PREFIX}${row_id}`, 'light')
  document.documentElement.dataset.theme = 'light'
  const { queryClient } = await renderApp('/featherbase/admin', admin)
  await waitFor(() => expect(queryClient.getQueryData(['whoami'])).toMatchObject({ theme: 'device' }))
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
  expect(localStorage.getItem(`${THEME_MIRROR_PREFIX}${getSessionUser()!.row_id}`)).toBe('device')
})

describe('index.html paints before the first frame, with the same rule as lib/theme', () => {
  const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8')
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]
  const run = () => new Function(script)()

  test('declares both colour schemes and reads the mirror key lib/theme writes', () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark" />')
    expect(script).toContain(`'${THEME_MIRROR_PREFIX}'`)
    expect(script).toContain("'fc_user'")
  })

  test.for([
    ['signed out, dark device', null, true, 'dark'],
    ['signed out, light device', null, false, 'light'],
    ['mirror light on a dark device', 'light', true, 'light'],
    ['mirror dark on a light device', 'dark', false, 'dark'],
    ['mirror device on a dark device', 'device', true, 'dark'],
  ] as const)('%s → %s', ([, mirror, dark, painted]) => {
    deviceSetTo(dark)
    clearSession()
    if (mirror) {
      setSession('t', { row_id: 'Head Script', email: null, full_name: null })
      localStorage.setItem(`${THEME_MIRROR_PREFIX}Head Script`, mirror)
    }
    document.documentElement.removeAttribute('data-theme')
    run()
    expect(document.documentElement.dataset.theme).toBe(painted)
    localStorage.removeItem(`${THEME_MIRROR_PREFIX}Head Script`)
    clearSession()
  })
})
