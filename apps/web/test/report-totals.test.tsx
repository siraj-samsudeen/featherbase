// #330: the summary view shows at most 500 rows, but its counts, sums, chart
// and export cover every matching row, and it says when rows are left out.
// URL.createObjectURL is a browser API jsdom lacks; the spy hands back the
// exported Blob so the test reads what the person would download.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { sql } from 'server/src/db'
import { invalidateSources } from 'server/src/sources/registry'
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

  // Ungrouped export reads pages by id but must restore newest-change-first
  // order. Put the lexically last id first by date: sorting by id would fail.
  const [newest] = await sql<{ row_id: string }[]>`select row_id from featherbase.rpt_totals_sale order by row_id desc limit 1`
  await sql`update featherbase.rpt_totals_sale set updated_at = '2099-01-01T00:00:00Z' where row_id = ${newest.row_id}`
  await userEvent.selectOptions(screen.getByTestId('report-groupby'), '')
  await userEvent.click(screen.getByTestId('export-csv'))
  await waitFor(() => expect(blobs).toHaveLength(2))
  const ungrouped = (await textOf(blobs[1])).split('\n')
  expect(ungrouped).toHaveLength(503)
  expect(ungrouped[1].split(',')[0]).toBe(newest.row_id)
  expect(new Set(ungrouped.slice(1, -1).map((line) => line.split(',')[0])).size).toBe(501)
  expect(ungrouped.at(-1)).toBe('Total (501),,1203')
})

test('check values and absent text retain their meaning in the report and CSV', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: T,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'ready', column_type: 'Check', label: 'Ready', in_list_view: true },
      { column_name: 'notes', column_type: 'Data', label: 'Notes', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: T, row: { row_id: 'ready', ready: true } })
  await admin.post('/api/save_row', { table: T, row: { row_id: 'waiting', ready: false, notes: 'Pending' } })
  const blobs = captureDownloads()
  await renderApp(`/featherbase/admin/${ENC}/view/report`, admin)
  await screen.findByText('Pending')
  expect(screen.getByText('✓')).toBeInTheDocument()
  expect(screen.getByText('—')).toBeInTheDocument()
  await userEvent.click(screen.getByTestId('export-csv'))
  await waitFor(() => expect(blobs).toHaveLength(1))
  const [header, ...rows] = (await textOf(blobs[0])).split('\n')
  expect(header).toBe('Name,Ready,Notes')
  expect(rows.sort()).toEqual(['ready,true,', 'waiting,false,Pending'])
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
  const dir = mkdtempSync(join(tmpdir(), 'report-source-'))
  process.env.REPORT_FIXTURE_URL = join(dir, 'sales.duckdb')
  try {
    const instance = await DuckDBInstance.create(process.env.REPORT_FIXTURE_URL)
    const connection = await instance.connect()
    await connection.run(`create table sales as select n as id,
      case when n <= 300 then 'North' else 'South' end as region,
      case when n <= 300 then 2 else 3 end as amount,
      timestamp '2026-01-01' + n * interval '1 second' as updated_at from range(1, 502) t(n)`)
    connection.closeSync()
    instance.closeSync()
    await admin.post('/api/table/Data%20Source', { row_id: 'report-fallback', engine: 'duckdb', url_env: 'REPORT_FIXTURE_URL', access: 'read_only' })
    const reflected = await admin.post<{ created: { name: string }[] }>('/api/table/Data%20Source/report-fallback:reflect', { schema: 'sales.main', tables: ['sales'] })
    expect(reflected.created).toHaveLength(1)
    const blobs = captureDownloads()
    await renderApp(`/featherbase/admin/${encodeURIComponent(reflected.created[0].name)}/view/report`, admin)
    await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(500))
    await waitFor(() => expect(screen.getByTestId('report-shown-note')).toHaveTextContent(
      'Showing the first 500 of 501 rows. The counts and totals cover only these 500; the export has all 501.',
    ))
    expect(screen.getByTestId('report-grand-total')).toHaveTextContent('Total (500)')
    await userEvent.click(screen.getByTestId('export-csv'))
    await waitFor(() => expect(blobs).toHaveLength(1))
    const lines = (await textOf(blobs[0])).trim().split('\n')
    expect(lines).toHaveLength(503)
    const amount = lines[0].split(',').findIndex((label) => label.toLowerCase().includes('amount'))
    expect(amount).toBeGreaterThan(0)
    expect(lines.at(-1)!.split(',')[0]).toBe('Total (501)')
    expect(lines.at(-1)!.split(',')[amount]).toBe('1203')
  } finally {
    invalidateSources()
    delete process.env.REPORT_FIXTURE_URL
    rmSync(dir, { recursive: true, force: true })
  }
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
  for (const [area, amount] of [['A', 2], ['', 3], [null, 5]])
    await admin.post('/api/save_row', { table: T, row: { area, amount } })
  // Saving normalizes an empty string to NULL. Persist both representations
  // to exercise distinct server groups that share the displayed empty label.
  await sql`update featherbase.rpt_totals_sale set area = '' where amount = 3`
  // NULL sorts after the page boundary, so the displayed empty group must
  // use server counts and sums, not coincidentally equal page-local values.
  await sql`insert into featherbase.rpt_totals_sale (row_id, area, amount)
    select 'report-extra-' || n, 'A', 2 from generate_series(1, 498) n`
  await renderApp(`/featherbase/admin/${ENC}/view/report`, admin)
  await screen.findByTestId('report-view', {}, { timeout: 8000 })
  await userEvent.selectOptions(screen.getByTestId('report-groupby'), 'area')
  await waitFor(() => expect(within(groupHeader('(empty)')).getByTestId('group-count')).toHaveTextContent('(2)'))
  expect(within(groupHeader('(empty)')).getByTestId('group-sum-amount')).toHaveTextContent('8')
  // The stored empty string sorts before A; its later NULL group joins it.
  expect(screen.getAllByTestId('group-header').map((h) => h.dataset.group)).toEqual(['(empty)', 'A'])
  // Rows and summary totals arrive through independent requests.
  await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(500))
})
