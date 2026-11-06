// #1020: nested rows on a row the viewer can only read show each row's values,
// and a link among them reads as its Table's links read.
import { configure, screen, waitFor } from '@testing-library/react'
import { tableHref } from 'shared'
import { createUserWithRole, grantRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })

test('a read-only form lists nested rows, their links by format or in neutral words', async ({ admin, createUser }) => {
  for (const [name, code, label] of [['Nv Open', 'VLM', 'Vellayambalam'], ['Nv Closed', 'SEC', 'Secret Place']]) {
    await admin.post('/api/table_def', {
      name, id_pattern: 'field:code', title_column: 'label', link_format: 'code_name',
      columns: [{ column_name: 'code', column_type: 'Data' }, { column_name: 'label', column_type: 'Data' }],
    })
    await admin.post('/api/save_row', { table: name, row: { code, label } })
  }
  await admin.post('/api/table_def', {
    name: 'Nv Line', kind: 'sub_table',
    columns: [
      { column_name: 'qty', column_type: 'Int' },
      { column_name: 'open', column_type: 'Reference', reference_table: 'Nv Open' },
      { column_name: 'closed', column_type: 'Reference', reference_table: 'Nv Closed' },
    ],
  })
  await admin.post('/api/table_def', {
    name: 'Nv Order',
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'lines', column_type: 'Sub-table', row_table: 'Nv Line' },
    ],
  })
  const { row_id } = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Nv Order', row: { title: 'First', lines: [{ qty: 3, open: 'VLM', closed: 'SEC' }] },
  })
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Order Viewer', table: 'Nv Order', can_read: true })

  // Not allowed to read the nested Table: how many rows, nothing else.
  const { unmount } = await renderApp(`${tableHref('Nv Order')}/row/${encodeURIComponent(row_id)}`, viewer)
  await waitFor(() => expect(screen.getByTestId('nested-count-lines')).toHaveTextContent('1 row'))
  unmount()

  await grantRole(admin, { role: 'Nv Order Viewer', table: ['Nv Line', 'Nv Open'], can_read: true })
  await renderApp(`${tableHref('Nv Order')}/row/${encodeURIComponent(row_id)}`, viewer)
  const field = await screen.findByTestId('value-lines')
  await waitFor(() => expect(field).toHaveTextContent('VLM (Vellayambalam)'))
  await waitFor(() => expect(field).toHaveTextContent('A row you cannot see'))
  expect(field).toHaveTextContent('3')
  expect(field).not.toHaveTextContent('object Object')
  expect(field).not.toHaveTextContent('SEC')
})
