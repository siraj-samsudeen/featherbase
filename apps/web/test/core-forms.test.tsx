// Row Editing (openspec/specs/core-forms): the form that every Table gets.
// Real FormView and Peek in jsdom, talking through the fetch bridge to the
// in-process server inside a rolled-back Postgres transaction.

import { screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { test, expect, renderApp } from './pg-test'

// A cold first render on a busy machine can take longer than the 1s default.

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

// #324: a Table whose rows are named by whoever creates them (id pattern
// 'prompt') — the new-row form must ask for that name and send it.
async function seedPromptNamed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Core Shelf', id_pattern: 'prompt',
    columns: [{ column_name: 'aisle', column_type: 'Data', label: 'Aisle' }],
  })
}

test('A typed-in name is asked for on the new-row form: typing it and saving creates the row under that name', async ({ admin }) => {
  await seedPromptNamed(admin)
  await renderApp(`/featherbase/admin/${enc('Core Shelf')}/new`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  const rowId = await screen.findByRole('textbox', { name: /Row ID/ })
  expect(rowId).toHaveAttribute('aria-required', 'true')

  fireEvent.change(rowId, { target: { value: 'shelf-a1' } })
  fireEvent.change(field('aisle'), { target: { value: 'A' } })
  screen.getByTestId('form-save').click()

  // Saved: the form has moved to the new row, so its name is no longer asked for.
  // (The heading shows the Row ID only until the row's readable title loads, so
  // it is not a stable sign of the save; the server read below proves the name.)
  await waitFor(() => expect(screen.queryByRole('textbox', { name: /Row ID/ })).toBeNull())
  const saved = await admin.get<{ row_id: string; aisle: string }>(`/api/table/${enc('Core Shelf')}/shelf-a1`)
  expect(saved.aisle).toBe('A')
  // Once the row exists its name changes through Rename, not this field.
  await waitFor(() => expect(field('aisle')).toHaveValue('A'))
  expect(screen.queryByRole('textbox', { name: /Row ID/ })).toBeNull()
})

test('A typed-in name is asked for on the new-row form: leaving it blank calls out the name and saves nothing', async ({ admin }) => {
  await seedPromptNamed(admin)
  await renderApp(`/featherbase/admin/${enc('Core Shelf')}/new`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('aisle')).toBeInTheDocument())

  fireEvent.change(field('aisle'), { target: { value: 'B' } })
  screen.getByTestId('form-save').click()

  expect(await screen.findByTestId('error-row_id')).toHaveTextContent('Row ID is required')
  expect(field('aisle')).toHaveValue('B')
  const list = await admin.get<{ total: number }>(`/api/table/${enc('Core Shelf')}`)
  expect(list.total).toBe(0)
})

test('A typed-in name is asked for on the new-row form: a name already in use is refused and the existing row is untouched', async ({ admin }) => {
  await seedPromptNamed(admin)
  await admin.post('/api/save_row', { table: 'Core Shelf', row: { row_id: 'shelf-a1', aisle: 'A' } })
  await renderApp(`/featherbase/admin/${enc('Core Shelf')}/new`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  const rowId = await screen.findByRole('textbox', { name: /Row ID/ })

  fireEvent.change(rowId, { target: { value: 'shelf-a1' } })
  fireEvent.change(field('aisle'), { target: { value: 'Z' } })
  screen.getByTestId('form-save').click()

  expect(await screen.findByTestId('form-banner')).toHaveTextContent('Core Shelf shelf-a1 already exists')
  expect(screen.getByTestId('error-row_id')).toHaveTextContent('Already in use')
  expect(field('aisle')).toHaveValue('Z')
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New')
  const existing = await admin.get<{ aisle: string }>(`/api/table/${enc('Core Shelf')}/shelf-a1`)
  expect(existing.aisle).toBe('A')
})

test('A new row on a Table that names its own rows asks for no name', async ({ admin }) => {
  await seedNote(admin)
  await renderApp(`/featherbase/admin/${enc('Core Note')}/new`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('title')).toBeInTheDocument())
  expect(screen.queryByRole('textbox', { name: /Row ID/ })).toBeNull()
})

test('A typed-in name is asked for on the new-row form: spaces around the typed name are dropped', async ({ admin }) => {
  await seedPromptNamed(admin)
  await renderApp(`/featherbase/admin/${enc('Core Shelf')}/new`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  fireEvent.change(await screen.findByRole('textbox', { name: /Row ID/ }), { target: { value: '  shelf-b2 ' } })
  screen.getByTestId('form-save').click()
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('shelf-b2'))
  expect((await admin.get<{ row_id: string }>(`/api/table/${enc('Core Shelf')}/shelf-b2`)).row_id).toBe('shelf-b2')
})

test('An existing row of a Table whose rows are named by their creator opens with no name field', async ({ admin }) => {
  await seedPromptNamed(admin)
  await admin.post('/api/save_row', { table: 'Core Shelf', row: { row_id: 'shelf-c3', aisle: 'C' } })
  await renderApp(`/featherbase/admin/${enc('Core Shelf')}/shelf-c3`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('aisle')).toHaveValue('C'))
  expect(screen.queryByRole('textbox', { name: /Row ID/ })).toBeNull()
})
