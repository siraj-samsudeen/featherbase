// #410: the shell shows only what the person can use. Three layouts, driven
// by `capabilities` from /api/whoami — computed on the server, never guessed
// from role names in the browser.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { sql } from 'server/src/db'
import { VIEWER_ROLE } from 'server/src/sales-target'
import { ACCOUNT_SIGN_IN_METHODS_PATH } from 'shared'
import { resolve } from 'node:path'
import { discoverPackages } from 'server/src/runtime-packages'
import { shellKindOf } from '../src/lib/session'
import { setSession } from '../src/lib/api'
import { ManageOnly } from '../src/pages/RestrictedShell'
import { test, expect, renderApp } from './pg-test'
import { grantRole } from 'server/test/fixtures'

type Admin = Parameters<typeof renderApp>[1]

const DASH_STAND_IN = resolve('../..', 'test-apps/fixtures/dash-stand-in')

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
  await grantRole(admin, { table: 'Shelf Note', role: 'Shelf Clerk', can_read: true })
}

// Management tools are System Manager only. Access tokens are self-service (#131), so they stay.
const ADMIN_ONLY_TESTIDS = ['new-table-link', 'import-data-link', 'past-imports-link']

test('management content stays hidden until the server confirms the current person can manage', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ManageOnly><button>Manage instance</button></ManageOnly></QueryClientProvider>)
  expect(screen.queryByRole('button', { name: 'Manage instance' })).not.toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Manage instance' })).toBeInTheDocument()
})

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

