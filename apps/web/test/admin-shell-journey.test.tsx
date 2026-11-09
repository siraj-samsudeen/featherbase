// Moved from e2e/admin.spec.ts (UI-001 and the two lost-connection tests,
// #1080). A lost connection is a fetch that rejects, which is what a browser
// gives the page when it is offline; the rest of every request still runs
// against the in-process server on the sandboxed database.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { makeTable } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never
type Router = { state: { location: { pathname: string } }; history: { back: () => void } }
const pathOf = (r: { router: unknown }) => (r.router as Router).state.location.pathname

afterEach(() => vi.restoreAllMocks())

/** Requests whose URL matches `lost` fail as an offline browser fails them. */
function loseConnection(lost: (url: string) => boolean) {
  const bridge = globalThis.fetch
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return lost(url) ? Promise.reject(new TypeError('Failed to fetch')) : bridge(input, init)
  })
}

test('signed out, the root address goes to the sign-in page', async () => {
  const r = await renderApp('/', anonymous)
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/login'))
})

test('signed in, the root address goes to the Admin', async ({ admin }) => {
  const r = await renderApp('/', admin)
  await waitFor(() => expect(pathOf(r)).toMatch(/^\/featherbase\/admin/))
})

test("a new Data Source opened as a row is the guided connect page", async ({ admin }) => {
  await renderApp('/featherbase/admin/table/data-source/row/new', admin)
  expect(await screen.findByTestId('connect-source', {}, { timeout: 8000 })).toBeInTheDocument()
})

test('a sign-in lost to the connection says it failed, and the same credentials work once it returns', async ({ admin, createUser }) => {
  const person = await createUser({ email: 'offline.signin@example.com', roles: ['System Manager'] })
  await admin.post('/api/set_password', { user: person.user, password: 'offline-pw-1' })
  const r = await renderApp('/featherbase/login', anonymous)
  await userEvent.type(await screen.findByLabelText('Email or username'), 'offline.signin@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'offline-pw-1')

  const offline = loseConnection((url) => url.endsWith('/api/login'))
  await userEvent.click(screen.getByTestId('login-submit'))
  expect(await screen.findByTestId('login-error')).toHaveTextContent('Sign-in failed. Please try again.')
  expect(screen.getByTestId('login-submit')).toBeEnabled()
  expect(pathOf(r)).toBe('/featherbase/login')

  offline.mockRestore()
  await userEvent.click(screen.getByTestId('login-submit'))
  await waitFor(() => expect(pathOf(r)).toMatch(/^\/featherbase\/admin/))
  expect(await screen.findByTestId('session-user', {}, { timeout: 8000 })).toHaveTextContent(/offline\.signin|Offline/i)
})

test('All tables keeps the System group closed under its count; opening it lists the engine Tables', async ({ admin }) => {
  await renderApp('/featherbase/admin/all-tables', admin)
  const toggle = await screen.findByTestId('system-group-toggle', {}, { timeout: 8000 })
  const nav = screen.getByTestId('table-nav')
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(within(nav).queryByRole('link', { name: 'Person' })).not.toBeInTheDocument()
  expect(Number(screen.getByTestId('system-group-count').textContent)).toBeGreaterThan(0)
  await userEvent.click(toggle)
  for (const name of ['Person', 'Role', 'Table']) expect(within(nav).getByRole('link', { name })).toBeInTheDocument()
})

test('a Table clicked in All tables opens its list page, which a fresh load of that address reopens', async ({ admin }) => {
  const r = await renderApp('/featherbase/admin/all-tables', admin)
  await userEvent.click(await screen.findByTestId('system-group-toggle', {}, { timeout: 8000 }))
  await userEvent.click(within(screen.getByTestId('table-nav')).getByRole('link', { name: 'Person' }))
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/admin/table/person'))
  await waitFor(() => expect(screen.getByTestId('table-page')).toHaveTextContent('Person'), { timeout: 8000 })

  // A reload: the page starts again from the address and the stored session.
  r.unmount()
  await renderApp('/featherbase/admin/table/person', admin)
  await waitFor(() => expect(screen.getByTestId('table-page')).toHaveTextContent('Person'), { timeout: 8000 })
})

test('a cached list stays usable when its settings and recent-history reads lose the connection', async ({ admin }) => {
  const table = 'Offline Cached List'
  await makeTable(admin, { name: table, columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] })
  await admin.post('/api/save_row', { table, row: { title: 'Locally cached row' } })
  const r = await renderApp('/featherbase/admin/table/offline-cached-list', admin)
  await waitFor(() => expect(screen.getByTestId('list-rows')).toHaveTextContent('Locally cached row'), { timeout: 8000 })

  await userEvent.click(screen.getByTestId('session-user'))
  await userEvent.click(screen.getByTestId('account-sign-in-methods'))
  await screen.findByTestId('sign-in-methods', {}, { timeout: 8000 })

  const failed: string[] = []
  const offline = loseConnection((url) => {
    const lost = url.includes('/api/user_settings/') || /\/api\/events(\/summary)?$/.test(url)
    if (lost) failed.push(url)
    return lost
  })
  ;(r.router as unknown as Router).history.back()
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/admin/table/offline-cached-list'))
  await waitFor(() => {
    expect(failed.some((u) => u.includes('/api/user_settings/'))).toBe(true)
    expect(failed.some((u) => u.endsWith('/api/events/summary'))).toBe(true)
  })
  expect(screen.getByTestId('list-rows')).toHaveTextContent('Locally cached row')
  expect(screen.getByTestId('admin-sidebar')).toBeInTheDocument()

  offline.mockRestore()
  await userEvent.click(screen.getByTestId('col-title'))
  await waitFor(async () => {
    const { settings } = await admin.get<{ settings: { sort?: unknown } | null }>(`/api/user_settings/${encodeURIComponent(table)}`)
    expect(settings?.sort).toEqual({ field: 'title', dir: 'asc' })
  })
})
