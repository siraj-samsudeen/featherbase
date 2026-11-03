// #832: a link inside a grid of nested rows (a person's roles, an order's
// lines) is picked from the linked Table's rows, with the same picker a link
// field on the form uses. Text typed but never picked is not saved as a link.
import { screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import type { TestClient } from 'feather-testing-postgres'
import { test, expect, renderApp } from './pg-test'

type Saved = { row_id: string }
const enc = encodeURIComponent

async function seedOrders(admin: TestClient) {
  await admin.post('/api/table_def', { name: 'Nest Customer', id_pattern: 'prompt', columns: [{ column_name: 'city', column_type: 'Data' }] })
  for (const name of ['Acme Ltd', 'Globex Ltd', 'Formco'])
    await admin.post('/api/save_row', { table: 'Nest Customer', row: { row_id: name, city: 'x' } })
  await admin.post('/api/table_def', {
    name: 'Nest Line', kind: 'sub_table',
    columns: [{ column_name: 'customer', column_type: 'Reference', label: 'Customer', reference_table: 'Nest Customer', reqd: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Nest Order',
    columns: [
      { column_name: 'label', column_type: 'Data', label: 'Label' },
      { column_name: 'lines', column_type: 'Sub-table', label: 'Lines', row_table: 'Nest Line' },
    ],
  })
  return admin.post<Saved>('/api/save_row', { table: 'Nest Order', row: { label: 'o1' } })
}

test('a link cell in nested rows offers matching rows, and the picked one is saved', async ({ admin }) => {
  const order = await seedOrders(admin)
  await renderApp(`/featherbase/admin/${enc('Nest Order')}/${order.row_id}`, admin)
  fireEvent.click(await screen.findByTestId('add-row-lines', {}, { timeout: 8000 }))
  const cell = await screen.findByLabelText('Lines, Customer, row 1')
  expect(cell).toHaveAttribute('role', 'combobox')
  expect(cell).toHaveAttribute('data-childfield', 'customer')

  fireEvent.change(cell, { target: { value: 'Ltd' } })
  const options = await screen.findByTestId('link-options-customer')
  await waitFor(() => expect(within(options).getAllByTestId('link-option')).toHaveLength(2))
  expect(options).not.toHaveTextContent('Formco')
  fireEvent.mouseDown(within(options).getAllByTestId('link-option').find((o) => o.textContent === 'Globex Ltd')!)
  expect(screen.getByLabelText('Lines, Customer, row 1')).toHaveValue('Globex Ltd')

  screen.getByTestId('form-save').click()
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  const stored = await admin.get<{ lines: { customer: string }[] }>(`/api/table/${enc('Nest Order')}/${order.row_id}`)
  expect(stored.lines.map((l) => l.customer)).toEqual(['Globex Ltd'])
})

test('text typed in a nested link cell but never picked is not saved', async ({ admin }) => {
  const order = await seedOrders(admin)
  await renderApp(`/featherbase/admin/${enc('Nest Order')}/${order.row_id}`, admin)
  fireEvent.click(await screen.findByTestId('add-row-lines', {}, { timeout: 8000 }))
  fireEvent.change(await screen.findByLabelText('Lines, Customer, row 1'), { target: { value: 'Initech' } })
  fireEvent.blur(screen.getByLabelText('Lines, Customer, row 1'))

  screen.getByTestId('form-save').click()
  await waitFor(() => expect(screen.getByTestId('error-lines-0-customer')).toBeVisible())
  expect(screen.getByLabelText('Lines, Customer, row 1')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByLabelText('Lines, Customer, row 1')).toHaveAccessibleDescription(screen.getByTestId('error-lines-0-customer').textContent!)
  const stored = await admin.get<{ lines: unknown[] }>(`/api/table/${enc('Nest Order')}/${order.row_id}`)
  expect(stored.lines).toEqual([])
})

test("a person's role is picked from the roles that exist", async ({ admin }) => {
  const person = await admin.post<Saved>('/api/save_row', { table: 'Person', row: { email: 'nested-role@example.test', enabled: true } })
  await renderApp(`/featherbase/admin/Person/${enc(person.row_id)}`, admin)
  fireEvent.click(await screen.findByTestId('add-row-roles', {}, { timeout: 8000 }))
  const cell = await screen.findByRole('combobox', { name: /Role, row 1$/ })
  fireEvent.change(cell, { target: { value: 'Sys' } })
  const options = await screen.findByTestId('link-options-role')
  await waitFor(() => expect(within(options).getAllByTestId('link-option').map((o) => o.textContent)).toContain('System Manager'))
  for (const option of within(options).getAllByTestId('link-option')) expect(option.textContent).toMatch(/sys/i)
})
