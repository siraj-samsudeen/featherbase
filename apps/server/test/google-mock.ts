// Drives the dev mock Google provider the way a browser would, carrying the
// state/verifier cookies between hops (see oauth.test.ts for why).
import type { TestClient } from 'feather-testing-postgres'

const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0])

export function sidCookie(res: Response): string {
  return cookiesOf(res).find((c) => c.startsWith('sid=')) ?? ''
}

export function handoffCode(res: Response): string | null {
  const location = res.headers.get('location') as string
  return new URLSearchParams(location.split('?')[1] ?? '').get('code')
}

async function approveAndCallback(api: TestClient, start: Response, cookie: string, email: string, extra: { subject?: string; hd?: string; name?: string }) {
  const location = start.headers.get('location') as string
  const state = new URLSearchParams(location.split('?')[1]).get('state') as string
  const all = [cookie, ...cookiesOf(start)].filter(Boolean).join('; ')
  const approve = await api.fetch(
    '/api/oauth/mock/approve?' +
      new URLSearchParams({ state, redirect_uri: '/api/oauth/google/callback', email, name: extra.name ?? 'Test User', ...(extra.subject ? { subject: extra.subject } : {}), ...(extra.hd !== undefined ? { hd: extra.hd } : {}) }).toString(),
    { headers: { cookie: all } },
  )
  if (approve.status !== 302) return approve
  return api.fetch(approve.headers.get('location') as string, { headers: { cookie: all } })
}

/** A full Google sign-in through the mock; returns the callback response. */
export async function googleSignIn(api: TestClient, email: string, extra: { subject?: string; hd?: string; name?: string } = {}) {
  const start = await api.fetch('/api/oauth/google/login')
  if (start.status !== 302) return start
  return approveAndCallback(api, start, '', email, extra)
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
  const cookie = `sid=${token}`
  const start = await api.fetch('/api/oauth/google/link', { headers: { cookie } })
  if (start.status !== 302) return start
  return approveAndCallback(api, start, cookie, email, extra)
}

export const linkOutcome = (res: Response) =>
  new URLSearchParams((res.headers.get('location') ?? '').split('?')[1] ?? '').get('link')
