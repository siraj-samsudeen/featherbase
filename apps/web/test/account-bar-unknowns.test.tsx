// A person's own account pages (#1006, #501) while the server has not yet
// said, or cannot say, what it needs to name and frame them.
import { act, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { holdResponses } from './held-requests'

const WAIT = { timeout: 10_000 }

test("an account page whose address cannot say what it opens still opens, under the plain bar", async ({ createUser }) => {
  const me = await createUser({ roles: [] })
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (path === '/api/brand') return new Response('{}', { status: 503 })
    return real(input, init)
  })
  await renderApp('/featherbase/account/sign-in-methods', me)
  expect(await screen.findByTestId('account-layout', {}, WAIT)).toBeInTheDocument()
  await waitFor(() => expect(within(screen.getByTestId('top-bar')).getByTestId('top-bar-name')).toHaveTextContent('Featherbase'), WAIT)
})

test("the bar of an account page names nobody's product until the server says who is looking", async ({ createUser }) => {
  const me = await createUser({ roles: [] })
  const whoami = holdResponses('/api/whoami')
  await renderApp('/featherbase/account/sign-in-methods', me)
  const bar = await screen.findByTestId('top-bar', {}, WAIT)
  await whoami.asked
  await new Promise((r) => setTimeout(r, 100))
  expect(within(bar).queryByTestId('top-bar-name')?.textContent ?? '').toBe('')
  await act(async () => { whoami.release() })
  await waitFor(() => expect(within(screen.getByTestId('top-bar')).getByTestId('top-bar-name')).toHaveTextContent('Featherbase'), WAIT)
})
