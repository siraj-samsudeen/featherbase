// #738: a new table's list starts with its first seven columns. The Import
// Wizard's column step shows an "In list" tick per column, follows "first
// seven columns in use" until the user changes a tick, and offers "Tick all"
// and "Clear" above the column. Real server for what gets created.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

const COLUMNS = ['Section', 'MCH', 'Floor', 'Zone', 'Rack', 'Owner', 'Category', 'Remarks', 'Updated On', 'Notes']
const FIRST_SEVEN = [true, true, true, true, true, true, true, false, false, false]

async function openColumnStep(admin: Parameters<typeof renderApp>[1], fileName: string) {
  clearSession()
  await renderApp('/featherbase/admin/import', admin)
  const csv = `${COLUMNS.join(',')}\n${COLUMNS.map((c) => `${c} 1`).join(',')}\n`
  const bytes = new TextEncoder().encode(csv).buffer
  const file = new File([bytes], fileName, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [file] } })
  await screen.findByTestId('iw-new-grid-0')
}

const rows = () => [...screen.getByTestId('iw-new-grid-0').querySelectorAll<HTMLElement>('tbody tr[data-columnrow]')]
const field = (row: HTMLElement, name: string) => row.querySelector<HTMLInputElement>(`[data-rowfield=${name}]`)!
const inList = () => rows().map((r) => field(r, 'in_list_view').checked)
const rowFor = (label: string) => rows().find((r) => field(r, 'label').value === label)!

test('the column step shows an In list tick per column, the first seven ticked', async ({ admin }) => {
  await openColumnStep(admin, 'iwl ticks.csv')

  expect(within(screen.getByTestId('iw-new-grid-0')).getByText('In list')).toBeInTheDocument()
  expect(inList()).toEqual(FIRST_SEVEN)
  clearSession()
})

test('leaving a column out moves the next column into the list', async ({ admin }) => {
  const user = userEvent.setup()
  await openColumnStep(admin, 'iwl follow.csv')

  await user.click(field(rowFor('MCH'), 'include'))

  expect(inList()).toEqual([true, false, true, true, true, true, true, true, false, false])
  clearSession()
})

test("once the user changes an In list tick, leaving a column out no longer moves the others", async ({ admin }) => {
  const user = userEvent.setup()
  await openColumnStep(admin, 'iwl stand.csv')

  await user.click(field(rowFor('Notes'), 'in_list_view'))
  await user.click(field(rowFor('MCH'), 'include'))

  expect(inList()).toEqual([true, false, true, true, true, true, true, false, false, true])
  clearSession()
})

test('a column left out of the import cannot be ticked into the list', async ({ admin }) => {
  const user = userEvent.setup()
  await openColumnStep(admin, 'iwl disabled.csv')

  await user.click(field(rowFor('Section'), 'include'))

  expect(field(rowFor('Section'), 'in_list_view')).not.toBeChecked()
  expect(field(rowFor('Section'), 'in_list_view')).toBeDisabled()
  clearSession()
})

test('Tick all ticks every column in use', async ({ admin }) => {
  const user = userEvent.setup()
  await openColumnStep(admin, 'iwl all.csv')
  await user.click(field(rowFor('Owner'), 'include'))

  await user.click(screen.getByRole('button', { name: 'Tick all in the list' }))

  expect(inList()).toEqual(COLUMNS.map((c) => c !== 'Owner'))
  clearSession()
})

test('Clear unticks every column', async ({ admin }) => {
  const user = userEvent.setup()
  await openColumnStep(admin, 'iwl clear.csv')

  await user.click(screen.getByRole('button', { name: 'Clear the list ticks' }))

  expect(inList()).toEqual(COLUMNS.map(() => false))
  clearSession()
})

test('the created table lists exactly the ticked columns in use', async ({ admin }) => {
  const user = userEvent.setup()
  await openColumnStep(admin, 'iwl created.csv')
  await user.clear(screen.getByTestId('iw-new-name-0'))
  await user.type(screen.getByTestId('iw-new-name-0'), 'Iwl Section Mapping')
  await user.click(screen.getByRole('button', { name: 'Tick all in the list' }))
  await user.click(field(rowFor('MCH'), 'include'))

  await user.click(screen.getByTestId('iw-import'))
  await screen.findByTestId('list-view', undefined, { timeout: 10_000 })

  await waitFor(async () => {
    const meta = await admin.get<{ columns: { label: string; in_list_view?: boolean }[] }>(
      `/api/table/${encodeURIComponent('Iwl Section Mapping')}:meta`,
    )
    expect(meta.columns.filter((c) => c.in_list_view).map((c) => c.label)).toEqual(
      COLUMNS.filter((c) => c !== 'MCH'),
    )
  })
  clearSession()
})
