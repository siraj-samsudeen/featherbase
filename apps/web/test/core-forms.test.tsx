// Row Editing (openspec/specs/core-forms): the form that every Table gets.
// Real FormView and Peek in jsdom, talking through the fetch bridge to the
// in-process server inside a rolled-back Postgres transaction.

import { configure, screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { test, expect, renderApp } from './pg-test'

// A cold first render on a busy machine can take longer than the 1s default.
configure({ asyncUtilTimeout: 5000 })

type Admin = Parameters<typeof renderApp>[1]
type Saved = { row_id: string; updated_at: string }

const enc = encodeURIComponent
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`) as HTMLInputElement

async function seedNote(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Core Note',
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', reqd: true },
      { column_name: 'qty', column_type: 'Int', label: 'Qty' },
    ],
  })
  return admin.post<Saved>('/api/save_row', { table: 'Core Note', row: { title: 'first', qty: 4 } })
}

async function openNote(admin: Admin, rowId: string) {
  await renderApp(`/featherbase/admin/${enc('Core Note')}/${rowId}`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('title')).toHaveValue('first'))
}

async function titleOf(admin: Admin, rowId: string) {
  const row = await admin.get<{ title: string }>(`/api/table/${enc('Core Note')}/${rowId}`)
  return row.title
}

test('Open or create a row: opening a row shows its saved values in the form', async ({ admin }) => {
  const row = await seedNote(admin)
  await openNote(admin, row.row_id)
  expect(field('qty')).toHaveValue(4)
  expect(screen.getByTestId('form-status')).toHaveTextContent('Saved')
})

test('Open or create a row: a new row opens blank and ready for input', async ({ admin }) => {
  await seedNote(admin)
  await renderApp(`/featherbase/admin/${enc('Core Note')}/new`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('title')).toBeInTheDocument())
  expect(field('title')).toHaveValue('')
  expect(field('title')).toBeEnabled()
})

test('Edit and save: a changed field shows as not saved, and saving confirms and keeps the new value', async ({ admin }) => {
  const row = await seedNote(admin)
  await openNote(admin, row.row_id)

  fireEvent.change(field('title'), { target: { value: 'second' } })
  await waitFor(() => expect(screen.getByTestId('form-status')).toHaveTextContent('Not saved'))

  screen.getByTestId('form-save').click()
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  await waitFor(() => expect(screen.getByTestId('form-status')).toHaveTextContent('Saved'))
  expect(field('title')).toHaveValue('second')
  expect(await titleOf(admin, row.row_id)).toBe('second')
})

test('An invalid value blocks the save, in place: nothing is saved and the typed value stays beside its error', async ({ admin }) => {
  const row = await seedNote(admin)
  await openNote(admin, row.row_id)

  const tooLong = 'x'.repeat(150)
  fireEvent.change(field('title'), { target: { value: tooLong } })
  screen.getByTestId('form-save').click()

  expect(await screen.findByTestId('error-title')).toBeVisible()
  expect(field('title')).toHaveValue(tooLong)
  expect(await titleOf(admin, row.row_id)).toBe('first')
})

test('A save that arrives too late is refused: the other person\'s change stands and the typed values stay in the form', async ({ admin }) => {
  const row = await seedNote(admin)
  await openNote(admin, row.row_id)

  // Someone else saves the row after this form loaded it.
  await admin.post('/api/save_row', {
    table: 'Core Note',
    row: { row_id: row.row_id, updated_at: row.updated_at, title: 'theirs' },
  })

  fireEvent.change(field('title'), { target: { value: 'mine' } })
  screen.getByTestId('form-save').click()

  await waitFor(() => expect(screen.getByTestId('form-banner')).not.toHaveTextContent(/^Saved$/))
  expect(screen.getByTestId('form-banner').textContent).toMatch(/\S/)
  expect(field('title')).toHaveValue('mine')
  expect(screen.getByTestId('form-status')).toHaveTextContent('Not saved')
  expect(await titleOf(admin, row.row_id)).toBe('theirs')
})

test('Peek at a linked row: a chain of links opens in panels over the page, and closing returns to the page unchanged', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Peek Country',
    columns: [{ column_name: 'label', column_type: 'Data', label: 'Label' }],
  })
  await admin.post('/api/table_def', {
    name: 'Peek City',
    columns: [
      { column_name: 'label', column_type: 'Data', label: 'Label' },
      { column_name: 'country', column_type: 'Reference', label: 'Country', reference_table: 'Peek Country' },
    ],
  })
  await admin.post('/api/table_def', {
    name: 'Peek Shop',
    columns: [
      { column_name: 'label', column_type: 'Data', label: 'Label' },
      { column_name: 'city', column_type: 'Reference', label: 'City', reference_table: 'Peek City' },
    ],
  })
  const country = await admin.post<Saved>('/api/save_row', { table: 'Peek Country', row: { label: 'Indialand' } })
  const city = await admin.post<Saved>('/api/save_row', {
    table: 'Peek City',
    row: { label: 'Chennai', country: country.row_id },
  })
  const shop = await admin.post<Saved>('/api/save_row', {
    table: 'Peek Shop',
    row: { label: 'Main Street', city: city.row_id },
  })

  await renderApp(`/featherbase/admin/${enc('Peek Shop')}/${shop.row_id}`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('label')).toHaveValue('Main Street'))

  // First link: the city, in a panel; the form is still underneath.
  fireEvent.mouseDown(await screen.findByTestId('link-peek-city'))
  const first = await screen.findByTestId('peek-panel-0')
  expect(await within(first).findByText('Chennai')).toBeInTheDocument()

  // Its own link: the country, one level deeper.
  fireEvent.click(await within(first).findByTestId('peek-ref-country'))
  const second = await screen.findByTestId('peek-panel-1')
  expect(await within(second).findByText('Indialand')).toBeInTheDocument()
  expect(within(second).getByTestId('peek-title')).toHaveTextContent(country.row_id)

  // Step back one level, then forward again, then close it all.
  fireEvent.click(within(second).getByTestId('peek-back'))
  await waitFor(() => expect(screen.queryByTestId('peek-panel-1')).not.toBeInTheDocument())
  expect(screen.getByTestId('peek-panel-0')).toBeInTheDocument()
  fireEvent.click(await within(screen.getByTestId('peek-panel-0')).findByTestId('peek-ref-country'))
  await screen.findByTestId('peek-panel-1')
  fireEvent.click(within(screen.getByTestId('peek-panel-1')).getByTestId('peek-close'))

  await waitFor(() => expect(screen.queryByTestId('peek-panel-0')).not.toBeInTheDocument())
  expect(screen.getByTestId('form-view')).toBeInTheDocument()
  expect(field('label')).toHaveValue('Main Street')
})

test('Peek at a linked row: the open-as-full-page control navigates to that row\'s own form', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Peek Parent',
    columns: [{ column_name: 'label', column_type: 'Data', label: 'Label' }],
  })
  await admin.post('/api/table_def', {
    name: 'Peek Child',
    columns: [
      { column_name: 'label', column_type: 'Data', label: 'Label' },
      { column_name: 'mother', column_type: 'Reference', label: 'Parent', reference_table: 'Peek Parent' },
    ],
  })
  const parent = await admin.post<Saved>('/api/save_row', { table: 'Peek Parent', row: { label: 'Mother' } })
  const child = await admin.post<Saved>('/api/save_row', {
    table: 'Peek Child',
    row: { label: 'Kid', mother: parent.row_id },
  })
  await renderApp(`/featherbase/admin/${enc('Peek Child')}/${child.row_id}`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('label')).toHaveValue('Kid'))

  fireEvent.mouseDown(await screen.findByTestId('link-peek-mother'))
  fireEvent.click(await screen.findByTestId('peek-open-full'))

  await waitFor(() => expect(field('label')).toHaveValue('Mother'))
  expect(screen.getByTestId('breadcrumbs')).toHaveTextContent('Peek Parent')
  expect(screen.queryByTestId('peek-panel-0')).not.toBeInTheDocument()
})

test('Pick a linked row by typing: matching rows are offered, picking one fills the field and saves, and a new one can be created from the list', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Pick Customer',
    id_pattern: 'prompt',
    columns: [{ column_name: 'city', column_type: 'Data', label: 'City' }],
  })
  for (const name of ['Acme Ltd', 'Globex Ltd', 'Formco'])
    await admin.post('/api/save_row', { table: 'Pick Customer', row: { row_id: name, city: 'x' } })
  await admin.post('/api/table_def', {
    name: 'Pick Order',
    columns: [
      { column_name: 'label', column_type: 'Data', label: 'Label' },
      { column_name: 'customer', column_type: 'Reference', label: 'Customer', reference_table: 'Pick Customer' },
    ],
  })
  const order = await admin.post<Saved>('/api/save_row', { table: 'Pick Order', row: { label: 'o1' } })
  await renderApp(`/featherbase/admin/${enc('Pick Order')}/${order.row_id}`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('label')).toHaveValue('o1'))

  fireEvent.change(field('customer'), { target: { value: 'Ltd' } })
  const options = await screen.findByTestId('link-options-customer')
  await waitFor(() => expect(within(options).getAllByTestId('link-option')).toHaveLength(2))
  expect(options).toHaveTextContent('Acme Ltd')
  expect(options).toHaveTextContent('Globex Ltd')
  expect(options).not.toHaveTextContent('Formco')
  expect(within(options).getByTestId('link-create-new')).toBeInTheDocument()

  fireEvent.change(field('customer'), { target: { value: 'Glob' } })
  await waitFor(() => expect(within(screen.getByTestId('link-options-customer')).getAllByTestId('link-option')).toHaveLength(1))
  fireEvent.mouseDown(within(screen.getByTestId('link-options-customer')).getByTestId('link-option'))
  expect(field('customer')).toHaveValue('Globex Ltd')

  screen.getByTestId('form-save').click()
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  const stored = await admin.get<{ customer: string }>(`/api/table/${enc('Pick Order')}/${order.row_id}`)
  expect(stored.customer).toBe('Globex Ltd')
})

async function seedAllTypes(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Types Form',
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title' },
      { column_name: 'qty', column_type: 'Int', label: 'Qty' },
      { column_name: 'done', column_type: 'Check', label: 'Done' },
      { column_name: 'stage', column_type: 'Choice', label: 'Stage', choices: 'Open\nClosed' },
      { column_name: 'due', column_type: 'Date', label: 'Due' },
      { column_name: 'notes', column_type: 'Text', label: 'Notes' },
      { column_name: 'locked', column_type: 'Data', label: 'Locked', read_only: true },
      { column_name: 'secret', column_type: 'Data', label: 'Secret', hidden: true },
    ],
  })
  return admin.post<Saved>('/api/save_row', {
    table: 'Types Form',
    row: { title: 't', qty: 4, done: true, stage: 'Open', due: '2026-08-01', notes: 'multi\nline' },
  })
}

test('Each field gets a control that fits its type', async ({ admin }) => {
  const row = await seedAllTypes(admin)
  await renderApp(`/featherbase/admin/${enc('Types Form')}/${row.row_id}`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('title')).toHaveValue('t'))

  expect(field('title')).toHaveAttribute('type', 'text')
  expect(field('qty')).toHaveAttribute('type', 'number')
  expect(field('qty')).toHaveValue(4)
  expect(field('done')).toBeChecked()
  expect(field('done')).toHaveAttribute('type', 'checkbox')
  expect(document.querySelector('select[data-field=stage]')).toHaveValue('Open')
  expect(field('due')).toHaveAttribute('type', 'date')
  expect(field('due')).toHaveValue('2026-08-01')
  expect(document.querySelector('textarea[data-field=notes]')).toHaveValue('multi\nline')
})

test('Read-only and hidden fields: a read-only field cannot be edited, and a hidden field is not shown', async ({ admin }) => {
  const row = await seedAllTypes(admin)
  await renderApp(`/featherbase/admin/${enc('Types Form')}/${row.row_id}`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('title')).toHaveValue('t'))

  expect(field('locked')).toBeDisabled()
  expect(field('title')).toBeEnabled()
  expect(document.querySelector('[data-field=secret]')).toBeNull()
})
