// #832: a link inside a grid of nested rows (a person's roles, an order's
// lines) is picked from the linked Table's rows, with the same picker a link
// field on the form uses. Text typed but never picked is not saved as a link.
import { act, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { fireEvent } from '@testing-library/dom'
import type { TestClient } from 'feather-testing-postgres'
import { test, expect, renderApp } from './pg-test'
import { rowHref } from 'shared'

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
    name: 'Nest Note', kind: 'sub_table',
    columns: [{ column_name: 'about', column_type: 'Reference', label: 'About', reference_table: 'Nest Customer' }],
  })
  await admin.post('/api/table_def', {
    name: 'Nest Order',
    columns: [
      { column_name: 'notes', column_type: 'Sub-table', label: 'Notes', row_table: 'Nest Note' },
      { column_name: 'label', column_type: 'Data', label: 'Label' },
      { column_name: 'lines', column_type: 'Sub-table', label: 'Lines', row_table: 'Nest Line' },
    ],
  })
  return admin.post<Saved>('/api/save_row', { table: 'Nest Order', row: { label: 'o1' } })
}

test('a link cell in nested rows offers matching rows, and the picked one is saved', async ({ admin }) => {
  const order = await seedOrders(admin)
  await renderApp(rowHref('Nest Order', order.row_id), admin)
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
  await renderApp(rowHref('Nest Order', order.row_id), admin)
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
  await renderApp(rowHref('Person', person.row_id), admin)
  fireEvent.click(await screen.findByTestId('add-row-roles', {}, { timeout: 8000 }))
  const cell = await screen.findByRole('combobox', { name: /Role, row 1$/ })
  fireEvent.change(cell, { target: { value: 'Sys' } })
  const options = await screen.findByTestId('link-options-role')
  await waitFor(() => expect(within(options).getAllByTestId('link-option').map((o) => o.textContent)).toContain('System Manager'))
  for (const option of within(options).getAllByTestId('link-option')) expect(option.textContent).toMatch(/sys/i)
})

// Moved from e2e/nested-link-picker.spec.ts (#832, #1019; #1080).
test("a person's role picked in the grid is saved as that role", async ({ admin }) => {
  const person = await admin.post<Saved>('/api/save_row', { table: 'Person', row: { email: 'nested-role-saved@example.test', enabled: true } })
  await renderApp(rowHref('Person', person.row_id), admin)
  fireEvent.click(await screen.findByTestId('add-row-roles', {}, { timeout: 8000 }))
  const cell = await screen.findByRole('combobox', { name: /Role, row 1$/ })
  fireEvent.change(cell, { target: { value: 'Sys' } })
  const options = await screen.findByTestId('link-options-role')
  const option = await waitFor(() => {
    const hit = within(options).getAllByTestId('link-option').find((o) => o.textContent === 'System Manager')
    if (!hit) throw new Error('no System Manager yet')
    return hit
  })
  fireEvent.mouseDown(option)
  await waitFor(() => expect(screen.getByRole('combobox', { name: /Role, row 1$/ })).toHaveValue('System Manager'))
  fireEvent.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner').textContent).toBe('Saved'))
  const stored = await admin.get<{ roles: { role: string }[] }>(`/api/table/Person/${enc(person.row_id)}`)
  expect(stored.roles.map((r) => r.role)).toEqual(['System Manager'])
})

test('a floating link list that scrolls itself stays open', async ({ admin }) => {
  const person = await admin.post<Saved>('/api/save_row', { table: 'Person', row: { email: 'nested-role-scroll@example.test', enabled: true } })
  await renderApp(rowHref('Person', person.row_id), admin)
  fireEvent.click(await screen.findByTestId('add-row-roles', {}, { timeout: 8000 }))
  fireEvent.change(await screen.findByRole('combobox', { name: /Role, row 1$/ }), { target: { value: 'Sys' } })
  const options = await screen.findByTestId('link-options-role')
  await within(options).findAllByTestId('link-option')
  options.dispatchEvent(new Event('scroll'))
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(screen.getByTestId('link-options-role')).toBeInTheDocument()
})

test('a floating link list closes when the page scrolls away from it', async ({ admin }) => {
  const person = await admin.post<Saved>('/api/save_row', { table: 'Person', row: { email: 'nested-role-page-scroll@example.test', enabled: true } })
  await renderApp(rowHref('Person', person.row_id), admin)
  fireEvent.click(await screen.findByTestId('add-row-roles', {}, { timeout: 8000 }))
  fireEvent.change(await screen.findByRole('combobox', { name: /Role, row 1$/ }), { target: { value: 'Sys' } })
  await within(await screen.findByTestId('link-options-role')).findAllByTestId('link-option')
  fireEvent.scroll(document)
  await waitFor(() => expect(screen.queryByTestId('link-options-role')).not.toBeInTheDocument())
})

