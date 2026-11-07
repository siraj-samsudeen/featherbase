import { version } from '../package.json'

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

export function getSessionUser(): { row_id: string } | null {
  return JSON.parse(localStorage.getItem('fc_user') ?? 'null')
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json',
      'X-Featherbase-App-Version': `tasker@${version}`,
      ...(localStorage.getItem('fc_token') ? { Authorization: `Bearer ${localStorage.getItem('fc_token')}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok) throw new ApiError(result.error?.message ?? 'Request failed', response.status)
  return result
}
export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, 'POST', body),
  patch: <T>(path: string, body: unknown) => request<T>(path, 'PATCH', body),
  put: <T>(path: string, body: unknown) => request<T>(path, 'PUT', body),
}
export function listResource<T>(table: string, params: {
  fields?: string[]; filters?: unknown[]; order_by?: string; limit_page_length?: number; limit_start?: number
} = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params))
    query.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value))
  return api.get<{ data: T[]; total: number }>(`/api/table/${encodeURIComponent(table)}?${query}`)
}

/** Uploads a private file for a task and returns its address. */
export async function uploadTaskFile(file: File): Promise<string> {
  const form = new FormData()
  form.set('file', file)
  form.set('is_private', '1')
  form.set('ref_table', 'tasker.task')
  const token = localStorage.getItem('fc_token')
  const response = await fetch('/api/upload_file', {
    method: 'POST', credentials: 'same-origin', body: form,
    headers: { 'X-Featherbase-App-Version': `tasker@${version}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const result = await response.json()
  if (!response.ok) throw new ApiError(result.error?.message ?? 'Could not upload the photo', response.status)
  return String(result.file_url)
}

/** Load each page through the same permission-filtered list interface. */
export async function listAllResources<T>(table: string, params: Parameters<typeof listResource>[1] = {}) {
  const rows: T[] = []
  let total = 0
  do {
    const page = await listResource<T>(table, { ...params, limit_start: rows.length })
    rows.push(...page.data)
    total = page.total
    if (!page.data.length) break
  } while (rows.length < total)
  return { data: rows, total }
}
