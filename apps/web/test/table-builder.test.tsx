// tables-and-fields: "Build a table by describing its columns". The paste box
// and the grid are React-side; creating the table goes through the real
// in-process server, so what lands is checked against its metadata.

import { screen, waitFor } from '@testing-library/react'
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
    await user.click(screen.getByTestId('dt-create'))

    await screen.findByTestId('list-view', undefined, { timeout: 10_000 })
    const meta = (await admin.get(`/api/table/${encodeURIComponent('Tb Shelf Label')}:meta`)) as {
      columns: { column_name: string }[]
    }
    expect(meta.columns.map((c) => c.column_name)).toEqual(['aisle', 'shelf'])
  })
})

describe('Choose how each new row gets its id', () => {
  test('a series prefix shows the first ids before anything is saved', async ({ admin }) => {
    const user = userEvent.setup()
    await renderApp('/featherbase/admin/new-table', admin)
    await screen.findByTestId('table-builder')

    expect(screen.getByTestId('dt-naming')).toHaveValue('series')
    await user.clear(screen.getByTestId('dt-naming-prefix'))
    await user.type(screen.getByTestId('dt-naming-prefix'), 'EMP-')
    await user.selectOptions(screen.getByTestId('dt-naming-digits'), '3')
    // Shown while the builder is still open — nothing has been created yet.
    expect(screen.getByTestId('dt-naming-preview')).toHaveTextContent('EMP-001, EMP-002, EMP-003')
    expect(screen.getByTestId('dt-create')).toBeInTheDocument()
  })
})
