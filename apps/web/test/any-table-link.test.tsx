// #881: a link to a row of any Table, on a form. The Table is chosen first,
// from the Tables the column allows; then a row of that Table, found and shown
// by its title. A row the reader can't read shows only its Table. Made-up rows.
import { screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { rowHref, tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { grantRole } from 'server/test/fixtures'
import { columnsToAdd, ANY_TABLE_LINK } from '../src/pages/ColumnEditor'

type Admin = Parameters<typeof renderApp>[1]
const PLANT = 'Atw Plant'
const UNIT = 'Atw Unit'
const OTHER = 'Atw Other'
const DECISION = 'Atw Decision'
const box = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`) as HTMLInputElement

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: PLANT, id_pattern: 'prompt', title_column: 'city', columns: [{ column_name: 'city', column_type: 'Data' }] })
  await admin.post('/api/table_def', { name: UNIT, id_pattern: 'prompt', title_column: 'label', columns: [{ column_name: 'label', column_type: 'Data' }] })
  await admin.post('/api/table_def', { name: OTHER, id_pattern: 'prompt', columns: [{ column_name: 'note', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: PLANT, row: { row_id: '8151', city: 'Palakkad' } })
  await admin.post('/api/save_row', { table: UNIT, row: { row_id: 'PKN-GOLD', label: 'Gold jewellery' } })
  await admin.post('/api/table_def', { name: DECISION, columns: [
    { column_name: 'title', column_type: 'Data', in_list_view: true },
    ...columnsToAdd({ label: 'Shapes', column_name: 'shapes', column_type: ANY_TABLE_LINK, target: `${PLANT}\n${UNIT}`, nameTouched: false })
      .map((c) => ({ ...c, in_list_view: true })),
  ] })
}

// A freshly chosen Table's picker searches by its title once it has read the
// Table's columns, so the typing is repeated until the row is offered.
async function pick(field: string, typed: string, option: string) {
  await waitFor(async () => {
    fireEvent.change(box(field), { target: { value: `${typed} ` } })
    fireEvent.change(box(field), { target: { value: typed } })
    const options = await screen.findByTestId(`link-options-${field}`)
    await waitFor(() => expect(options).toHaveTextContent(option), { timeout: 600 })
  }, { timeout: 5000 })
  const options = screen.getByTestId(`link-options-${field}`)
  fireEvent.mouseDown(within(options).getAllByTestId('link-option').find((o) => o.textContent === option)!)
}

test('the column editor makes a Table column and a row column bound to it', () => {
  expect(columnsToAdd({ label: 'Shapes', column_name: 'shapes', column_type: ANY_TABLE_LINK, target: 'Plant, Business Unit\n', nameTouched: false })).toEqual([
    { column_name: 'shapes_table', label: 'Shapes Table', column_type: 'Reference', reference_table: 'Table' },
    { column_name: 'shapes', label: 'Shapes', column_type: 'Reference', table_column: 'shapes_table', choices: 'Plant\nBusiness Unit' },
  ])
})

test('the row is chosen after its Table, from the Tables the column allows, and reads by its title', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref(DECISION)}/new`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  expect(box('shapes')).toBeDisabled()
  expect(box('shapes')).toHaveAttribute('placeholder', 'Choose its Table first')

  fireEvent.focus(box('shapes_table'))
  fireEvent.change(box('shapes_table'), { target: { value: 'Atw' } })
  const tables = await screen.findByTestId('link-options-shapes_table')
  await waitFor(() => expect(within(tables).getAllByTestId('link-option').map((o) => o.textContent)).toEqual([UNIT, PLANT].sort()))
  expect(within(tables).queryByTestId('link-create-new')).not.toBeInTheDocument()
  fireEvent.mouseDown(within(tables).getAllByTestId('link-option').find((o) => o.textContent === PLANT)!)

  await waitFor(() => expect(box('shapes')).toBeEnabled())
  await pick('shapes', 'Pala', 'Palakkad')
  await waitFor(() => expect(box('shapes')).toHaveValue('Palakkad'))
  expect(screen.getByTestId('link-open-shapes')).toBeInTheDocument()

  // Another Table clears the row: PKN-GOLD is not a Plant, nor 8151 a Unit.
  await pick('shapes_table', 'Unit', UNIT)
  await waitFor(() => expect(box('shapes')).toHaveValue(''))
  await pick('shapes', 'Gold', 'Gold jewellery')
  await waitFor(() => expect(box('shapes')).toHaveValue('Gold jewellery'))
})

