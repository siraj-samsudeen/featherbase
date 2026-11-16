import { version } from '../package.json'

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

/** Calls one of Feather Dash's declared reads on the platform, as the
 *  signed-in person (the session cookie rides along on the same origin). */
export async function read<T>(name: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/api/app_reads/dash/${encodeURIComponent(name)}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `dash@${version}` },
    body: JSON.stringify({ payload }),
  })
  const body = await response.json().catch(() => ({}))
  reloadIfViewAsEnded(response.status, body)
  if (!response.ok) throw new ApiError(body.error?.message ?? 'Request failed', response.status)
  return body.result as T
}

/** #1222: the platform says a View as just ended; reload, so the page never shows two people at once. */
function reloadIfViewAsEnded(status: number, body: { error?: { message?: string } }) {
  if (status === 409 && body.error?.message?.startsWith('View as has ended') && typeof window !== 'undefined') window.location.reload()
}

/** The platform's bar marks the page while a tester views as someone (#1222). */
export const VIEWING_AS_ATTRIBUTE = 'data-featherbase-viewing-as'
export const viewingAs = () => typeof document !== 'undefined' && document.documentElement.hasAttribute(VIEWING_AS_ATTRIBUTE)
export const VIEWING_ONLY = 'You are viewing as someone else: this is for looking only. Exit View as to make changes.'

/** Runs one of Dash's declared actions. A fresh key per call: a retry after a lost answer is
 *  the caller pressing the button again, and the rules refuse a repeat. */
export async function act<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  // #1222: while a tester views as someone, the page is for looking only; its change buttons are hidden.
  if (viewingAs()) throw new ApiError(VIEWING_ONLY, 403)
  const response = await fetch(`/api/app_actions/dash/${encodeURIComponent(name)}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `dash@${version}` },
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), payload }),
  })
  const body = await response.json().catch(() => ({}))
  reloadIfViewAsEnded(response.status, body)
  if (!response.ok) throw new ApiError(body.error?.message ?? 'That did not go through. Try again.', response.status)
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
  const check = health?.checks.find(c => c.key === 'app-setup:dash')
  return { manages: true, missing: check?.missing, fix: check?.fix ?? null }
}
