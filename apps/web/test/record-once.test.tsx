// Verifier on #476: under React StrictMode (dev) every visit was recorded
// twice, 1ms apart, so one visit showed "· 2×". A navigation is recorded once,
// however many times its effect runs; a new navigation records again.
import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from '../src/router'
import { recentActions } from '../src/lib/recents'
import { test, expect } from './pg-test'

test('one navigation is recorded once under StrictMode; navigating again records again', async ({ admin }) => {
  localStorage.setItem('fc_token', admin.token!)
  localStorage.setItem('fc_user', JSON.stringify({ row_id: 'Administrator', email: 'Administrator', full_name: null }))
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/featherbase/admin/explore'] }),
  })
  render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    </StrictMode>,
  )
  await screen.findByTestId('admin-sidebar')
  const visits = () => recentActions('Administrator', 10).find((e) => e.key === 'page:explore')?.visits.length ?? 0
  await waitFor(() => expect(visits()).toBeGreaterThan(0))
  await new Promise((r) => setTimeout(r, 100))
  expect(visits()).toBe(1)

  await router.navigate({ to: '/featherbase/admin/all-tables' })
  await router.navigate({ to: '/featherbase/admin/explore', search: { root: undefined, chain: undefined, select: undefined } as never })
  await waitFor(() => expect(visits()).toBe(2))
  await new Promise((r) => setTimeout(r, 100))
  expect(visits()).toBe(2)
})
