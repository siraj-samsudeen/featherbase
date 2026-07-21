// Thin authenticated client for the Featherbase server API.

const TOKEN_KEY = 'fc_token'
const USER_KEY = 'fc_user'

export interface SessionUser {
  name: string
  email: string
  full_name: string | null
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getSessionUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY)
  return raw ? (JSON.parse(raw) as SessionUser) : null
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

// PLAT-006: store a session token obtained out-of-band (the OAuth callback
// redirect carries it). The user profile is filled in on the next whoami.
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.removeItem(USER_KEY)
}

export class ApiError extends Error {
  status: number
  type: string
  fields?: Record<string, string>
  constructor(status: number, type: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.status = status
    this.type = type
    this.fields = fields
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  })
  if (res.status === 401) {
    clearSession()
    if (!path.endsWith('/api/login')) window.location.href = '/login'
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: { type: string; message: string; fields?: Record<string, string> }
  }
  if (!res.ok)
    throw new ApiError(
      res.status,
      body.error?.type ?? 'InternalError',
      body.error?.message ?? `Request failed (${res.status})`,
      body.error?.fields,
    )
  return body as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export async function login(usr: string, pwd: string): Promise<SessionUser> {
  const res = await api.post<{ token: string; user: SessionUser }>('/api/login', { usr, pwd })
  localStorage.setItem(TOKEN_KEY, res.token)
  localStorage.setItem(USER_KEY, JSON.stringify(res.user))
  return res.user
}

export interface ListResult<T = Record<string, unknown>> {
  data: T[]
  total: number
  limit_start: number
  limit_page_length: number
}

export function listResource<T = Record<string, unknown>>(
  doctype: string,
  params: {
    filters?: unknown[]
    fields?: string[]
    order_by?: string
    limit_start?: number
    limit_page_length?: number
  } = {},
) {
  const qs = new URLSearchParams()
  if (params.filters?.length) qs.set('filters', JSON.stringify(params.filters))
  if (params.fields?.length) qs.set('fields', JSON.stringify(params.fields))
  if (params.order_by) qs.set('order_by', params.order_by)
  if (params.limit_start != null) qs.set('limit_start', String(params.limit_start))
  if (params.limit_page_length != null)
    qs.set('limit_page_length', String(params.limit_page_length))
  const suffix = qs.size ? `?${qs}` : ''
  return api.get<ListResult<T>>(`/api/resource/${encodeURIComponent(doctype)}${suffix}`)
}
