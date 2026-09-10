import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { inferTableDef, coerceRows } from 'shared'
import { test } from './pg-test'
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

describe('text identifiers survive the parser and storage (#111/#112)', () => {
  for (const [extension, separator] of [['csv', ','], ['tsv', '\t']]) {
    test(`${extension} preserves mixed codes and unsafe integers through import`, async ({ admin }) => {
      const bytes = new TextEncoder().encode([
        ['Code', 'Identifier', 'Quantity'].join(separator),
        ['007', '9007199254740993', '0.5'].join(separator),
        ['350', '12', '2.25'].join(separator),
      ].join('\n'))
      const [sheet] = await parseWorkbook(asFile(bytes.buffer, `codes.${extension}`))
      expect(sheet.rows).toEqual([['007', '9007199254740993', '0.5'], ['350', '12', '2.25']])
      const def = inferTableDef(`Lexical ${extension}`, sheet.headers, sheet.rows)
      expect(def.columns.map((c) => c.column_type)).toEqual(['Data', 'Data', 'Float'])
      await admin.post('/api/table_def', def)
      const values = coerceRows(def.columns, sheet.rows)
      for (const { values: value } of values) {
        const saved = await admin.post<{ row_id: string }>('/api/save_row', { table: def.name, row: value })
        const stored = await admin.get(`/api/table/${encodeURIComponent(def.name)}/${saved.row_id}`)
        expect(stored).toMatchObject({ code: value.code, identifier: value.identifier, quantity: Number(value.quantity) })
      }
    })
  }

  it('native XLSX numeric cells remain numeric', async () => {
    const [sheet] = await parseWorkbook(fileFrom([['Quantity'], [7], [2.25]]))
    expect(sheet.rows).toEqual([[7], [2.25]])
    expect(inferTableDef('Numbers', sheet.headers, sheet.rows).columns[0].column_type).toBe('Float')
  })
})

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

// #198 — a workbook hides sheets, and the overview must be able to say so.
// Reading wb.Workbook.Sheets is the only way to know; SheetJS reports
// Hidden: 0 visible, 1 hidden, 2 very hidden, index-aligned with SheetNames.
describe('#198: parseWorkbook reports each sheet visibility', () => {
  // book_append_sheet does not write sheet properties, so set them the way a
  // real workbook carries them — one entry per sheet, in SheetNames order.
  function workbookWith(hidden: (0 | 1 | 2 | undefined)[], names: string[]): File {
    const wb = XLSX.utils.book_new()
    names.forEach((n) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['H'], ['x']]), n))
    wb.Workbook = { Sheets: hidden.map((h) => (h === undefined ? {} : { Hidden: h })) }
    return asFile(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'wb.xlsx')
  }

  it('separates visible, hidden and very hidden', async () => {
    const sheets = await parseWorkbook(workbookWith([0, 1, 2], ['Open', 'Tucked', 'Buried']))
    expect(sheets.map((s) => [s.sheetName, s.visibility])).toEqual([
      ['Open', 'visible'],
      ['Tucked', 'hidden'],
      ['Buried', 'very-hidden'],
    ])
  })

  it('a workbook carrying no sheet properties reads as all visible', async () => {
    // Written by a tool that omits them; absence must not throw or mislead.
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['H'], ['x']]), 'Only')
    delete wb.Workbook
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const sheets = await parseWorkbook(asFile(buf, 'plain.xlsx'))
    expect(sheets.map((s) => s.visibility)).toEqual(['visible'])
  })

  it('visibility follows the sheet, not its position, when a sheet is skipped', async () => {
    // An all-blank sheet is dropped (see above), so a naive index into
    // Workbook.Sheets would shift every visibility after it by one.
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['', '']]), 'Blank')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['H'], ['x']]), 'Real')
    wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] }
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const sheets = await parseWorkbook(asFile(buf, 'skip.xlsx'))
    expect(sheets.map((s) => [s.sheetName, s.visibility])).toEqual([['Real', 'hidden']])
  })
})
