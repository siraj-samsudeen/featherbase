// #825: a Version record is one change to one row. Opening it shows that
// change the way the row's own Activity card does (labels, ✓ / ✗, formatted
// values), as a Field · Before · After table under a who / what / when header,
// with the stored JSON kept collapsed for engineers.
process.env.TZ = 'Asia/Kolkata'

import { screen, waitFor, within } from '@testing-library/react'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'

const T = 'Vr Plant'
const ENC = encodeURIComponent(T)

type Admin = Parameters<typeof renderApp>[1]

async function editedPlant(admin: Admin) {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'plant_name', label: 'Plant name', column_type: 'Data' },
      { column_name: 'active', label: 'In use', column_type: 'Check' },
      { column_name: 'opened_on', label: 'Opened on', column_type: 'Date' },
      { column_name: 'region', column_type: 'Data' },
    ],
  })
  const row = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', {
    table: T,
    row: { plant_name: 'North wing', active: true },
  })
  await admin.post('/api/save_row', {
    table: T,
    row: { row_id: row.row_id, updated_at: row.updated_at, active: false, opened_on: '2026-10-23', region: 'South' },
  })
  await sql`update version set created_at = '2026-11-03T05:40:00Z' where ref_table = ${T} and ref_name = ${row.row_id}`
  const [version] = await sql`select row_id from version where ref_table = ${T} and ref_name = ${row.row_id} order by created_at desc limit 1`
  return { rowId: row.row_id, versionId: String(version.row_id) }
}

let shown: { unmount: () => void } | undefined
async function openVersion(admin: Admin, versionId: string) {
  shown?.unmount()
  shown = await renderApp(`/featherbase/admin/Version/${encodeURIComponent(versionId)}`, admin)
  return screen.findByTestId('change-record', {}, { timeout: 10_000 })
}

test('#825: a Version reads as a Field · Before · After table, in the changed Table\'s words', async ({ admin }) => {
  const { versionId } = await editedPlant(admin)
  const record = await openVersion(admin, versionId)
  const cells = () => within(record).getAllByTestId('change-row').map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))
  await waitFor(() => expect(cells()).toEqual([
    ['In use', '✓', '✗'],
    ['Opened on', '—', '23-Oct-2026'],
    // Created without a label: the readable label the platform gives it.
    ['Region', '—', 'South'],
  ]))
  expect(within(record).getByRole('heading', { name: 'Changes' })).toBeInTheDocument()
  expect(within(record).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Field', 'Before', 'After'])
})

test('#825: the header says what changed, by whom and when, and links to the row', async ({ admin }) => {
  const { rowId, versionId } = await editedPlant(admin)
  const record = await openVersion(admin, versionId)
  const header = within(record).getByTestId('change-header')
  await waitFor(() => expect(header).toHaveTextContent('Administrator'))
  expect(header).toHaveTextContent(T)
  expect(header).toHaveTextContent('03-Nov-2026 11:10 IST')
  expect(within(header).getByRole('link', { name: rowId })).toHaveAttribute('href', `/featherbase/admin/${ENC}/${encodeURIComponent(rowId)}`)
})

test('#825: the stored JSON stays available, collapsed, and is no longer the main view', async ({ admin }) => {
  const { versionId } = await editedPlant(admin)
  await openVersion(admin, versionId)
  const raw = screen.getByTestId('raw-details')
  expect(raw.tagName).toBe('DETAILS')
  expect(raw).not.toHaveAttribute('open')
  expect(within(raw).getByText('Raw JSON')).toBeInTheDocument()
})

test('#825: an import, an undo and a kept correction say so; no field changes says so', async ({ admin }) => {
  const { rowId } = await editedPlant(admin)
  let n = 0
  const add = async (data: Record<string, unknown>) => {
    const [v] = await sql`insert into version (row_id, ref_table, ref_name, data) values (${`vr-${++n}`}, ${T}, ${rowId}, ${sql.json(data)}) returning row_id`
    return String(v.row_id)
  }
  const imported = await add({ changed: [['region', 'South', 'East']], import_run: 'sap-2' })
  let record = await openVersion(admin, imported)
  expect(within(record).getByTestId('change-header')).toHaveTextContent('Import sap-2')

  const undone = await add({ changed: [['region', 'East', 'South']], import_revert: 'sap-2' })
  record = await openVersion(admin, undone)
  expect(within(record).getByTestId('change-header')).toHaveTextContent('Undo of import sap-2')

  const kept = await add({ changed: [], resolution: { field: 'region', decision: 'keep', incoming: 'West' } })
  record = await openVersion(admin, kept)
  await waitFor(() => expect(within(record).getByTestId('change-resolution')).toHaveTextContent('Region: kept the current value instead of West'))
  expect(within(record).getByText('No field changes')).toBeInTheDocument()

  const adopted = await add({ changed: [['region', 'South', 'West']], resolution: { field: 'region', decision: 'source', incoming: 'West' } })
  record = await openVersion(admin, adopted)
  await waitFor(() => expect(within(record).getByTestId('change-resolution')).toHaveTextContent('Region: accepted the source; future imports can update this field'))
})
