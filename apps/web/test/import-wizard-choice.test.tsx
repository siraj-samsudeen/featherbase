// The import wizard, driven the way the owner drove it on staging: a workbook
// of two sheets combined into one new Table, with a column of many values
// switched to Choice by hand. Real server, made-up data.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { afterEach, describe, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

function workbook(sheets: Record<string, unknown[][]>, name = 'book.xlsx') {
  const wb = XLSX.utils.book_new()
  for (const [sheet, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

const HEADER = ['Store', 'Lob', 'Section', 'Code']
// Twelve Sections: past the eight that inference will call a Choice by itself.
const sheet = (store: string, start: number) => [
  HEADER,
  ...Array.from({ length: 30 }, (_, i) => [store, `Lob ${i % 3}`, `Section ${String((i + start) % 12).padStart(2, '0')}`, `${store}-${i}`]),
]
const BOOK = { One: sheet('AAA', 0), Two: sheet('BBB', 5) }

const rowOf = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-columnrow]')].find(
    (r) => r.querySelector<HTMLInputElement>('[data-rowfield="label"]')?.value === label,
  ) as HTMLElement
const typeOf = (label: string) => rowOf(label).querySelector('[data-rowfield="column_type"]') as HTMLSelectElement

async function mergedInto(name: string, book: Record<string, unknown[][]>, admin: Parameters<typeof renderApp>[1]) {
  clearSession()
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/import', admin)
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [workbook(book)] } })
  await user.click(await screen.findByTestId('iw-ov-master', {}, { timeout: 8000 }))
  await user.click(screen.getByTestId('iw-ov-mode-merge'))
  await user.clear(screen.getByTestId('iw-ov-merge-name'))
  await user.type(screen.getByTestId('iw-ov-merge-name'), name)
  await user.click(screen.getByTestId('iw-ov-continue'))
  await screen.findByTestId('iw-import')
  return user
}

test('a column of many values switched to Choice imports, its options read from the sheets', async ({ admin }) => {
  const user = await mergedInto('Iwc Mapping', BOOK, admin)
  expect(typeOf('Section')).toHaveValue('Data')
  await user.selectOptions(typeOf('Section'), 'Choice')
  await user.click(screen.getByTestId('iw-import'))
  await waitFor(() => expect(screen.getByTestId('iw-results')).toBeInTheDocument(), { timeout: 20000 })
  expect(screen.queryByTestId('iw-failure-0')?.textContent ?? 'no failure').toBe('no failure')
  const meta = await admin.get<{ columns: { column_name: string; column_type: string; choices: string }[] }>('/api/table/Iwc%20Mapping:meta')
  const section = meta.columns.find((c) => c.column_name === 'section')!
  expect(section.column_type).toBe('Choice')
  expect(section.choices.split('\n')).toHaveLength(12)
  expect(await admin.get('/api/table/Iwc%20Mapping:count')).toMatchObject({ count: 60 })
  clearSession()
}, 30000)

// Only the wizard's own steps differ below, so one helper opens a single sheet.
async function singleSheet(name: string, aoa: unknown[][], admin: Parameters<typeof renderApp>[1]) {
  clearSession()
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/import', admin)
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [workbook({ Sheet: aoa })] } })
  await screen.findByTestId('iw-import', {}, { timeout: 8000 })
  await user.clear(screen.getByTestId('iw-new-name-0'))
  await user.type(screen.getByTestId('iw-new-name-0'), name)
  return user
}

test('the options of a long Choice show the first eight and how many more, the rest on hover', async ({ admin }) => {
  const user = await mergedInto('Iwc Long', BOOK, admin)
  await user.selectOptions(typeOf('Section'), 'Choice')
  const options = rowOf('Section').querySelector('[data-rowfield="choices"]') as HTMLElement
  expect(options).toHaveTextContent('Section 00, Section 01, Section 02, Section 03, Section 04, Section 05, Section 06, Section 07 +4 more')
  expect(options.title.split(', ')).toHaveLength(12)
  clearSession()
}, 30000)

test('numbers switched to Choice import as their text', async ({ admin }) => {
  const user = await singleSheet('Iwc Floors', [['Floor', 'Code'], ...Array.from({ length: 9 }, (_, i) => [i % 3, `c${i}`])], admin)
  expect(typeOf('Floor')).toHaveValue('Int')
  await user.selectOptions(typeOf('Floor'), 'Choice')
  await user.click(screen.getByTestId('iw-import'))
  await waitFor(async () => expect(await admin.get('/api/table/Iwc%20Floors:count')).toMatchObject({ count: 9 }), { timeout: 10000 })
  clearSession()
}, 30000)

