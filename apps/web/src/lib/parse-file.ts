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
 * The section of an Excel number format that applies to a value, as SheetJS
 * renders it. Sections are `;`-separated (quoted text and a backslash-escaped `;` do not split).
 * When the first or second section carries a condition such as `[<=45586]`,
 * the first whose condition holds wins; otherwise the sections are
 * positive;negative;zero.
 */
function formatSectionFor(format: string, value: number): string {
  const sections: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < format.length; i++) {
    const ch = format[i]
    if (ch === '\\' && i + 1 < format.length) {
      // A backslash escapes the next character, including a ";".
      current += ch + format[++i]
      continue
    }
    if (ch === '"') quoted = !quoted
    if (ch === ';' && !quoted) {
      sections.push(current)
      current = ''
    } else current += ch
  }
  sections.push(current)
  // SheetJS's choose_fmt, which picks the section it renders: a trailing text
  // (@) section never formats a number; a missing section falls back to the
  // first. Only the first two sections' conditions count; when neither holds,
  // the next section is the fallback.
  const textLast = sections.length < 4 && sections[sections.length - 1].includes('@')
  const s = textLast ? sections.slice(0, -1) : sections
  if (!s.length) return 'General'
  const [pos, neg = pos, third = pos] = s
  const bySign = value > 0 ? pos : value < 0 ? neg : third
  if (!/\[[=<>]/.test(pos) && !/\[[=<>]/.test(neg)) return bySign
  const CONDITION = /\[(=|>=?|<[>=]?)(-?\d+(?:\.\d*)?)\]/
  const holds = (c: RegExpMatchArray | null) => {
    if (!c) return false
    const n = Number(c[2])
    const tests: Record<string, boolean> = { '=': value === n, '>': value > n, '>=': value >= n, '<': value < n, '<=': value <= n, '<>': value !== n }
    return tests[c[1]] ?? false
  }
  const c1 = pos.match(CONDITION)
  const c2 = neg.match(CONDITION)
  if (holds(c1)) return pos
  if (holds(c2)) return neg
  return c1 && c2 ? third : neg
}

/**
 * An Excel serial day as YYYY-MM-DD by pure UTC arithmetic, so no timezone can
 * move it (SSF.parse_date_code builds a local Date and is wrong in zones that
 * skipped a day, such as Samoa on 30-Dec-2011). 1900 system: serial 0 shows as
 * 31-Dec-1899, serial 60 is Excel's fictitious 29-Feb-1900, and serials before
 * it count from 31-Dec-1899; the 1904 system counts from 01-Jan-1904.
 */
function serialDay(day: number, date1904: boolean): string {
  const DAY_MS = 86_400_000
  if (!date1904 && day === 60) return '1900-02-29'
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : day < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30)
  return new Date(epoch + day * DAY_MS).toISOString().slice(0, 10)
}

/** The format's tokens only: drops quoted text, escaped characters (\x), spacing widths (_x) and fill characters (*x). */
function literalFree(section: string): string {
  let out = ''
  for (let i = 0; i < section.length; i++) {
    const c = section[i]
    if (c === '"') {
      const end = section.indexOf('"', i + 1)
      i = end === -1 ? section.length : end
    } else if (c === '\\' || c === '_' || c === '*') i++
    else out += c
  }
  return out
}

/** Does a format section show a time? (hours, seconds, AM/PM; escaped characters, quoted text and [colour] tags ignored) */
function formatShowsTime(section: string): boolean {
  const bare = literalFree(section).replace(/\[(?!h|m|s)[^\]]*\]/gi, '')
  return /[hs]|AM\/PM|A\/P/i.test(bare)
}

/** 31-Dec-9999, the last day Excel can show, in each date system. */
const LAST_SERIAL_1900 = 2_958_465
const LAST_SERIAL_1904 = 2_957_003

/**
 * #387: every numeric cell whose (applicable) number format is a date is read
 * from the serial itself, never through a timezone, and handed on as text:
 * - a format that shows only a date gives `YYYY-MM-DD`, which the shared
 *   inference reads as a Date. Not a local-midnight Date object: in some
 *   timezones a day has no local midnight (São Paulo's DST start) or does not
 *   exist at all (Samoa, 30-Dec-2011); the day comes from serialDay();
 * - a format that shows a time gives the local date-time,
 *   `YYYY-MM-DDTHH:MM:SS[.mmm]`, read as a Datetime, even at 00:00. The time is
 *   the serial's day fraction in whole milliseconds, so a rounded-up
 *   23:59:59.9996 carries into the next day. A time-only cell (serial below 1)
 *   sits on Excel's day zero, 31-Dec-1899.
 */
function calendarDates(XLSX: typeof import('xlsx'), sheet: import('xlsx').WorkSheet, date1904: boolean) {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const DAY_MS = 86_400_000
  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) continue
    const cell = sheet[address] as import('xlsx').CellObject
    if (cell.t !== 'n' || typeof cell.v !== 'number' || !cell.z) continue
    const section = formatSectionFor(String(cell.z), cell.v)
    if (!XLSX.SSF.is_date(section)) continue
    // [h], [m], [s] show elapsed time: a duration, not a date. Keep the number.
    if (/\[(?:h+|m+|s+)\]/i.test(literalFree(section))) continue
    // Excel shows no date before serial 0 or after 31-Dec-9999; such a cell stays a number.
    const lastDay = date1904 ? LAST_SERIAL_1904 : LAST_SERIAL_1900
    if (cell.v < 0 || cell.v >= lastDay + 1) continue
    let day = Math.floor(cell.v)
    if (!formatShowsTime(section)) {
      // A date-only format shows the serial's whole day; a hidden time never moves it.
      cell.t = 's'
      cell.v = serialDay(day, date1904)
      continue
    }
    let ms = Math.round((cell.v - day) * DAY_MS)
    if (ms >= DAY_MS) {
      day += 1
      ms -= DAY_MS
    }
    if (day > lastDay) continue
    cell.t = 's'
    const date = serialDay(day, date1904)
    const H = Math.floor(ms / 3_600_000)
    const M = Math.floor((ms % 3_600_000) / 60_000)
    const S = Math.floor((ms % 60_000) / 1000)
    const frac = ms % 1000
    cell.v = `${date}T${pad(H)}:${pad(M)}:${pad(S)}${frac ? `.${pad(frac, 3)}` : ''}`
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
