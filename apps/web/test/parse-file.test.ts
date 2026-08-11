import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  countDataRows,
  excelRow,
  isBlankRow,
  parseWorkbook,
} from '../src/lib/parse-file'

// #115 — the parse tier's half of row-number truth: sheet geometry is
// preserved (blank rows survive), and headerExcelRow makes the numbering
// honest even when the header is not row 1. The spec review flagged this
// path as untested; these are its witnesses.

// jsdom's File lacks arrayBuffer(); patch the instance rather than the code
// under test.
function asFile(buf: ArrayBuffer, name: string): File {
  const file = new File([buf], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  if (typeof file.arrayBuffer !== 'function')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

function fileFrom(aoa: unknown[][], name = 'test.xlsx'): File {
  const ws = XLSX.utils.aoa_to_sheet(aoa as unknown[][])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return asFile(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, name)
}

describe('#115: parseWorkbook keeps sheet geometry', () => {
  it('a blank data row survives as a row, and counts as no data', async () => {
    const [sheet] = await parseWorkbook(
      fileFrom([
        ['H1', 'H2'], // Excel row 1 — header
        ['a', 1], //      row 2
        ['', ''], //      row 3 — blank
        ['b', 2], //      row 4
      ]),
    )
    expect(sheet.headerExcelRow).toBe(1)
    expect(sheet.rows).toHaveLength(3) // geometry: blank included
    expect(isBlankRow(sheet.rows[1])).toBe(true)
    expect(countDataRows(sheet.rows)).toBe(2)
    // The bad-row arithmetic the wizard displays: source index 2 ('b') is
    // Excel row 4 — the blank above it shifts nothing.
    expect(excelRow(2, sheet.headerExcelRow)).toBe(4)
  })

  it('blank rows above the header are counted, not kept — numbering stays Excel-true', async () => {
    const [sheet] = await parseWorkbook(
      fileFrom([
        ['', ''], //      Excel row 1 — blank
        ['', ''], //      row 2 — blank
        ['H1', 'H2'], //  row 3 — header
        ['a', 1], //      row 4
        ['', ''], //      row 5 — blank
        ['b', 2], //      row 6
      ]),
    )
    expect(sheet.headerExcelRow).toBe(3)
    expect(sheet.headers).toEqual(['H1', 'H2'])
    expect(sheet.rows).toHaveLength(3) // rows 4..6, blank at index 1 kept
    expect(countDataRows(sheet.rows)).toBe(2)
    // 'b' sits at source index 2 → Excel row 6, through the offset header.
    expect(excelRow(2, sheet.headerExcelRow)).toBe(6)
  })

  it('an all-blank sheet is skipped entirely', async () => {
    const wsA = XLSX.utils.aoa_to_sheet([['', ''], ['', '']])
    const wsB = XLSX.utils.aoa_to_sheet([['H'], ['x']])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsA, 'Blank')
    XLSX.utils.book_append_sheet(wb, wsB, 'Real')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const sheets = await parseWorkbook(asFile(buf, 'two.xlsx'))
    expect(sheets.map((s) => s.sheetName)).toEqual(['Real'])
  })
})
