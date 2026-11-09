// The Admin's page entry (src/main.tsx), as the served index.html loads it:
// the module mounts the whole Admin on #root with its own router and query
// client, against the in-process server.
import { act, screen, waitFor } from '@testing-library/react'
import { settleSandboxRequests } from 'server/test/pg-test-shared'
import type { TestClient } from 'feather-testing-postgres'
import { test, expect } from './pg-test'
import { rememberLoginNext } from '../src/pages/Login'

const T = { timeout: 8000 }
let copy = 0
async function openAdmin(as: TestClient, path: string) {
  await settleSandboxRequests()
  localStorage.setItem('fc_token', as.token!)
  localStorage.setItem('fc_user', JSON.stringify({ row_id: as.user }))
  window.history.replaceState(null, '', path)
  document.body.innerHTML = '<div id="root"></div>'
  await act(() => import(/* @vite-ignore */ `../src/main?page=${++copy}`))
}

test('a filter value with a space keeps the space in the address, never a plus', async ({ admin }) => {
  const filters = JSON.stringify([['full_name', 'like', '%Asha Rao%']])
  await openAdmin(admin, `/featherbase/admin/table/person?filters=${encodeURIComponent(filters)}`)
  await screen.findByTestId('list-view', {}, T)
  expect(window.location.search).toContain('Asha%20Rao')
  expect(window.location.search).not.toContain('+')
  expect(JSON.parse(JSON.parse(new URLSearchParams(window.location.search).get('filters')!))).toEqual(JSON.parse(filters))
})

// The entry renders in StrictMode, which runs a page's effects twice in
// development: the import wizard takes up saved work once only.
test('the import page opens from the Admin entry, which runs its effects twice', async ({ admin }) => {
  sessionStorage.clear()
  await openAdmin(admin, '/featherbase/admin/import')
  expect(await screen.findByTestId('iw-file-input', {}, T)).toBeInTheDocument()
})

test('a refused Google sign-in keeps the saved destination in the address once, under the entry that runs its effects twice', async () => {
  localStorage.clear()
  rememberLoginNext('/featherbase/admin/all-tables')
  window.history.replaceState(null, '', '/featherbase/login?error=not_provisioned')
  document.body.innerHTML = '<div id="root"></div>'
  await act(() => import(/* @vite-ignore */ `../src/main?page=${++copy}`))
  await waitFor(() => expect(new URLSearchParams(window.location.search).getAll('next')).toEqual(['/featherbase/admin/all-tables']), T)
  expect(new URLSearchParams(window.location.search).get('error')).toBe('not_provisioned')
})

test('a row that does not exist says so at once, without asking the server again', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Ae Note', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await openAdmin(admin, '/featherbase/admin/table/ae-note/row/no-such-note')
  // A refusal (4xx) is final: retried, it would only hold the page on Loading.
  expect(await screen.findByText('Cannot load Ae Note no-such-note', {}, { timeout: 2000 })).toBeInTheDocument()
})
