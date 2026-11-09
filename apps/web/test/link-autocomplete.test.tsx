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

test('UI-006: a no-match query offers create-new in a new tab, keeping the form', async ({ admin }) => {
  await seed(admin)
  const { router } = await open(admin)
  const here = `/featherbase/admin/table/${tableSlug('Lac Order')}/row/o1`
  fireEvent.change(field('label'), { target: { value: 'typed before create-new' } })
  fireEvent.change(field('customer'), { target: { value: 'zzz-no-match' } })
  const options = await screen.findByTestId('link-options-customer')
  await waitFor(() => expect(options).toHaveTextContent('No matches'))
  const create = within(options).getByTestId('link-create-new')
  // The second tab itself is browser-only; here the link must aim at one (#1033).
  expect(create).toHaveAttribute('target', '_blank')
  expect(new URL(create.getAttribute('href')!, 'http://x').pathname)
    .toBe(`/featherbase/admin/table/${tableSlug('Lac Customer')}/new`)
  await userEvent.click(create)
  await new Promise((r) => setTimeout(r, 300)) // a same-tab navigation would land by now
  expect(screen.queryByTestId('unsaved-leave-dialog')).toBeNull()
  expect((router.state as { location: { pathname: string } }).location.pathname).toBe(here)
  expect(field('label')).toHaveValue('typed before create-new')
})

async function depots(admin: Admin) {
  await admin.post('/api/table_def', { name: 'Lac Depot', id_pattern: 'prompt', title_column: 'depot_name', columns: [{ column_name: 'depot_name', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Lac Depot', row: { row_id: 'D1', depot_name: 'North' } })
  await admin.post('/api/save_row', { table: 'Lac Depot', row: { row_id: 'D2' } })
  await admin.post('/api/table_def', { name: 'Lac Load', id_pattern: 'prompt', columns: [
    { column_name: 'label', column_type: 'Data' },
    { column_name: 'depot', column_type: 'Reference', reference_table: 'Lac Depot' },
  ] })
}

test('UI-006: a row with no title is offered by its id', async ({ admin }) => {
  await depots(admin)
  await admin.post('/api/save_row', { table: 'Lac Load', row: { row_id: 'l1', label: 'l1' } })
  await renderApp(`/featherbase/admin/table/${tableSlug('Lac Load')}/row/l1`, admin)
  await screen.findByTestId('form-view', {}, WAIT)
  fireEvent.change(field('depot'), { target: { value: 'D' } })
  fireEvent.change(field('depot'), { target: { value: '' } })
  const options = await screen.findByTestId('link-options-depot', {}, WAIT)
  await waitFor(() => expect(within(options).getAllByTestId('link-option').map((o) => o.textContent)).toEqual(['North', 'D2']))
})

test('UI-006: a link to a row with no title shows its id', async ({ admin }) => {
  await depots(admin)
  await admin.post('/api/save_row', { table: 'Lac Load', row: { row_id: 'l1', label: 'l1', depot: 'D2' } })
  await renderApp(`/featherbase/admin/table/${tableSlug('Lac Load')}/row/l1`, admin)
  await screen.findByTestId('form-view', {}, WAIT)
  await waitFor(() => expect(field('depot')).toHaveValue('D2'))
})
