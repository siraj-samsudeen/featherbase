// #626: conflict decisions and preview are driven through the real import API.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { sql } from 'server/src/db'
import { invalidateMeta } from 'server/src/meta'

const TABLE = 'Import Correction UI'
const path = `/api/table/${encodeURIComponent(TABLE)}`

test('a Table exposes the kept correction and lets the user keep it or adopt the source', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: TABLE,
    columns: [
      { column_name: 'code', column_type: 'Data', label: 'Code', in_list_view: true },
      { column_name: 'city', column_type: 'Data', label: 'City', in_list_view: true },
    ],
  })
  const load = (city: string, run: string) => admin.post(`${path}:import`, {
    key_column: 'code', rows: [{ code: 'C1', city }], context: { run_id: run },
  })
  await load('North', 'ui-first')
  const rows = await admin.get<{ data: { row_id: string }[] }>(path)
  const row = await admin.get<Record<string, unknown>>(`${path}/${rows.data[0].row_id}`)
  await admin.post('/api/save_row', { table: TABLE, row: { ...row, city: 'South' } })
  await load('East', 'ui-conflict')
  await renderApp(`/featherbase/admin/${encodeURIComponent(TABLE)}`, admin)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Import conflicts' }, { timeout: 8000 }))
  const panel = await screen.findByRole('region', { name: 'Import conflicts' })
  expect(await within(panel).findByText('South')).toBeInTheDocument()
  expect(within(panel).getByText('East')).toBeInTheDocument()
  expect(within(panel).getByText('City')).toBeInTheDocument()
  expect(within(panel).getByText('Administrator')).toBeInTheDocument()
  expect(within(panel).getByText('ui-conflict')).toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'Keep mine' }))
  expect(await within(panel).findByText('No open import conflicts.')).toBeInTheDocument()
  await load('West', 'ui-next')
  await user.click(screen.getByRole('button', { name: 'Import conflicts' }))
  await user.click(screen.getByRole('button', { name: 'Import conflicts' }))
  await user.click(await screen.findByRole('button', { name: 'Take the source' }))
  await waitFor(async () => {
    const saved = await admin.get<{ city: string }>(`${path}/${rows.data[0].row_id}`)
    expect(saved.city).toBe('West')
  })
  expect(await screen.findByText('No open import conflicts.')).toBeInTheDocument()
})

test('the import check explains updated and protected fields before committing', async ({ admin }) => {
  const { clearSession } = await import('../src/lib/import-session')
  clearSession()
  await admin.post('/api/table_def', { name: TABLE, columns: [
    { column_name: 'code', column_type: 'Data', label: 'Code' },
    { column_name: 'city', column_type: 'Data', label: 'City' },
    { column_name: 'phone', column_type: 'Data', label: 'Phone' },
  ] })
  await admin.post(`${path}:import`, { rows: [{ code: 'C1', city: 'North', phone: '111' }] })
  const rows = await admin.get<{ data: { row_id: string }[] }>(path)
  const row = await admin.get<Record<string, unknown>>(`${path}/${rows.data[0].row_id}`)
  await admin.post('/api/save_row', { table: TABLE, row: { ...row, city: 'South' } })
  await renderApp(`/featherbase/admin/import?table=${encodeURIComponent(TABLE)}`, admin)
  const bytes = new TextEncoder().encode('Code,City,Phone\nC1,East,222\n').buffer
  const file = new File([bytes], 'corrections.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  const { fireEvent } = await import('@testing-library/react')
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [file] } })
  const user = userEvent.setup()
  await user.selectOptions(await screen.findByTestId('iw-key-0'), 'code')
  await user.click(screen.getByTestId('iw-check'))
  const check = await screen.findByTestId('iw-check-0')
  expect(check).toHaveTextContent('1 field will update')
  expect(check).toHaveTextContent('1 hand-edited field will be kept and flagged')
  const unchanged = await admin.get<{ city: string; phone: string }>(`${path}/${rows.data[0].row_id}`)
  expect(unchanged.city).toBe('South')
  expect(unchanged.phone).toBe('111')
  clearSession()
})

test('the import check warns when a Table does not keep history', async ({ admin }) => {
  const { clearSession } = await import('../src/lib/import-session')
  clearSession()
  await admin.post('/api/table_def', { name: TABLE, track_changes: false, columns: [
    { column_name: 'code', column_type: 'Data', label: 'Code' },
    { column_name: 'city', column_type: 'Data', label: 'City' },
  ] })
  // Metadata can turn tracking off; the Admin editor does not expose the flag yet.
  await sql`update table_def set track_changes = false where name = ${TABLE}`
  invalidateMeta(TABLE)
  await renderApp(`/featherbase/admin/import?table=${encodeURIComponent(TABLE)}`, admin)
  const bytes = new TextEncoder().encode('Code,City\nC1,East\n').buffer
  const file = new File([bytes], 'corrections.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  const { fireEvent } = await import('@testing-library/react')
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [file] } })
  const user = userEvent.setup()
  await user.selectOptions(await screen.findByTestId('iw-key-0'), 'code')
  await user.click(screen.getByTestId('iw-check'))
  expect(await screen.findByTestId('iw-check-0')).toHaveTextContent('This Table does not keep change history. Imports overwrite existing values, including hand edits.')
  clearSession()
})
