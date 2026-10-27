// The Table builder's refusals and file handling the merged web coverage
// report (ADR 0012) still showed red: a refusal named against a setting rather
// than a row, refusals against two rows at once (the first is brought into
// view, and adding a row clears the marks), a file that cannot be read, the
// drop zone's click and drag states, and a browser that blocks site data.
// Refusals are the real server's.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

afterEach(() => vi.restoreAllMocks())

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-columnrow]')]
const cell = (row: HTMLElement, f: string) => row.querySelector(`[data-rowfield="${f}"]`) as HTMLInputElement

async function openBuilder(admin: Parameters<typeof renderApp>[1]) {
  await renderApp('/featherbase/admin/new-table', admin)
  await screen.findByTestId('table-builder', {}, { timeout: 8000 })
}

test('a Choice column with no options is refused, named by its column', async ({ admin }) => {
  const user = userEvent.setup()
  await openBuilder(admin)
  await user.type(screen.getByTestId('dt-name'), 'Bro Shelf')
  await user.type(cell(rows()[0], 'label'), 'Stage')
  await user.selectOptions(cell(rows()[0], 'column_type') as unknown as HTMLSelectElement, 'Choice')
  await user.click(screen.getByTestId('dt-create'))
  expect(await screen.findByTestId('dt-error')).toHaveTextContent('Invalid Table definition — stage: Choice column requires choices')
})

test('names refused on two rows mark both; adding a row clears the marks', async ({ admin }) => {
  const user = userEvent.setup()
  await openBuilder(admin)
  await user.type(screen.getByTestId('dt-name'), 'Bro Bins')
  await user.type(cell(rows()[0], 'column_name'), 'Bad Name')
  await user.click(screen.getByTestId('dt-add-field'))
  await user.type(cell(rows()[1], 'column_name'), 'Worse Name')
  await user.click(screen.getByTestId('dt-create'))
  expect(await screen.findByTestId('dt-error')).toHaveTextContent(
    'Invalid Table definition — Column “Bad Name”: column_name must be snake_case; Column “Worse Name”: column_name must be snake_case',
  )
  await waitFor(() => expect(screen.getByTestId('dt-col-error-0')).toBeInTheDocument())
  expect(screen.getByTestId('dt-col-error-1')).toBeInTheDocument()
  await user.click(screen.getByTestId('dt-add-field'))
  expect(screen.queryByTestId('dt-col-error-0')).not.toBeInTheDocument()
  expect(screen.queryByTestId('dt-error')).not.toBeInTheDocument()
})

test('a file that cannot be read says why; the drop zone opens the picker and shows a drag over it', async ({ admin }) => {
  await openBuilder(admin)
  const zone = screen.getByTestId('dt-dropzone')
  const picker = screen.getByTestId('dt-file-input')
  let opened = 0
  picker.addEventListener('click', () => opened++)
  fireEvent.click(zone)
  expect(opened).toBe(1)
  fireEvent.dragOver(zone)
  expect(zone.className).toMatch(/(^|\s)border-action(\s|$)/)
  fireEvent.dragLeave(zone)
  expect(zone.className).not.toMatch(/(^|\s)border-action(\s|$)/)

  const bytes = new TextEncoder().encode('\n\n').buffer
  const file = new File([bytes], 'empty.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(picker, { target: { files: [file] } })
  expect(await screen.findByTestId('dt-error')).toHaveTextContent('The file has no sheet with a header row and data')
})

test('with site data blocked the builder opens on the grid', async ({ admin }) => {
  localStorage.setItem('fc-table-builder-view', 'cards')
  const read = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (key === 'fc-table-builder-view') throw new DOMException('blocked', 'SecurityError')
    return read.call(this, key)
  })
  await openBuilder(admin)
  expect(screen.getByTestId('dt-view-grid')).toHaveAttribute('aria-pressed', 'true')
})
