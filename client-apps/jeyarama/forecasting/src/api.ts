import { version } from '../package.json'
import { NOT_A_LEAD } from './scoped'

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `forecasting@${version}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(result.error?.message ?? 'Request failed', response.status)
  return result as T
}

/** One of the app's read operations (server.ts reads), as the signed-in person. */
export async function readOp<T>(name: string, payload: Record<string, unknown> = {}): Promise<T> {
  return (await request<{ result: T }>(`/api/app_reads/forecasting/${encodeURIComponent(name)}`, 'POST', { payload })).result
}

/** How many rows of a Table hold each value of `field`, among the rows the person may read: one call, however many rows. */
export async function countBy(table: string, field: string, filters: Filter[]): Promise<{ label: string; value: number }[]> {
  return (await request<{ data: { label: string; value: number }[] }>('/api/dashboard/chart', 'POST', { table, group_by: field, filters })).data
}

/** Every row of a Table, page by page. */
export async function listAll<T>(table: string, fields: string[]): Promise<T[]> {
  const page = (start: number) => request<{ data: T[]; total: number }>(`/api/table/${encodeURIComponent(table)}?${new URLSearchParams({
    fields: JSON.stringify(['row_id', 'updated_at', ...fields]), limit_page_length: '500', limit_start: String(start), order_by: 'row_id asc' })}`)
  const first = await page(0)
  const rows: T[] = [...first.data]
  // A large Table (a Run's 13,000 lines) is read six pages at a time, in row order so pages neither skip nor repeat.
  const starts: number[] = []
  for (let s = rows.length; first.data.length && s < first.total; s += 500) starts.push(s)
  for (let i = 0; i < starts.length; i += 6) for (const p of await Promise.all(starts.slice(i, i + 6).map(page))) rows.push(...p.data)
  return rows
}

export const saveRow = (table: string, row: Record<string, unknown>) => request<Record<string, unknown>>('/api/save_row', 'POST', { table, row })

type Filter = [string, string, unknown]
/** The rows of a Table that match the filters, page by page (the Team Leader screen reads one section, never a whole Run). */
export async function listWhere<T>(table: string, fields: string[], filters: Filter[], orderBy = 'row_id asc'): Promise<T[]> {
  const rows: T[] = []
  for (;;) {
    const page = await request<{ data: T[] }>(`/api/table/${encodeURIComponent(table)}?${new URLSearchParams({
      fields: JSON.stringify(['row_id', 'updated_at', ...fields]), filters: JSON.stringify(filters), limit_page_length: '500', limit_start: String(rows.length), order_by: orderBy })}`)
    rows.push(...page.data)
    if (page.data.length < 500) return rows
  }
}
/** The rows of a Table that match the filters, eight pages at a time (the managers' pages read many stores' lines:
 *  a region is some 18,000 subcategories and five sales windows each). The first page says how many there are. */
export async function listWhereAll<T>(table: string, fields: string[], filters: Filter[]): Promise<T[]> {
  const page = (start: number) => request<{ data: T[]; total: number }>(`/api/table/${encodeURIComponent(table)}?${new URLSearchParams({
    fields: JSON.stringify(['row_id', ...fields]), filters: JSON.stringify(filters), limit_page_length: '500', limit_start: String(start), order_by: 'row_id asc' })}`)
  const first = await page(0)
  const rows: T[] = [...first.data]
  const starts: number[] = []
  for (let s = rows.length; first.data.length && s < first.total; s += 500) starts.push(s)
  for (let i = 0; i < starts.length; i += 8) for (const p of await Promise.all(starts.slice(i, i + 8).map(page))) rows.push(...p.data)
  return rows
}
// ---- #1454: the reads scoped by the org chart (server.ts `copy` and `review`, scoped.ts) ------------------------

/** Whether a read was refused because the person may not read Forecasting's data at all. */
export const refusedAccess = (e: unknown) => (e as { status?: number } | null)?.status === 403 || (e instanceof Error && e.message.includes(NOT_A_LEAD))

/** The filters as the scoped reads take them, each column one value or a list, all of which must hold; null when a
 *  list is empty, so nothing can match. Only = and in. */
function keyed(filters: Filter[]): Record<string, string[]> | null {
  const out: Record<string, string[]> = {}
  for (const [column, op, value] of filters) {
    if (op !== '=' && op !== 'in') throw new Error(`The scoped reads filter by = or in, not ${op}`)
    const values = (Array.isArray(value) ? value : [value]).map(String)
    out[column] = out[column] ? out[column].filter(v => values.includes(v)) : values
    if (!out[column].length) return null
  }
  return out
}
/** A read-only copy's rows that the signed-in person may see (their places on the org chart), matching `filters`. */
export async function listCopy<T>(table: string, fields: string[], filters: Filter[]): Promise<T[]> {
  const where = keyed(filters)
  if (!where) return []
  return (await readOp<{ at: string | null; rows: T[] }>('copy', { dataset: table.replace(/^forecasting\./, ''), filters: where, fields })).rows
}
/** A review Table's rows (answers, changes, questions, day explanations) that the person may see: within their places
 *  on the org chart; for someone the org chart gives none (the forecast team at head office), as their own grants on the
 *  Table allow, which for anyone else is the rows they wrote. */
export async function listReview<T>(table: string, fields: string[], filters: Filter[], orderBy = 'row_id asc',
  /** Sub-table columns the scoped read brings with each row (a plain Table read does not). */
  subTables: string[] = []): Promise<T[]> {
  const where = keyed(filters)
  if (!where) return []
  const [column, direction] = orderBy.split(/\s+/)
  try {
    const rows = await readOp<Record<string, unknown>[]>('review', { table, filters: where, fields: [...new Set([...fields, ...subTables, column])] })
    const sign = direction === 'desc' ? -1 : 1
    return rows.sort((a, b) => (String(a[column] ?? '') < String(b[column] ?? '') ? -sign : String(a[column] ?? '') > String(b[column] ?? '') ? sign : 0)) as T[]
  } catch (e) {
    if (refusedAccess(e)) return listWhere<T>(table, fields, filters, orderBy)
    throw e
  }
}

/** One row, with its sub-table rows. */
export async function getRow<T>(table: string, rowId: string): Promise<T> {
  const r = await request<{ data?: T } & T>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(rowId)}`)
  return (r.data ?? r) as T
}
