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
  fields?: string[]; filters?: unknown[]; order_by?: string; limit_page_length?: number
} = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params))
    query.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value))
  return api.get<{ data: T[] }>(`/api/table/${encodeURIComponent(table)}?${query}`)
}
