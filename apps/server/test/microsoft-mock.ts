// Drives the dev stand-in for Microsoft the way a browser would, carrying the
// state/verifier cookies between hops (the twin of google-mock.ts).
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { _setMicrosoftFetch } from '../src/microsoft'

const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0])

export const TENANT = '0b7c1f6e-3c1a-4f7e-9a63-2a6a3c1d9e11'

/** What the stand-in signs into its code: an Entra account. `edov` false is an
 *  address the tenant has not verified (nOAuth). */
export type MicrosoftAccount = { oid: string; tid?: string; name?: string; edov?: boolean }

/** Begins a sign-in (or, with `token`, a link) and approves it at the stand-in. */
export async function beginMicrosoftApproval(api: TestClient, email: string, account: MicrosoftAccount & { token?: string }) {
  const { token, ...acct } = account
  const sid = token ? `sid=${token}` : ''
  const start = await api.fetch(token ? '/api/oauth/microsoft/link' : '/api/oauth/microsoft/login', sid ? { headers: { cookie: sid } } : undefined)
  const cookie = [sid, ...cookiesOf(start)].filter(Boolean).join('; ')
  if (start.status !== 302) return { start, approve: start, callback: null, cookie }
  const state = new URLSearchParams((start.headers.get('location') as string).split('?')[1]).get('state') as string
  const params = new URLSearchParams({
    state,
    redirect_uri: '/api/oauth/microsoft/callback',
    email,
    name: acct.name ?? 'Test User',
    tid: acct.tid ?? TENANT,
    oid: acct.oid,
    edov: acct.edov === false ? '0' : '1',
  })
  const approve = await api.fetch(`/api/oauth/mock/microsoft/approve?${params}`, { headers: { cookie } })
  return { start, approve, callback: approve.status === 302 ? (approve.headers.get('location') as string) : null, cookie }
}

/** A full Microsoft sign-in through the stand-in; returns the callback response. */
export async function microsoftSignIn(api: TestClient, email: string, account: MicrosoftAccount) {
  const { approve, callback, cookie } = await beginMicrosoftApproval(api, email, account)
  return callback === null ? approve : api.fetch(callback, { headers: { cookie, accept: 'text/html' } })
}

/** A signed-in person (session `token`) links a Microsoft account through the stand-in. */
export async function microsoftLink(api: TestClient, token: string, email: string, account: MicrosoftAccount) {
  const { approve, callback, cookie } = await beginMicrosoftApproval(api, email, { ...account, token })
  return callback === null ? approve : api.fetch(callback, { headers: { cookie, accept: 'text/html' } })
}

export async function configureMicrosoft(o: { client_id?: string; allowed_email_domains?: string; new_person?: string; enabled?: boolean; self_link?: boolean; tenant?: string } = {}) {
  const [row] = await sql`select client_id, allowed_email_domains, new_person, enabled, self_link, settings from sign_in_method where row_id = 'microsoft'`
  const settings = { ...(typeof row.settings === 'string' ? JSON.parse(row.settings) : (row.settings ?? {})), ...(o.tenant ? { tenant: o.tenant } : {}) }
  await sql`update sign_in_method set
    client_id = ${o.client_id ?? row.client_id ?? ''},
    allowed_email_domains = ${o.allowed_email_domains ?? row.allowed_email_domains ?? ''},
    new_person = ${o.new_person ?? row.new_person},
    enabled = ${o.enabled ?? true},
    self_link = ${o.self_link ?? row.self_link},
    settings = ${JSON.stringify(settings)}::text::jsonb
    where row_id = 'microsoft'`
}

export async function microsoftLinks(person: string) {
  return sql`select subject, linked_by, email from sign_in_identity where person_id = ${person} and method = 'microsoft' and ended_at is null`
}

/** Runs `fn` with Microsoft's token endpoint answered by `handler`. */
export async function withMicrosoftFetch<T>(handler: NonNullable<Parameters<typeof _setMicrosoftFetch>[0]>, fn: () => Promise<T>): Promise<T> {
  _setMicrosoftFetch(handler)
  try {
    return await fn()
  } finally {
    _setMicrosoftFetch(null)
  }
}
