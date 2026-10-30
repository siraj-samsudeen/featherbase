import { version } from '../package.json'

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

/** Calls one of Feather Dash's declared reads on the platform, as the
 *  signed-in person (the session cookie rides along on the same origin). */
export async function read<T>(name: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/api/app_reads/feather_dash/${encodeURIComponent(name)}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `feather_dash@${version}` },
    body: JSON.stringify({ payload }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(body.error?.message ?? 'Request failed', response.status)
  return body.result as T
}
