// UI-024: the per-user dark/light theme, at the component layer — real
// AdminLayout in jsdom, talking through the fetch bridge to the in-process
// server inside a rolled-back transaction. Pushed down from
// e2e/dark-mode.spec.ts (#223 batch 1); what stayed in e2e is the one
// assertion jsdom cannot make, that the canvas actually repaints, because
// jsdom loads no stylesheet and computes no cascade.
//
// The three states the toggle has to get right are independent: the DOM the
// theme is expressed through, the server row it is stored on, and a fresh
// page load reading it back. One test each.

import { screen, waitFor } from '@testing-library/react'
import { afterEach } from 'vitest'
import { test, expect, renderApp } from './pg-test'

// applyTheme writes to the ONE jsdom document every test shares, and RTL's
// cleanup does not touch documentElement — so reset it, or a later test
// inherits the previous one's theme as its starting point.
afterEach(() => {
  delete document.documentElement.dataset.theme
})

type Client = Parameters<typeof renderApp>[1]

const serverTheme = (as: Client) =>
  as.get('/api/whoami').then((w) => (w as { theme?: string }).theme ?? 'light')

/**
 * Mount the Admin and wait until whoami is in the query cache.
 *
 * The wait is load-bearing, not tidiness. useTheme re-applies whatever the
 * whoami response carries, so a click fired before the first response lands
 * is overwritten by it moments later — the DOM flips back and the component's
 * own `theme` state disagrees with the server, which makes the NEXT toggle
 * compute the wrong direction.
 */
async function mountAdmin(as: Client, theme: 'light' | 'dark' = 'light') {
  const { queryClient } = await renderApp('/admin', as)
  await screen.findByTestId('theme-toggle')
  await waitFor(() => expect(queryClient.getQueryData(['whoami'])).toMatchObject({ theme }))
}

/**
 * Click the toggle and wait for the server to own the new value.
 *
 * Also load-bearing. useTheme fires `void api.post('/api/set_theme')`, so a
 * test that returns while it is in flight lets the write execute after its
 * sandbox transaction ended — committing a permanently dark Administrator
 * into the database, which the next test then reads as its starting state.
 */
async function toggleTo(as: Client, theme: 'light' | 'dark') {
  ;(await screen.findByTestId('theme-toggle')).click()
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe(theme))
  await waitFor(async () => expect(await serverTheme(as)).toBe(theme))
}

test('the toggle marks the document root dark, then light again', async ({ admin }) => {
  await mountAdmin(admin)
  expect(document.documentElement.dataset.theme ?? 'light').toBe('light')

  await toggleTo(admin, 'dark')
  await toggleTo(admin, 'light')
})

test('the choice is stored on the User row, not just in the DOM', async ({ admin }) => {
  expect(await serverTheme(admin)).toBe('light')
  await mountAdmin(admin)
  await toggleTo(admin, 'dark')
  expect(await serverTheme(admin)).toBe('dark')
})

test('a fresh load renders dark from the stored preference, with no toggle', async ({ admin }) => {
  await admin.post('/api/set_theme', { theme: 'dark' })
  await mountAdmin(admin, 'dark')
  // whoami resolves after mount and applies the server value — nobody clicked.
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
})

test("one account's theme never leaks into another's session", async ({ admin, createUser }) => {
  await admin.post('/api/set_theme', { theme: 'dark' })
  const other = await createUser({ roles: ['System Manager'] })
  // The mirror key is scoped by user (PR #92), so the other account starts
  // light and stays there once its own whoami resolves.
  await mountAdmin(other)
  expect(await serverTheme(other)).toBe('light')
  expect(document.documentElement.dataset.theme ?? 'light').toBe('light')
})
