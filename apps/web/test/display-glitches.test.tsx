// #914: small display glitches. A title column called "name" reads like any
// other title, not as a code.
import { screen } from '@testing-library/react'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'

test('a Table whose title column is called name shows its titles in the normal font, not as code', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Dg914 Shelf', title_column: 'name',
    columns: [{ column_name: 'name', column_type: 'Data', label: 'Name', in_list_view: true }],
  })
  await admin.post('/api/save_row', { table: 'Dg914 Shelf', row: { name: 'Blue shelf' } })
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug('Dg914 Shelf'))}`, admin)
  const title = await screen.findByRole('link', { name: 'Blue shelf' })
  expect(title.className).not.toMatch(/font-mono/)
})
