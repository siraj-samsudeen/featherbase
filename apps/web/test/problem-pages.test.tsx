// #1327 (audit F07): one page for what a screen can't show. Not found, No access or
// Couldn't open, each in plain words with one way forward, inside the page's own shell.
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { grantRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]
const T = { timeout: 8000 }

afterEach(() => vi.restoreAllMocks())

const TABLE = 'Pp Probe'
async function aTable(admin: Client) {
  await admin.post('/api/table_def', { name: TABLE, id_pattern: 'prompt', columns: [{ column_name: 'note', column_type: 'Data' }] })
}

/** The network drops every request with this method whose address contains `part`, until `restore`. */
function dropNetwork(method: string, part: string) {
  const bridge = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return (init?.method ?? 'GET') === method && url.includes(part) ? Promise.reject(new TypeError('Failed to fetch')) : bridge(input, init)
  })
  return () => spy.mockRestore()
}

test('a record that is not there says so by its Table and ID, inside the Admin, with the way back to its list', async ({ admin }) => {
  await aTable(admin)
  await renderApp('/featherbase/admin/table/pp-probe/row/NOPE', admin)
  const page = await screen.findByTestId('problem-not-found', {}, T)
  expect(within(page).getByRole('heading')).toHaveTextContent('This Pp Probe isn’t here')
  expect(page).toHaveTextContent('No Pp Probe has the ID “NOPE”. It may have been deleted, or the link is wrong.')
  expect(within(page).getByRole('link', { name: 'Back to Pp Probe' })).toHaveAttribute('href', '/featherbase/admin/table/pp-probe')
  expect(screen.getByTestId('admin-sidebar')).toBeInTheDocument()
})

test.for([
  ['a script report', '/featherbase/admin/script-report/Pp%20No%20Such%20Report', 'This report isn’t here'],
  ['a dashboard', '/featherbase/admin/dashboard/pp-no-such-board', 'This dashboard isn’t here'],
] as const)('%s that is not there says so, with the way to the Admin home', async ([, path, title], { admin }) => {
  await renderApp(path, admin)
  const page = await screen.findByTestId('problem-not-found', {}, T)
  expect(within(page).getByRole('heading')).toHaveTextContent(title)
  expect(within(page).getByRole('link', { name: 'Go to the Admin home' })).toHaveAttribute('href', '/featherbase/admin')
})

test('a Table the viewer may not read says they cannot open it, with the way to the Admin home', async ({ admin, createUser }) => {
  await aTable(admin)
  await admin.post('/api/table_def', { name: 'Pp Desk', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await grantRole(admin, { table: 'Pp Desk', role: 'Pp Reader', can_read: true })
  const reader = await createUser({ roles: ['Pp Reader'] })
  await renderApp('/featherbase/admin/table/pp-probe/row/NOPE', reader)
  const page = await screen.findByTestId('problem-no-access', {}, T)
  expect(within(page).getByRole('heading')).toHaveTextContent(/^You can’t open /)
  expect(page).toHaveTextContent('Ask your administrator if you need it.')
  expect(within(page).getByRole('link', { name: 'Go to the Admin home' })).toHaveAttribute('href', '/featherbase/admin')
})

test('a record that could not be loaded says so, and Try again loads it', async ({ admin }) => {
  await aTable(admin)
  await admin.post(`/api/table/${encodeURIComponent(TABLE)}`, { row_id: 'pp-back-soon', note: 'here after all' })
  const restore = dropNetwork('GET', '/api/table/Pp%20Probe/pp-back-soon')
  await renderApp('/featherbase/admin/table/pp-probe/row/pp-back-soon', admin)
  const page = await screen.findByTestId('problem-failed', {}, T)
  expect(within(page).getByRole('heading')).toHaveTextContent('This Pp Probe couldn’t be opened')
  expect(page).toHaveTextContent('The server didn’t answer. Try again in a moment.')
  restore()
  fireEvent.click(within(page).getByRole('button', { name: 'Try again' }))
  expect(await screen.findByDisplayValue('here after all', {}, T)).toBeInTheDocument()
  expect(screen.queryByTestId('problem-failed')).not.toBeInTheDocument()
})

test('an address outside the Admin that matches nothing says so under the top bar, with the way to Featherbase', async ({ admin }) => {
  await renderApp('/featherbase/pp-nowhere', admin)
  const page = await screen.findByTestId('problem-not-found', {}, T)
  expect(within(page).getByRole('heading')).toHaveTextContent('Page not found')
  expect(within(page).getByRole('link', { name: 'Go to Featherbase' })).toHaveAttribute('href', '/')
  expect(await screen.findByTestId('top-bar', {}, T)).toBeInTheDocument()
})

test('a list whose rows the network drops says it could not load them, and Try again loads them', async ({ admin }) => {
  await aTable(admin)
  await admin.post(`/api/table/${encodeURIComponent(TABLE)}`, { row_id: 'pp-listed', note: 'listed' })
  const restore = dropNetwork('GET', '/api/table/Pp%20Probe?')
  await renderApp('/featherbase/admin/table/pp-probe', admin)
  const page = await screen.findByTestId('problem-failed', {}, T)
  expect(within(page).getByRole('heading')).toHaveTextContent('The rows of Pp Probe couldn’t be loaded')
  restore()
  fireEvent.click(within(page).getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('pp-listed', {}, T)).toBeInTheDocument()
})

test('a Portal Table the viewer may not read leads to Featherbase, not the Admin home', async ({ admin, createUser }) => {
  await aTable(admin)
  await admin.post('/api/table_def', { name: 'Pp Desk', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await grantRole(admin, { table: 'Pp Desk', role: 'Pp Reader', can_read: true })
  const reader = await createUser({ roles: ['Pp Reader'] })
  await renderApp('/featherbase/portal/pp-probe/NOPE', reader)
  const page = await screen.findByTestId('problem-no-access', {}, T)
  expect(within(page).getByRole('link', { name: 'Go to Featherbase' })).toHaveAttribute('href', '/')
  expect(within(page).queryByRole('link', { name: 'Go to the Admin home' })).not.toBeInTheDocument()
})

test('a record the server failed on says something went wrong on the server', async ({ admin }) => {
  await aTable(admin)
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return url.includes('/api/table/Pp%20Probe/pp-broken')
      ? Promise.resolve(new Response(JSON.stringify({ error: { type: 'Internal', message: 'database exploded' } }), { status: 500, headers: { 'content-type': 'application/json' } }))
      : bridge(input, init)
  })
  await renderApp('/featherbase/admin/table/pp-probe/row/pp-broken', admin)
  const page = await screen.findByTestId('problem-failed', {}, T)
  expect(page).toHaveTextContent('Something went wrong on the server. Try again in a moment.')
  expect(page).not.toHaveTextContent('database exploded')
})

test("a record the server turns away for another reason says it in the server's words", async ({ admin }) => {
  await aTable(admin)
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return url.includes('/api/table/Pp%20Probe/pp-odd')
      ? Promise.resolve(new Response(JSON.stringify({ error: { type: 'Conflict', message: 'This record is being moved; open it in a minute' } }), { status: 409, headers: { 'content-type': 'application/json' } }))
      : bridge(input, init)
  })
  await renderApp('/featherbase/admin/table/pp-probe/row/pp-odd', admin)
  expect(await screen.findByTestId('problem-failed', {}, T)).toHaveTextContent('This record is being moved; open it in a minute')
})
