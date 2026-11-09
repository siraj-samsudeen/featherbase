// The form's child grid, its sections and its title bar (UI-007, UI-008,
// UI-016). Moved down from e2e/grid-layout.spec.ts (#1080): the real Admin in
// jsdom, saving through the in-process server on the sandboxed database.
import { tableSlug } from 'shared'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Gl Form'
const ROW = 'Gl Item'
const SEC = 'Gl Sections'
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`) as HTMLInputElement
const rowPath = (table: string, id: string) => `/featherbase/admin/table/${encodeURIComponent(tableSlug(table))}/row/${id}`
const here = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname

async function seedForm(admin: Admin) {
  await admin.post('/api/table_def', {
    name: ROW,
    kind: 'sub_table',
    columns: [
      { column_name: 'item', column_type: 'Data', label: 'Item' },
      { column_name: 'qty', column_type: 'Int', label: 'Qty' },
    ],
  })
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', reqd: true },
      { column_name: 'items', column_type: 'Sub-table', label: 'Items', row_table: ROW },
    ],
  })
  const row = await admin.post<{ row_id: string }>('/api/save_row', {
    table: DT,
    row: { title: 'grid fixture', items: [{ item: 'one', qty: 1 }, { item: 'two', qty: 2 }, { item: 'three', qty: 3 }] },
  })
  return row.row_id
}

test('UI-007: child grid add/edit/delete/reorder round-trips through save', async ({ admin }) => {
  const user = userEvent.setup()
  const id = await seedForm(admin)
  await renderApp(rowPath(DT, id), admin)
  const grid = await screen.findByTestId('table-items', {}, { timeout: 8000 })
  const rows = () => [...grid.querySelectorAll<HTMLTableRowElement>('tbody tr')]
  const cell = (n: number, name: string) => rows()[n].querySelector<HTMLInputElement>(`[data-childfield=${name}]`)!
  await waitFor(() => expect(rows()).toHaveLength(3))

  fireEvent.change(cell(1, 'qty'), { target: { value: '22' } })
  await user.click(within(rows()[2]).getByRole('button', { name: 'Remove row' }))
  expect(rows()).toHaveLength(2)
  await user.click(screen.getByTestId('add-row-items'))
  await waitFor(() => expect(rows()).toHaveLength(3))
  fireEvent.change(cell(2, 'item'), { target: { value: 'added' } })
  fireEvent.change(cell(2, 'qty'), { target: { value: '9' } })
  await user.click(within(rows()[2]).getByRole('button', { name: 'Move row up' }))
  expect(cell(1, 'item')).toHaveValue('added')
  await user.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))

  const doc = await admin.get<{ items: { item: string; qty: string; position: number }[] }>(
    `/api/table/${encodeURIComponent(DT)}/${id}`,
  )
  expect(doc.items.map((r) => [r.item, Number(r.qty), r.position])).toEqual([
    ['one', 1, 1],
    ['added', 9, 2],
    ['two', 22, 3],
  ])
})

test('UI-008: Section and Column Breaks produce grouped sections in metadata order', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: SEC,
    columns: [
      { column_name: 'a1', column_type: 'Data', label: 'A One' },
      { column_name: 'a2', column_type: 'Data', label: 'A Two' },
      { column_name: 'sec_b', column_type: 'Section Break', label: 'Details' },
      { column_name: 'b1', column_type: 'Data', label: 'B One' },
      { column_name: 'col_b', column_type: 'Column Break' },
      { column_name: 'b2', column_type: 'Data', label: 'B Two' },
    ],
  })
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(SEC))}/new`, admin)
  const s0 = await screen.findByTestId('form-section-0', {}, { timeout: 8000 })
  const s1 = screen.getByTestId('form-section-1')
  expect(s0.querySelector('[data-field=a1]')).toBeInTheDocument()
  expect(s0.querySelector('[data-field=a2]')).toBeInTheDocument()
  expect(s0.querySelector('[data-field=b1]')).not.toBeInTheDocument()
  expect(s1.querySelector('[data-field=b1]')).toBeInTheDocument()
  expect(s1.querySelector('[data-field=b2]')).toBeInTheDocument()
})

test('UI-016: breadcrumbs navigate and the title bar tracks saved state', async ({ admin }) => {
  const user = userEvent.setup()
  const id = await seedForm(admin)
  const app = await renderApp(rowPath(DT, id), admin)
  await waitFor(() => expect(field('title')).toHaveValue('grid fixture'), { timeout: 8000 })
  const crumbs = screen.getByTestId('breadcrumbs')
  expect(crumbs).toHaveTextContent('Admin')
  expect(crumbs).toHaveTextContent(DT)
  // #476: the row is named by its title, never by its internal id.
  await waitFor(() => expect(crumbs).toHaveTextContent('grid fixture'))
  expect(crumbs).not.toHaveTextContent(id)
  expect(screen.getByTestId('form-status')).toHaveTextContent('Saved')

  fireEvent.change(field('title'), { target: { value: 'status probe' } })
  await waitFor(() => expect(screen.getByTestId('form-status')).toHaveTextContent('Not saved'))
  await user.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  await waitFor(() => expect(screen.getByTestId('form-status')).toHaveTextContent('Saved'))

  await user.click(within(screen.getByTestId('breadcrumbs')).getByText(DT))
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
  expect(here(app)).toBe(`/featherbase/admin/table/${tableSlug(DT)}`)
})
