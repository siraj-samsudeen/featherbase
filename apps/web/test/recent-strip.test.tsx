// #741 item 3: the Recent strip above a Table's list offers only rows that
// still exist. A deleted row's chip led to an error page.
import { screen, waitFor } from '@testing-library/react'
import { recordAction } from '../src/lib/recents'
import { test, expect, renderApp } from './pg-test'

const TABLE = 'Strip Bin'
const path = `/featherbase/admin/${encodeURIComponent(TABLE)}`

function remember(rowId: string, at: number) {
  recordAction('Administrator', { kind: 'row', key: `row:${TABLE}/${rowId}`, label: rowId, sub: TABLE, path: `${path}/${rowId}` }, at)
}

test('#741 a deleted row leaves the Recent strip; the rows still there stay', async ({ admin }) => {
  await admin.post('/api/table_def', { name: TABLE, title_column: 'bin_name', columns: [
    { column_name: 'bin_name', column_type: 'Data' },
  ] })
  const kept = await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent(TABLE)}`, { bin_name: 'Kept bin' })
  const gone = await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent(TABLE)}`, { bin_name: 'Deleted bin' })
  remember(kept.row_id, Date.now() - 2000)
  remember(gone.row_id, Date.now() - 1000)
  await admin.delete(`/api/table/${encodeURIComponent(TABLE)}/${gone.row_id}`)

  await renderApp(path, admin)
  await waitFor(() => expect(screen.getByTestId('recent-strip-row')).toHaveTextContent('Kept bin'))
  expect(screen.getAllByTestId('recent-strip-row')).toHaveLength(1)
  expect(screen.getByTestId('recent-strip')).not.toHaveTextContent(gone.row_id)
})

test('#741 with every remembered row deleted, no Recent strip shows', async ({ admin }) => {
  await admin.post('/api/table_def', { name: TABLE, title_column: 'bin_name', columns: [
    { column_name: 'bin_name', column_type: 'Data' },
  ] })
  const gone = await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent(TABLE)}`, { bin_name: 'Deleted bin' })
  remember(gone.row_id, Date.now() - 1000)
  await admin.delete(`/api/table/${encodeURIComponent(TABLE)}/${gone.row_id}`)

  await renderApp(path, admin)
  await screen.findByTestId('list-view')
  // Give the existence check time to answer before asserting absence.
  await new Promise((r) => setTimeout(r, 1500))
  expect(screen.queryByTestId('recent-strip-row')).toBeNull()
})
