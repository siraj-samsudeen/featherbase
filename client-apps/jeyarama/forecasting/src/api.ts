import { version } from '../package.json'

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
/** One row, with its sub-table rows. */
export async function getRow<T>(table: string, rowId: string): Promise<T> {
  const r = await request<{ data?: T } & T>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(rowId)}`)
  return (r.data ?? r) as T
}
