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
  columns: InferredColumn[]
}

// Mirrors the server's STANDARD_COLUMNS (doctype-engine.ts): user columns can
// never shadow these, so inferred names step aside with a numeric suffix.
const RESERVED_COLUMN_NAMES = new Set([
  'name',
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
  return named.slice(0, 63)
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
      candidate = `${candidate}_${n}`.slice(0, 63)
    }
    taken.add(candidate)
    return candidate
  })
}

const INT_RE = /^-?\d{1,15}$/
const FLOAT_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
const BOOL_WORDS = new Set(['true', 'false', 'yes', 'no', 'y', 'n'])

function isEmpty(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '')
}

// A JS Date at exactly midnight (as SheetJS produces for date-only cells
// under cellDates: true) reads as a Date; anything with a time part is a
// Datetime.
function dateOnly(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0
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
    if (s.length > 140 || s.includes('\n')) longText = true
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
  if (sample.length < 6) return null
  const distinct = [...new Set(sample)]
  if (distinct.length < 2 || distinct.length > 8) return null
  if (sample.length < distinct.length * 3) return null
  if (distinct.some((s) => s.length > 60 || s.includes('\n'))) return null
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

// IMP-009: how well a file's headers cover an existing Table — the fraction
// of headers that auto-map. Content-based, so a renamed file or sheet still
// finds its Table; used to suggest an import target.
export function scoreTableMatch(headers: string[], targets: MappingTarget[]): number {
  const real = headers.filter((h) => sanitizeColumnName(h))
  if (!real.length) return 0
  const mapped = autoMapColumns(real, targets).filter(Boolean).length
  return mapped / real.length
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

// IMP-003: headers + parsed rows -> a ready POST /api/doctype payload.
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
      label: String(headers[i] ?? '').trim() || column_name,
      column_type,
      ...(choices ? { choices } : {}),
      reqd: false,
      in_list_view: i < 4,
    }
  })
  return { name, columns }
}

// IMP-004: normalize parsed cells to what each (possibly user-edited) column
// type expects on the wire — booleans for Check, YYYY-MM-DD for Date, ISO
// strings for Datetime; empty cells are omitted entirely.
export function coerceRows(
  columns: { column_name: string; column_type: string }[],
  rows: unknown[][],
): Record<string, unknown>[] {
  return rows
    .map((cells) => {
      const row: Record<string, unknown> = {}
      for (const [i, col] of columns.entries()) {
        const v = cells[i]
        if (isEmpty(v)) continue
        row[col.column_name] = coerceCell(v, col.column_type)
      }
      return row
    })
    .filter((row) => Object.keys(row).length > 0)
}

function coerceCell(v: unknown, columnType: string): unknown {
  switch (columnType) {
    case 'Check': {
      if (typeof v === 'boolean') return v
      const s = String(v).trim().toLowerCase()
      return s === 'true' || s === 'yes' || s === 'y' || s === '1'
    }
    case 'Date':
      if (v instanceof Date) return toLocalIso(v).slice(0, 10)
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

// SheetJS date cells are local-time JS Dates; toISOString would shift the
// calendar day for anyone east of UTC, so format the local components.
function toLocalIso(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
