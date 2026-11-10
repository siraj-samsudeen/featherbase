// The Admin index sends a person to their first Home Page, unless the address
// has already moved on while the index is still mounted: then the move stands.
// The window is staged with a module mock: the moment the Home Pages answer
// reaches the index, the address moves to All tables before the index's
// effect runs.
import { waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const stage = vi.hoisted(() => ({ router: null as null | { history: { push: (path: string) => void } }, moved: false }))

vi.mock('../src/lib/home-pages', async (original) => {
  const actual = await original<typeof import('../src/lib/home-pages')>()
  return { ...actual, useHomePages: () => {
    const pages = actual.useHomePages()
    if (pages.data?.pages.length && stage.router && !stage.moved) {
      stage.moved = true
      stage.router.history.push('/featherbase/admin/all-tables')
    }
    return pages
  } }
})

const pathOf = (r: { router: unknown }) => (r.router as { state: { location: { pathname: string } } }).state.location.pathname

test('an address that moved on while the Admin index waited for Home Pages stays where it went', async ({ admin }) => {
  await admin.post('/api/save_row', { table: 'Home Page', row: { row_id: 'aim-first', label: 'First' } })
  const r = await renderApp('/featherbase/admin', admin)
  stage.router = r.router as typeof stage.router
  await waitFor(() => expect(stage.moved).toBe(true), { timeout: 8000 })
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/admin/all-tables'))
  // Long enough for a stale redirect to the Home Page to have landed.
  await new Promise((done) => setTimeout(done, 300))
  expect(pathOf(r)).toBe('/featherbase/admin/all-tables')
})
