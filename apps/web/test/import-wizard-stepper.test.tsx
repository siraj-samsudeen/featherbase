// #202 (issue #197): the import wizard's column step walks one target at a
// time, imports a step on its own, keeps a finished step's result readable,
// and lets the bulk button finish the rest without re-importing what landed.
// Moved from e2e/import-stepper.spec.ts (#1080). Real server.
import { onTestFinished } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

type Admin = Parameters<typeof renderApp>[1]

const ONE = 'Iws Step One'
const TWO = 'Iws Step Two'
const THREE = 'Iws Step Three'

function workbook(): File {
  const wb = XLSX.utils.book_new()
  for (const [sheet, header] of [
    ['Iws Alpha', 'Iws Alpha Name'],
    ['Iws Beta', 'Iws Beta Name'],
    ['Iws Gamma', 'Iws Gamma Name'],
  ] as const)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[header, 'Iws Note'], ['a', 'x'], ['b', 'y']]), sheet)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], 'stepper fixture.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

async function openColumns(admin: Admin) {
  clearSession()
  onTestFinished(clearSession)
  // Arrives by clicking, as a person does, from the Admin home.
  await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('import-data-link', {}, { timeout: 8000 }))
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, { timeout: 8000 }), { target: { files: [workbook()] } })
  await userEvent.click(await screen.findByTestId('iw-ov-master', {}, { timeout: 8000 }))
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  expect(await screen.findByTestId('iw-stepper')).toBeInTheDocument()
}

async function name(step: number, table: string) {
  const box = screen.getByTestId(`iw-new-name-${step}`)
  await userEvent.clear(box)
  await userEvent.type(box, table)
}

async function importFirstAs(table: string) {
  await name(0, table)
  await userEvent.click(screen.getByTestId('iw-import-one'))
  await waitFor(() => expect(screen.getByTestId('iw-result-0')).toHaveTextContent(`Imported 2 rows into ${table}`), { timeout: 10_000 })
}

async function tableNames(admin: Admin) {
  const res = await admin.get<{ data: { row_id: string }[] }>('/api/table/Table?limit_page_length=500')
  return res.data.map((t) => t.row_id)
}

const cards = () => document.querySelectorAll('[data-testid^="iw-sheet-"]:not([data-testid*="preview"])')

test('#202: three sheets are three steps, one card on screen at a time, every step reachable', async ({ admin }) => {
  await openColumns(admin)
  expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 1 of 3')
  expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Iws Alpha')
  expect(cards()).toHaveLength(1)
  expect(screen.getByTestId('iw-sheet-0')).toBeInTheDocument()
  expect(screen.getByTestId('iw-step-strip').querySelectorAll('button')).toHaveLength(3)
  expect(screen.getByTestId('iw-step-1')).toHaveTextContent('Iws Beta')

  expect(screen.getByTestId('iw-prev')).toBeDisabled()
  await userEvent.click(screen.getByTestId('iw-next'))
  expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 2 of 3')
  expect(screen.getByTestId('iw-sheet-1')).toBeInTheDocument()
  expect(screen.queryByTestId('iw-sheet-0')).not.toBeInTheDocument()

  await userEvent.click(screen.getByTestId('iw-step-2'))
  expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 3 of 3')
  expect(screen.getByTestId('iw-next')).toBeDisabled()
})

test('#202: a step imports on its own, says the run is not over and walks on, leaving the other two untouched', async ({ admin }) => {
  await openColumns(admin)
  await name(0, ONE)
  expect(screen.getByTestId('iw-import-one')).toHaveTextContent(`Import 2 rows into ${ONE}`)
  await userEvent.click(screen.getByTestId('iw-import-one'))
  await waitFor(() => expect(screen.getByTestId('iw-result-0')).toHaveTextContent(`Imported 2 rows into ${ONE}`), { timeout: 10_000 })

  const names = await tableNames(admin)
  expect(names).toContain(ONE)
  expect(names).not.toContain('Iws Beta')
  expect(names).not.toContain('Iws Gamma')

  await waitFor(() => expect(screen.getByTestId('iw-done')).toHaveTextContent('Imported 1; 2 still to import.'))
  expect(screen.getByTestId('iw-import')).toBeEnabled()
  await waitFor(() => expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 2 of 3'))
  expect(screen.getByTestId('iw-step-0')).toHaveAttribute('data-state', 'done')
  expect(screen.getByTestId('iw-step-1')).toHaveAttribute('data-state', 'todo')
})

test('#202: a finished step stays readable, with its undo, from the next step and offers no second import', async ({ admin }) => {
  await openColumns(admin)
  await importFirstAs(ONE)
  await waitFor(() => expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 2 of 3'))
  expect(screen.queryByTestId('iw-sheet-0')).not.toBeInTheDocument()
  expect(screen.getByTestId('iw-result-0')).toHaveTextContent(`Imported 2 rows into ${ONE}`)
  expect(screen.getByTestId('iw-revert-open-0')).toBeInTheDocument()

  await userEvent.click(screen.getByTestId('iw-step-0'))
  expect(screen.queryByTestId('iw-import-one')).not.toBeInTheDocument()
  expect(screen.getByTestId('iw-import-one-done')).toHaveTextContent(`${ONE} imported`)
})

test('#202: the bulk button finishes the remaining steps without re-importing the one that landed', async ({ admin }) => {
  await openColumns(admin)
  await importFirstAs(ONE)
  await waitFor(() => expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 2 of 3'))
  await name(1, TWO)
  await userEvent.click(screen.getByTestId('iw-next'))
  await name(2, THREE)
  expect(screen.getByTestId('iw-import')).toHaveTextContent('Import the remaining 2 Tables')
  await userEvent.click(screen.getByTestId('iw-import'))

  await waitFor(() => expect(screen.getByTestId('iw-done')).toHaveTextContent('Import complete.'), { timeout: 10_000 })
  expect(screen.getByTestId('iw-result-1')).toHaveTextContent(`Imported 2 rows into ${TWO}`)
  expect(screen.getByTestId('iw-result-2')).toHaveTextContent(`Imported 2 rows into ${THREE}`)
  expect(screen.getByTestId('iw-result-0')).toHaveTextContent('Imported 2 rows')
  expect(await admin.get(`/api/table/${encodeURIComponent(ONE)}:count`)).toEqual({ count: 2 })
})
