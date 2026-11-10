// The drill pane (#910) on a Table whose form is laid out in sections and
// whose values are not plain text: a tick on or off, a choice, JSON (an object
// or plain words) and a file. Also
// how the rows of a group are opened, and what Filter keeps.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { tableHref } from 'shared'
import { deleteStored } from 'server/src/storage'
import { test, expect, renderApp } from './pg-test'
import { pickedFile, useNodeMultipart } from './node-multipart'

afterEach(() => vi.unstubAllGlobals())

type Admin = Parameters<typeof renderApp>[1]
const BIN = 'Dpf Bin'
const ITEM = 'Dpf Item'
const T = { timeout: 10_000 }

async function seedBins(admin: Admin) {
  await admin.post('/api/table_def', {
    name: BIN, id_pattern: 'prompt', title_column: 'bin_name',
    columns: [
      { column_name: 'bin_name', column_type: 'Data', label: 'Bin name', in_list_view: true },
      { column_name: 'stock_section', column_type: 'Section Break', label: 'Stock' },
      { column_name: 'sealed', column_type: 'Check', label: 'Sealed' },
      { column_name: 'state', column_type: 'Choice', label: 'State', choices: 'Open\nShut' },
      { column_name: 'spec', column_type: 'JSON', label: 'Spec' },
      { column_name: 'photo', column_type: 'Attach', label: 'Photo' },
    ],
  })
  await admin.post('/api/table_def', {
    name: ITEM, id_pattern: 'prompt', title_column: 'item_name',
    columns: [
      { column_name: 'item_name', column_type: 'Data', label: 'Item name', in_list_view: true },
      { column_name: 'bin', column_type: 'Reference', reference_table: BIN, label: 'Bin', in_list_view: true },
      { column_name: 'grade', column_type: 'Choice', label: 'Grade', choices: 'Prime\nSeconds', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: BIN, row: {
    row_id: 'B1', bin_name: 'North bay', sealed: true, state: 'Shut', spec: { depth: 40 },
  } })
  await admin.post('/api/save_row', { table: BIN, row: { row_id: 'B2', bin_name: 'South bay' } })
  await admin.post('/api/save_row', { table: ITEM, row: { row_id: 'I1', item_name: 'Hinges', bin: 'B1', grade: 'Prime' } })
  await admin.post('/api/save_row', { table: ITEM, row: { row_id: 'I2', item_name: 'Brackets', bin: 'B1', grade: 'Seconds' } })
  await admin.post('/api/save_row', { table: ITEM, row: { row_id: 'I3', item_name: 'Washers', bin: 'B2', grade: 'Prime' } })
}

const pane = (name: RegExp) => screen.findByRole('complementary', { name }, T)

/** Shows the row named `name` of the list on screen in the pane. */
async function select(name: string) {
  const line = (await screen.findByRole('link', { name }, T)).closest('tr')!
  fireEvent.click(within(line).getAllByRole('cell').at(-1)!)
}

async function openNorthBay(admin: Admin) {
  await seedBins(admin)
  await renderApp(tableHref(BIN), admin)
  await select('North bay')
  return pane(/^North bay/)
}

const field = (bin: HTMLElement, label: string) => within(bin).getByText(label, { selector: 'dt' }).nextElementSibling

test("the pane keeps the form's sections, each under its heading", async ({ admin }) => {
  const bin = await openNorthBay(admin)
  expect(await within(bin).findByRole('heading', { name: 'Stock' }, T)).toBeInTheDocument()
  expect(within(bin).getByRole('heading', { name: 'Stock' }).parentElement).toHaveTextContent('Sealed')
})

test('a ticked box reads Yes in the pane', async ({ admin }) => {
  const bin = await openNorthBay(admin)
  await within(bin).findByRole('heading', { name: 'Stock' }, T)
  expect(field(bin, 'Sealed')).toHaveTextContent(/^Yes$/)
})

test('a choice reads as its label in the pane', async ({ admin }) => {
  const bin = await openNorthBay(admin)
  await within(bin).findByRole('heading', { name: 'Stock' }, T)
  expect(field(bin, 'State')).toHaveTextContent(/^Shut$/)
})

test('JSON reads as its text in the pane', async ({ admin }) => {
  const bin = await openNorthBay(admin)
  await within(bin).findByRole('heading', { name: 'Stock' }, T)
  expect(JSON.parse(field(bin, 'Spec')!.querySelector('code')!.textContent!)).toEqual({ depth: 40 })
})

test("a file reads as its file's name in the pane", async ({ admin }) => {
  await seedBins(admin)
  await useNodeMultipart()
  const form = new FormData()
  form.append('file', pickedFile('north-bay.txt', 'bin label'))
  const { file_url } = await (await admin.fetch('/api/upload_file', { method: 'POST', body: form })).json() as { file_url: string }
  try {
    const { updated_at } = await admin.get<{ updated_at: string }>(`/api/table/${encodeURIComponent(BIN)}/B1`)
    await admin.post('/api/save_row', { table: BIN, row: { row_id: 'B1', updated_at, photo: file_url } })
    await renderApp(tableHref(BIN), admin)
    await select('North bay')
    const bin = await pane(/^North bay/)
    await within(bin).findByRole('heading', { name: 'Stock' }, T)
    expect(field(bin, 'Photo')!.textContent).toBe(file_url.split('/').pop())
    expect(field(bin, 'Photo')).toHaveTextContent(/north-bay\.txt$/)
  } finally {
    await deleteStored(file_url).catch(() => {})
  }
})

test("a group's rows show a choice by its label", async ({ admin }) => {
  const bin = await openNorthBay(admin)
  fireEvent.click(await within(bin).findByRole('button', { name: `${ITEM} 2` }, T))
  const table = await within(bin).findByRole('table', {}, T)
  await waitFor(() => expect(within(table).getByRole('row', { name: /Hinges/ })).toHaveTextContent('Prime'))
})

test("Enter on a group's row drills to it", async ({ admin }) => {
  const bin = await openNorthBay(admin)
  fireEvent.click(await within(bin).findByRole('button', { name: `${ITEM} 2` }, T))
  const table = await within(bin).findByRole('table', {}, T)
  fireEvent.keyDown(await within(table).findByRole('row', { name: /Hinges/ }, T), { key: 'Enter' })
  expect(await pane(/^Hinges/)).toHaveTextContent(ITEM)
})

test("a key other than Enter on a group's row stays on the bin", async ({ admin }) => {
  const bin = await openNorthBay(admin)
  fireEvent.click(await within(bin).findByRole('button', { name: `${ITEM} 2` }, T))
  const table = await within(bin).findByRole('table', {}, T)
  fireEvent.keyDown(await within(table).findByRole('row', { name: /Hinges/ }, T), { key: 'a' })
  expect(screen.getByRole('complementary', { name: /^North bay/ })).toBeInTheDocument()
})

test("a compact group's row drills to it", async ({ admin }) => {
  const bin = await openNorthBay(admin)
  fireEvent.click(await within(bin).findByRole('button', { name: `${ITEM} 2` }, T))
  await within(bin).findByRole('table', {}, T)
  fireEvent.click(within(bin).getByRole('button', { name: 'Compact' }))
  fireEvent.click(await within(bin).findByRole('button', { name: /^Hinges/ }, T))
  expect(await pane(/^Hinges/)).toHaveTextContent(ITEM)
})

test('Ctrl-click on Open as list is left to the browser, a new tab', async ({ admin }) => {
  const bin = await openNorthBay(admin)
  fireEvent.click(await within(bin).findByRole('button', { name: `${ITEM} 2` }, T))
  const link = await within(bin).findByRole('link', { name: 'Open as list' }, T)
  // fireEvent answers true when no handler took the click (preventDefault).
  expect(fireEvent.click(link, { ctrlKey: true })).toBe(true)
  expect(screen.getByRole('complementary', { name: /^North bay/ })).toBeInTheDocument()
})

test('Filter from the pane keeps the filters the list already had', async ({ admin }) => {
  await seedBins(admin)
  await renderApp(`${tableHref(ITEM)}?filters=${encodeURIComponent(JSON.stringify([['grade', '=', 'Prime']]))}`, admin)
  await select('Hinges')
  const hinges = await pane(/^Hinges/)
  fireEvent.click(await within(hinges).findByRole('button', { name: 'Filter' }, T))
  await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(2))
  await waitFor(() => expect(within(screen.getByTestId('list-rows')).getAllByTestId('row-check')).toHaveLength(1))
  expect(within(screen.getByTestId('list-rows')).getByRole('link', { name: 'Hinges' })).toBeInTheDocument()
})

test('a box left unticked reads No in the pane', async ({ admin }) => {
  await seedBins(admin)
  await admin.post('/api/save_row', { table: BIN, row: { row_id: 'B3', bin_name: 'East bay', sealed: false, spec: 'loose shelving' } })
  await renderApp(tableHref(BIN), admin)
  await select('East bay')
  const bin = await pane(/^East bay/)
  await within(bin).findByRole('heading', { name: 'Stock' }, T)
  expect(field(bin, 'Sealed')).toHaveTextContent(/^No$/)
})

test('JSON holding plain words reads as those words in the pane', async ({ admin }) => {
  await seedBins(admin)
  await admin.post('/api/save_row', { table: BIN, row: { row_id: 'B3', bin_name: 'East bay', sealed: false, spec: 'loose shelving' } })
  await renderApp(tableHref(BIN), admin)
  await select('East bay')
  const bin = await pane(/^East bay/)
  await within(bin).findByRole('heading', { name: 'Stock' }, T)
  expect(field(bin, 'Spec')!.querySelector('code')).toHaveTextContent(/^loose shelving$/)
})

test('on a wide screen the pane sits on the right by default', async ({ admin }) => {
  const real = window.matchMedia
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.startsWith('(min-width:'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  try {
    const bin = await openNorthBay(admin)
    expect(await within(bin).findByRole('button', { name: 'Auto (right)' }, T)).toHaveAttribute('aria-pressed', 'true')
  } finally {
    window.matchMedia = real
  }
})
