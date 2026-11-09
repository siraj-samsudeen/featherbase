// Delete permanently (#859) at its edges: what the summary counts as going
// with the rows, many rows asked, lines and many rows pointing at them, rows
// pointing at them that can be neither deleted nor unlinked, and the network
// dropping the preview or the delete. The plan is the real server's.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableHref } from 'shared'
import { vi } from 'vitest'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

type Admin = Parameters<typeof renderApp>[1]
const T = { timeout: 10_000 }
const BIN = 'Pdg Bin'

async function bins(admin: Admin, count: number) {
  await admin.post('/api/table_def', { name: BIN, id_pattern: 'prompt', title_column: 'label', columns: [{ column_name: 'label', column_type: 'Data', in_list_view: true }] })
  if (count) await admin.post(`/api/table/${encodeURIComponent(BIN)}:import`, {
    rows: Array.from({ length: count }, (_, i) => ({ row_id: `B${String(i + 1).padStart(2, '0')}`, label: `Bin ${i + 1}` })),
  })
}

/** The Bin list with its first `n` rows sent to Delete permanently. */
async function purge(admin: Admin, n: number) {
  await renderApp(tableHref(BIN), admin)
  const rows = await screen.findByTestId('list-rows', {}, T)
  await waitFor(() => expect(within(rows).getAllByTestId('row-check').length).toBeGreaterThan(0), T)
  for (const check of within(rows).getAllByTestId('row-check').slice(0, n)) fireEvent.click(check)
  fireEvent.click(await screen.findByTestId('bulk-purge', {}, T))
  return screen.findByTestId('purge-dialog', {}, T)
}

/** What drops the network for every request whose address matches. */
function dropNetwork(lost: (url: string) => boolean) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return lost(url) ? Promise.reject(new TypeError('Failed to fetch')) : bridge(input, init)
  })
}

test('the summary counts the history entries, attachments and shares that go with a row', async ({ admin }) => {
  await bins(admin, 1)
  await sql`insert into version ${sql({ row_id: 'pdg-version-1', ref_table: BIN, ref_name: 'B01' })}`
  await sql`insert into version ${sql({ row_id: 'pdg-version-2', ref_table: BIN, ref_name: 'B01' })}`
  await sql`insert into file ${sql({ row_id: 'pdg-file-1', ref_table: BIN, ref_name: 'B01' })}`
  await sql`insert into file ${sql({ row_id: 'pdg-file-2', ref_table: BIN, ref_name: 'B01' })}`
  await sql`insert into share ${sql({ row_id: 'pdg-share-1', share_table: BIN, share_name: 'B01', person: 'Administrator', read: true })}`
  await sql`insert into share ${sql({ row_id: 'pdg-share-2', share_table: BIN, share_name: 'B01', person: 'Administrator', read: true })}`
  const dialog = await purge(admin, 1)
  const summary = await within(dialog).findByTestId('purge-summary', {}, T)
  expect(summary).toHaveTextContent(/history entries, 2 attachments, 2 shares\. This cannot be undone\./)
})

test("more than twenty rows asked, as an import run's can be, lists twenty and counts the rest", async ({ admin }) => {
  await bins(admin, 0)
  await admin.post(`/api/table/${encodeURIComponent(BIN)}:import`, {
    rows: Array.from({ length: 22 }, (_, i) => ({ row_id: `R${i + 1}`, label: `Run bin ${i + 1}` })),
    context: { run_id: 'pdg-run', file_name: 'bins.csv' },
  })
  clearSession()
  await renderApp(`/featherbase/admin/import?table=${encodeURIComponent(BIN)}`, admin)
  fireEvent.click(await within(await screen.findByTestId('iw-run-history', {}, T)).findByTestId('iw-run-purge-0', {}, T))
  const dialog = await screen.findByTestId('purge-dialog', {}, T)
  await within(dialog).findByTestId('purge-summary', {}, T)
  const listed = within(dialog).getByTestId('purge-rows')
  expect(within(listed).getAllByRole('link')).toHaveLength(20)
  expect(listed).toHaveTextContent('and 2 more')
})