test("a cell's error goes once the grid changes, and unpicked text leaves the cell when it is left", async ({ admin }) => {
  const order = await seedOrders(admin)
  await renderApp(rowHref('Nest Order', order.row_id), admin)
  fireEvent.click(await screen.findByTestId('add-row-lines', {}, { timeout: 8000 }))
  screen.getByTestId('form-save').click()
  await waitFor(() => expect(screen.getByTestId('error-lines-0-customer')).toBeVisible())

  const cell = screen.getByLabelText('Lines, Customer, row 1')
  fireEvent.change(cell, { target: { value: 'Acme' } })
  const options = await screen.findByTestId('link-options-customer')
  await waitFor(() => expect(within(options).getAllByTestId('link-option')).toHaveLength(1))
  fireEvent.mouseDown(within(options).getByTestId('link-option'))
  expect(screen.queryByTestId('error-lines-0-customer')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Lines, Customer, row 1')).not.toHaveAttribute('aria-invalid')

  fireEvent.change(screen.getByLabelText('Lines, Customer, row 1'), { target: { value: 'Initech' } })
  fireEvent.focusOut(screen.getByLabelText('Lines, Customer, row 1'))
  await waitFor(() => expect(screen.getByLabelText('Lines, Customer, row 1')).toHaveValue('Acme Ltd'))
})

test('emptying an optional nested link cell removes the link when saved', async ({ admin }) => {
  await seedOrders(admin)
  const order = await admin.post<Saved>('/api/save_row', { table: 'Nest Order', row: { label: 'o2', notes: [{ about: 'Formco' }] } })
  await renderApp(rowHref('Nest Order', order.row_id), admin)
  const cell = await screen.findByLabelText('Notes, About, row 1', {}, { timeout: 8000 })
  await waitFor(() => expect(cell).toHaveValue('Formco'))
  fireEvent.change(cell, { target: { value: '' } })
  fireEvent.focusOut(cell)
  screen.getByTestId('form-save').click()
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  const stored = await admin.get<{ notes: { about: string | null }[] }>(`/api/table/${enc('Nest Order')}/${order.row_id}`)
  expect(stored.notes.map((n) => n.about ?? null)).toEqual([null])
})


test('leaving a nested reference field then closing its form releases pending callbacks', async ({ admin }) => {
  const order = await seedOrders(admin)
  const view = await renderApp(rowHref('Nest Order', order.row_id), admin)
  fireEvent.click(await screen.findByTestId('add-row-lines', {}, { timeout: 8000 }))
  const cell = await screen.findByLabelText('Lines, Customer, row 1')
  const browserWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')!
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    fireEvent.focusIn(cell)
    fireEvent.focusOut(cell)
    view.unmount()
    // Match the host's disposal after a view closes: delayed field work may
    // not reach React after the browser environment has gone away.
    Reflect.deleteProperty(globalThis, 'window')
    expect(() => vi.advanceTimersByTime(151)).not.toThrow()
  } finally {
    Object.defineProperty(globalThis, 'window', browserWindow)
    vi.useRealTimers()
  }
})


test('a reference search that finishes after leaving the cell cannot reopen its picker', async ({ admin }) => {
  const order = await seedOrders(admin)
  await renderApp(rowHref('Nest Order', order.row_id), admin)
  fireEvent.click(await screen.findByTestId('add-row-lines', {}, { timeout: 8000 }))
  const cell = await screen.findByLabelText('Lines, Customer, row 1')
  fireEvent.focusIn(cell)
  await screen.findByTestId('link-options-customer')

  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let reached!: () => void
  const responseReady = new Promise<void>(resolve => { reached = resolve })
  let delivered!: () => void
  const responseDelivered = new Promise<void>(resolve => { delivered = resolve })
  const real = globalThis.fetch
  const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await real(input, init)
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (path.includes('/api/table/Nest%20Customer?') && path.includes('Acme')) {
      reached()
      await held
      delivered()
    }
    return response
  })
  try {
    fireEvent.change(cell, { target: { value: 'Acme' } })
    await responseReady
    fireEvent.focusOut(cell)
    await waitFor(() => expect(screen.queryByTestId('link-options-customer')).not.toBeInTheDocument())
    await act(async () => {
      release()
      await responseDelivered
    })
    expect(screen.queryByTestId('link-options-customer')).not.toBeInTheDocument()
    expect(cell).toHaveValue('')
  } finally {
    release()
    transport.mockRestore()
  }
})
