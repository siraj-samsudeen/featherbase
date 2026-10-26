// Codex review on #476: under React StrictMode the callback's effect runs
// twice against ONE redemption. Only the live effect may finish the sign-in:
// the saved deep link is used once and nothing then overrides it.
import { StrictMode } from 'react'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { routeTree } from '../src/router'
import { rememberLoginNext } from '../src/pages/Login'
import { clearSession } from '../src/lib/api'

const DEEP = '/featherbase/reset-password?key=deep-link'

afterEach(() => {
  vi.restoreAllMocks()
  clearSession()
})

test('under StrictMode, a Google sign-in lands on the saved deep link and stays there', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = url.includes('/api/oauth/session')
      ? { token: 'strict-token', user: { row_id: 'Administrator', full_name: 'Administrator' } }
      : {}
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  rememberLoginNext(DEEP)
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/featherbase/oauth-callback?code=strict-code'] }),
  })
  render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    </StrictMode>,
  )
  await waitFor(() => expect(router.state.location.href).toBe(DEEP))
  // Give a second (stale) handler every chance to run and override it.
  await new Promise((r) => setTimeout(r, 200))
  expect(router.state.location.href).toBe(DEEP)
})
