// UI-011 / IMP-006: the Table builder's grid — module, the fix offered for a
// column name that is not a database name, a Reference target typed in,
// Required, removing a column, coming back from the cards view — and how a
// create that fails, wholly or for some imported rows, is told. The merged
// web coverage report (ADR 0012) showed these paths taken by no test.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Meta = { module?: string; columns: { column_name: string; column_type: string; reqd?: boolean; reference_table?: string }[] }

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-columnrow]')]
const cell = (row: HTMLElement, f: string) => row.querySelector(`[data-rowfield="${f}"]`) as HTMLInputElement

test('a table built in the grid stores its module, fixed names, link and Required', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Bg Region', columns: [{ column_name: 'label', column_type: 'Data' }] })
  await renderApp('/featherbase/admin/new-table', admin)
  await screen.findByTestId('table-builder')
  await user.type(screen.getByTestId('dt-name'), 'Bg Depot')
  await user.clear(screen.getByTestId('dt-module'))
  await user.type(screen.getByTestId('dt-module'), 'Stores')

  // Visit the cards and come back: the grid is still the grid.
  await user.click(screen.getByTestId('dt-view-cards'))
  await user.click(screen.getByTestId('dt-view-grid'))
  expect(screen.getByTestId('dt-view-grid')).toHaveAttribute('aria-pressed', 'true')

  // Row 1: a raw name that is not a database name; take the offered fix.
  const [first] = rows()
  await user.type(cell(first, 'column_name'), 'Depot Code')
  fireEvent.blur(cell(first, 'column_name'))
  const error = await screen.findByTestId('dt-col-error-0')
  expect(error).toHaveTextContent('Needs to be a database name')
  await user.click(within(error).getByRole('button', { name: 'Use “depot_code”' }))
  expect(cell(first, 'column_name')).toHaveValue('depot_code')
  await user.click(cell(first, 'reqd'))

  // Row 2: a link, its table typed in. Row 3: added, then removed.
  await user.click(screen.getByTestId('dt-add-field'))
  const second = rows()[1]
  await user.type(cell(second, 'label'), 'Region')
  await user.selectOptions(cell(second, 'column_type') as unknown as HTMLSelectElement, 'Reference')
  await user.type(cell(second, 'target'), 'Bg Region')
  fireEvent.blur(cell(second, 'target'))
  await user.click(screen.getByTestId('dt-add-field'))
  expect(rows()).toHaveLength(3)
  await user.click(within(rows()[2]).getByRole('button', { name: 'Remove column' }))
  expect(rows()).toHaveLength(2)

  await user.click(screen.getByTestId('dt-create'))
  await screen.findByTestId('list-view', undefined, { timeout: 10_000 })
  const meta = (await admin.get(`/api/table/${encodeURIComponent('Bg Depot')}:meta`)) as Meta
  expect(meta.module).toBe('Stores')
  expect(meta.columns).toEqual([
    expect.objectContaining({ column_name: 'depot_code', column_type: 'Data', reqd: true }),
    expect.objectContaining({ column_name: 'region', column_type: 'Reference', reference_table: 'Bg Region' }),
  ])
})

test('a name already taken is refused with the server’s reason, and nothing is created twice', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Bg Taken', columns: [{ column_name: 'label', column_type: 'Data' }] })
  await renderApp('/featherbase/admin/new-table', admin)
  await screen.findByTestId('table-builder')
  await user.type(screen.getByTestId('dt-name'), 'Bg Taken')
  await user.type(cell(rows()[0], 'label'), 'Other')
  await user.click(screen.getByTestId('dt-create'))
  const banner = await screen.findByTestId('dt-error')
  expect(banner.textContent).toMatch(/Bg Taken/)
  expect(screen.getByTestId('table-builder')).toBeInTheDocument()
  const meta = (await admin.get(`/api/table/${encodeURIComponent('Bg Taken')}:meta`)) as Meta
  expect(meta.columns.map((c) => c.column_name)).toEqual(['label'])
})

test('a file whose rows partly fail creates the table, imports the rest, and names the rows that failed', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/new-table', admin)
  await screen.findByTestId('table-builder')
  const csv = 'sku,qty\nA-1,1\n,2\nB-2,3\n'
  const bytes = new TextEncoder().encode(csv).buffer
  const file = new File([bytes], 'stock.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(screen.getByTestId('dt-file-input'), { target: { files: [file] } })
  expect(await screen.findByTestId('dt-file-name', undefined, { timeout: 8000 })).toHaveTextContent('stock.csv')
  await waitFor(() => expect(rows()).toHaveLength(2))
  await user.clear(screen.getByTestId('dt-name'))
  await user.type(screen.getByTestId('dt-name'), 'Bg Stock')
  // `sku` is required, so the row without one cannot be imported.
  await user.click(cell(rows()[0], 'reqd'))
  await user.click(screen.getByTestId('dt-create'))

  const banner = await screen.findByTestId('dt-error', undefined, { timeout: 10_000 })
  expect(banner).toHaveTextContent('Table created; 2 of 3 rows imported. Failed rows: #3')
  const stored = (await admin.get(`/api/table/${encodeURIComponent('Bg Stock')}`)) as { total: number }
  expect(stored.total).toBe(2)
})

test('the paste box: Tab or the sample button fills in an example, Clear empties it, ✕ puts it away', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/new-table', admin)
  await screen.findByTestId('table-builder')
  await user.click(screen.getByTestId('dt-paste-open'))
  const box = screen.getByTestId('dt-paste-text') as HTMLTextAreaElement
  box.focus()
  await user.keyboard('{Tab}')
  const sample = box.value
  expect(sample).toMatch(/^Employee Name, Date of Birth, Salary, Department\n/)
  expect(screen.getByTestId('dt-paste-build')).toBeEnabled()

  await user.click(screen.getByTestId('dt-paste-clear'))
  expect(box).toHaveValue('')
  expect(screen.getByTestId('dt-paste-build')).toBeDisabled()
  await user.click(screen.getByTestId('dt-paste-sample'))
  expect(box).toHaveValue(sample)

  await user.click(screen.getByRole('button', { name: 'Close paste box' }))
  expect(screen.queryByTestId('dt-paste')).not.toBeInTheDocument()
  // Put away, it kept nothing: reopened, it is empty again.
  await user.click(screen.getByTestId('dt-paste-open'))
  expect(screen.getByTestId('dt-paste-text')).toHaveValue('')
})
