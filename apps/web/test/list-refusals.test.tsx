// List paths the merged web coverage report (ADR 0012) still showed red: a
// bulk delete the server refuses part-way, backing out of the Delete Table
// dialog by clicking outside or pressing Escape, and the filter-reuse counter
// keeping itself small and surviving a corrupt entry; and the network dropping
// a list's details, its rows or a bulk change. Refusals are the server's.
import { tableSlug } from 'shared'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent
const OPEN = [['stage', '=', 'Open']]

async function seed(admin: Admin, name: string, submittable = false) {
  await admin.post('/api/table_def', {
    name,
    id_pattern: 'prompt',
    is_submittable: submittable,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
      { column_name: 'stage', column_type: 'Choice', label: 'Stage', choices: 'Open\nClosed', in_list_view: true },
    ],
  })
  for (const [id, stage] of [['r1', 'Open'], ['r2', 'Open'], ['r3', 'Closed']])
    await admin.post('/api/save_row', { table: name, row: { row_id: id, title: id, stage } })
}

async function open(admin: Admin, table: string, filters?: unknown) {
  const search = filters ? `?filters=${enc(JSON.stringify(filters))}` : ''
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(table))}${search}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
  return screen.findByTestId('list-rows')
}

test('a bulk delete that meets a row the server will not delete deletes nothing and says why (#332)', async ({ admin }) => {
  await seed(admin, 'Lrf Bulk', true)
  const rows = await open(admin, 'Lrf Bulk')
  await waitFor(() => expect(within(rows).getAllByTestId('row-check')).toHaveLength(3))
  for (const check of within(rows).getAllByTestId('row-check')) fireEvent.click(check)
  // Submitted meanwhile: a submitted row cannot be deleted.
  await admin.post(`/api/table/${enc('Lrf Bulk')}/r2:submit`)
  fireEvent.click(await screen.findByTestId('bulk-delete'))
  fireEvent.click(await screen.findByTestId('bulk-delete-confirm'))
  expect(await screen.findByTestId('bulk-error')).toHaveTextContent(
    'No rows were deleted. r2: Lrf Bulk r2 is submitted and cannot be deleted (cancel it first)',
  )
  expect(((await admin.get(`/api/table/${enc('Lrf Bulk')}/r2`)) as { submission_status: string }).submission_status).toBe('submitted')
  // All-or-nothing: the rows before and after the refused one are still there.
  expect(((await admin.get(`/api/table/${enc('Lrf Bulk')}`)) as { data: unknown[] }).data).toHaveLength(3)
})

test('the Delete Table dialog closes on a click outside it and on Escape, deleting nothing', async ({ admin }) => {
  await seed(admin, 'Lrf Keep')
  await open(admin, 'Lrf Keep')
  fireEvent.click(await screen.findByRole('button', { name: 'Table administration' }))
  fireEvent.click(await screen.findByTestId('delete-table'))
  fireEvent.click(screen.getByTestId('delete-table-dialog').parentElement!)
  expect(screen.queryByTestId('delete-table-dialog')).not.toBeInTheDocument()

  fireEvent.click(screen.getByTestId('delete-table'))
  fireEvent.keyDown(screen.getByTestId('delete-table-dialog'), { key: 'Escape' })
  expect(screen.queryByTestId('delete-table-dialog')).not.toBeInTheDocument()
  expect(((await admin.get(`/api/table/${enc('Lrf Keep')}`)) as { data: unknown[] }).data).toHaveLength(3)
})

test('the filter-reuse counter keeps only the 50 most recent combinations', async ({ admin }) => {
  await seed(admin, 'Lrf Count')
  const key = `fc-filter-count:${admin.user}`
  const old: Record<string, { n: number; t: number }> = {}
  for (let i = 0; i < 50; i++) old[`Other|f${i}`] = { n: 1, t: Date.now() - 86_400_000 + i }
  localStorage.setItem(key, JSON.stringify(old))
  await open(admin, 'Lrf Count', OPEN)
  await waitFor(() => {
    const store = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>
    expect(Object.keys(store)).toHaveLength(50)
    expect(store).toHaveProperty(`Lrf Count|${JSON.stringify(OPEN)}`)
    expect(store).not.toHaveProperty('Other|f0')
    expect(store).toHaveProperty('Other|f1')
  })
})

test('a corrupt filter-reuse counter offers nothing and does not stop the list', async ({ admin }) => {
  await seed(admin, 'Lrf Corrupt')
  localStorage.setItem(`fc-filter-count:${admin.user}`, '{not json')
  const rows = await open(admin, 'Lrf Corrupt', OPEN)
  await waitFor(() => expect(within(rows).getAllByTestId('row-check')).toHaveLength(2))
  expect(screen.queryByTestId('filter-nudge')).not.toBeInTheDocument()
})

/** The network drops every request whose address matches. */
function dropNetwork(lost: (url: string) => boolean) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return lost(url) ? Promise.reject(new TypeError('Failed to fetch')) : bridge(input, init)
  })
}

test("a list whose Table's details the network drops says it cannot load the Table", async ({ admin }) => {
  await seed(admin, 'Lrf Meta Lost')
  dropNetwork((url) => url.includes(`/api/table/${enc('Lrf Meta Lost')}:meta`))
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug('Lrf Meta Lost'))}`, admin)
  expect(await screen.findByTestId('list-error', {}, { timeout: 8000 })).toHaveTextContent('Cannot load Lrf Meta Lost')
})

test('a list whose rows the network drops says it cannot load them', async ({ admin }) => {
  await seed(admin, 'Lrf Rows Lost')
  dropNetwork((url) => url.startsWith(`/api/table/${enc('Lrf Rows Lost')}?`))
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug('Lrf Rows Lost'))}`, admin)
  expect(await screen.findByText('Cannot load rows for Lrf Rows Lost', {}, { timeout: 8000 })).toBeInTheDocument()
})

test('a bulk delete the network drops says the bulk delete failed', async ({ admin }) => {
  await seed(admin, 'Lrf Bulk Lost')
  const rows = await open(admin, 'Lrf Bulk Lost')
  await waitFor(() => expect(within(rows).getAllByTestId('row-check')).toHaveLength(3))
  fireEvent.click(within(rows).getAllByTestId('row-check')[0])
  dropNetwork((url) => url.includes(':bulk-delete'))
  fireEvent.click(await screen.findByTestId('bulk-delete'))
  fireEvent.click(screen.getByTestId('bulk-delete-confirm'))
  expect(await screen.findByTestId('bulk-error')).toHaveTextContent('Bulk delete failed')
})

test('a bulk edit the network drops says the bulk edit failed', async ({ admin }) => {
  await seed(admin, 'Lrf Edit Lost')
  const rows = await open(admin, 'Lrf Edit Lost')
  await waitFor(() => expect(within(rows).getAllByTestId('row-check')).toHaveLength(3))
  fireEvent.click(within(rows).getAllByTestId('row-check')[0])
  dropNetwork((url) => url.includes(':bulk-edit'))
  fireEvent.change(await screen.findByTestId('bulk-edit-field'), { target: { value: 'stage' } })
  fireEvent.change(await screen.findByTestId('bulk-edit-value'), { target: { value: 'Closed' } })
  fireEvent.click(screen.getByTestId('bulk-edit-apply'))
  expect(await screen.findByTestId('bulk-error')).toHaveTextContent('Bulk edit failed')
})
