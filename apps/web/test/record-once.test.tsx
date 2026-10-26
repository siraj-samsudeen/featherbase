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

// Siraj, 26-Oct (#476): `/featherbase/admin/people` is not a Table, yet it was
// remembered as a list and offered back as "people". A list or row visit is
// recorded only once the Table's metadata has loaded; a 404 is never recorded.
test('a list for a Table that does not exist is never recorded; a real one is', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Record Real', columns: [{ column_name: 'title', column_type: 'Data' }] })
  const { renderApp } = await import('./pg-test')
  const rendered = await renderApp('/featherbase/admin/people', admin)
  await screen.findByTestId('admin-sidebar')
  await new Promise((r) => setTimeout(r, 300))
  expect(recentActions('Administrator', 20).map((e) => e.key)).not.toContain('list:people?')
  await rendered.router.navigate({ to: '/featherbase/admin/Record Real' })
  await waitFor(() => expect(recentActions('Administrator', 20).map((e) => e.key)).toContain('list:Record Real?'))
  await rendered.router.navigate({ to: '/featherbase/admin/people/P-1' })
  await new Promise((r) => setTimeout(r, 300))
  expect(recentActions('Administrator', 20).map((e) => e.key)).not.toContain('row:people/P-1')
})
