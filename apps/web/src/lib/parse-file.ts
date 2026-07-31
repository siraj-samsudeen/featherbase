// IMP-006: parse a dropped CSV/Excel file into headers + rows in the browser.
// SheetJS handles both formats; dynamically imported (like ReportView's
// export) so the parser stays out of the main bundle.

export interface ParsedSheet {
  sheetName: string
  headers: string[]
  rows: unknown[][]
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
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      defval: null,
      blankrows: false,
    })
    if (!grid.length) continue
    const [headerRow, ...rows] = grid
    const headers = (headerRow as unknown[]).map((h) => (h == null ? '' : String(h)))
    if (!headers.some((h) => h.trim())) continue
    sheets.push({ sheetName, headers, rows })
  }
  if (!sheets.length)
    throw new Error('The file has no sheet with a header row and data')
  return sheets
}

export async function parseTabularFile(file: File): Promise<ParsedSheet> {
  const sheets = await parseWorkbook(file)
  return sheets[0]
}
