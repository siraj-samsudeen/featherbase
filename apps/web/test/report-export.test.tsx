// RPT-003: the CSV and XLSX a grouped report exports match the rows on screen,
// in the same grouping order, with group and grand totals. The page builds the
// file itself; URL.createObjectURL (absent in jsdom) is replaced to hand back
// the Blob a person would download.
import { tableSlug } from 'shared'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { afterEach } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const DT = 'RPT Export Task'

afterEach(() => {
  // @ts-expect-error jsdom has neither; the test installs them
  delete URL.createObjectURL
  // @ts-expect-error see above
  delete URL.revokeObjectURL
})

function captureDownloads(): Blob[] {
  const blobs: Blob[] = []
  URL.createObjectURL = (b: Blob) => {
    blobs.push(b)
    return 'blob:report'
  }
  URL.revokeObjectURL = () => {}
  return blobs
}

// jsdom's Blob has no text() or arrayBuffer(); FileReader reads it as a browser would.
function read(blob: Blob, as: 'text'): Promise<string>
function read(blob: Blob, as: 'bytes'): Promise<ArrayBuffer>
function read(blob: Blob, as: 'text' | 'bytes'): Promise<string | ArrayBuffer> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string | ArrayBuffer)
    if (as === 'text') reader.readAsText(blob)
    else reader.readAsArrayBuffer(blob)
  })
}

test('RPT-003: the CSV and XLSX exports match the on-screen rows and grouping order', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
      { column_name: 'stage', column_type: 'Choice', label: 'Status', choices: 'Open\nClosed', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
    ],
  })
  for (const [title, stage, qty] of [['alpha', 'Open', 1], ['bravo', 'Open', 2], ['charlie', 'Closed', 5]] as const)
    await admin.post(`/api/table/${encodeURIComponent(DT)}`, { title, stage, qty })
  const blobs = captureDownloads()
  const user = userEvent.setup()
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/view/report`, admin)
  await screen.findByTestId('report-view', {}, { timeout: 8000 })
  await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(3))
  await user.selectOptions(screen.getByTestId('report-groupby'), 'stage')
  await waitFor(() => expect(screen.getAllByTestId('group-header')).toHaveLength(2))

  // On-screen order: each row's title, and the groups top to bottom.
  const screenTitles = screen.getAllByTestId('report-row').map((row) => row.querySelectorAll('td')[1].textContent!.trim())
  const screenGroups = screen.getAllByTestId('group-header').map((g) => g.dataset.group!)

  await user.click(screen.getByTestId('export-csv'))
  await waitFor(() => expect(blobs).toHaveLength(1))
  const lines = (await read(blobs[0], 'text')).split('\n')
  expect(lines[0]).toBe('Name,Title,Status,Qty')
  expect(lines.slice(1).map((l) => l.split(',')[1]).filter((t) => t)).toEqual(screenTitles)
  const groupLines = lines.filter((l) => /^\w+ \(\d+\)/.test(l))
  expect(groupLines).toHaveLength(3) // 2 groups + grand total
  expect(groupLines[0].startsWith(`${screenGroups[0]} (`)).toBe(true)
  expect(groupLines[1].startsWith(`${screenGroups[1]} (`)).toBe(true)
  const sums = Object.fromEntries(groupLines.map((l) => {
    const cells = l.split(',')
    return [cells[0].split(' (')[0], cells[3]]
  }))
  expect(sums).toEqual({ Open: '3', Closed: '5', Total: '8' })

  await user.click(screen.getByTestId('export-xlsx'))
  await waitFor(() => expect(blobs).toHaveLength(2))
  const wb = XLSX.read(new Uint8Array(await read(blobs[1], 'bytes')), { type: 'array' })
  const grid = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 })
  expect(grid[0]).toEqual(['Name', 'Title', 'Status', 'Qty'])
  expect(grid.slice(1).map((r) => r[1]).filter((t) => t != null && t !== '')).toEqual(screenTitles)
})
