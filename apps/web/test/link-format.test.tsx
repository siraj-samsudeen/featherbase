// #1020: what a link says comes from the Table it links to, wherever it shows.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]

const FORMATS = [
  ['name_code', 'Vellayambalam (VLM)'],
  ['code_name', 'VLM (Vellayambalam)'],
  ['name', 'Vellayambalam'],
  ['code', 'VLM'],
] as const

async function stores(admin: Admin, link_format?: string) {
  await admin.post('/api/table_def', {
    name: 'Lf Cluster',
    id_pattern: 'field:cluster_code',
    title_column: 'cluster_name',
    link_format,
    columns: [
      { column_name: 'cluster_code', column_type: 'Data' },
      { column_name: 'cluster_name', column_type: 'Data' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Lf Cluster', row: { cluster_code: 'VLM', cluster_name: 'Vellayambalam' } })
  await admin.post('/api/table_def', {
    name: 'Lf Store',
    id_pattern: 'field:store_name',
    title_column: 'store_name',
    columns: [
      { column_name: 'store_name', column_type: 'Data', in_list_view: true },
      { column_name: 'cluster', column_type: 'Reference', reference_table: 'Lf Cluster', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: 'Lf Store', row: { store_name: 'East', cluster: 'VLM' } })
}

test.for(FORMATS)('a list cell, in %s, reads %s', async ([link_format, text], { admin }) => {
  await stores(admin, link_format)
  await renderApp('/featherbase/admin/table/Lf%20Store', admin)
  const cell = await screen.findByTestId('cell-cluster', undefined, { timeout: 8000 })
  await waitFor(() => expect(cell).toHaveTextContent(new RegExp(`^${text.replace(/[()]/g, '\\$&')}$`)))
})

test('a form link box reads the format, and its options do too', async ({ admin }) => {
  await stores(admin, 'code_name')
  await renderApp('/featherbase/admin/table/Lf%20Store/row/East', admin)
  const box = await screen.findByRole('combobox', { name: /cluster/i }, { timeout: 8000 })
  await waitFor(() => expect(box).toHaveValue('VLM (Vellayambalam)'))
  await userEvent.setup().click(box)
  const options = await screen.findByTestId('link-options-cluster')
  await waitFor(() => expect(within(options).getByTestId('link-option')).toHaveTextContent('VLM (Vellayambalam)'))
})

test('the settings page saves a format, and shows a preview from a real row', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Lf Imported',
    id_pattern: 'field:cluster_code',
    title_column: 'cluster_name',
    columns: [
      { column_name: 'cluster_code', column_type: 'Data' },
      { column_name: 'cluster_name', column_type: 'Data' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Lf Imported', row: { cluster_code: 'VLM', cluster_name: 'Vellayambalam' } })
  await renderApp('/featherbase/admin/table/Lf%20Imported/naming', admin)
  const user = userEvent.setup()
  const format = await screen.findByRole('combobox', { name: 'How links read' }, { timeout: 8000 })
  expect(format).toHaveValue('name_code')
  await waitFor(() => expect(screen.getByTestId('link-format-preview')).toHaveTextContent('Vellayambalam (VLM)'))
  await user.selectOptions(format, 'code')
  await waitFor(() => expect(screen.getByTestId('link-format-preview')).toHaveTextContent(/VLM$/))
  await user.click(screen.getByTestId('link-format-save'))
  expect(await screen.findByTestId('link-format-saved')).toBeInTheDocument()
  expect(await admin.get(`/api/table/${encodeURIComponent('Lf Imported')}:meta`)).toMatchObject({ link_format: 'code' })
})
