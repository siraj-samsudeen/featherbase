// IMP-001: infer a Table definition from tabular file data (CSV/Excel).
// Pure functions shared by the web builder (live preview while the user
// reviews the inferred schema) and exercised by the server test suite.

export interface InferredColumn {
  column_name: string
  label: string
  column_type: string
  choices?: string
  reqd: boolean
  in_list_view: boolean
}

export interface InferredTableDef {
  name: string
  id_pattern: string
  columns: InferredColumn[]
}

// Mirrors the server's STANDARD_COLUMNS (table-engine.ts): user columns can
// never shadow these, so inferred names step aside with a numeric suffix.
// #132: the row key is 'row_id'; 'name' is a legal user column again.
const RESERVED_COLUMN_NAMES = new Set([
  'row_id',
  'created_by',
  'created_at',
  'updated_at',
  'updated_by',
  'status',
  'position',
  'parent',
  'parenttype',
  'parentfield',
])

// Header -> snake_case matching the server's /^[a-z][a-z0-9_]{0,63}$/ rule.
export function sanitizeColumnName(header: string): string {
  const base = header
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2') // camelCase -> camel_case
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
  const named = /^[a-z]/.test(base) ? base : base ? `col_${base}` : ''
  return named.slice(0, COLUMN_NAME_MAX)
}

// Sanitize a whole header row: blanks become col_N, duplicates and reserved
// names get numeric suffixes, so the result is always a valid, unique set.
export function sanitizeHeaders(headers: string[]): string[] {
  const taken = new Set<string>()
  return headers.map((h, i) => {
    let candidate = sanitizeColumnName(h) || `col_${i + 1}`
    if (RESERVED_COLUMN_NAMES.has(candidate) || taken.has(candidate)) {
      let n = 1
      while (taken.has(`${candidate}_${n}`) || RESERVED_COLUMN_NAMES.has(`${candidate}_${n}`)) n++
      candidate = `${candidate}_${n}`.slice(0, COLUMN_NAME_MAX)
    }
    taken.add(candidate)
    return candidate
  })
}

// IMP-012: consistent human labels from however messy the file header was —
// underscores/camelCase become spaces, lone-case words are Title-Cased,
// short all-caps words (ID, SKU, URL) and mixed tokens like "(kg)" survive
// untouched. "Reg_District_ID" -> "Reg District ID", "Active_flag" ->
// "Active Flag", "unitPrice" -> "Unit Price", "Qty (kg)" -> "Qty (kg)".
export function prettifyLabel(header: string): string {
  return header
    .trim()
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => {
      if (/^[A-Z0-9]+$/.test(w) && w.length <= 3) return w
      if (/^[a-z0-9]+$/.test(w) || /^[A-Z0-9]+$/.test(w))
        return w[0].toUpperCase() + w.slice(1).toLowerCase()
      return w
    })
    .join(' ')
}

// ADR 0008: every inference threshold is a named, exported bet. Spec, ADR,
// and tests reference these names, never the literals. Changing one means
// re-scoring the judgement rules it feeds (see the ADR).
export const COLUMN_NAME_MAX = 63 // Postgres identifier headroom
export const INT_SAFE_DIGITS = 15 // 10^15 < 2^53: Int never loses precision
export const LONG_TEXT_CHARS = 140 // beyond this a cell reads as prose
export const CHOICE_MIN_SAMPLE = 6 // fewer values: repetition proves nothing
export const CHOICE_MIN_OPTIONS = 2
export const CHOICE_MAX_OPTIONS = 8 // beyond this a fixed list stops helping
export const CHOICE_MIN_DENSITY = 3 // each option seen ~3x on average
export const CHOICE_MAX_OPTION_CHARS = 60 // longer values are content
export const AUTO_MATCH_MIN_SCORE = 0.6 // share of sheet headers that map
export const AUTO_MATCH_MIN_COVERAGE = 0.8 // share of Table columns covered

const INT_RE = new RegExp(`^-?\\d{1,${INT_SAFE_DIGITS}}$`)
const FLOAT_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
const BOOL_WORDS = new Set(['true', 'false', 'yes', 'no', 'y', 'n'])

function isEmpty(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '')
}

// A JS Date at exactly midnight (as SheetJS produces for date-only cells
// under cellDates: true) reads as a Date; anything with a time part is a
// Datetime. SheetJS yields local-midnight Dates for xlsx date cells but
// UTC-midnight Dates for date-only strings (e.g. CSV "2026-01-15"), so
// midnight on either clock counts — checking local components alone
// misreads UTC midnight as a time-of-day on any non-UTC machine.
function isLocalMidnight(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0
}

function isUtcMidnight(d: Date): boolean {
  return (
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
  )
}

function dateOnly(d: Date): boolean {
  return isLocalMidnight(d) || isUtcMidnight(d)
}

