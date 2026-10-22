// #387: an Excel date cell must import as the calendar day the sheet shows, on
// every machine. Under TZ=Asia/Kolkata, SheetJS `cellDates: true` (xlsx 0.18.5)
// turned 21-Oct-2024 into 20-Oct 23:59:50 local, so imports stored the day before.
process.env.TZ = 'Asia/Kolkata'

import * as XLSX from 'xlsx'
import { describe, expect, test } from 'vitest'
import { coerceRows } from 'shared'
import { parseWorkbook } from '../src/lib/parse-file'
import { previewCell } from '../src/pages/ImportWizard'

/** A workbook whose cells are real Excel dates: serial numbers with a date number format. */
function workbookFile(cells: [number, string][]): File {
  const ws: XLSX.WorkSheet = { '!ref': `A1:A${cells.length + 1}`, A1: { t: 's', v: 'when' } }
  cells.forEach(([serial, format], i) => (ws[`A${i + 2}`] = { t: 'n', v: serial, z: format }))
  const buf = XLSX.write({ SheetNames: ['S'], Sheets: { S: ws } }, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return { name: 'dates.xlsx', arrayBuffer: async () => buf } as unknown as File
}

const local = (d: unknown) => {
  const x = d as Date
  return [x.getFullYear(), x.getMonth() + 1, x.getDate(), x.getHours(), x.getMinutes(), x.getSeconds()]
}

describe('Excel dates in IST (+05:30)', () => {
  test('the clock really is IST', () => {
    expect(new Date(2024, 9, 21).getTimezoneOffset()).toBe(-330)
  })

  test.each([
    [45586, '21-Oct-2024', [2024, 10, 21]],
    [45351, '29-Feb-2024 (leap day)', [2024, 2, 29]],
    [45322, '31-Jan-2024 (month end)', [2024, 1, 31]],
    [45657, '31-Dec-2024 (year end)', [2024, 12, 31]],
    [45658, '01-Jan-2025', [2025, 1, 1]],
  ])('serial %i (%s) reads as that local day at midnight', async (serial, _label, ymd) => {
    const [sheet] = await parseWorkbook(workbookFile([[serial, 'dd-mmm-yyyy']]))
    expect(local(sheet.rows[0][0])).toEqual([...ymd, 0, 0, 0])
  })

  test('a date with a time keeps its exact local time, just before midnight', async () => {
    const [sheet] = await parseWorkbook(workbookFile([[45657.99998, 'yyyy-mm-dd hh:mm:ss']]))
    expect(local(sheet.rows[0][0])).toEqual([2024, 12, 31, 23, 59, 58])
  })

  test('imported rows store the sheet’s day, not the day before', async () => {
    const [sheet] = await parseWorkbook(workbookFile([[45586, 'dd-mmm-yyyy'], [45658, 'dd-mmm-yyyy']]))
    const rows = coerceRows([{ column_name: 'when', column_type: 'Date' }], sheet.rows)
    expect(rows.map((r) => r.values.when)).toEqual(['2024-10-21', '2025-01-01'])
  })

  test('the import preview shows the sheet’s day', async () => {
    const [sheet] = await parseWorkbook(workbookFile([[45586, 'dd-mmm-yyyy']]))
    expect(previewCell(sheet.rows[0][0])).toBe('2024-10-21')
  })

  test('a number that is not a date stays a number', async () => {
    const [sheet] = await parseWorkbook(workbookFile([[45586, '0.00']]))
    expect(sheet.rows[0][0]).toBe(45586)
  })
})
