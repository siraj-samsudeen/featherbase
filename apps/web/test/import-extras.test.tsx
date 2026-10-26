// Import wizard paths the merged web coverage report (ADR 0012) showed
// untaken: shaping a new Table's columns before importing (display name,
// database name, type), and the target picker's keyboard and its three kinds
// of choice (best match, New Table, any other Table).
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

const planRow = (header: string) =>
  [...document.querySelectorAll<HTMLElement>('tr')].find((tr) => tr.querySelector('[data-rowfield="label"]') && tr.textContent?.includes(header))!

test("a new Table's columns can be renamed and retyped before the import", async ({ admin }) => {
  clearSession()
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/import', admin)
  await upload('Title,Qty\nalpha,1\nbeta,2\n')
  const name = await screen.findByTestId('iw-new-name-0', undefined, { timeout: 8000 })
  await user.clear(name)
  await user.type(name, 'Ix Shaped')

  const qty = planRow('Qty')
  const field = (f: string) => qty.querySelector(`[data-rowfield="${f}"]`) as HTMLInputElement
  await user.clear(field('label'))
  await user.type(field('label'), 'Quantity')
  await user.clear(field('column_name'))
  await user.type(field('column_name'), 'quantity')
  await user.selectOptions(field('column_type') as unknown as HTMLSelectElement, 'Float')

  await user.click(screen.getByTestId('iw-import'))
  await screen.findByTestId('list-view', undefined, { timeout: 10_000 })
  const meta = await admin.get<{ columns: { column_name: string; label: string; column_type: string }[] }>('/api/table/Ix%20Shaped:meta')
  expect(meta.columns.find((c) => c.column_name === 'quantity')).toMatchObject({ label: 'Quantity', column_type: 'Float' })
  await waitFor(async () => expect((await admin.get<{ total: number }>('/api/table/Ix%20Shaped')).total).toBe(2))
  clearSession()
})

test('the target picker: Escape closes it, Enter takes the best match, and New Table or any other Table can be chosen', async ({ admin }) => {
  clearSession()
  const user = userEvent.setup()
  await admin.post('/api/table_def', {
    name: 'Ix Stock',
    columns: [
      { column_name: 'sku', column_type: 'Data' },
      { column_name: 'qty', column_type: 'Int' },
    ],
  })
  await admin.post('/api/table_def', { name: 'Ix Unrelated', columns: [{ column_name: 'colour', column_type: 'Data' }] })
  await renderApp('/featherbase/admin/import', admin)
  await upload('sku,qty\nA-1,1\n')
  const target = await screen.findByTestId('iw-target-0', undefined, { timeout: 8000 })

  await user.click(target)
  await user.keyboard('{Escape}')
  expect(screen.queryByTestId('iw-target-menu-0')).not.toBeInTheDocument()

  await user.click(target)
  await user.click(screen.getByTestId('iw-target-new-0'))
  expect(target).toHaveValue('New Table…')

  await user.click(target)
  await user.type(screen.getByTestId('iw-target-search-0'), 'Ix St{Enter}')
  await waitFor(() => expect(target).toHaveValue('Ix Stock'))

  await user.click(target)
  const menu = screen.getByTestId('iw-target-menu-0')
  expect(within(menu).getByText('All Tables')).toBeInTheDocument()
  await user.click(within(menu).getByTestId('iw-target-opt-0-Ix Unrelated'))
  expect(target).toHaveValue('Ix Unrelated')
  clearSession()
})
