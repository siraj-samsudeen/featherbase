// The Import wizard's column step at its edges: a drop or a file picker that
// brings no file, a Choice with nothing to offer, a blank file header, a
// column picked and then unpicked, and a Table whose column labels are just
// their names. Real server.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

async function upload(csv: string, name = 'stock.csv') {
  const bytes = new TextEncoder().encode(csv).buffer
  const file = new File([bytes], name, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [file] } })
}

const columnRow = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-columnrow]')].find(
    (r) => (r.querySelector('[data-rowfield="column_name"]') as HTMLInputElement | null)?.value === name,
  )!

const DROP_PROMPT = /Drag & drop a CSV or Excel workbook here/

test('a drop that carries no file leaves the wizard waiting for one', async ({ admin }) => {
  clearSession()
  await renderApp('/featherbase/admin/import', admin)
  const zone = (await screen.findByText(DROP_PROMPT)).closest('div')!
  fireEvent.drop(zone, { dataTransfer: { files: [] } })
  expect(zone).toHaveTextContent(DROP_PROMPT)
  expect(screen.queryByTestId('iw-file-name')).not.toBeInTheDocument()
})

test('closing the file picker without a file leaves the wizard waiting for one', async ({ admin }) => {
  clearSession()
  await renderApp('/featherbase/admin/import', admin)
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [] } })
  expect(screen.getByText(DROP_PROMPT)).toBeInTheDocument()
  expect(screen.queryByTestId('iw-file-name')).not.toBeInTheDocument()
})

test('a column with no values made a Choice offers no options', async ({ admin }) => {
  clearSession()
  await renderApp('/featherbase/admin/import', admin)
  await upload('iwc_title,iwc_grade\nalpha,\nbeta,\n')
  await screen.findByTestId('iw-new-name-0', undefined, { timeout: 8000 })
  fireEvent.change(columnRow('iwc_grade').querySelector('[data-rowfield="column_type"]')!, { target: { value: 'Choice' } })
  const choices = columnRow('iwc_grade').querySelector('[data-rowfield="choices"]')!
  expect(choices).toHaveTextContent(/^$/)
  expect(choices).not.toHaveAttribute('title')
  clearSession()
})

test("a new Table's column whose display name was cleared is made with its own label", async ({ admin }) => {
  clearSession()
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/import', admin)
  await upload('iwc_title,iwc_qty\nalpha,1\n')
  const name = await screen.findByTestId('iw-new-name-0', undefined, { timeout: 8000 })
  await user.clear(name)
  await user.type(name, 'Iwc Unlabelled')
  await user.clear(columnRow('iwc_qty').querySelector('[data-rowfield="label"]') as HTMLInputElement)
  await user.click(screen.getByTestId('iw-import'))
  await screen.findByTestId('list-view', undefined, { timeout: 10_000 })
  const meta = await admin.get<{ columns: { column_name: string; label: string }[] }>(`/api/table/${encodeURIComponent('Iwc Unlabelled')}:meta`)
  expect(meta.columns.find((c) => c.column_name === 'iwc_qty')?.label).toBe('Iwc Qty')
  clearSession()
})

async function stockTable(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', {
    name: 'Iwc Stock',
    columns: [
      { column_name: 'iwc_sku', label: 'iwc_sku', column_type: 'Data' },
      { column_name: 'iwc_qty', label: 'Iwc Quantity', column_type: 'Int' },
    ],
  })
}

async function openOnStock(admin: Parameters<typeof renderApp>[1], csv: string) {
  clearSession()
  const user = userEvent.setup()
  await stockTable(admin)
  await renderApp('/featherbase/admin/import', admin)
  await upload(csv)
  const target = await screen.findByTestId('iw-target-0', undefined, { timeout: 8000 })
  if ((target as HTMLInputElement).value !== 'Iwc Stock') {
    await user.click(target)
    await user.click(await screen.findByTestId('iw-target-opt-0-Iwc Stock'))
  }
  await screen.findByTestId('iw-mapping-0')
  return user
}

test("a file column with no header reads (blank) in the mapping", async ({ admin }) => {
  await openOnStock(admin, 'iwc_sku,\nA-1,x\n')
  expect(within(screen.getByTestId('iw-mapping-0')).getByText('(blank)')).toBeInTheDocument()
  clearSession()
})

test('setting a mapped file column back to pick a column unticks it', async ({ admin }) => {
  const user = await openOnStock(admin, 'iwc_sku,iwc_qty\nA-1,1\n')
  await waitFor(() => expect(screen.getByTestId('iw-map-0-1')).toHaveValue('iwc_qty'))
  await user.selectOptions(screen.getByTestId('iw-map-0-1'), '')
  expect(screen.getByTestId('iw-map-use-0-1')).not.toBeChecked()
  expect(screen.getByTestId('iw-mapped-count-0')).toHaveTextContent('1 of 2 file columns mapped')
  clearSession()
})

test('a Table column labelled with its own name is offered by that name alone', async ({ admin }) => {
  await openOnStock(admin, 'iwc_sku,iwc_qty\nA-1,1\n')
  const options = within(screen.getByTestId('iw-map-0-0')).getAllByRole('option').map((o) => o.textContent)
  expect(options).toContain('iwc_sku (Data)')
  expect(options).toContain('Iwc Quantity · iwc_qty (Int)')
  clearSession()
})

test('a match key labelled with its own name is offered by that name alone', async ({ admin }) => {
  await openOnStock(admin, 'iwc_sku,iwc_qty\nA-1,1\n')
  const keys = within(screen.getByTestId('iw-key-0')).getAllByRole('option').map((o) => o.textContent)
  expect(keys).toEqual(['— none: append every row —', 'iwc_sku', 'Iwc Quantity · iwc_qty'])
  clearSession()
})

test('a match key set back to none appends every row again', async ({ admin }) => {
  const user = await openOnStock(admin, 'iwc_sku,iwc_qty\nA-1,1\n')
  await user.selectOptions(screen.getByTestId('iw-key-0'), 'iwc_sku')
  expect(screen.getByTestId('iw-key-0')).toHaveValue('iwc_sku')
  await user.selectOptions(screen.getByTestId('iw-key-0'), '')
  expect(screen.getByTestId('iw-key-0')).toHaveValue('')
  clearSession()
})
