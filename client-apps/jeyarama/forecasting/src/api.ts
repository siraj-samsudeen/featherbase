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
  const rows: T[] = []
  for (;;) {
    const query = new URLSearchParams({ fields: JSON.stringify(['row_id', 'updated_at', ...fields]), limit_page_length: '500', limit_start: String(rows.length) })
    const page = await request<{ data: T[]; total: number }>(`/api/table/${encodeURIComponent(table)}?${query}`)
    rows.push(...page.data)
    if (!page.data.length || rows.length >= page.total) return rows
  }
}

export const saveRow = (table: string, row: Record<string, unknown>) => request<Record<string, unknown>>('/api/save_row', 'POST', { table, row })
