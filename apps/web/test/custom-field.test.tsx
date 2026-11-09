// CUST-001: a Custom Field added to an existing Table renders in the generic
// form and list views. The server half (meta, API round-trip, re-seed) is
// apps/server/test/custom-field.test.ts; this is what the Admin shows.
import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Cf Target'
const FIELD = 'priority_note'

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/save_row', {
    table: 'Custom Field',
    row: { row_id: `${DT}-${FIELD}`, dt: DT, column_name: FIELD, label: 'Priority Note', column_type: 'Data', in_list_view: true },
  })
  await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'cf-doc', title: 'has custom', [FIELD]: 'urgent' })
}

test('the form shows the custom field with its saved value', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/cf-doc`, admin)
  await waitFor(
    () => expect(document.querySelector<HTMLInputElement>(`[data-field=${FIELD}]`)).toHaveValue('urgent'),
    { timeout: 8000 },
  )
})

test('the list shows a column for the in-list-view custom field', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}`, admin)
  expect(await screen.findByTestId(`col-${FIELD}`, {}, { timeout: 8000 })).toBeInTheDocument()
  await waitFor(() => expect(within(screen.getByTestId('list-rows')).getByText('urgent')).toBeInTheDocument())
})