// IMP-002: pick the narrowest column type every sampled value fits.
export function inferColumnType(values: unknown[]): string {
  const sample = values.filter((v) => !isEmpty(v))
  if (!sample.length) return 'Data'

  let allInt = true
  let allNumeric = true
  let allBool = true
  let allDate = true
  let allDatetime = true
  let longText = false

  for (const v of sample) {
    if (v instanceof Date) {
      allInt = allNumeric = allBool = false
      if (!dateOnly(v)) allDate = false
      continue
    }
    if (typeof v === 'boolean') {
      allInt = allNumeric = allDate = allDatetime = false
      continue
    }
    if (typeof v === 'number') {
      allBool = allDate = allDatetime = false
      if (!Number.isInteger(v)) allInt = false
      continue
    }
    const s = String(v).trim()
    if (s.length > LONG_TEXT_CHARS || s.includes('\n')) longText = true
    if (!INT_RE.test(s)) allInt = false
    if (!FLOAT_RE.test(s)) allNumeric = false
    if (!BOOL_WORDS.has(s.toLowerCase())) allBool = false
    if (!DATE_RE.test(s)) allDate = false
    if (!DATETIME_RE.test(s) || Number.isNaN(Date.parse(s))) allDatetime = false
  }

  if (allBool) return 'Check'
  if (allInt) return 'Int'
  if (allNumeric) return 'Float'
  if (allDate) return 'Date'
  if (allDatetime) return 'Datetime'
  return longText ? 'Text' : 'Data'
}

// IMP-008: a low-cardinality text column reads as a Choice column. Applied
// only where inference would otherwise say Data, and only with enough
// evidence (each option seen ~3x on average) that the repetition is a
// category, not coincidence.
export function inferChoices(values: unknown[]): string[] | null {
  const sample = values
    .filter((v) => !isEmpty(v) && !(v instanceof Date) && typeof v !== 'boolean')
    .map((v) => String(v).trim())
  if (sample.length < CHOICE_MIN_SAMPLE) return null
  const distinct = [...new Set(sample)]
  if (distinct.length < CHOICE_MIN_OPTIONS || distinct.length > CHOICE_MAX_OPTIONS) return null
  if (sample.length < distinct.length * CHOICE_MIN_DENSITY) return null
  if (distinct.some((s) => s.length > CHOICE_MAX_OPTION_CHARS || s.includes('\n'))) return null
  return distinct.sort()
}

export interface MappingTarget {
  column_name: string
  label?: string | null
}

// IMP-009: match file headers onto an existing Table's columns — by
// sanitized column_name first, then by sanitized label — so a file exported
// from Featherbase (or hand-labeled like the Table) maps itself. Unmatched
// headers return null and are left for the user to map or skip.
export function autoMapColumns(
  headers: string[],
  targets: MappingTarget[],
): (string | null)[] {
  const byName = new Map<string, string>()
  const byLabel = new Map<string, string>()
  for (const t of targets) {
    byName.set(t.column_name, t.column_name)
    const label = sanitizeColumnName(t.label ?? '')
    if (label && !byLabel.has(label)) byLabel.set(label, t.column_name)
  }
  const used = new Set<string>()
  return headers.map((h) => {
    const key = sanitizeColumnName(h)
    const hit = byName.get(key) ?? byLabel.get(key) ?? null
    if (!hit || used.has(hit)) return null
    used.add(hit)
    return hit
  })
}

// IMP-009/IMP-012: how well a file's headers fit an existing Table, in BOTH
// directions. `score` = fraction of the sheet's headers that map (does my
// data fit?); `coverage` = fraction of the Table's columns that get mapped
// (is this Table actually about the same thing, or merely a superset?). A
// 3-column Zone sheet maps 3/3 into a 5-column Registration District Table
// — score 1.0 but coverage 0.6, which is why score alone must not
// auto-select.
export interface TableMatchQuality {
  score: number
  coverage: number
  mapped: number
}

export function tableMatchQuality(
  headers: string[],
  targets: MappingTarget[],
): TableMatchQuality {
  const real = headers.filter((h) => sanitizeColumnName(h))
  if (!real.length || !targets.length) return { score: 0, coverage: 0, mapped: 0 }
  const mapped = autoMapColumns(real, targets).filter(Boolean).length
  return { score: mapped / real.length, coverage: mapped / targets.length, mapped }
}

export function scoreTableMatch(headers: string[], targets: MappingTarget[]): number {
  return tableMatchQuality(headers, targets).score
}

// Do a sheet name and a Table name share any meaningful word? ("zone" vs
// "Zone" yes; "zone" vs "Registration District" no.)
export function namesShareToken(a: string, b: string): boolean {
  const tokens = (s: string) =>
    new Set(sanitizeColumnName(s).split('_').filter((w) => w.length > 1))
  const ta = tokens(a)
  return [...tokens(b)].some((w) => ta.has(w))
}

// IMP-012: auto-select an existing Table only when the evidence is strong —
// most of the sheet's headers map AND (the sheet accounts for most of the
// Table's columns OR the names agree). Below this bar the wizard defaults
// to a new Table and surfaces the near-match as a hint instead.
export function shouldAutoMatch(
  sheetName: string,
  tableName: string,
  q: TableMatchQuality,
): boolean {
  return (
    q.score >= AUTO_MATCH_MIN_SCORE &&
    (q.coverage >= AUTO_MATCH_MIN_COVERAGE || namesShareToken(sheetName, tableName))
  )
}

