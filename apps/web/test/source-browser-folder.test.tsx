// The source browser on a folder of CSV files, whose tables have no schema,
// and on any source when the network drops a test, a listing or a turn-on.
// The folder is real files read by the in-process server.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { invalidateSources } from 'server/src/sources/registry'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const WAIT = { timeout: 8000 }
let dir: string

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fb-sbf-'))
  writeFileSync(path.join(dir, 'sbf_depot.csv'), 'code,city\nKKL,Karaikal\n')
})
afterAll(() => {
  invalidateSources()
  rmSync(dir, { recursive: true, force: true })
})

async function openFolder(admin: Admin, connect = '') {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'web-sbf', engine: 'csv-folder', root_path: dir, access: 'read_only' })
  await renderApp(`/featherbase/admin/source/web-sbf${connect}`, admin)
}

/** Requests whose address has `part` are lost, as offline. */
function dropNetwork(part: string) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).includes(part)
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
}

test("a folder's files are listed by their own names and can be turned on", async ({ admin }) => {
  const user = userEvent.setup()
  await openFolder(admin)
  await user.click(await screen.findByTestId('sb-load', {}, WAIT))
  const row = await screen.findByTestId('sb-row-sbf_depot.csv', {}, WAIT)
  expect(row).not.toHaveTextContent(/\.sbf_depot/)
  await user.click(row.querySelector('input[type="checkbox"]')!)
  await user.click(screen.getByTestId('sb-reflect'))
  expect(await screen.findByTestId('sb-result', {}, WAIT)).toHaveTextContent('Created:')
})

test('a file named in the address is ticked when the folder is listed', async ({ admin }) => {
  const user = userEvent.setup()
  await openFolder(admin, '?connect=sbf_depot.csv')
  await user.click(await screen.findByTestId('sb-load', {}, WAIT))
  const row = await screen.findByTestId('sb-row-sbf_depot.csv', {}, WAIT)
  await waitFor(() => expect(row.querySelector('input[type="checkbox"]')).toBeChecked())
})

test('a connection test the network drops says it failed', async ({ admin }) => {
  await openFolder(admin)
  dropNetwork(':test_connection')
  await userEvent.click(await screen.findByTestId('sb-test', {}, WAIT))
  expect(await screen.findByTestId('sb-test-result', {}, WAIT)).toHaveTextContent(/^Failed$/)
})

test('a listing the network drops says introspection failed', async ({ admin }) => {
  await openFolder(admin)
  dropNetwork(':introspect')
  await userEvent.click(await screen.findByTestId('sb-load', {}, WAIT))
  expect(await screen.findByText('Introspection failed', {}, WAIT)).toBeInTheDocument()
})

test('a turn-on the network drops says reflect failed', async ({ admin }) => {
  const user = userEvent.setup()
  await openFolder(admin)
  await user.click(await screen.findByTestId('sb-load', {}, WAIT))
  const row = await screen.findByTestId('sb-row-sbf_depot.csv', {}, WAIT)
  await user.click(row.querySelector('input[type="checkbox"]')!)
  dropNetwork(':reflect')
  await user.click(screen.getByTestId('sb-reflect'))
  expect(await screen.findByText('Reflect failed', {}, WAIT)).toBeInTheDocument()
  expect(within(screen.getByTestId('sb-row-sbf_depot.csv')).getByRole('checkbox')).toBeEnabled()
})
