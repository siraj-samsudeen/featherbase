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

const platformGet = async <T>(path: string): Promise<T> => {
  const response = await fetch(path, { credentials: 'same-origin' })
  if (!response.ok) throw new ApiError('Request failed', response.status)
  return await response.json() as T
}

/**
 * What the platform says about this person and this app, for the page's "no access" message:
 * whether they can manage the instance (whoami) and, if so, what instance health says the app
 * lacks. Anything unreadable leaves them a reader or a manager with nothing known to be missing.
 */
export async function accessFacts(): Promise<{ manages: boolean; missing?: string[]; fix?: string | null }> {
  const me = await platformGet<{ capabilities?: { manage?: boolean } }>('/api/whoami').catch(() => undefined)
  if (!me?.capabilities?.manage) return { manages: false }
  const health = await platformGet<{ checks: { key: string; missing?: string[]; fix?: string | null }[] }>('/api/instance-health').catch(() => undefined)
  const check = health?.checks.find(c => c.key === 'app-setup:feather_dash')
  return { manages: true, missing: check?.missing, fix: check?.fix ?? null }
}
