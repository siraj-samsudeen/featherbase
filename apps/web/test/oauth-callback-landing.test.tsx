// PLAT-006, #488: where a Google sign-in lands once its one-time code is
// redeemed: where the server says, or, for someone who belongs on another
// address of the instance, that address. The redemption needs the browser's
// own sign-in cookie, which jsdom's fetch cannot carry, so the server's answer
// to it is given here (as in oauth-callback-strict.test.tsx).
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { routeTree } from '../src/router'
import { clearSession } from '../src/lib/api'

afterEach(() => {
  vi.restoreAllMocks()
  clearSession()
})

function signIn(code: string, redeemed: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = url.includes('/api/oauth/session') ? redeemed : {}
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [`/featherbase/oauth-callback?code=${code}`] }) })
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router as never} /></QueryClientProvider>)
  return router
}

test('a Google sign-in with nowhere saved to return to lands where the server says', async () => {
  const router = signIn('landing-code', {
    token: 'landing-token', user: { row_id: 'Administrator', full_name: 'Administrator' }, landing: '/featherbase/account/sign-in-methods',
  })
  await waitFor(() => expect(router.state.location.pathname).toBe('/featherbase/account/sign-in-methods'))
})

test('a Google sign-in of someone who belongs on another address goes there to sign in', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  signIn('handoff-code', {
    token: 'handoff-token', user: { row_id: 'Administrator', full_name: 'Administrator' }, handoff: 'https://dash.example.test/featherbase/oauth-callback?code=next',
  })
  // jsdom cannot load another document; it reports the attempt instead.
  await waitFor(() => expect(errors.mock.calls.some((c) => /Not implemented: navigation/.test(String((c[0] as Error)?.message ?? c[0])))).toBe(true))
})