test('a Choice value with spaces around it imports as its option', async ({ admin }) => {
  const user = await singleSheet('Iwc Padded', [['Zone', 'Code'], ...Array.from({ length: 12 }, (_, i) => [i % 2 ? ' Fresh' : 'Dairy ', `c${i}`])], admin)
  expect(typeOf('Zone')).toHaveValue('Choice')
  await user.click(screen.getByTestId('iw-import'))
  await waitFor(async () => expect(await admin.get('/api/table/Iwc%20Padded:count')).toMatchObject({ count: 12 }), { timeout: 10000 })
  clearSession()
}, 30000)

// #993: a column with no values has no options to offer, so Choice is not
// offered for it; a column with values still is.
test('Choice cannot be picked for a column with no values', async ({ admin }) => {
  await singleSheet('Iwc Blank', [['Zone', 'Empty'], ['a', ''], ['b', '']], admin)
  const choice = (label: string) => [...typeOf(label).options].find((o) => o.value === 'Choice')!
  expect(choice('Empty')).toBeDisabled()
  expect(choice('Empty')).toHaveTextContent('Choice (no values to offer)')
  expect(choice('Zone')).toBeEnabled()
  clearSession()
}, 30000)

// #993: after Start over, the name a first attempt took is an existing Table.
test('a new Table named like an existing one says so before importing, and offers to import into it', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Iwc Taken', columns: [{ column_name: 'zone', column_type: 'Data' }] })
  const user = await singleSheet('Iwc Taken', [['Zone', 'Code'], ['a', 'x']], admin)
  expect(await screen.findByTestId('iw-name-taken-0')).toHaveTextContent(
    'A Table called Iwc Taken already exists. Import into it, or give the new Table another name.',
  )
  await user.click(screen.getByTestId('iw-import'))
  expect(await screen.findByTestId('iw-failure-0', {}, { timeout: 10000 })).toHaveTextContent(
    'Iwc Taken failed — Table Iwc Taken already exists. Give the new Table another name, or pick that Table under “Import into” to add the rows to it.',
  )
  await waitFor(() => expect(screen.getByTestId('iw-import')).toBeEnabled(), { timeout: 8000 })
  await user.click(screen.getByTestId('iw-name-taken-use-0'))
  expect(screen.getByTestId('iw-target-0')).toHaveValue('Iwc Taken')
  expect(screen.queryByTestId('iw-name-taken-0')).not.toBeInTheDocument()
  clearSession()
}, 30000)

test('one row is one row: the Import button and its result', async ({ admin }) => {
  const user = await singleSheet('Iwc Single', [['Zone', 'Code'], [1, 'x'], ['text', 'y']], admin)
  expect(screen.getByTestId('iw-import')).toHaveTextContent(/^Import 2 rows$/)
  await user.selectOptions(typeOf('Zone'), 'Int')
  await user.click(screen.getByTestId('iw-import'))
  expect(await screen.findByTestId('iw-result-0', {}, { timeout: 10000 })).toHaveTextContent('Imported 1 row into Iwc Single; 1 failed')
  clearSession()
}, 30000)

test('a bad column name is named by the row the person sees; a bad Table name as the Table name', async ({ admin }) => {
  const user = await singleSheet('Iwc-Bad', [['Zone', 'Code'], ['a', 'b']], admin)
  await user.click(screen.getByTestId('iw-import'))
  expect(await screen.findByTestId('iw-failure-0', {}, { timeout: 10000 })).toHaveTextContent('Invalid Table definition — Table name: invalid Table name')
  await waitFor(() => expect(screen.getByTestId('iw-import')).toBeEnabled(), { timeout: 8000 })
  await user.clear(screen.getByTestId('iw-new-name-0'))
  await user.type(screen.getByTestId('iw-new-name-0'), 'Iwc Good')
  const machineName = rowOf('Zone').querySelector('[data-rowfield="column_name"]') as HTMLInputElement
  await user.clear(machineName)
  await user.type(machineName, 'Bad Name')
  await user.click(screen.getByTestId('iw-import'))
  await waitFor(() => expect(screen.getByTestId('iw-failure-0')).toHaveTextContent('Invalid Table definition — Column “Zone”: column_name must be snake_case'), { timeout: 10000 })
  clearSession()
}, 30000)

