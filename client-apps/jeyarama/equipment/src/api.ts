import { version } from '../package.json'

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

function headers(json: boolean): Record<string, string> {
  const token = localStorage.getItem('fc_token')
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'X-Featherbase-App-Version': `equipment@${version}`,
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

/** Upload a private photo for the repair jobs Table, before the job exists. */
export async function uploadJobPhoto(file: File): Promise<string> {
  const form = new FormData()
  form.set('file', file)
  form.set('is_private', '1')
  form.set('ref_table', 'equipment.job')
  const response = await fetch('/api/upload_file', { method: 'POST', credentials: 'same-origin', headers: headers(false), body: form })
  const result = await response.json()
  if (!response.ok) throw new ApiError(result.error?.message ?? 'Could not upload the photo', response.status)
  return String(result.file_url)
}

export function save<T>(table: string, row: Record<string, unknown>) {
  return api.post<T>('/api/save_row', { table, row })
}
