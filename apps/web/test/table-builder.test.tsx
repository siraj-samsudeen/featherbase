// tables-and-fields: "Build a table by describing its columns". The paste box
// and the grid are React-side; creating the table goes through the real
// in-process server, so what lands is checked against its metadata.

import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { tableSlug } from 'shared'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const gridRows = () => [...document.querySelectorAll<HTMLTableRowElement>('[data-testid=dt-fields] [data-columnrow]')]
const cell = (row: HTMLElement, field: string) =>
  row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-rowfield=${field}]`)!

describe('Build a table by describing its columns', () => {
  test('a pasted header line becomes one column per name, each typed from the sample values below it', async ({
    admin,
  }) => {
    const user = userEvent.setup()
    await renderApp('/featherbase/admin/new-table', admin)
    await screen.findByTestId('table-builder')

    await user.click(screen.getByTestId('dt-paste-open'))
    const box = screen.getByTestId('dt-paste-text')
    // fireEvent-free typing of a multi-line value: paste is what a person does.
    await user.click(box)
    await user.paste('Employee Name, Date of Birth, Salary\nRavi Kumar, 1990-03-12, 45000\nMeena S, 1988-11-04, 52000')
    await user.click(screen.getByTestId('dt-paste-build'))

    await waitFor(() => expect(gridRows().map((r) => cell(r, 'column_name').value)).toEqual([
      'employee_name',
      'date_of_birth',
      'salary',
    ]))
    expect(gridRows().map((r) => cell(r, 'column_type').value)).toEqual(['Data', 'Date', 'Int'])
  })

  test('creating the table lands the builder on its own list, ready to use', async ({ admin }) => {
    const user = userEvent.setup()
    await renderApp('/featherbase/admin/new-table', admin)
    await screen.findByTestId('table-builder')

    await user.type(screen.getByTestId('dt-name'), 'Tb Shelf Label')
    await user.click(screen.getByTestId('dt-paste-open'))
    await user.click(screen.getByTestId('dt-paste-text'))
    await user.paste('Aisle, Shelf')
    await user.click(screen.getByTestId('dt-paste-build'))
    await user.click(cell(gridRows()[1], 'in_list_view'))
    expect(cell(gridRows()[1], 'in_list_view')).not.toBeChecked()
    await user.click(screen.getByTestId('dt-create'))

    await screen.findByTestId('list-view', undefined, { timeout: 10_000 })
    const meta = (await admin.get(`/api/table/${encodeURIComponent('Tb Shelf Label')}:meta`)) as {
      columns: { column_name: string; in_list_view: boolean }[]
    }
    expect(meta.columns.map((c) => c.column_name)).toEqual(['aisle', 'shelf'])
    expect(meta.columns.map((c) => c.in_list_view)).toEqual([true, false])
  })
})

describe("A new table's list starts with its first seven columns", () => {
  const inList = () => gridRows().map((r) => (cell(r, 'in_list_view') as HTMLInputElement).checked)
  const FIRST_SEVEN = [true, true, true, true, true, true, true, false, false, false]

  test('typing ten columns ticks the first seven for the list', async ({ admin }) => {
    const user = userEvent.setup()
    await renderApp('/featherbase/admin/new-table', admin)
    await screen.findByTestId('table-builder')

    for (let n = 1; n < 10; n++) await user.click(screen.getByTestId('dt-add-field'))

    expect(inList()).toEqual(FIRST_SEVEN)
  })

  test('pasting ten columns ticks the first seven for the list', async ({ admin }) => {
    const user = userEvent.setup()
    await renderApp('/featherbase/admin/new-table', admin)
    await screen.findByTestId('table-builder')

    await user.click(screen.getByTestId('dt-paste-open'))
    await user.click(screen.getByTestId('dt-paste-text'))
    await user.paste('Section, MCH, Floor, Zone, Rack, Owner, Category, Remarks, Updated On, Notes')
    await user.click(screen.getByTestId('dt-paste-build'))

    await waitFor(() => expect(gridRows()).toHaveLength(10))
    expect(inList()).toEqual(FIRST_SEVEN)
  })
})

describe('Choose how each new row gets its id', () => {
  test('#855: a new table is numbered 1, 2, 3 unless the user picks otherwise', async ({ admin }) => {
    await renderApp('/featherbase/admin/new-table', admin)
    await screen.findByTestId('table-builder')

    expect(screen.getByTestId('dt-naming')).toHaveValue('integer')
    expect(screen.getByTestId('dt-naming-preview')).toHaveTextContent('Rows will be numbered 1, 2, 3')
  })

  test('numbering 1, 2, 3 can be chosen again after picking another way', async ({ admin }) => {
    const user = userEvent.setup()
    await renderApp('/featherbase/admin/new-table', admin)
    await screen.findByTestId('table-builder')
    await user.selectOptions(screen.getByTestId('dt-naming'), 'prompt')
    expect(screen.getByTestId('dt-naming')).toHaveValue('prompt')
    await user.selectOptions(screen.getByTestId('dt-naming'), 'integer')
    expect(screen.getByTestId('dt-naming')).toHaveValue('integer')
    expect(screen.getByTestId('dt-naming-preview')).toHaveTextContent('Rows will be numbered 1, 2, 3')
  })

  test('a series prefix shows the first ids before anything is saved', async ({ admin }) => {
    const user = userEvent.setup()
    await renderApp('/featherbase/admin/new-table', admin)
    await screen.findByTestId('table-builder')

    await user.type(screen.getByTestId('dt-name'), 'Staff')
    await user.selectOptions(screen.getByTestId('dt-naming'), 'series')
    expect(screen.getByTestId('dt-naming-prefix')).toHaveValue('STAFF-')
    await user.clear(screen.getByTestId('dt-naming-prefix'))
    await user.type(screen.getByTestId('dt-naming-prefix'), 'EMP-')
    await user.selectOptions(screen.getByTestId('dt-naming-digits'), '3')
    // Shown while the builder is still open — nothing has been created yet.
    expect(screen.getByTestId('dt-naming-preview')).toHaveTextContent('EMP-001, EMP-002, EMP-003')
    expect(screen.getByTestId('dt-create')).toBeInTheDocument()
  })

  // Moved from the deleted e2e/naming-series.spec.ts (NAM-001): the pattern
  // the builder composes from the prefix and digit count is what is stored.
  test('NAM-001: a one-digit series numbers ND-1, ND-2, ND-3, and the new table stores that pattern', async ({ admin }) => {
    const user = userEvent.setup()
    await renderApp('/featherbase/admin/new-table', admin)
    await screen.findByTestId('table-builder')

    await user.type(screen.getByTestId('dt-name'), 'Naming Demo')
    await user.selectOptions(screen.getByTestId('dt-naming'), 'series')
    expect(screen.getByTestId('dt-naming-prefix')).toHaveValue('NAMING-DEMO-')
    expect(screen.getByTestId('dt-naming-preview')).toHaveTextContent('NAMING-DEMO-001')
    await user.clear(screen.getByTestId('dt-naming-prefix'))
    await user.type(screen.getByTestId('dt-naming-prefix'), 'ND-')
    await user.selectOptions(screen.getByTestId('dt-naming-digits'), '1')
    expect(screen.getByTestId('dt-naming-preview')).toHaveTextContent('ND-1, ND-2, ND-3')
    await user.type(cell(gridRows()[0], 'column_name'), 'title')
    await user.click(screen.getByTestId('dt-create'))

    await screen.findByTestId('list-view', undefined, { timeout: 10_000 })
    expect(await admin.get(`/api/table/${encodeURIComponent('Naming Demo')}:meta`)).toMatchObject({ id_pattern: 'ND-.#' })
  })

  test('#858: a prefix plus a column shows a sample id, and the new table names its rows that way', async ({ admin }) => {
    const user = userEvent.setup()
    await renderApp('/featherbase/admin/new-table', admin)
    await screen.findByTestId('table-builder')

    await user.type(screen.getByTestId('dt-name'), 'Tb Plant')
    await user.click(screen.getByTestId('dt-paste-open'))
    await user.click(screen.getByTestId('dt-paste-text'))
    await user.paste('Plant Code, City')
    await user.click(screen.getByTestId('dt-paste-build'))
    await user.selectOptions(screen.getByTestId('dt-naming'), 'field:plant_code')
    await user.type(screen.getByTestId('dt-naming-prefix'), 'PLANT-')
    expect(screen.getByTestId('dt-naming-preview')).toHaveTextContent('Ids look like PLANT-‹Plant Code›')
    await user.click(screen.getByTestId('dt-create'))

    await screen.findByTestId('list-view', undefined, { timeout: 10_000 })
    expect(await admin.get(`/api/table/${encodeURIComponent('Tb Plant')}:meta`)).toMatchObject({ id_pattern: 'PLANT-{plant_code}' })
    expect(await admin.post('/api/save_row', { table: 'Tb Plant', row: { plant_code: '8151' } })).toMatchObject({ row_id: 'PLANT-8151' })
  })
})

// Moved down from e2e/table-builder.spec.ts (#1080).
describe('Build a table in the grid and use it at once', () => {
  const here = (r: { router: unknown }) =>
    (r.router as { state: { location: { pathname: string } } }).state.location.pathname

  test('UI-011: create a Table with 5 fields from the Admin; list+form work immediately', async ({ admin }) => {
    const user = userEvent.setup()
    const T = 'Builder Widget'
    const app = await renderApp('/featherbase/admin', admin)
    await user.click(await screen.findByTestId('new-table-link', {}, { timeout: 8000 }))
    await screen.findByTestId('table-builder', {}, { timeout: 8000 })
    await user.type(screen.getByTestId('dt-name'), T)

    // NAM-002: the row id is column one, locked above the editable rows.
    const first = screen.getByTestId('dt-fields').querySelector('tbody tr')!
    expect(first).toHaveAttribute('data-testid', 'dt-row-id')
    expect(first).not.toHaveAttribute('data-columnrow')

    const defs = [
      ['title', 'Title', 'Data', '', true, true],
      ['count', 'Count', 'Int', '', false, true],
      ['active', 'Active', 'Check', '', false, false],
      ['stage', 'Stage', 'Choice', 'New, Done', false, true],
      ['notes', 'Notes', 'Text', '', false, false],
    ] as const
    for (const [i, [name, label, type, target, reqd, list]] of defs.entries()) {
      if (i > 0) await user.click(screen.getByTestId('dt-add-field'))
      const row = gridRows()[i]
      fireEvent.change(cell(row, 'column_name'), { target: { value: name } })
      fireEvent.change(cell(row, 'label'), { target: { value: label } })
      await user.selectOptions(cell(row, 'column_type') as HTMLSelectElement, type)
      if (target) fireEvent.change(cell(gridRows()[i], 'target'), { target: { value: target } })
      const box = (f: string) => cell(gridRows()[i], f) as HTMLInputElement
      if (box('reqd').checked !== reqd) await user.click(box('reqd'))
      if (box('in_list_view').checked !== list) await user.click(box('in_list_view'))
    }
    await user.click(screen.getByTestId('dt-create'))

    // Lands on the new Table's empty list.
    await screen.findByTestId('list-view', {}, { timeout: 10_000 })
    expect(here(app)).toBe(`/featherbase/admin/table/${tableSlug(T)}`)
    expect(await screen.findByTestId('col-title')).toHaveTextContent('Title')

    // #80: the Table appears on its module's home page without a reload.
    await user.click(await screen.findByTestId('home-page-link-custom', {}, { timeout: 8000 }))
    await waitFor(() => expect(screen.getByTestId('home-page-title')).toHaveTextContent(/^Custom$/), { timeout: 8000 })
    await user.click(await screen.findByTestId(`home-link-${T}`))
    await screen.findByTestId('list-view', {}, { timeout: 8000 })
    expect(here(app)).toBe(`/featherbase/admin/table/${tableSlug(T)}`)

    // The form works at once.
    await user.click(screen.getByTestId('list-new'))
    await screen.findByTestId('form-view', {}, { timeout: 8000 })
    const title = await waitFor(() => document.querySelector<HTMLInputElement>('[data-field=title]')!)
    fireEvent.change(title, { target: { value: 'first doc' } })
    await user.selectOptions(document.querySelector<HTMLSelectElement>('select[data-field=stage]')!, 'Done')
    await user.click(screen.getByTestId('form-save'))
    await waitFor(() => expect(screen.getByTestId('form-status')).toHaveTextContent('Saved'), { timeout: 8000 })

    cleanup()
    await renderApp(`/featherbase/admin/table/${tableSlug(T)}`, admin)
    await waitFor(() => expect(screen.getByTestId('list-rows')).toHaveTextContent('first doc'), { timeout: 8000 })

    // The metadata is real; #74: a real module, and never a system table.
    const meta = await admin.get<{ module: string; system: boolean; columns: { column_name: string }[] }>(
      `/api/table/${encodeURIComponent(T)}:meta`,
    )
    expect(meta.columns.map((c) => c.column_name)).toEqual(expect.arrayContaining(['title', 'count', 'active', 'stage', 'notes']))
    expect(meta.module).toBe('Custom')
    expect(meta.system).toBe(false)
  })

  // #128: the payload drops blank-named rows, so the server's `columns.0` is
  // the SECOND row on screen. A blank row above a bad column is the witness.
  test('#128: a blank row above a bad column does not shift the blame', async ({ admin }) => {
    const user = userEvent.setup()
    await renderApp('/featherbase/admin/new-table', admin)
    await screen.findByTestId('table-builder', {}, { timeout: 8000 })
    await user.type(screen.getByTestId('dt-name'), 'Offset Probe')
    await user.click(screen.getByTestId('dt-add-field'))
    fireEvent.change(cell(gridRows()[1], 'column_name'), { target: { value: 'Bad Name' } })
    fireEvent.change(cell(gridRows()[1], 'label'), { target: { value: 'Price' } })
    await user.click(screen.getByTestId('dt-create'))

    // The banner names the column, announces itself, and leaks no index path.
    const banner = await screen.findByTestId('dt-error', {}, { timeout: 8000 })
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveTextContent('Price')
    expect(banner).toHaveTextContent('snake_case')
    expect(banner).not.toHaveTextContent('columns.0')
    expect(banner).not.toHaveTextContent('columns.1')

    // The mark lands on row 1, never the blank row 0; the input is described by it and holds focus.
    await waitFor(() => expect(screen.getByTestId('dt-col-error-1')).toBeInTheDocument())
    expect(screen.queryByTestId('dt-col-error-0')).not.toBeInTheDocument()
    const bad = cell(gridRows()[1], 'column_name')
    expect(bad).toHaveAttribute('aria-invalid', 'true')
    expect(bad).toHaveAttribute('aria-describedby', 'dt-col-error-1')
    await waitFor(() => expect(bad).toHaveFocus())
    expect(cell(gridRows()[0], 'column_name')).not.toHaveAttribute('aria-invalid', 'true')

    // The accusation dies with the correction, not at the next submit.
    fireEvent.change(bad, { target: { value: 'price' } })
    await waitFor(() => expect(screen.queryByTestId('dt-col-error-1')).not.toBeInTheDocument())
    expect(screen.queryByTestId('dt-error')).not.toBeInTheDocument()
  })
})
