// #204 (issue #197): the wizard's work outlives the page. Going to look at
// the rows just imported and coming back, or reloading, resumes the run; a
// finished run or Start over leaves nothing to resume; and when the rows do
// not fit in session storage the decisions still do. Moved from
// e2e/import-resume.spec.ts (#1080). A reload is the page unmounted and
// rendered afresh: the wizard keeps nothing outside sessionStorage (see
// src/lib/import-session.ts, whose rules are test/import-session.test.ts).
import { onTestFinished, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { IMPORT_DATA_KEY, clearSession } from '../src/lib/import-session'

type Admin = Parameters<typeof renderApp>[1]

const ONE = 'Iwz Resume One'
const TWO = 'Iwz Resume Two'
const FILE = 'resume fixture.xlsx'

function workbook(): File {
  const wb = XLSX.utils.book_new()
  for (const [sheet, header] of [
    ['Iwz Alpha', 'Iwz Alpha Name'],
    ['Iwz Beta', 'Iwz Beta Name'],
    ['Iwz Gamma', 'Iwz Gamma Name'],
  ] as const)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[header, 'Iwz Note'], ['a', 'x'], ['b', 'y']]), sheet)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], FILE, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

async function drop() {
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, { timeout: 8000 }), { target: { files: [workbook()] } })
}

/** The Admin home, then its Import data link, as a person arrives. */
async function openWizard(admin: Admin) {
  clearSession()
  onTestFinished(clearSession)
  const rendered = await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('import-data-link', {}, { timeout: 8000 }))
  return rendered
}

async function allSheetsAsTables() {
  await userEvent.click(await screen.findByTestId('iw-ov-master', {}, { timeout: 8000 }))
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  await screen.findByTestId('iw-stepper')
}

async function name(step: number, table: string) {
  const box = screen.getByTestId(`iw-new-name-${step}`)
  await userEvent.clear(box)
  await userEvent.type(box, table)
}

/** A full page reload: everything mounted goes, sessionStorage stays. */
async function reload(rendered: { unmount: () => void }, admin: Admin) {
  rendered.unmount()
  return renderApp('/featherbase/admin/import', admin)
}

test('#204: going to look at the imported rows and coming back resumes everything', async ({ admin }) => {
  await openWizard(admin)
  await drop()
  await allSheetsAsTables()
  await name(0, ONE)
  await userEvent.click(screen.getByTestId('iw-import-one'))
  await waitFor(() => expect(screen.getByTestId('iw-result-0')).toHaveTextContent(`Imported 2 rows into ${ONE}`), { timeout: 10_000 })
  await waitFor(() => expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 2 of 3'))
  await name(1, TWO)

  await userEvent.click(within(screen.getByTestId('iw-result-0')).getByRole('link', { name: ONE }))
  expect(await screen.findByTestId('list-view')).toBeInTheDocument()
  await userEvent.click(await screen.findByTestId('import-data-link'))

  expect(await screen.findByTestId('iw-file-name')).toHaveTextContent(FILE)
  expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 2 of 3')
  expect(screen.getByTestId('iw-new-name-1')).toHaveValue(TWO)
  expect(screen.getByTestId('iw-result-0')).toHaveTextContent(`Imported 2 rows into ${ONE}`)
  expect(screen.getByTestId('iw-step-0')).toHaveAttribute('data-state', 'done')

  await userEvent.click(screen.getByTestId('iw-import-one'))
  await waitFor(() => expect(screen.getByTestId('iw-result-1')).toHaveTextContent(`Imported 2 rows into ${TWO}`), { timeout: 10_000 })
  expect(await admin.get(`/api/table/${encodeURIComponent(ONE)}:count`)).toEqual({ count: 2 })
})

test('#204: a full page reload resumes the parsed workbook and every name typed', async ({ admin }) => {
  const first = await openWizard(admin)
  await drop()
  await allSheetsAsTables()
  await name(0, ONE)
  await userEvent.click(screen.getByTestId('iw-next'))
  await name(1, TWO)

  await reload(first, admin)
  await waitFor(() => expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 2 of 3'), { timeout: 8000 })
  expect(screen.queryByTestId('iw-resume')).not.toBeInTheDocument()
  expect(screen.getByTestId('iw-new-name-1')).toHaveValue(TWO)
  await userEvent.click(screen.getByTestId('iw-prev'))
  expect(screen.getByTestId('iw-new-name-0')).toHaveValue(ONE)
})

test('#204: a finished import is not resumed; coming back starts the next one', async ({ admin }) => {
  const first = await openWizard(admin)
  await drop()
  // Two sheets, so the run does not move on to a lone new Table's list.
  await userEvent.click(await screen.findByTestId('iw-ov-sheet-0', {}, { timeout: 8000 }))
  await userEvent.click(screen.getByTestId('iw-ov-sheet-1'))
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  await name(0, ONE)
  await userEvent.click(screen.getByTestId('iw-next'))
  await name(1, TWO)
  await userEvent.click(screen.getByTestId('iw-import'))
  await waitFor(() => expect(screen.getByTestId('iw-done')).toHaveTextContent('Import complete.'), { timeout: 10_000 })

  await reload(first, admin)
  expect(await screen.findByTestId('iw-dropzone', {}, { timeout: 8000 })).toHaveTextContent('Drag & drop')
  expect(screen.queryByTestId('iw-stepper')).not.toBeInTheDocument()
  expect(screen.queryByTestId('iw-resume')).not.toBeInTheDocument()
})

test('#204: Start over forgets the file and every choice about it, across a reload too', async ({ admin }) => {
  const first = await openWizard(admin)
  await drop()
  await allSheetsAsTables()
  await name(0, ONE)

  await userEvent.click(screen.getByTestId('iw-start-over'))
  expect(await screen.findByTestId('iw-dropzone')).toHaveTextContent('Drag & drop')
  expect(screen.queryByTestId('iw-stepper')).not.toBeInTheDocument()

  await reload(first, admin)
  expect(await screen.findByTestId('iw-dropzone', {}, { timeout: 8000 })).toHaveTextContent('Drag & drop')
  expect(screen.queryByTestId('iw-stepper')).not.toBeInTheDocument()
})

test('#204: when the rows do not fit, the decisions still do, and the same file picks up where it left off', async ({ admin }) => {
  const first = await openWizard(admin)
  // A big workbook overflows session storage: the rows are refused, the
  // small decisions are not.
  const real = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function guarded(this: Storage, key: string, value: string) {
    if (key === IMPORT_DATA_KEY) throw new DOMException('quota', 'QuotaExceededError')
    return real.call(this, key, value)
  })
  onTestFinished(() => vi.restoreAllMocks())
  await drop()
  await allSheetsAsTables()
  await name(0, ONE)
  // Said before leaving, not discovered on return.
  expect(screen.getByTestId('iw-too-big')).toHaveTextContent('drop the file again')

  await reload(first, admin)
  const resume = await screen.findByTestId('iw-resume', {}, { timeout: 8000 })
  expect(resume).toHaveTextContent(`Your work on ${FILE}`)
  expect(resume).toHaveTextContent('3 Tables planned')
  expect(screen.getByTestId('iw-file-name')).toHaveTextContent('again to carry on')

  await drop()
  await waitFor(() => expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 1 of 3'), { timeout: 8000 })
  expect(screen.queryByTestId('iw-resume')).not.toBeInTheDocument()
  expect(screen.getByTestId('iw-new-name-0')).toHaveValue(ONE)
})
