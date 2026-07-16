import { sql } from './db'
import { AppError } from './errors'
import { getDoc } from './document'

// RPT-004: admin-authored SQL reports. The query may contain named filter
// placeholders like {from_date}; these are bound as parameters (never string-
// interpolated), and the whole query runs inside a READ ONLY transaction so a
// report can never mutate data even if its SQL tries. Authoring is gated to
// System Managers at save time (controllers/report.ts); running is gated by
// read permission on the Report document.

export interface QueryReportResult {
  columns: string[]
  rows: Record<string, unknown>[]
}

// Placeholder names in first-seen order (deduped).
export function parseFilters(query: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of query.matchAll(/\{(\w+)\}/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      out.push(m[1])
    }
  }
  return out
}

// Reject anything that isn't a single read-only SELECT/CTE. A read-only
// transaction is the real guard; this is defense in depth and a clearer error.
function assertReadOnly(query: string) {
  const trimmed = query.trim().replace(/;\s*$/, '')
  if (/;/.test(trimmed))
    throw new AppError('ValidationError', 'Query reports must be a single statement (no ";")')
  if (!/^\s*(select|with)\b/i.test(trimmed))
    throw new AppError('ValidationError', 'Query reports must start with SELECT or WITH')
}

// Replace {name} with $n placeholders, returning the parameter values in order.
function bind(query: string, filters: Record<string, unknown>): { text: string; params: unknown[] } {
  const index = new Map<string, number>()
  const params: unknown[] = []
  const text = query.replace(/\{(\w+)\}/g, (_m, name: string) => {
    if (!index.has(name)) {
      params.push(filters[name] ?? null)
      index.set(name, params.length)
    }
    return `$${index.get(name)}`
  })
  return { text, params }
}

export async function runQueryReport(
  reportName: string,
  filters: Record<string, unknown>,
  user: string,
): Promise<QueryReportResult> {
  // Reading the Report enforces the caller's read permission on it.
  const report = await getDoc('Report', reportName, user)
  if (report.report_type !== 'Query Report')
    throw new AppError('ValidationError', `${reportName} is not a Query Report`)
  const query = typeof report.query === 'string' ? report.query.trim() : ''
  if (!query) throw new AppError('ValidationError', `${reportName} has no query`)

  assertReadOnly(query)
  const { text, params } = bind(query.replace(/;\s*$/, ''), filters)

  let rows: unknown
  try {
    rows = await sql.begin(async (tx) => {
      await tx.unsafe('set transaction read only')
      return tx.unsafe(text, params as never[])
    })
  } catch (err) {
    // A bad query or an out-of-range/ill-typed filter value must not surface
    // as a 500. (Writes are already impossible — the txn is READ ONLY.)
    throw new AppError(
      'ValidationError',
      `Query failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const list = rows as unknown as Record<string, unknown>[]
  // postgres.js exposes column metadata on the result even when zero rows come
  // back, so headers render for an empty report; fall back to the first row.
  const meta = (rows as { columns?: { name: string }[] }).columns
  const columns = meta?.length ? meta.map((c) => c.name) : list.length ? Object.keys(list[0]) : []
  return { columns, rows: list }
}
