// Columns the database holds with no label (the Table builder always writes
// one; a column_def row can still carry none), and a Choice with no choices:
// the list names each by its column name, never by an empty heading.
import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Sql } from 'postgres'
import { tableHref } from 'shared'
import { invalidateMeta } from 'server/src/meta'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })

type Admin = Parameters<typeof renderApp>[1]
const T = 'Ulc Stock'

async function seed(admin: Admin, db: unknown) {
  await admin.post('/api/table_def', { name: 'Ulc Depot', id_pattern: 'prompt', columns: [{ column_name: 'depot_name', column_type: 'Data' }] })
  await admin.post('/api/table_def', { name: 'Ulc Line', kind: 'sub_table', columns: [
    { column_name: 'qty', column_type: 'Int' }, { column_name: 'from_depot', column_type: 'Reference', reference_table: 'Ulc Depot' },
  ] })
  await admin.post('/api/table_def', {
    name: T,
    id_pattern: 'prompt',
    title_column: 'item',
    columns: [
      { column_name: 'item', column_type: 'Data', in_list_view: true },
      { column_name: 'grade', column_type: 'Choice', choices: 'A\nB', in_list_view: true },
      { column_name: 'depot', column_type: 'Reference', reference_table: 'Ulc Depot', in_list_view: true },
      { column_name: 'note', column_type: 'Data' },
      { column_name: 'lines', column_type: 'Sub-table', row_table: 'Ulc Line' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Ulc Depot', row: { row_id: 'dp-1', depot_name: 'North' } })
  await admin.post('/api/save_row', { table: T, row: { row_id: 'st-1', item: 'Bolt', grade: 'A', depot: 'dp-1', lines: [{ qty: 3 }] } })
  await (db as Sql)`update column_def set label = null where parent in (${T}, 'Ulc Line')`
  invalidateMeta()
}

test("a list's filter boxes for columns stored with no label are named by their column names", async ({ admin, db }) => {
  await seed(admin, db)
  await renderApp(`${tableHref(T)}?filters=${encodeURIComponent(JSON.stringify([['depot', '=', 'dp-1']]))}`, admin)
  const filters = await screen.findByTestId('standard-filters')
  expect(within(filters).getByTitle('item')).toHaveTextContent('item')
  expect(within(filters).getByTitle('grade')).toHaveTextContent('grade')
  expect(within(filters).getByTitle('depot')).toHaveTextContent('depot')
  expect(screen.getByTestId('std-filter-item')).toHaveAttribute('placeholder', 'Filter item…')
  expect(await screen.findByRole('button', { name: 'Clear the depot filter' })).toBeInTheDocument()
})

test('an expanded row names its unlabelled lines, their columns and their total by column name', async ({ admin, db }) => {
  await admin.post('/api/table_def', { name: 'Ulc Line', kind: 'sub_table', columns: [{ column_name: 'qty', column_type: 'Int' }, { column_name: 'price', column_type: 'Currency' }] })
  await admin.post('/api/table_def', { name: T, id_pattern: 'prompt', title_column: 'item', columns: [
    { column_name: 'item', column_type: 'Data', in_list_view: true }, { column_name: 'lines', column_type: 'Sub-table', row_table: 'Ulc Line' },
  ] })
  await admin.post('/api/save_row', { table: T, row: { row_id: 'st-1', item: 'Bolt', lines: [{ qty: 3, price: 2 }] } })
  await (db as Sql)`update column_def set label = null where parent in (${T}, 'Ulc Line')`
  invalidateMeta()
  const user = userEvent.setup()
  await renderApp(tableHref(T), admin)
  await user.click((await screen.findAllByTestId('row-expand'))[0])
  const lines = await screen.findByTestId('inline-children-lines')
  expect(lines).toHaveTextContent(/^lines \(1\)qtyprice3/)
  expect(lines).toHaveTextContent(/Σ price: ₹\s?2\.00$/)
})

test("a row's form names unlabelled fields, its link's search box and its grid cells by column name", async ({ admin, db }) => {
  await seed(admin, db)
  const user = userEvent.setup()
  await renderApp(`${tableHref(T)}/row/st-1`, admin)
  const form = await screen.findByTestId('form-view')
  await waitFor(() => expect(form.querySelector('[data-form-field="note"]')).toHaveAttribute('data-label', 'note'))
  expect(within(form).getByText('note', { selector: 'span' })).toBeInTheDocument()
  expect(within(await screen.findByTestId('table-lines')).getByRole('columnheader', { name: 'qty' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'lines, qty, row 1' })).toHaveValue('3')
  expect(screen.getByRole('combobox', { name: 'lines, from_depot, row 1' })).toBeInTheDocument()
  await user.click(within(form.querySelector<HTMLElement>('[data-form-field="depot"]')!).getByRole('combobox'))
  expect(await screen.findByRole('searchbox', { name: 'Search depot' })).toBeInTheDocument()
})

test('a list opened on an empty link filter shows an empty filter box', async ({ admin, db }) => {
  await seed(admin, db)
  await renderApp(`${tableHref(T)}?filters=${encodeURIComponent(JSON.stringify([['depot', '=', null]]))}`, admin)
  expect(await screen.findByTestId('std-filter-depot')).toHaveValue('')
})

test('a Choice with no choices filters on All alone', async ({ admin, db }) => {
  await seed(admin, db)
  await (db as Sql)`update column_def set choices = null where parent = ${T} and column_name = 'grade'`
  invalidateMeta()
  await renderApp(tableHref(T), admin)
  const grade = await screen.findByTestId('std-filter-grade')
  expect(within(grade).getAllByRole('option').map((o) => o.textContent)).toEqual(['All'])
})

test("a list's column picker and bulk edit name unlabelled columns by their column names", async ({ admin, db }) => {
  await seed(admin, db)
  const user = userEvent.setup()
  await renderApp(tableHref(T), admin)
  await user.click(await screen.findByTestId('list-columns'))
  const popup = screen.getByTestId('list-columns-popup')
  expect(within(popup).getByTestId('list-col-toggle-item').closest('label')).toHaveTextContent('item')
  expect(within(popup).getByTestId('list-col-toggle-note').closest('label')).toHaveTextContent('note')
  await user.click(screen.getByTestId('list-columns'))
  await waitFor(() => expect(within(screen.getByTestId('list-rows')).getAllByTestId('row-check')).toHaveLength(1))
  await user.click(within(screen.getByTestId('list-rows')).getAllByTestId('row-check')[0])
  expect(within(await screen.findByTestId('bulk-edit-field')).getByRole('option', { name: 'note' })).toBeInTheDocument()
})

