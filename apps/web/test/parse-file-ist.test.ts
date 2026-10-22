// #387: an Excel date cell must import as the calendar day the sheet shows, on
// every machine. Under TZ=Asia/Kolkata, SheetJS `cellDates: true` (xlsx 0.18.5)
// turned 21-Oct-2024 into 20-Oct 23:59:50 local, so imports stored the day before.
process.env.TZ = 'Asia/Kolkata'

import * as XLSX from 'xlsx'
import { describe, expect, test } from 'vitest'
import { coerceRows, inferColumnType } from 'shared'
import { parseWorkbook } from '../src/lib/parse-file'
import { previewCell } from '../src/pages/ImportWizard'

/** A workbook whose cells are real Excel dates: serial numbers with a date number format. */
function workbookFile(cells: [number, string][], date1904 = false): File {
  const ws: XLSX.WorkSheet = { '!ref': `A1:A${cells.length + 1}`, A1: { t: 's', v: 'when' } }
  cells.forEach(([serial, format], i) => (ws[`A${i + 2}`] = { t: 'n', v: serial, z: format }))
  const wb: XLSX.WorkBook = { SheetNames: ['S'], Sheets: { S: ws }, Workbook: { WBProps: { date1904 } } }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return { name: 'dates.xlsx', arrayBuffer: async () => buf } as unknown as File
}

