// IMP-006: parse a dropped CSV/Excel file into headers + rows in the browser.
// SheetJS handles both formats; dynamically imported (like ReportView's
// export) so the parser stays out of the main bundle.
//
// #115: this module owns row-number truth. Sheet geometry is preserved
// (blank rows included), and the two exported helpers below — isBlankRow
// and excelRow — are the only blank-row predicate and the only
// index→row-number arithmetic anywhere; every consumer imports them.

// #198: what the workbook itself said about showing this sheet. 'very-hidden'
// is set deliberately (from VBA, and not undoable through Excel's UI), so it
// stays distinct from an ordinary hidden sheet rather than being flattened
// into it — the overview says which.
export type SheetVisibility = 'visible' | 'hidden' | 'very-hidden'

export interface ParsedSheet {
  sheetName: string
  headers: string[]
  rows: unknown[][]
  // 1-based Excel row of the header. Data row i (0-based, blanks included)
  // sits at Excel row excelRow(i, headerExcelRow) — see below.
  headerExcelRow: number
  // #198: reported, never acted on here. A CSV, and any workbook written
  // without sheet properties, is 'visible' throughout.
  visibility: SheetVisibility
}

// The one definition of "blank": no cell with visible content.
export function isBlankRow(row: unknown[]): boolean {
  return !row.some((c) => c != null && String(c).trim() !== '')
}

// The one index→row-number translation (#115): a data row's source index
// (0-based, blanks included) to the row number the user sees in Excel —
// correct even when blank rows sit above the header.
export function excelRow(sourceIndex: number, headerExcelRow: number): number {
  return headerExcelRow + 1 + sourceIndex
}

// A row with at least one non-empty cell — what the imports will act on.
// Counts shown to the user use this, never raw .length (#115: blank rows
// survive parsing to keep row numbers true, but they are not data).
export function countDataRows(rows: unknown[][]): number {
  return rows.filter((r) => !isBlankRow(r)).length
}

const ACCEPTED = /\.(csv|tsv|xlsx|xlsm|xls)$/i

export function isImportableFile(name: string): boolean {
  return ACCEPTED.test(name)
}

// SheetJS carries sheet properties in wb.Workbook.Sheets, index-aligned with
// wb.SheetNames — `Hidden` is 0 visible, 1 hidden, 2 very hidden. The array is
// absent for CSVs and for workbooks written by tools that omit it, and may be
// shorter than SheetNames; every one of those reads as visible.
function visibilityOf(props: { Hidden?: number } | undefined): SheetVisibility {
  if (props?.Hidden === 2) return 'very-hidden'
  if (props?.Hidden === 1) return 'hidden'
  return 'visible'
}

/**
 * #387: every numeric cell with a date number format becomes a local Date
 * built from the serial's own y/m/d h:m:s (SSF.parse_date_code, no timezone),
 * so a date-only cell is local midnight of the day the sheet shows, which the
 * shared inference and coercion read back as that day.
 */
function calendarDates(XLSX: typeof import('xlsx'), sheet: import('xlsx').WorkSheet, date1904: boolean) {
  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) continue
    const cell = sheet[address] as import('xlsx').CellObject
    if (cell.t !== 'n' || typeof cell.v !== 'number' || !cell.z || !XLSX.SSF.is_date(cell.z)) continue
    const p = XLSX.SSF.parse_date_code(cell.v, { date1904 })
    if (!p) continue
    cell.t = 'd'
    cell.v = new Date(p.y, p.m - 1, p.d, p.H, p.M, p.S)
  }
}

// IMP-010: parse every non-empty sheet — a multi-sheet workbook yields one
// ParsedSheet per sheet, a CSV exactly one.
export async function parseWorkbook(file: File): Promise<ParsedSheet[]> {
  const XLSX = await import('xlsx')
  // #387: date cells are read as serial numbers WITH their number format
  // (cellDates: false, cellNF: true) and turned into calendar dates below.
  // SheetJS's own cellDates conversion shifts them across timezones: under
  // Asia/Kolkata (xlsx 0.18.5) 21-Oct-2024 became 20-Oct 23:59:50 local, so
  // every import stored the day before.
  // raw applies to text formats at READ time: sheet_to_json cannot recover
  // padding or precision after SheetJS has already converted a CSV/TSV cell.
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, cellNF: true, raw: true })
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904)
  if (!wb.SheetNames.length) throw new Error('The file has no sheets')
  const sheets: ParsedSheet[] = []
  // #198: read visibility by the sheet's own index in SheetNames, before any
  // sheet is dropped below. Indexing the props array as sheets are pushed
  // would shift every visibility after a skipped sheet by one.
  const sheetProps = wb.Workbook?.Sheets
  for (const [sheetIndex, sheetName] of wb.SheetNames.entries()) {
    // #115: blankrows: true keeps the sheet's real geometry — a blank row
    // survives as all-nulls instead of silently vanishing and shifting
    // every row number below it. coerceRows is the single place blanks are
    // dropped, and it records each survivor's source index.
    calendarDates(XLSX, wb.Sheets[sheetName], date1904)
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      defval: null,
      blankrows: true,
    })
    // The header is the first non-blank row; blank rows above it are
    // counted (headerExcelRow), never kept.
    let h = 0
    while (h < grid.length && isBlankRow(grid[h])) h++
    if (h === grid.length) continue
    const headers = grid[h].map((c) => (c == null ? '' : String(c)))
    sheets.push({
      sheetName,
      headers,
      rows: grid.slice(h + 1),
      headerExcelRow: h + 1,
      visibility: visibilityOf(sheetProps?.[sheetIndex]),
    })
  }
  if (!sheets.length)
    throw new Error('The file has no sheet with a header row and data')
  return sheets
}

export async function parseTabularFile(file: File): Promise<ParsedSheet> {
  const sheets = await parseWorkbook(file)
  return sheets[0]
}
