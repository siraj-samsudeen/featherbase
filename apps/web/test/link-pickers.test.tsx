// #793: a link to a Table with no picker of its own is found and shown by the
// target's title column, on a form and in a list's quick filter; the quick
// filter never offers to create a row, reads the picked row's name and clears
// in one click. Made-up rows only.
import { screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { test, expect, renderApp } from './pg-test'
import { tableHref } from 'shared'
import { createUserWithRole, grantRole } from 'server/test/fixtures'

type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent
const CUSTOMER = 'Lp Customer'
const ORDER = 'Lp Order'

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: CUSTOMER, id_pattern: 'prompt', title_column: 'customer_name',
    columns: [{ column_name: 'customer_name', column_type: 'Data', label: 'Customer Name' }],
  })
  for (const [row_id, customer_name] of [['c-1', 'Globex Ltd'], ['c-2', 'Initech']])
    await admin.post('/api/save_row', { table: CUSTOMER, row: { row_id, customer_name } })
  await admin.post('/api/table_def', {
    name: ORDER, id_pattern: 'prompt',
    columns: [
      { column_name: 'item', column_type: 'Data', label: 'Item', in_list_view: true },
      { column_name: 'customer', column_type: 'Reference', label: 'Customer', reference_table: CUSTOMER, in_list_view: true },
    ],
  })
  for (const [row_id, item, customer] of [['o-1', 'Widgets', 'c-1'], ['o-2', 'Sprockets', 'c-1'], ['o-3', 'Gears', 'c-2']])
    await admin.post('/api/save_row', { table: ORDER, row: { row_id, item, customer } })
}

const listed = () => within(screen.getByTestId('list-rows')).queryAllByTestId('row-check').length

test("a form's link searches and shows the target's title column", async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref(ORDER)}/row/o-3`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  const box = () => document.querySelector<HTMLInputElement>('[data-field=customer]') as HTMLInputElement
  await waitFor(() => expect(box()).toHaveValue('Initech'))

  fireEvent.change(box(), { target: { value: 'Ltd' } })
  const options = await screen.findByTestId('link-options-customer')
  await waitFor(() => expect(within(options).getAllByTestId('link-option')).toHaveLength(1))
  expect(options).toHaveTextContent('Globex Ltd')
  expect(within(options).getByTestId('link-create-new')).toBeInTheDocument()
  fireEvent.mouseDown(within(options).getByTestId('link-option'))
  await waitFor(() => expect(box()).toHaveValue('Globex Ltd'))
})

test("a link column's quick filter picks a row by name, offers no new row, and clears in one click", async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref(ORDER)}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 10_000 })
  await waitFor(() => expect(listed()).toBe(3))

  const filter = screen.getByTestId('std-filter-customer')
  fireEvent.focus(filter)
  fireEvent.change(filter, { target: { value: 'Glo' } })
  const options = await screen.findByTestId('link-options-customer')
  await waitFor(() => expect(within(options).getAllByTestId('link-option')).toHaveLength(1))
  expect(within(options).queryByTestId('link-create-new')).not.toBeInTheDocument()
  fireEvent.mouseDown(within(options).getByTestId('link-option'))

  await waitFor(() => expect(listed()).toBe(2))
  await waitFor(() => expect(screen.getByTestId('std-filter-customer')).toHaveValue('Globex Ltd'))

  fireEvent.click(screen.getByTestId('std-filter-clear-customer'))
  await waitFor(() => expect(listed()).toBe(3))
  expect(screen.queryByTestId('std-filter-clear-customer')).not.toBeInTheDocument()
})

test('a quick link filter drops typing that picked nothing and carries no peek or open', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref(ORDER)}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 10_000 })
  await waitFor(() => expect(listed()).toBe(3))
  fireEvent.focus(screen.getByTestId('std-filter-customer'))
  fireEvent.change(screen.getByTestId('std-filter-customer'), { target: { value: 'Glo' } })
  const options = await screen.findByTestId('link-options-customer')
  await waitFor(() => expect(within(options).getAllByTestId('link-option')).toHaveLength(1))
  fireEvent.mouseDown(within(options).getByTestId('link-option'))
  await waitFor(() => expect(screen.getByTestId('std-filter-customer')).toHaveValue('Globex Ltd'))
  await waitFor(() => expect(listed()).toBe(2))
  expect(screen.queryByTestId('link-peek-customer')).not.toBeInTheDocument()
  expect(screen.queryByTestId('link-open-customer')).not.toBeInTheDocument()

  const filter = screen.getByTestId('std-filter-customer')
  fireEvent.change(filter, { target: { value: 'zzz' } })
  fireEvent.focusOut(filter)
  await waitFor(() => expect(screen.getByTestId('std-filter-customer')).toHaveValue('Globex Ltd'))
  expect(listed()).toBe(2)
})

// A link picker never reveals a title the viewer may not read: a restricted
// title column, or a target Table the viewer cannot read at all, leaves the
// link searched and shown by its row id.
async function seedRestricted(admin: Admin, createUser: Parameters<typeof createUserWithRole>[1], customerRead: boolean) {
  await admin.post('/api/table_def', {
    name: CUSTOMER, id_pattern: 'prompt', title_column: 'customer_name',
    columns: [{ column_name: 'customer_name', column_type: 'Data', label: 'Customer Name', tier: 'restricted' }],
  })
  for (const [row_id, customer_name] of [['c-1', 'Globex Ltd'], ['c-2', 'Initech']])
    await admin.post('/api/save_row', { table: CUSTOMER, row: { row_id, customer_name } })
  await admin.post('/api/table_def', {
    name: ORDER, id_pattern: 'prompt',
    columns: [
      { column_name: 'item', column_type: 'Data', label: 'Item', in_list_view: true },
      { column_name: 'customer', column_type: 'Reference', label: 'Customer', reference_table: CUSTOMER, in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: ORDER, row: { row_id: 'o-3', item: 'Gears', customer: 'c-2' } })
  const user = await createUserWithRole(admin, createUser, {
    role: 'Lp Clerk', table: ORDER, tier: 'basic', can_read: true, can_write: true, can_create: true,
  })
  if (customerRead) await grantRole(admin, { role: 'Lp Clerk', table: CUSTOMER, tier: 'basic', can_read: true })
  return user
}

for (const customerRead of [true, false]) {
  const why = customerRead ? 'a restricted title column' : 'a Table the viewer cannot read'
  test(`a link to ${why} is searched and shown by its row id, never its title`, async ({ admin, createUser }) => {
    const user = await seedRestricted(admin, createUser, customerRead)
    await renderApp(`${tableHref(ORDER)}/row/o-3`, user)
    await screen.findByTestId('form-view', {}, { timeout: 8000 })
    const box = () => document.querySelector<HTMLInputElement>('[data-field=customer]') as HTMLInputElement
    await waitFor(() => expect(box()).toHaveValue('c-2'))

    fireEvent.change(box(), { target: { value: 'c-' } })
    if (customerRead) {
      const options = await screen.findByTestId('link-options-customer')
      await waitFor(() => expect(within(options).getAllByTestId('link-option')).toHaveLength(2))
      expect(options).toHaveTextContent('c-1')
    }
    // Give any title lookup time to land before checking none did.
    await new Promise((r) => setTimeout(r, 400))
    expect(document.body).not.toHaveTextContent('Initech')
    expect(document.body).not.toHaveTextContent('Globex')
  })
}