describe('Excel dates in IST (+05:30)', () => {
  test('the clock really is IST', () => {
    expect(new Date(2024, 9, 21).getTimezoneOffset()).toBe(-330)
  })

  test.each([
    [45586, '21-Oct-2024', '2024-10-21'],
    [45351, '29-Feb-2024 (leap day)', '2024-02-29'],
    [45322, '31-Jan-2024 (month end)', '2024-01-31'],
    [45657, '31-Dec-2024 (year end)', '2024-12-31'],
    [45658, '01-Jan-2025', '2025-01-01'],
  ])('serial %i (%s) reads as that day, with no time and no timezone', async (serial, _label, day) => {
    const [sheet] = await parseWorkbook(workbookFile([[serial, 'dd-mmm-yyyy']]))
    expect(sheet.rows[0][0]).toBe(day)
  })

  test.each([
    ['America/Sao_Paulo', 43408, '2018-11-04'], // that day's local midnight did not exist (DST began)
    ['Pacific/Apia', 40907, '2011-12-30'], // Samoa skipped this day entirely
  ])('in %s, serial %i still reads as %s, and as a date', async (tz, serial, day) => {
    const before = process.env.TZ
    process.env.TZ = tz
    try {
      const [sheet] = await parseWorkbook(workbookFile([[serial, 'dd-mmm-yyyy']]))
      expect(sheet.rows[0][0]).toBe(day)
      expect(inferColumnType([sheet.rows[0][0]])).toBe('Date')
    } finally {
      process.env.TZ = before
    }
  })

  test.each([
    [1, '1900-01-01'],
    [59, '1900-02-28'],
    [60, '1900-02-29'], // Excel's fictitious leap day, shown as the sheet shows it
    [61, '1900-03-01'],
  ])('1900 date system: serial %i reads as %s', async (serial, day) => {
    const [sheet] = await parseWorkbook(workbookFile([[serial, 'yyyy-mm-dd']]))
    expect(sheet.rows[0][0]).toBe(day)
  })

  test('a 1904-based workbook counts from 01-Jan-1904', async () => {
    const [sheet] = await parseWorkbook(workbookFile([[44124, 'yyyy-mm-dd']], true)) // 21-Oct-2024 in the 1904 system
    expect(sheet.rows[0][0]).toBe('2024-10-21')
  })

  test('a conditional format section is chosen by its condition, as Excel does', async () => {
    const fmt = '[<=45586]yyyy-mm-dd hh:mm;yyyy-mm-dd'
    // 45585.5 meets [<=45586] and shows a time; 45587.5 does not and shows only the day (as SheetJS renders them).
    const [sheet] = await parseWorkbook(workbookFile([[45585.5, fmt], [45587.5, fmt]]))
    expect(sheet.rows.map((r) => r[0])).toEqual(['2024-10-20T12:00:00', '2024-10-22'])
  })

  test.each(['[m]', '[h]:mm', '[s]'])('an elapsed-time format (%s) is a duration, so the number is kept', async (fmt) => {
    const [sheet] = await parseWorkbook(workbookFile([[0.5, fmt]]))
    expect(sheet.rows[0][0]).toBe(0.5)
  })

  test('an escaped semicolon is part of the format, not a section break', async () => {
    const [sheet] = await parseWorkbook(workbookFile([[45586.5, 'yyyy-mm-dd\\;hh:mm;hh:mm']]))
    expect(sheet.rows[0][0]).toBe('2024-10-21T12:00:00')
  })

  test('a date-only cell never carries a hidden time into the next day', async () => {
    const [sheet] = await parseWorkbook(workbookFile([[45586.9999999943, 'yyyy-mm-dd']]))
    expect(sheet.rows[0][0]).toBe('2024-10-21')
  })

  test('a time-only cell (serial below 1) is a valid date-time on Excel’s day zero', async () => {
    const [sheet] = await parseWorkbook(workbookFile([[0.5, 'h:mm']]))
    expect(sheet.rows[0][0]).toBe('1899-12-31T12:00:00')
    expect(inferColumnType([sheet.rows[0][0]])).toBe('Datetime')
  })

  test('only the format section that applies to the value is read', async () => {
    // Positive values use the first section (a date); the unused second section would show a time.
    const [sheet] = await parseWorkbook(workbookFile([[45586.75, 'yyyy-mm-dd;hh:mm']]))
    expect(sheet.rows[0][0]).toBe('2024-10-21')
  })

  test('a date with a time is its exact local date-time, seconds and fraction included', async () => {
    const [sheet] = await parseWorkbook(workbookFile([[45657.99998, 'yyyy-mm-dd hh:mm:ss']]))
    expect(sheet.rows[0][0]).toBe('2024-12-31T23:59:58.272')
  })

  test('a time that is exactly UTC midnight in IST (05:30) stays a date-time, never just a day', async () => {
    const [sheet] = await parseWorkbook(workbookFile([[45586 + 5.5 / 24, 'dd-mmm-yyyy hh:mm']]))
    expect(inferColumnType(sheet.rows.map((r) => r[0]))).toBe('Datetime')
    const rows = coerceRows([{ column_name: 'when', column_type: 'Datetime' }], sheet.rows)
    expect(rows[0].values.when).toBe('2024-10-21T05:30:00')
  })

  test('a date-time cell at exactly midnight is still a date-time: the format says so', async () => {
    const [sheet] = await parseWorkbook(workbookFile([[45586, 'yyyy-mm-dd hh:mm:ss'], [45587, 'yyyy-mm-dd hh:mm:ss']]))
    expect(sheet.rows.map((r) => r[0])).toEqual(['2024-10-21T00:00:00', '2024-10-22T00:00:00'])
    expect(inferColumnType(sheet.rows.map((r) => r[0]))).toBe('Datetime')
  })

  test('a fraction that rounds up carries into the next second, and past midnight into the next day', async () => {
    const at = (h: number, m: number, s: number) => (h * 3600 + m * 60 + s) / 86400
    const [sheet] = await parseWorkbook(
      workbookFile([
        [45586 + at(12, 34, 56.9996), 'yyyy-mm-dd hh:mm:ss.000'],
        [45586 + at(23, 59, 59.9996), 'yyyy-mm-dd hh:mm:ss.000'],
      ]),
    )
    expect(sheet.rows.map((r) => r[0])).toEqual(['2024-10-21T12:34:57', '2024-10-22T00:00:00'])
  })

  test('fractional seconds survive', async () => {
    const [sheet] = await parseWorkbook(workbookFile([[45586.5 + 0.123 / 86400, 'yyyy-mm-dd hh:mm:ss.000']]))
    expect(sheet.rows[0][0]).toBe('2024-10-21T12:00:00.123')
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