test('a one-sheet import with some rows refused stays, lists them, and does not call itself complete', async ({ admin }) => {
  // #993: the outcome line is brought into view, clear of the sticky Import bar.
  const scrolled: Element[] = []
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this) }
  const user = await singleSheet('Iwc Partial', [['Zone', 'Code'], [1, 'x'], ['text', 'y']], admin)
  await user.selectOptions(typeOf('Zone'), 'Int')
  await user.click(screen.getByTestId('iw-import'))
  expect(await screen.findByTestId('iw-result-0', {}, { timeout: 10000 })).toHaveTextContent('1 failed')
  await waitFor(() => expect(screen.getByTestId('iw-done')).toHaveTextContent('1 row was refused. See above.'), { timeout: 8000 })
  expect(screen.getByTestId('iw-done')).toHaveClass('text-negative')
  expect(scrolled).toContain(screen.getByTestId('iw-done'))
  delete (Element.prototype as Partial<Element>).scrollIntoView
  await new Promise((resolve) => setTimeout(resolve, 1000))
  expect(screen.getByTestId('iw-result-0')).toBeInTheDocument()
  clearSession()
}, 30000)

test('when every row is refused nothing has landed: it says so, and correcting the column and importing again works', async ({ admin }) => {
  const user = await singleSheet('Iwc Refused', [['Zone', 'Code'], ...Array.from({ length: 3 }, (_, i) => [`text${i}`, `c${i}`])], admin)
  await user.selectOptions(typeOf('Zone'), 'Int')
  await user.click(screen.getByTestId('iw-import'))
  const failure = await screen.findByTestId('iw-failure-0', {}, { timeout: 10000 })
  expect(failure).toHaveTextContent('Iwc Refused failed — all 3 rows were refused (first: row 2:')
  expect(screen.queryByTestId('iw-result-0')).not.toBeInTheDocument()
  // #993: with one target, Fix it still shows where: the card, outlined.
  await user.click(screen.getByTestId('iw-failure-goto-0'))
  expect(screen.getByTestId('iw-sheet-0')).toHaveAttribute('data-flash', 'true')
  await waitFor(() => expect(screen.getByTestId('iw-sheet-0')).not.toHaveAttribute('data-flash'), { timeout: 4000 })
  await waitFor(() => expect(screen.getByTestId('iw-import')).toBeEnabled(), { timeout: 8000 })
  await user.selectOptions(typeOf('Zone'), 'Data')
  await user.click(screen.getByTestId('iw-import'))
  await waitFor(async () => expect(await admin.get('/api/table/Iwc%20Refused:count')).toMatchObject({ count: 3 }), { timeout: 10000 })
  const meta = await admin.get<{ columns: { column_name: string; column_type: string }[] }>('/api/table/Iwc%20Refused:meta')
  expect(meta.columns.find((c) => c.column_name === 'zone')?.column_type).toBe('Data')
  clearSession()
}, 30000)

test('joining two columns keeps what was set by hand on the others', async ({ admin }) => {
  const user = await mergedInto('Iwc Join', BOOK, admin)
  await user.selectOptions(typeOf('Section'), 'Choice')
  const label = (name: string) => [...document.querySelectorAll<HTMLElement>('[data-columnrow]')].findIndex((r) => r.querySelector<HTMLInputElement>('[data-rowfield="label"]')?.value === name)
  await user.click(screen.getByTestId(`iw-combine-pick-0-${label('Store')}`))
  await user.click(screen.getByTestId(`iw-combine-pick-0-${label('Lob')}`))
  await user.click(await screen.findByTestId('iw-combine-rule-first-0'))
  await user.click(screen.getByTestId('iw-combine-go-0'))
  await waitFor(() => expect(rowOf('Lob')).toBeUndefined())
  expect(typeOf('Section')).toHaveValue('Choice')
  expect((rowOf('Section').querySelector('[data-rowfield="choices"]') as HTMLElement).title.split(', ')).toHaveLength(12)
  clearSession()
}, 30000)

test('a clean one-sheet import still goes straight to its Table', async ({ admin }) => {
  const user = await singleSheet('Iwc Clean', [['Zone', 'Code'], ['a', 'x'], ['b', 'y']], admin)
  await user.click(screen.getByTestId('iw-import'))
  await waitFor(() => expect(screen.queryByTestId('iw-import')).not.toBeInTheDocument(), { timeout: 10000 })
  clearSession()
}, 30000)

