// UI-006: a Reference field's picker. Filtering, picking and saving are
// core-forms.test.tsx's; these are the rest of what the Playwright
// link-autocomplete spec walked through (#1080).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`)!
const WAIT = { timeout: 8000 }

async function seed(admin: Admin, customer: string | null = null) {
  await admin.post('/api/table_def', {
    name: 'Lac Customer',
    id_pattern: 'prompt',
    columns: [{ column_name: 'city', column_type: 'Data', label: 'City' }],
  })
  for (const name of ['Acme Ltd', 'Globex Ltd'])
    await admin.post('/api/save_row', { table: 'Lac Customer', row: { row_id: name, city: 'x' } })
  await admin.post('/api/table_def', {
    name: 'Lac Order',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'label', column_type: 'Data', label: 'Label' },
      { column_name: 'customer', column_type: 'Reference', label: 'Customer', reference_table: 'Lac Customer' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Lac Order', row: { row_id: 'o1', label: 'o1', customer } })
}

async function open(admin: Admin) {
  const r = await renderApp(`/featherbase/admin/table/${tableSlug('Lac Order')}/row/o1`, admin)
  await screen.findByTestId('form-view', {}, WAIT)
  await waitFor(() => expect(field('label')).toHaveValue('o1'))
  return r
}

test('UI-006: a picked and saved row shows in the field when the form opens again', async ({ admin }) => {
  await seed(admin, 'Globex Ltd')
  await open(admin)
  await waitFor(() => expect(field('customer')).toHaveValue('Globex Ltd'))
})

test('UI-006: typing what matches nothing says so, and Create new opens a blank form of the linked Table', async ({ admin }) => {
  await seed(admin)
  const { router } = await open(admin)
  fireEvent.change(field('customer'), { target: { value: 'zzz-no-match' } })
  const options = await screen.findByTestId('link-options-customer')
  await waitFor(() => expect(options).toHaveTextContent('No matches'))
  await userEvent.click(within(options).getByTestId('link-create-new'))
  await waitFor(() => expect((router.state as { location: { pathname: string } }).location.pathname)
    .toBe(`/featherbase/admin/table/${tableSlug('Lac Customer')}/new`))
  expect(await screen.findByTestId('form-status', {}, WAIT)).toHaveTextContent('New document')
})
