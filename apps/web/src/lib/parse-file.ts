// IMP-006: parse a dropped CSV/Excel file into headers + rows in the browser.
// SheetJS handles both formats; dynamically imported (like ReportView's
// export) so the parser stays out of the main bundle.

export interface ParsedSheet {
  sheetName: string
  headers: string[]
  rows: unknown[][]
  // 1-based Excel row of the header. Data row i (0-based, blanks included)
  // sits at Excel row headerExcelRow + 1 + i — the ONLY row arithmetic
  // downstream code may do (#115: users see Excel's numbers, nothing else).
  headerExcelRow: number
}

// A row with at least one non-empty cell — what the imports will act on.
// Counts shown to the user use this, never raw .length (#115: blank rows
// survive parsing to keep row numbers true, but they are not data).
export function countDataRows(rows: unknown[][]): number {
  return rows.filter((r) => r.some((c) => c != null && String(c).trim() !== '')).length
}

const ACCEPTED = /\.(csv|tsv|xlsx|xlsm|xls)$/i

export function isImportableFile(name: string): boolean {
  return ACCEPTED.test(name)
}

// IMP-010: parse every non-empty sheet — a multi-sheet workbook yields one
// ParsedSheet per sheet, a CSV exactly one.
export async function parseWorkbook(file: File): Promise<ParsedSheet[]> {
  const XLSX = await import('xlsx')
  // cellDates keeps Excel date cells as JS Dates instead of serial numbers,
  // which is what the shared type inference expects.
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  if (!wb.SheetNames.length) throw new Error('The file has no sheets')
  const sheets: ParsedSheet[] = []
  for (const sheetName of wb.SheetNames) {
    // #115: blankrows: true keeps the sheet's real geometry — a blank row
    // survives as all-nulls instead of silently vanishing and shifting
    // every row number below it. coerceRows is the single place blanks are
    // dropped, and it records each survivor's source index.
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      defval: null,
      blankrows: true,
    })
    // The header is the first non-blank row; blank rows above it are
    // counted (headerExcelRow), never kept.
    const isBlank = (r: unknown[]) => !r.some((c) => c != null && String(c).trim() !== '')
    let h = 0
    while (h < grid.length && isBlank(grid[h])) h++
    if (h === grid.length) continue
    const headers = grid[h].map((c) => (c == null ? '' : String(c)))
    sheets.push({ sheetName, headers, rows: grid.slice(h + 1), headerExcelRow: h + 1 })
  }
  if (!sheets.length)
    throw new Error('The file has no sheet with a header row and data')
  return sheets
}

export async function parseTabularFile(file: File): Promise<ParsedSheet> {
  const sheets = await parseWorkbook(file)
  return sheets[0]
}