test("a row the reader can't read shows only its Table, and is not a link", async ({ admin, createUser }) => {
  await seed(admin)
  const decision = await admin.post<{ row_id: string }>('/api/save_row', { table: DECISION, row: { title: 'Close it', shapes_table: PLANT, shapes: '8151' } })
  await grantRole(admin, { role: 'Atw Clerk', table: [DECISION], can_read: true, can_write: true })
  const clerk = await createUser({ roles: ['Atw Clerk'] })
  await renderApp(`${tableHref(DECISION)}/row/${decision.row_id}`, clerk)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(box('shapes')).toHaveValue(`${PLANT} (no access)`))
  expect(screen.queryByTestId('link-open-shapes')).not.toBeInTheDocument()
  expect(document.body.textContent).not.toContain('8151')
})

test("a list reads a link to a row of any Table as that row's title", async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/save_row', { table: DECISION, row: { title: 'Close it', shapes_table: PLANT, shapes: '8151' } })
  await renderApp(tableHref(DECISION), admin)
  await screen.findByTestId('list-view', {}, { timeout: 10_000 })
  const cell = await screen.findByTestId('cell-shapes')
  await waitFor(() => expect(cell).toHaveTextContent('Palakkad'))
  expect(within(cell).getByRole('link')).toHaveAttribute('href', expect.stringContaining('8151'))
})

// #881, second slice: a Sub-table row holds the pair too; its row cell waits
// for its Table cell, which offers only the allowed Tables.
async function pickCell(label: string, field: string, typed: string, option: string) {
  await waitFor(async () => {
    const cell = screen.getByLabelText(label)
    fireEvent.change(cell, { target: { value: `${typed} ` } })
    fireEvent.change(cell, { target: { value: typed } })
    const options = await screen.findByTestId(`link-options-${field}`)
    await waitFor(() => expect(options).toHaveTextContent(option), { timeout: 600 })
  }, { timeout: 5000 })
  fireEvent.mouseDown(within(screen.getByTestId(`link-options-${field}`)).getAllByTestId('link-option').find((o) => o.textContent === option)!)
}

test('a Sub-table row links to a row of any Table, its Table first', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', { name: 'Atw Step', kind: 'sub_table', columns: [
    ...columnsToAdd({ label: 'Shapes', column_name: 'shapes', column_type: ANY_TABLE_LINK, target: `${PLANT}\n${UNIT}`, nameTouched: false }),
  ] })
  await admin.post('/api/table_def', { name: 'Atw Plan', columns: [
    { column_name: 'label', column_type: 'Data' },
    { column_name: 'steps', column_type: 'Sub-table', label: 'Steps', row_table: 'Atw Step' },
  ] })
  const plan = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Atw Plan', row: { label: 'p1' } })
  await renderApp(rowHref('Atw Plan', plan.row_id), admin)
  fireEvent.click(await screen.findByTestId('add-row-steps', {}, { timeout: 8000 }))
  expect(await screen.findByLabelText('Steps, Shapes, row 1')).toBeDisabled()

  await pickCell('Steps, Shapes Table, row 1', 'shapes_table', 'Atw', PLANT)
  await waitFor(() => expect(screen.getByLabelText('Steps, Shapes, row 1')).toBeEnabled())
  await pickCell('Steps, Shapes, row 1', 'shapes', 'Pala', 'Palakkad')
  await waitFor(() => expect(screen.getByLabelText('Steps, Shapes, row 1')).toHaveValue('Palakkad'))

  screen.getByTestId('form-save').click()
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'), { timeout: 8000 })
  const stored = await admin.get<{ steps: { shapes_table: string; shapes: string }[] }>(`/api/table/${encodeURIComponent('Atw Plan')}/${plan.row_id}`)
  expect(stored.steps.map((s) => [s.shapes_table, s.shapes])).toEqual([[PLANT, '8151']])
})