// "customer orders.csv" -> "Customer Orders", fitting the server's
// /^[A-Za-z][A-Za-z0-9 ]{0,60}$/ Table-name rule.
export function tableNameFromFile(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '')
  const words = stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
  const name = words.join(' ').replace(/^[^A-Za-z]+/, '')
  return name.slice(0, 61).trim()
}

// A Table name -> the series prefix for its id pattern: "Zone" -> "ZONE-",
// "Sales Invoice" -> "SALES-INVOICE-". Only [A-Za-z0-9 ] survive a valid Table
// name, but the builder derives this from a half-typed name too, so anything
// else (a '.' above all — resolveName splits the pattern at the first dot)
// is dropped rather than trusted.
export function seriesPrefix(tableName: string): string {
  const words = tableName
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return ''
  return words.join('-').toUpperCase().slice(0, 20) + '-'
}

export function idPatternFor(tableName: string, digits = 3): string {
  const prefix = seriesPrefix(tableName)
  return prefix ? `${prefix}.${'#'.repeat(digits)}` : 'hash'
}

// IMP-003: headers + parsed rows -> a ready POST /api/table payload.
// Original headers survive as labels; the first columns are flagged for the
// list view so the imported Table is immediately browsable.
export function inferTableDef(
  name: string,
  headers: string[],
  rows: unknown[][],
): InferredTableDef {
  const columnNames = sanitizeHeaders(headers)
  const columns = columnNames.map((column_name, i) => {
    const values = rows.map((r) => r[i])
    let column_type = inferColumnType(values)
    let choices: string | undefined
    if (column_type === 'Data') {
      const options = inferChoices(values)
      if (options) {
        column_type = 'Choice'
        choices = options.join('\n')
      }
    }
    return {
      column_name,
      // IMP-012: labels are normalized, not copied verbatim — a file with
      // "Zone ID" next to "Reg_District_ID" yields consistent labels.
      label: prettifyLabel(String(headers[i] ?? '')) || prettifyLabel(column_name),
      column_type,
      ...(choices ? { choices } : {}),
      reqd: false,
      in_list_view: i < 4,
    }
  })
  // Imported Tables get a readable series (ZONE-001) rather than the engine's
  // random-hash fallback; the builder and wizard both let the user change it.
  return { name, id_pattern: idPatternFor(name), columns }
}

// IMP-004: normalize parsed cells to what each (possibly user-edited) column
// type expects on the wire — booleans for Check, YYYY-MM-DD for Date, ISO
// strings for Datetime; empty cells are omitted entirely.
//
// #115 / IMP-I1: blank rows are dropped, but never silently — each coerced
// row carries its `sourceIndex` into the input rows (the sheet's data rows
// IN ORDER, blanks included), so display code can always name the TRUE
// spreadsheet row (+2: the header is row 1). The only row number a user
// ever sees is Excel's own.
export interface CoercedRow {
  values: Record<string, unknown>
  sourceIndex: number
}

export function coerceRows(
  columns: { column_name: string; column_type: string }[],
  rows: unknown[][],
): CoercedRow[] {
  return rows
    .map((cells, sourceIndex) => {
      const values: Record<string, unknown> = {}
      for (const [i, col] of columns.entries()) {
        const v = cells[i]
        if (isEmpty(v)) continue
        values[col.column_name] = coerceCell(v, col.column_type)
      }
      return { values, sourceIndex }
    })
    .filter((r) => Object.keys(r.values).length > 0)
}

function coerceCell(v: unknown, columnType: string): unknown {
  switch (columnType) {
    case 'Check': {
      if (typeof v === 'boolean') return v
      const s = String(v).trim().toLowerCase()
      return s === 'true' || s === 'yes' || s === 'y' || s === '1'
    }
    case 'Date':
      if (v instanceof Date) return dateToYmd(v)
      return String(v).trim().slice(0, 10)
    case 'Datetime':
      if (v instanceof Date) return v.toISOString()
      return String(v).trim()
    case 'Int':
    case 'Float':
    case 'Currency':
      return typeof v === 'number' ? v : String(v).trim()
    default:
      if (v instanceof Date) return toLocalIso(v)
      return typeof v === 'string' ? v : String(v)
  }
}

// A date-only value must keep its calendar day on every machine: read the
// components off whichever clock says midnight (UTC-midnight Dates come
// from date-only strings, local-midnight ones from xlsx date cells).
function dateToYmd(d: Date): string {
  if (!isLocalMidnight(d) && isUtcMidnight(d)) return d.toISOString().slice(0, 10)
  return toLocalIso(d).slice(0, 10)
}

// SheetJS date cells are local-time JS Dates; toISOString would shift the
// calendar day for anyone east of UTC, so format the local components.
function toLocalIso(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
