// #410: the shell shows only what the person can use. Three layouts, driven
// by `capabilities` from /api/whoami — computed on the server, never guessed
// from role names in the browser.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { VIEWER_ROLE } from 'server/src/sales-target'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]

afterEach(() => vi.restoreAllMocks())

/** Every URL the page asks the server for, from now on. */
function recordCalls(): string[] {
  const urls: string[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : (input as Request).url)
    return real(input, init)
  })
  return urls
}

async function seed(admin: Admin) {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: VIEWER_ROLE } })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Shelf Clerk' } })
  await admin.post('/api/table_def', { name: 'Shelf Note', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  await admin.post('/api/table_def', { name: 'Back Office', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Shelf Note', role: 'Shelf Clerk', can_read: true } })
}

const ADMIN_ONLY_TESTIDS = ['new-table-link', 'import-data-link', 'past-imports-link', 'access-tokens-link']

test('a System Manager keeps the whole Admin shell', async ({ admin }) => {
  await seed(admin)
  await renderApp('/featherbase/admin/all-tables', admin)
  for (const id of ADMIN_ONLY_TESTIDS) expect(await screen.findByTestId(id)).toBeInTheDocument()
  expect(screen.getByTestId('all-tables-link')).toBeInTheDocument()
})

test('a person with a Table grant sees no management tools and only the Tables they can read', async ({ admin, createUser }) => {
  await seed(admin)
  const clerk = await createUser({ email: 'clerk@example.com', roles: ['Shelf Clerk'] })
  const urls = recordCalls()
  await renderApp('/featherbase/admin/all-tables', clerk)
  await screen.findByTestId('all-tables-link')
  for (const id of ADMIN_ONLY_TESTIDS) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  expect(await screen.findByRole('link', { name: 'Shelf Note' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Back Office' })).not.toBeInTheDocument()
  // The Table list itself is refused to this person; the shell must not ask.
  expect(urls.filter((u) => u.startsWith('/api/table/Table'))).toEqual([])
})

test('a viewer-only person is taken to the report: no Admin chrome, no Admin calls', async ({ admin, createUser }) => {
  await seed(admin)
  const tl = await createUser({ email: 'tl@example.com', roles: [VIEWER_ROLE] })
  const urls = recordCalls()
  await renderApp('/featherbase/admin/home/home', tl)
  await screen.findByTestId('identity')
  for (const id of [...ADMIN_ONLY_TESTIDS, 'all-tables-link', 'admin-sidebar']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  const adminCalls = urls.filter((u) => !/^\/api\/(whoami|runtime_app_versions|sales_target\/)/.test(u))
  expect(adminCalls).toEqual([])
})

test('a viewer-only person reaches their sign-in methods in a bare shell, still without Admin calls', async ({ admin, createUser }) => {
  await seed(admin)
  const tl = await createUser({ email: 'tl2@example.com', roles: [VIEWER_ROLE] })
  const urls = recordCalls()
  await renderApp('/featherbase/admin/sign-in-methods', tl)
  expect(await screen.findByTestId('report-only-shell')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /back to your report/i })).toHaveAttribute('href', '/featherbase/sales-target')
  expect(screen.getByTestId('logout')).toBeInTheDocument()
  for (const id of [...ADMIN_ONLY_TESTIDS, 'all-tables-link', 'admin-sidebar']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  expect(urls.filter((u) => /^\/api\/(table|home_pages|app_catalog|unread_count|events|navigable_tables)/.test(u))).toEqual([])
})

test('a person with neither the viewer role nor a Table grant lands on a plain no-access page', async ({ admin, createUser }) => {
  await seed(admin)
  const nobody = await createUser({ email: 'nobody@example.com' })
  const urls = recordCalls()
  await renderApp('/featherbase/admin/home/home', nobody)
  const page = await screen.findByTestId('no-access')
  expect(page).toHaveTextContent("You don't have access to anything here yet")
  expect(page).toHaveTextContent(/ask your administrator/i)
  expect(screen.getByTestId('logout')).toBeInTheDocument()
  for (const id of [...ADMIN_ONLY_TESTIDS, 'admin-sidebar']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  expect(urls.filter((u) => /^\/api\/(table|home_pages|app_catalog|unread_count|events)/.test(u))).toEqual([])
  await userEvent.click(screen.getByTestId('logout'))
  await waitFor(() => expect(screen.queryByTestId('no-access')).not.toBeInTheDocument())
})