test('a Person reader without management access cannot see administrative sign-in controls', async ({ admin, createUser }) => {
  await seed(admin)
  await grantRole(admin, { table: 'Person', role: 'Shelf Clerk', can_read: true })
  const clerk = await createUser({ email: 'person.reader@example.com', roles: ['Shelf Clerk'] })
  const urls = recordCalls()
  await renderApp(`/featherbase/admin/table/person/row/${encodeURIComponent(clerk.user!)}`, clerk)
  await screen.findByTestId('form-view')
  expect(screen.queryByTestId('user-sign-in-methods')).not.toBeInTheDocument()
  expect(urls.filter((u) => u.includes('/identities') || u === '/api/me/sign_in_methods')).toEqual([])
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

test('a person with neither the viewer role nor a Table grant lands on a plain no-access page, which asks for access', async ({ admin, createUser }) => {
  await seed(admin)
  const nobody = await createUser({ email: 'nobody@example.com' })
  const urls = recordCalls()
  await renderApp('/featherbase/admin/home/home', nobody)
  const page = await screen.findByTestId('no-access')
  // #955: opening Featherbase with no access is the request for it.
  await waitFor(() => expect(page).toHaveTextContent("You don't have access to Featherbase yet"))
  expect(page).toHaveTextContent('An admin has been told')
  for (const id of [...ADMIN_ONLY_TESTIDS, 'admin-sidebar']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  expect(urls.filter((u) => /^\/api\/(table|home_pages|app_catalog|unread_count|events)/.test(u))).toEqual([])
  // #489: signing out is in the shared top bar's Account menu.
  await userEvent.click(await screen.findByTestId('session-user'))
  await userEvent.click(screen.getByTestId('logout'))
  await waitFor(() => expect(screen.queryByTestId('no-access')).not.toBeInTheDocument())
})

// (1) A failed background refetch must not unmount a shell that already has its answer.
// #659: an installed app's own Tables do not open the Admin. A person who reads only an app's
// Table is refused the Admin. Found on staging (10-Nov-2026): its no-access page then emailed
// every System Manager for someone who belongs in their app; they are sent there instead.
test("a person whose only grant is on an installed app's Table is sent from the Admin to that app, asking for nothing", async ({ admin, createUser }) => {
  expect(await discoverPackages([DASH_STAND_IN])).toEqual([])
  try {
    await admin.post('/api/install_app', { name: 'dash' })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Dash Reader' } })
    await grantRole(admin, { table: 'dash.note', role: 'Dash Reader', can_read: true })
    const reader = await createUser({ email: 'dash.reader.shell@example.com', roles: ['Dash Reader'] })
    await renderApp('/featherbase/admin', reader)
    const going = await screen.findByTestId('going-to-app')
    const asked = await sql`select count(*)::int as n from access_request where person = ${reader.user}`
    expect([going.getAttribute('data-path'), screen.queryByTestId('no-access'), asked[0].n]).toEqual(['/dash/', null, 0])
  } finally {
    await discoverPackages([])
  }
})

// Someone whose only apps are open to everyone is shown those apps on the Admin's page instead of
// "no access", and nobody is asked for anything.
test('someone who can open only apps open to everyone is shown them, and asks for nothing', async ({ admin, createUser }) => {
  expect(await discoverPackages([resolve('../..', 'test-apps/other')])).toEqual([])
  try {
    await admin.post('/api/install_app', { name: 'other' })
    const anyone = await createUser({ email: 'open.apps.only@example.com', roles: [] })
    // Any moment the no-access card is drawn counts, however briefly (the verifier saw a 50 ms flash).
    let flashed = false
    const watch = new MutationObserver(() => { flashed ||= !!document.querySelector('[data-testid=no-access]') })
    watch.observe(document.body, { childList: true, subtree: true })
    await renderApp('/featherbase/admin', anyone)
    const list = await screen.findByTestId('app-list')
    watch.disconnect()
    const links = [...list.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])
    const asked = await sql`select count(*)::int as n from access_request where person = ${anyone.user}`
    expect([links, flashed, asked[0].n]).toEqual([[['Other tasks', '/other/']], false, 0])
  } finally {
    await discoverPackages([])
  }
})

// When asking for access fails, the page doesn't wait forever: it says there's no access.
test('the no-access page still says so when asking for access fails', async ({ createUser }) => {
  const nobody = await createUser({ email: 'ask.fails@example.com', roles: [] })
  const { api } = await import('../src/lib/api')
  const post = api.post.bind(api)
  const spy = vi.spyOn(api, 'post').mockImplementation(((path: string, body?: unknown) =>
    path === '/api/access_request' ? Promise.reject(new Error('offline')) : post(path, body)) as typeof api.post)
  try {
    await renderApp('/featherbase/admin', nobody)
    expect(await screen.findByText("You don't have access to anything here yet")).toBeInTheDocument()
  } finally {
    spy.mockRestore()
  }
})

test('a failed refresh of whoami keeps the shell the person already has', () => {
  const caps = { manage: false, report: false, admin: true, own_grant: true, tables: ['Shelf Note'], creatable: [], archived: [] }
  expect(shellKindOf({ isError: true, data: { capabilities: caps } })).toBe('admin')
  expect(shellKindOf({ isError: true, data: undefined })).toBe('failed')
  expect(shellKindOf({ isError: false, data: undefined })).toBe('loading')
})

// (5) Grants to the implicit All role come from runtime apps; they list a Table, they do not earn the shell.
test('a viewer whose only grants are to the All role gets the report, not the Admin', async ({ admin, createUser }) => {
  await seed(admin)
  await sql`insert into permission (row_id, ref_table, role, operation, scope_mode, column_rule) values ('all-grant-web', 'Back Office', 'All', 'read', 'all', 'basic')`
  const tl = await createUser({ email: 'tl-all@example.com', roles: [VIEWER_ROLE] })
  await renderApp('/featherbase/admin/all-tables', tl)
  await screen.findByTestId('identity')
  expect(screen.queryByTestId('admin-sidebar')).not.toBeInTheDocument()
})

// (3) ListView toolbar follows what the person may do.
test('a Table list offers Columns, Merge and Import only to a System Manager, and New only where rows can be created', async ({ admin, createUser }) => {
  await seed(admin)
  await grantRole(admin, { table: 'Back Office', role: 'Shelf Clerk', can_read: true, can_create: true })
  const clerk = await createUser({ email: 'clerk-list@example.com', roles: ['Shelf Clerk'] })

  await renderApp('/featherbase/admin/table/back-office', clerk)
  await screen.findByTestId('list-new')
  // Import is a System Manager tool (its route and wizard are), even for someone who can create rows.
  await userEvent.click(await screen.findByRole('button', { name: 'List actions' }))
  expect(screen.queryByTestId('open-import')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Table administration' })).not.toBeInTheDocument()
  expect(screen.queryByTestId('open-columns')).not.toBeInTheDocument()
  expect(screen.queryByTestId('open-merge')).not.toBeInTheDocument()
  cleanup()

  await renderApp('/featherbase/admin/table/shelf-note', clerk)
  await screen.findByTestId('list-columns')
  // A read-only clerk gets no way to add rows, in the toolbar or the empty list.
  expect(screen.queryByTestId('list-new')).not.toBeInTheDocument()
  expect(await screen.findByText('No rows')).toBeInTheDocument()
  expect(screen.queryByTestId('list-empty-new')).not.toBeInTheDocument()
  cleanup()

  await renderApp('/featherbase/admin/table/back-office', admin)
  await userEvent.click(await screen.findByRole('button', { name: 'Table administration' }))
  expect(await screen.findByTestId('open-columns')).toBeInTheDocument()
  expect(screen.getByTestId('open-merge')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'List actions' }))
  expect(screen.getByTestId('open-import')).toBeInTheDocument()
  // Escape from a menu item dismisses the disclosure and returns focus to
  // its trigger, so keyboard users can continue along the toolbar.
  screen.getByTestId('open-import').focus()
  await userEvent.keyboard('{Escape}')
  const actions = screen.getByRole('button', { name: 'List actions' })
  expect(actions).toHaveAttribute('aria-expanded', 'false')
  expect(actions).toHaveFocus()
  expect(screen.queryByTestId('open-import')).not.toBeInTheDocument()
})

// (6) Manage-only routes bounce everyone else to the admin home.
test('typing a management address as a non-manager lands on the admin home instead', async ({ admin, createUser }) => {
  await seed(admin)
  const clerk = await createUser({ email: 'clerk-route@example.com', roles: ['Shelf Clerk'] })
  for (const path of ['/featherbase/admin/new-table', '/featherbase/admin/import', '/featherbase/admin/imports', '/featherbase/admin/table/shelf-note/columns', '/featherbase/admin/table/shelf-note/merge']) {
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
  await grantRole(admin, { table: 'Drop Box', role: 'Drop Box Clerk', can_create: true })
  const writer = await createUser({ email: 'writer-only@example.com', roles: ['Drop Box Clerk'] })
  await renderApp('/featherbase/admin', writer)
  // Wait for a positive marker: the empty-home note or the home page has rendered.
  await waitFor(() => expect(screen.queryByTestId('admin-index-empty') ?? screen.queryByTestId('home-page')).not.toBeNull())
  expect(screen.queryByTestId('shared-only')).not.toBeInTheDocument()
})

test('a refused table list says the person cannot read it, rather than showing an empty list', async ({ admin, createUser }) => {
  await seed(admin)
  const clerk = await createUser({ email: 'clerk.refused@example.com', roles: ['Shelf Clerk'] })
  await renderApp('/featherbase/admin/table/back-office', clerk)
  const refusal = await screen.findByRole('alert', {}, { timeout: 10_000 })
  expect(refusal).toHaveTextContent(/don't have read permission on Back Office/i)
  expect(screen.queryByText('No rows')).not.toBeInTheDocument()
})
