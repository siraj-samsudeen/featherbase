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

/** #1222: whether the signed-in person may view as someone (the platform answers for them, never for whom they view). */
export const mayViewAs = async () => (await platformGet<{ may?: boolean }>('/api/view_as').catch(() => ({ may: false }))).may === true

/** #1222: view as `person`; the page (and other tabs on this sign-in) reload to show what they see. */
export async function startViewAs(person: string, name: string): Promise<void> {
  const response = await fetch('/api/view_as/start', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person }) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(body.error?.message ?? 'Could not view as them. Try again.', response.status)
  try {
    window.localStorage.setItem('featherbase.view-as.changed', String(Date.now()))
    // Whom the platform's pages are about now (its lib/viewing-as.ts): every "me" is this person.
    window.localStorage.setItem('featherbase.viewing-as', JSON.stringify({ row_id: person, full_name: name }))
  } catch { /* private window: this tab only */ }
  // Land on Dash's home: the page you started from (Report access) may not be one they can open.
  window.location.assign(window.location.pathname)
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

/**
 * #1240: another app's declared action or read, as the signed-in person. The platform asks a
 * browser to name the version of the app it calls, which Dash learns from the versions the
 * instance runs now. Null when that app isn't running here.
 */
async function runningVersion(app: string): Promise<string | null> {
  const response = await fetch('/api/runtime_app_versions', { credentials: 'same-origin' }).catch(() => null)
  if (!response?.ok) return null
  const versions = await response.json().catch(() => []) as unknown
  return Array.isArray(versions) ? (versions.find((v): v is string => typeof v === 'string' && v.startsWith(`${app}@`)) ?? null) : null
}

async function otherApp<T>(app: string, path: string, body: Record<string, unknown>): Promise<T> {
  const identity = await runningVersion(app)
  if (!identity) throw new ApiError(`${app} isn't running on this instance`, 404)
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': identity },
    body: JSON.stringify(body),
  })
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(answer.error?.message ?? 'That did not go through. Try again.', response.status)
  return answer.result as T
}

/** Whether Tickets runs here, so the page offers "Report an issue" only where a ticket can be raised. */
export const ticketsRunning = async () => (await runningVersion('tickets')) !== null

/**
 * Raises a ticket in Tickets as the signed-in person. A retry of the same submission sends the same
 * key and payload, so a ticket whose answer was lost is answered again, never raised twice.
 */
export const raiseTicket = (submission: { key: string; payload: Record<string, unknown> }) =>
  otherApp<{ ticket: { row_id: string; title: string; ticket_state: string } }>('tickets', '/api/app_actions/tickets/create', { idempotencyKey: submission.key, payload: submission.payload })

export interface OpenFeedback { row_id: string; title: string; ticket_state: string; problem: string | null; about: string | null }

/** The signed-in person's own open feedback on one report, newest first. */
export const openFeedback = async (reportKey: string) =>
  (await otherApp<{ answer: { tickets: OpenFeedback[]; count: number } }>('tickets', '/api/app_reads/tickets/about_report', { payload: { report_key: reportKey } })).answer
