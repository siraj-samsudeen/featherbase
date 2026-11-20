import { version } from '../package.json'

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

function headers(json: boolean): Record<string, string> {
  const token = localStorage.getItem('fc_token')
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'X-Featherbase-App-Version': `budgets@${version}`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, credentials: 'same-origin', headers: headers(true),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok) throw new ApiError(result.error?.message ?? 'Request failed', response.status)
  return result
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, 'POST', body),
}

export async function listAll<T>(table: string, params: { fields: string[]; filters?: unknown[]; order_by?: string }) {
  const rows: T[] = []
  for (;;) {
    const query = new URLSearchParams({ fields: JSON.stringify(params.fields), limit_page_length: '500', limit_start: String(rows.length) })
    if (params.filters) query.set('filters', JSON.stringify(params.filters))
    if (params.order_by) query.set('order_by', params.order_by)
    const page = await api.get<{ data: T[]; total: number }>(`/api/table/${encodeURIComponent(table)}?${query}`)
    rows.push(...page.data)
    if (!page.data.length || rows.length >= page.total) return rows
  }
}

/** The signed-in person's ID, as stored at sign-in. */
export function myId(): string {
  try { return JSON.parse(localStorage.getItem('fc_user') ?? 'null')?.row_id ?? '' } catch { return '' }
}

export function runRead<T>(name: string, payload: unknown = {}) {
  return api.post<{ result: T }>(`/api/app_reads/budgets/${name}`, { payload }).then(response => response.result)
}

export function runAction<T>(name: string, payload: unknown) {
  return api.post<{ result: T }>(`/api/app_actions/budgets/${name}`, { idempotencyKey: crypto.randomUUID(), payload }).then(response => response.result)
}

export function save<T>(table: string, row: Record<string, unknown>) {
  return api.post<T>('/api/save_row', { table, row })
}
