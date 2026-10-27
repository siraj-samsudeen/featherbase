// #410: the shell shows only what the person can use. Three layouts, driven
// by `capabilities` from /api/whoami — computed on the server, never guessed
// from role names in the browser.
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { sql } from 'server/src/db'
import { VIEWER_ROLE } from 'server/src/sales-target'
import { ACCOUNT_SIGN_IN_METHODS_PATH } from 'shared'
import { shellKindOf } from '../src/lib/session'
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

// Management tools are System Manager only. Access tokens are self-service (#131), so they stay.
const ADMIN_ONLY_TESTIDS = ['new-table-link', 'import-data-link', 'past-imports-link']

test('a System Manager keeps the whole Admin shell', async ({ admin }) => {
  await seed(admin)
  await renderApp('/featherbase/admin/all-tables', admin)
  for (const id of ADMIN_ONLY_TESTIDS) expect(await screen.findByTestId(id)).toBeInTheDocument()
  expect(screen.getByTestId('all-tables-link')).toBeInTheDocument()
  expect(screen.getByTestId('access-tokens-link')).toBeInTheDocument()
})

test('a person with a Table grant sees no management tools and only the Tables they can read', async ({ admin, createUser }) => {
  await seed(admin)
  const clerk = await createUser({ email: 'clerk@example.com', roles: ['Shelf Clerk'] })
  const urls = recordCalls()
  await renderApp('/featherbase/admin/all-tables', clerk)
  await screen.findByTestId('all-tables-link')
  for (const id of ADMIN_ONLY_TESTIDS) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  expect(screen.getByTestId('access-tokens-link')).toBeInTheDocument()
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
  // /api/brand is the shared top bar asking what this address opens (#489).
  const adminCalls = urls.filter((u) => !/^\/api\/(whoami|brand|runtime_app_versions|sales_target\/)/.test(u))
  expect(adminCalls).toEqual([])
})

test('a viewer-only person reaches their sign-in methods on the account page, still without Admin calls', async ({ admin, createUser }) => {
  await seed(admin)
  const tl = await createUser({ email: 'tl2@example.com', roles: [VIEWER_ROLE] })
  const urls = recordCalls()
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, tl)
  expect(await screen.findByTestId('sign-in-methods')).toBeInTheDocument()
  expect(screen.getByTestId('top-bar')).toBeInTheDocument()
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
  for (const id of [...ADMIN_ONLY_TESTIDS, 'admin-sidebar']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  expect(urls.filter((u) => /^\/api\/(table|home_pages|app_catalog|unread_count|events)/.test(u))).toEqual([])
  // #489: signing out is in the shared top bar's Account menu.
  await userEvent.click(await screen.findByTestId('session-user'))
  await userEvent.click(screen.getByTestId('logout'))
  await waitFor(() => expect(screen.queryByTestId('no-access')).not.toBeInTheDocument())
})

// (1) A failed background refetch must not unmount a shell that already has its answer.
test('a failed refresh of whoami keeps the shell the person already has', () => {
  const caps = { manage: false, report: false, table_access: true, own_grant: true, tables: ['Shelf Note'], creatable: [] }
  expect(shellKindOf({ isError: true, data: { capabilities: caps } })).toBe('admin')
  expect(shellKindOf({ isError: true, data: undefined })).toBe('failed')
  expect(shellKindOf({ isError: false, data: undefined })).toBe('loading')
})

// (5) Grants to the implicit All role come from runtime apps; they list a Table, they do not earn the shell.
test('a viewer whose only grants are to the All role gets the report, not the Admin', async ({ admin, createUser }) => {
  await seed(admin)
  await sql`insert into permission (row_id, ref_table, role, tier, can_read) values ('all-grant-web', 'Back Office', 'All', 'basic', true)`
  const tl = await createUser({ email: 'tl-all@example.com', roles: [VIEWER_ROLE] })
  await renderApp('/featherbase/admin/all-tables', tl)
  await screen.findByTestId('identity')
  expect(screen.queryByTestId('admin-sidebar')).not.toBeInTheDocument()
})

