// #1301: a list asks where its Table was copied from without a failing request.
// Only a Table copied from a data source has copy information (#772), and only a
// System Manager may read it; the list of any other Table must not answer with 4xx.
import { screen, waitFor } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { grantRole } from 'server/test/fixtures'

afterEach(() => vi.restoreAllMocks())

/** Every request the page makes that the server refuses (4xx or 5xx), from now on. */
function recordFailures(): string[] {
  const failures: string[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await real(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (response.status >= 400) failures.push(`${response.status} ${url}`)
    return response
  })
  return failures
}

const WAIT = { timeout: 8000 }

async function shelfNote(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', { name: 'Shelf Note', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true }] })
  await admin.post('/api/save_row', { table: 'Shelf Note', row: { title: 'Restock aisle 4' } })
}

test('a System Manager opening the list of a Table that was not copied makes no failing request', async ({ admin }) => {
  await shelfNote(admin)
  const failures = recordFailures()
  await renderApp('/featherbase/admin/table/shelf-note', admin)
  await waitFor(() => expect(screen.getByTestId('list-rows')).toHaveTextContent('Restock aisle 4'), WAIT)
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining(':copy_info'), expect.anything()), WAIT)
  expect(failures).toEqual([])
  expect(screen.queryByTestId('copy-bar')).not.toBeInTheDocument()
})

test('a person who reads a Table but does not manage the instance opens its list with no failing request', async ({ admin, createUser }) => {
  await shelfNote(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Shelf Clerk' } })
  await grantRole(admin, { table: 'Shelf Note', role: 'Shelf Clerk', can_read: true })
  const clerk = await createUser({ email: 'shelf.clerk@example.com', roles: ['Shelf Clerk'] })
  const failures = recordFailures()
  await renderApp('/featherbase/admin/table/shelf-note', clerk)
  await waitFor(() => expect(screen.getByTestId('list-rows')).toHaveTextContent('Restock aisle 4'), WAIT)
  expect(failures).toEqual([])
})
