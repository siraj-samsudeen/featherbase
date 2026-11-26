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
