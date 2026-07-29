// IMP-006: parse a dropped CSV/Excel file into headers + rows in the browser.
// SheetJS handles both formats; dynamically imported (like ReportView's
// export) so the parser stays out of the main bundle.

export interface ParsedSheet {
  headers: string[]
  rows: unknown[][]
}

const ACCEPTED = /\.(csv|tsv|xlsx|xlsm|xls)$/i

export function isImportableFile(name: string): boolean {
  return ACCEPTED.test(name)
}

export async function parseTabularFile(file: File): Promise<ParsedSheet> {
  const XLSX = await import('xlsx')
  // cellDates keeps Excel date cells as JS Dates instead of serial numbers,
  // which is what the shared type inference expects.
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('The file has no sheets')
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    defval: null,
    blankrows: false,
  })
  if (!grid.length) throw new Error('The file is empty')
  const [headerRow, ...rows] = grid
  const headers = (headerRow as unknown[]).map((h) => (h == null ? '' : String(h)))
  if (!headers.some((h) => h.trim()))
    throw new Error('The first row must contain column headers')
  return { headers, rows }
}
