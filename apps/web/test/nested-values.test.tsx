// #1020: nested rows on a row the viewer can only read show each row's values,
// and a link among them reads as its Table's links read.
import { configure, screen, waitFor } from '@testing-library/react'
import { tableHref } from 'shared'
import { createUserWithRole, grantRole } from 'server/test/fixtures'
import { sql } from 'server/src/db'
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

test('an editor who may not read the nested Table sees how many rows, not an endless wait', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Nv Part', kind: 'sub_table', columns: [{ column_name: 'qty', column_type: 'Int' }] })
  await admin.post('/api/table_def', { name: 'Nv Box', columns: [
    { column_name: 'title', column_type: 'Data' },
    { column_name: 'parts', column_type: 'Sub-table', row_table: 'Nv Part' },
  ] })
  const { row_id } = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Nv Box', row: { title: 'First', parts: [{ qty: 1 }, { qty: 2 }] } })
  const editor = await createUserWithRole(admin, createUser, { role: 'Nv Box Editor', table: 'Nv Box', can_read: true, can_write: true })
  await renderApp(`${tableHref('Nv Box')}/row/${encodeURIComponent(row_id)}`, editor)
  await waitFor(() => expect(screen.getByTestId('nested-count-parts')).toHaveTextContent('2 rows'))
})

test("a link stored as a Table's title column gives its row's page no id and no dot", async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Nv Place', id_pattern: 'prompt', columns: [{ column_name: 'label', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Nv Place', row: { row_id: 'VLM', label: 'Somewhere' } })
  await admin.post('/api/table_def', { name: 'Nv Titled', id_pattern: 'integer', columns: [
    { column_name: 'place', column_type: 'Reference', reference_table: 'Nv Place' },
  ] })
  const { row_id } = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Nv Titled', row: { place: 'VLM' } })
  // Stored before the API refused it; only the database can make one now.
  await sql`update table_def set title_column = 'place' where name = 'Nv Titled'`
  await admin.put(`/api/table_def/${encodeURIComponent('Nv Titled')}`, { link_format: 'name' })

  await renderApp(`${tableHref('Nv Titled')}/row/${encodeURIComponent(row_id)}`, admin)
  const heading = await screen.findByRole('heading', { level: 1 })
  await waitFor(() => expect(heading).toHaveTextContent('Nv Titled: Nv Titled'))
  expect(heading).not.toHaveTextContent('·')
  expect(heading).not.toHaveTextContent('VLM')
})

test("a link to a Table the editor can't read is a closed box that says so, not one that drops what is typed", async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Nv Hidden', id_pattern: 'prompt', columns: [{ column_name: 'label', column_type: 'Data' }] })
  await admin.post('/api/table_def', { name: 'Nv Ticket', columns: [
    { column_name: 'title', column_type: 'Data' },
    { column_name: 'place', column_type: 'Reference', reference_table: 'Nv Hidden', label: 'Place' },
  ] })
  const { row_id } = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Nv Ticket', row: { title: 'First' } })
  const editor = await createUserWithRole(admin, createUser, { role: 'Nv Ticket Editor', table: 'Nv Ticket', can_read: true, can_write: true })
  await renderApp(`${tableHref('Nv Ticket')}/row/${encodeURIComponent(row_id)}`, editor)
  const box = await screen.findByPlaceholderText("You can't read Nv Hidden")
  expect(box).toBeDisabled()
})