// (3) ListView toolbar follows what the person may do.
test('a Table list offers Columns, Merge and Import only to a System Manager, and New only where rows can be created', async ({ admin, createUser }) => {
  await seed(admin)
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Back Office', role: 'Shelf Clerk', can_read: true, can_create: true } })
  const clerk = await createUser({ email: 'clerk-list@example.com', roles: ['Shelf Clerk'] })

  await renderApp('/featherbase/admin/Back%20Office', clerk)
  await screen.findByTestId('list-new')
  // Import is a System Manager tool (its route and wizard are), even for someone who can create rows.
  expect(screen.queryByTestId('open-import')).not.toBeInTheDocument()
  expect(screen.queryByTestId('open-columns')).not.toBeInTheDocument()
  expect(screen.queryByTestId('open-merge')).not.toBeInTheDocument()
  cleanup()

  await renderApp('/featherbase/admin/Shelf%20Note', clerk)
  await screen.findByTestId('list-columns')
  // A read-only clerk gets no way to add rows, in the toolbar or the empty list.
  expect(screen.queryByTestId('list-new')).not.toBeInTheDocument()
  expect(await screen.findByText('No rows')).toBeInTheDocument()
  expect(screen.queryByTestId('list-empty-new')).not.toBeInTheDocument()
  cleanup()

  await renderApp('/featherbase/admin/Back%20Office', admin)
  expect(await screen.findByTestId('open-columns')).toBeInTheDocument()
  expect(screen.getByTestId('open-merge')).toBeInTheDocument()
  expect(screen.getByTestId('open-import')).toBeInTheDocument()
})

// (6) Manage-only routes bounce everyone else to the admin home.
test('typing a management address as a non-manager lands on the admin home instead', async ({ admin, createUser }) => {
  await seed(admin)
  const clerk = await createUser({ email: 'clerk-route@example.com', roles: ['Shelf Clerk'] })
  for (const path of ['/featherbase/admin/new-table', '/featherbase/admin/import', '/featherbase/admin/imports', '/featherbase/admin/Shelf%20Note/columns', '/featherbase/admin/Shelf%20Note/merge']) {
    await renderApp(path, clerk)
    await screen.findByTestId('admin-sidebar')
    await waitFor(() => expect(screen.queryByTestId('table-page')).not.toBeInTheDocument())
    cleanup()
  }
})

// (8) Only a shared row: the admin home says how rows reach them, not an empty shell.
test('a person with only a shared row lands on a page that says so', async ({ admin, createUser }) => {
  await seed(admin)
  const row = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Shelf Note', row: { title: 'Hello' } })
  const guest = await createUser({ email: 'guest-share@example.com' })
  await admin.post('/api/save_row', { table: 'Share', row: { share_table: 'Shelf Note', share_name: row.row_id, person: guest.user, read: true } })
  await renderApp('/featherbase/admin', guest)
  expect(await screen.findByTestId('shared-only')).toHaveTextContent(/shared with you/i)
})

// (9) The preview banner stays in the restricted layouts.
test('the preview banner shows on the no-access page', async ({ createUser }) => {
  vi.stubEnv('PREVIEW_LOGIN_KEY', 'k'.repeat(40))
  vi.stubEnv('PREVIEW_LOGIN_USER', 'someone')
  const nobody = await createUser({ email: 'nobody-banner@example.com' })
  await renderApp('/featherbase/admin', nobody)
  await screen.findByTestId('no-access')
  expect(await screen.findByTestId('preview-banner')).toBeInTheDocument()
  vi.unstubAllEnvs()
})

// (3) A create-only grant is a grant of their own: the shared-rows page is for people with none.
test('a create-only grant holder is not told "nothing is open to you"', async ({ admin, createUser }) => {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Drop Box Clerk' } })
  await admin.post('/api/table_def', { name: 'Drop Box', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  // The role's ONLY grant: create. It reads nothing, so `tables` is empty.
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Drop Box', role: 'Drop Box Clerk', can_create: true } })
  const writer = await createUser({ email: 'writer-only@example.com', roles: ['Drop Box Clerk'] })
  await renderApp('/featherbase/admin', writer)
  // Wait for a positive marker: the empty-home note or the home page has rendered.
  await waitFor(() => expect(screen.queryByTestId('admin-index-empty') ?? screen.queryByTestId('home-page')).not.toBeNull())
  expect(screen.queryByTestId('shared-only')).not.toBeInTheDocument()
})

test('a refused table list says the person cannot read it, rather than showing an empty list', async ({ admin, createUser }) => {
  await seed(admin)
  const clerk = await createUser({ email: 'clerk.refused@example.com', roles: ['Shelf Clerk'] })
  await renderApp('/featherbase/admin/Back%20Office', clerk)
  const refusal = await screen.findByTestId('list-error', {}, { timeout: 10_000 })
  expect(refusal).toHaveTextContent(/no read permission on Back Office/i)
  expect(screen.queryByText('No rows')).not.toBeInTheDocument()
})