describe('trying again after the connection dropped once the Table was made', () => {
  afterEach(() => vi.restoreAllMocks())
  // Every part of an import fails with a gateway error until `restore` runs,
  // and `land` lets one row in first: the state a deploy mid-import leaves.
  const dropImportCalls = (admin: Parameters<typeof renderApp>[1], land?: { table: string; row: Record<string, unknown> }) => {
    const real = globalThis.fetch
    let landed = false
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String((input as Request)?.url ?? input).includes(':import')) {
        if (land && !landed) { landed = true; await admin.post('/api/save_row', land) }
        return new Response('bad gateway', { status: 502 })
      }
      return real(input, init)
    })
    return () => spy.mockRestore()
  }

  test('with no row landed it imports, and takes a type changed in between', async ({ admin }) => {
    const user = await singleSheet('Iwc Retry', [['Zone', 'Code'], ['a', 1], ['b', 2]], admin)
    const restore = dropImportCalls(admin)
    await user.click(screen.getByTestId('iw-import'))
    await screen.findByTestId('iw-failure-0', {}, { timeout: 10000 })
    await waitFor(() => expect(screen.getByTestId('iw-import')).toBeEnabled(), { timeout: 8000 })
    restore()
    await user.selectOptions(typeOf('Code'), 'Data')
    await user.click(screen.getByTestId('iw-import'))
    await waitFor(async () => expect(await admin.get('/api/table/Iwc%20Retry:count')).toMatchObject({ count: 2 }), { timeout: 10000 })
    const meta = await admin.get<{ columns: { column_name: string; column_type: string }[] }>('/api/table/Iwc%20Retry:meta')
    expect(meta.columns.find((c) => c.column_name === 'code')?.column_type).toBe('Data')
    clearSession()
  }, 30000)

  test('with the Table it made deleted since, it makes the Table again and imports', async ({ admin }) => {
    const user = await singleSheet('Iwc Remade', [['Zone', 'Code'], ['a', 1], ['b', 2]], admin)
    const restore = dropImportCalls(admin)
    await user.click(screen.getByTestId('iw-import'))
    await screen.findByTestId('iw-failure-0', {}, { timeout: 10000 })
    await waitFor(() => expect(screen.getByTestId('iw-import')).toBeEnabled(), { timeout: 8000 })
    restore()
    await admin.delete('/api/table_def/Iwc%20Remade')
    await user.click(screen.getByTestId('iw-import'))
    await waitFor(async () => expect(await admin.get('/api/table/Iwc%20Remade:count')).toMatchObject({ count: 2 }), { timeout: 10000 })
    clearSession()
  }, 30000)

  test('with rows landed it refuses to double them, and says where to undo them', async ({ admin }) => {
    const user = await singleSheet('Iwc Landed', [['Zone', 'Code'], ['a', 1], ['b', 2]], admin)
    const restore = dropImportCalls(admin, { table: 'Iwc Landed', row: { zone: 'a', code: 1 } })
    await user.click(screen.getByTestId('iw-import'))
    await screen.findByTestId('iw-failure-0', {}, { timeout: 10000 })
    await waitFor(() => expect(screen.getByTestId('iw-import')).toBeEnabled(), { timeout: 8000 })
    restore()
    await user.click(screen.getByTestId('iw-import'))
    await waitFor(() => expect(screen.getByTestId('iw-failure-0')).toHaveTextContent(
      'Iwc Landed already holds 1 row from the attempt that stopped. Delete it under Past imports, then import again.',
    ), { timeout: 10000 })
    // #993: nothing on this step can fix that, so the way out is Past imports.
    expect(screen.queryByTestId('iw-failure-goto-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('iw-failure-past-imports-0')).toHaveAttribute('href', '/featherbase/admin/imports')
    expect(await admin.get('/api/table/Iwc%20Landed:count')).toMatchObject({ count: 1 })
    clearSession()
  }, 30000)
})

test('a one-sheet import with several rows refused counts them', async ({ admin }) => {
  const user = await singleSheet('Iwc Several', [['Zone', 'Code'], [1, 'x'], ['text', 'y'], ['more text', 'z']], admin)
  await user.selectOptions(typeOf('Zone'), 'Int')
  await user.click(screen.getByTestId('iw-import'))
  await waitFor(() => expect(screen.getByTestId('iw-done')).toHaveTextContent('2 rows were refused. See above.'), { timeout: 10000 })
  clearSession()
}, 30000)

test('when the one row of a sheet is refused it says that row was refused', async ({ admin }) => {
  const user = await singleSheet('Iwc Lone', [['Zone', 'Code'], ['text', 'c']], admin)
  await user.selectOptions(typeOf('Zone'), 'Int')
  await user.click(screen.getByTestId('iw-import'))
  expect(await screen.findByTestId('iw-failure-0', {}, { timeout: 10000 })).toHaveTextContent('Iwc Lone failed — the 1 row was refused (first: row 2:')
  clearSession()
}, 30000)
