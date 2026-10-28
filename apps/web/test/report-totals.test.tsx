// #330: the summary view shows at most 500 rows, but its counts, sums, chart
// and export cover every matching row, and it says when rows are left out.
// URL.createObjectURL is a browser API jsdom lacks; the spy hands back the
// exported Blob so the test reads what the person would download.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const T = 'Rpt Totals Sale'
const ENC = encodeURIComponent(T)

afterEach(() => {
  // @ts-expect-error jsdom has neither; the tests that export install them
  delete URL.createObjectURL
  // @ts-expect-error see above
  delete URL.revokeObjectURL
})

// 501 rows: 300 North at amount 2, 201 South at amount 3 — one more than a list page holds.
async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'region', column_type: 'Choice', label: 'Region', choices: 'North\nSouth', in_list_view: true },
      { column_name: 'amount', column_type: 'Int', label: 'Amount', in_list_view: true },
    ],
  })
  for (let i = 0; i < 501; i++)
    await admin.post('/api/save_row', { table: T, row: i < 300 ? { region: 'North', amount: 2 } : { region: 'South', amount: 3 } })
}

function captureDownloads(): Blob[] {
  const blobs: Blob[] = []
  URL.createObjectURL = (b: Blob) => {
    blobs.push(b)
    return 'blob:report'
  }
  URL.revokeObjectURL = () => {}
  return blobs
}

function textOf(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
}

const groupHeader = (value: string) => {
  const header = screen.getAllByTestId('group-header').find((h) => h.dataset.group === value)
  if (!header) throw new Error(`no group ${value}`)
  return header
}

async function openReport(admin: Admin) {
  await renderApp(`/featherbase/admin/${ENC}/view/report`, admin)
  await screen.findByTestId('report-view', {}, { timeout: 8000 })
  await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(500), { timeout: 8000 })
}

test('the grand total covers every matching row, and the page says only the first 500 are listed', async ({ admin }) => {
  await seed(admin)
  await openReport(admin)
  await waitFor(() => expect(screen.getByTestId('grand-sum-amount')).toHaveTextContent('1,203'))
  expect(screen.getByTestId('report-grand-total')).toHaveTextContent('Total (501)')
  expect(screen.getByTestId('report-shown-note')).toHaveTextContent(
    'Showing the first 500 of 501 rows. The counts, totals, chart and export cover all 501.',
  )
})

test('each group counts and sums all its rows, not only the ones listed', async ({ admin }) => {
  await seed(admin)
  await openReport(admin)
  await userEvent.selectOptions(screen.getByTestId('report-groupby'), 'region')
  await waitFor(() => expect(within(groupHeader('South')).getByTestId('group-count')).toHaveTextContent('(201)'))
  const south = groupHeader('South')
  expect(within(south).getByTestId('group-sum-amount')).toHaveTextContent('603')
  const north = groupHeader('North')
  expect(within(north).getByTestId('group-count')).toHaveTextContent('(300)')
  expect(within(north).getByTestId('group-sum-amount')).toHaveTextContent('600')
  expect(screen.getByTestId('chart-bar-value-South')).toHaveTextContent('201')
})

test('the export has every matching row and the same totals', async ({ admin }) => {
  await seed(admin)
  const blobs = captureDownloads()
  await openReport(admin)
  await userEvent.selectOptions(screen.getByTestId('report-groupby'), 'region')
  await waitFor(() =>
    expect(within(groupHeader('South')).getByTestId('group-count')).toHaveTextContent('(201)'),
  )
  await userEvent.click(screen.getByTestId('export-csv'))
  await waitFor(() => expect(blobs).toHaveLength(1))
  const lines = (await textOf(blobs[0])).split('\n')
  expect(lines).toHaveLength(1 + 2 + 501 + 1)
  // Every row once: 501 distinct names under the two group lines.
  const names = lines.slice(1, -1).filter((l) => !/^(North|South) \(/.test(l)).map((l) => l.split(',')[0])
  expect(new Set(names).size).toBe(501)
  expect(lines[1]).toBe('North (300),,600')
  expect(lines[302]).toBe('South (201),,603')
  expect(lines.at(-1)).toBe('Total (501),,1203')
})

test('a summary that fits on the page says nothing about rows left out', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: T,
    columns: [{ column_name: 'amount', column_type: 'Int', label: 'Amount', in_list_view: true }],
  })
  await admin.post('/api/save_row', { table: T, row: { amount: 5 } })
  await renderApp(`/featherbase/admin/${ENC}/view/report`, admin)
  await waitFor(() => expect(screen.getByTestId('grand-sum-amount')).toHaveTextContent('5'))
  expect(screen.queryByTestId('report-shown-note')).not.toBeInTheDocument()
})

// A connected table whose source can't add up a column has no server totals:
// the summary adds up the rows it lists, and says that is all they cover.
test('without server totals, the summary says its totals cover only the rows listed', async ({ admin }) => {
  await seed(admin)
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) =>
    String(input).includes(':summary')
      ? Response.json({ error: { type: 'ValidationError', message: 'sums are not supported here' } }, { status: 417 })
      : real(input, init),
  )
  await openReport(admin)
  await waitFor(() =>
    expect(screen.getByTestId('report-shown-note')).toHaveTextContent(
      'Showing the first 500 of 501 rows. The counts and totals cover only these 500; the export has all 501.',
    ),
  )
  expect(screen.getByTestId('report-grand-total')).toHaveTextContent('Total (500)')
})

test('an export that cannot read every row says so and downloads nothing', async ({ admin }) => {
  await seed(admin)
  const blobs = captureDownloads()
  await openReport(admin)
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) =>
    String(input).includes('limit_start=')
      ? Response.json({ error: { type: 'PermissionError', message: 'No read permission' } }, { status: 403 })
      : real(input, init),
  )
  await userEvent.click(screen.getByTestId('export-csv'))
  expect(await screen.findByRole('alert')).toHaveTextContent('No read permission')
  expect(blobs).toHaveLength(0)
  expect(screen.getByTestId('export-csv')).toBeEnabled()
})

test('a blank and a missing value are one empty group, with all its rows listed', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'area', column_type: 'Data', label: 'Area', in_list_view: true },
      { column_name: 'amount', column_type: 'Int', label: 'Amount', in_list_view: true },
    ],
  })
  for (const area of ['A', '', null]) await admin.post('/api/save_row', { table: T, row: { area, amount: 1 } })
  await renderApp(`/featherbase/admin/${ENC}/view/report`, admin)
  await screen.findByTestId('report-view', {}, { timeout: 8000 })
  await userEvent.selectOptions(screen.getByTestId('report-groupby'), 'area')
  await waitFor(() => expect(within(groupHeader('(empty)')).getByTestId('group-count')).toHaveTextContent('(2)'))
  expect(screen.getAllByTestId('group-header').map((h) => h.dataset.group)).toEqual(['A', '(empty)'])
  expect(screen.getAllByTestId('report-row')).toHaveLength(3)
})
