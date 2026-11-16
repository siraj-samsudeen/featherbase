// Drives the dev mock Google provider the way a browser would, carrying the
// state/verifier cookies between hops (see oauth.test.ts for why).
import { vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { _setGoogleFetch } from '../src/oauth'

const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0])

export function sidCookie(res: Response): string {
  return cookiesOf(res).find((c) => c.startsWith('sid=')) ?? ''
}

export function handoffCode(res: Response): string | null {
  const location = res.headers.get('location') as string
  return new URLSearchParams(location.split('?')[1] ?? '').get('code')
}

type ApproveExtra = { subject?: string; hd?: string; name?: string }

/** The mock provider's approve URL; `origin` is for tests that run the dance on a listed address. */
export function mockApproveUrl(state: string, email: string, extra: ApproveExtra = {}, origin = ''): string {
  const params = new URLSearchParams({ state, redirect_uri: '/api/oauth/google/callback', email, name: extra.name ?? 'Test User', ...(extra.subject ? { subject: extra.subject } : {}), ...(extra.hd !== undefined ? { hd: extra.hd } : {}) })
  return `${origin}/api/oauth/mock/approve?${params}`
}

/**
 * Begins a sign-in (or, with `token`, a link for that signed-in person) and approves it at the
 * mock, stopping before the callback. `callback` is where Google would send the browser back
 * (null when the start or the approve was refused); `cookie` is what the browser carries there;
 * `challenge` is the state/verifier cookies alone.
 */
export async function beginMockApproval(api: TestClient, email: string, opts: ApproveExtra & { token?: string; origin?: string } = {}) {
  const { token, origin = '', ...extra } = opts
  const sid = token ? `sid=${token}` : ''
  const start = await api.fetch(`${origin}${token ? '/api/oauth/google/link' : '/api/oauth/google/login'}`, sid ? { headers: { cookie: sid } } : undefined)
  const challenge = cookiesOf(start)
  const cookie = [sid, ...challenge].filter(Boolean).join('; ')
  if (start.status !== 302) return { start, approve: start, callback: null, cookie, challenge }
  const state = new URLSearchParams((start.headers.get('location') as string).split('?')[1]).get('state') as string
  const approve = await api.fetch(mockApproveUrl(state, email, extra, origin), { headers: { cookie } })
  return { start, approve, callback: approve.status === 302 ? (approve.headers.get('location') as string) : null, cookie, challenge }
}

async function approveAndCallback(api: TestClient, email: string, opts: ApproveExtra & { token?: string }) {
  const { approve, callback, cookie } = await beginMockApproval(api, email, opts)
  return callback === null ? approve : api.fetch(callback, { headers: { cookie } })
}

/** A full Google sign-in through the mock; returns the callback response. */
export async function googleSignIn(api: TestClient, email: string, extra: ApproveExtra = {}) {
  return approveAndCallback(api, email, extra)
}

/** Redeem a sign-in's handoff code into `{ token, user }`. */
export async function redeemSession(api: TestClient, res: Response) {
  const out = await api.fetch('/api/oauth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sidCookie(res) },
    body: JSON.stringify({ code: handoffCode(res) }),
  })
  return (await out.json()) as { token: string; user: { row_id: string; sign_in?: { method: string; identity: string } } }
}

/** A signed-in person (session `token`) links a Google account through the mock. */
export async function googleLink(api: TestClient, token: string, email: string, extra: { subject?: string; hd?: string } = {}) {
  return approveAndCallback(api, email, { ...extra, token })
}

export const linkOutcome = (res: Response) =>
  new URLSearchParams((res.headers.get('location') ?? '').split('?')[1] ?? '').get('link')

/** Runs `fn` with Google's two endpoints answered by `handler`; the real fetch is back afterwards. */
export async function withGoogleFetch<T>(handler: NonNullable<Parameters<typeof _setGoogleFetch>[0]>, fn: () => Promise<T>): Promise<T> {
  _setGoogleFetch(handler)
  try {
    return await fn()
  } finally {
    _setGoogleFetch(null)
  }
}

/** Turns the dev mock Google provider on or off for the rest of the test (vitest restores it). */
export function mockOAuth(on: boolean) {
  vi.stubEnv('ALLOW_MOCK_OAUTH', on ? '1' : '')
}