async function crates(admin: Admin, links: number) {
  await bins(admin, 2)
  await admin.post('/api/table_def', { name: 'Pdg Crate', id_pattern: 'prompt', columns: [{ column_name: 'bin', column_type: 'Reference', reference_table: BIN }] })
  await admin.post(`/api/table/${encodeURIComponent('Pdg Crate')}:import`, {
    rows: Array.from({ length: links }, (_, i) => ({ row_id: `C${i + 1}`, bin: i % 2 ? 'B02' : 'B01' })),
  })
}

test('rows pointing at several rows asked are counted as going with them', async ({ admin }) => {
  await crates(admin, 2)
  const dialog = await purge(admin, 2)
  const dependents = await within(dialog).findByTestId('purge-dependents', {}, T)
  expect(dependents).toHaveTextContent('Rows that point at them')
  expect(dependents).toHaveTextContent('2 rows in all go with them.')
})

test('more rows pointing at a row than the plan names are counted', async ({ admin }) => {
  await crates(admin, 104)
  const dialog = await purge(admin, 1)
  const group = await within(dialog).findByTestId('purge-group', {}, T)
  expect(group).toHaveTextContent('Pdg Crate: 52')
  expect(group).toHaveTextContent('and 2 more')
})

test('lines of a document pointing at a row are named as lines in their documents', async ({ admin }) => {
  await bins(admin, 1)
  await admin.post('/api/table_def', { name: 'Pdg Load Line', kind: 'sub_table', columns: [{ column_name: 'bin', column_type: 'Reference', reference_table: BIN }] })
  await admin.post('/api/table_def', { name: 'Pdg Load', columns: [
    { column_name: 'note', column_type: 'Data' },
    { column_name: 'lines', column_type: 'Sub-table', row_table: 'Pdg Load Line' },
  ] })
  await admin.post('/api/save_row', { table: 'Pdg Load', row: { note: 'first', lines: [{ bin: 'B01' }] } })
  const dialog = await purge(admin, 1)
  const group = await within(dialog).findByTestId('purge-group', {}, T)
  expect(group).toHaveTextContent('Pdg Load Line (lines in Pdg Load): 1')
})

test('rows pointing at a row that can be neither deleted nor unlinked hold the delete', async ({ admin }) => {
  await bins(admin, 1)
  await admin.post('/api/table_def', {
    name: 'Pdg Locked',
    id_pattern: 'prompt',
    access_policy: { version: 1, roles: ['System Manager'] },
    columns: [{ column_name: 'bin', column_type: 'Reference', reference_table: BIN, reqd: true }],
  })
  await admin.post('/api/save_row', { table: 'Pdg Locked', row: { row_id: 'L1', bin: 'B01' } })
  const dialog = await purge(admin, 1)
  const group = await within(dialog).findByTestId('purge-group', {}, T)
  expect(within(group).getByTestId('purge-group-action')).toHaveTextContent('— cannot be deleted or unlinked here:')
  expect(within(group).getByTestId('purge-group-action')).toHaveClass('text-negative')
  expect(within(dialog).getByTestId('purge-blocked')).toHaveTextContent('Some rows that point at this can be neither deleted nor unlinked here.')
})

test('a plan the network drops says it could not work out what goes', async ({ admin }) => {
  await bins(admin, 1)
  dropNetwork((url) => url.includes(':purge_preview'))
  const dialog = await purge(admin, 1)
  expect(await within(dialog).findByTestId('purge-preview-error', {}, T)).toHaveTextContent('Could not work out what this removes')
})

test('a delete the network drops says the delete failed', async ({ admin }) => {
  await bins(admin, 1)
  const dialog = await purge(admin, 1)
  await within(dialog).findByTestId('purge-summary', {}, T)
  const user = userEvent.setup()
  await user.type(within(dialog).getByTestId('purge-reason'), 'Made by mistake')
  await user.type(within(dialog).getByTestId('purge-confirm-word'), 'DELETE')
  dropNetwork((url) => url.endsWith(':purge'))
  await user.click(within(dialog).getByTestId('purge-confirm'))
  expect(await within(dialog).findByTestId('purge-error', {}, T)).toHaveTextContent('Delete failed')
})
