import { version } from '../package.json'
export type Ticket = {
  row_id: string
  title: string
  kind: string
  ticket_state: string
  assigned_to?: string
  public_update?: string
  updated_at: string
  owner: string
}
export type Session = {
  user: string | { row_id: string; full_name?: string; email?: string }
  capabilities: { support: boolean; verify: boolean; fulfill: boolean }
  connections: unknown
  people?: { row_id: string; full_name: string }[]
}
export type RecordData = Record<string, unknown>
export type Detail = {
  ticket: Ticket
  details?: RecordData
  events: RecordData[]
  privateEvents?: RecordData[]
  verification?: RecordData
  approval?: RecordData
  capabilities?: Record<string, boolean>
  names?: Record<string, string>
  [key: string]: unknown
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}
async function request<T>(path: string, body: unknown): Promise<T> {
  const token = localStorage.getItem('fc_token')
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Featherbase-App-Version': `tickets@${version}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (response.status === 401) {
    window.location.assign('/featherbase/login?next=%2Ftickets%2F')
    throw new ApiError('Sign in to continue.', 401)
  }
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new ApiError(
      data?.error?.message ??
        data?.message ??
        `Request failed (${response.status}). Please try again.`,
      response.status,
    )
  return data.result as T
}
export async function read<T>(name: string, payload: object = {}): Promise<T> {
  return (
    await request<{ answer: T }>(`/api/app_reads/tickets/${name}`, { payload })
  ).answer
}
export function action(name: string, payload: object) {
  return request<{ ticket: Ticket }>(`/api/app_actions/tickets/${name}`, {
    idempotencyKey: crypto.randomUUID(),
    payload,
  })
}
